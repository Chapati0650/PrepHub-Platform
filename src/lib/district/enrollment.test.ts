import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getAccessContext, invalidateAccessContext } from "@/lib/entitlements";
import {
  __resetPartnerDomainCache,
  catchUpDistrictEnrollment,
  ensureDistrictMembership,
  findDistrictMatch,
} from "@/lib/district/enrollment";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    studentMembership: { findUnique: vi.fn(), create: vi.fn() },
    schoolRosterEntry: { findFirst: vi.fn(), count: vi.fn() },
    organizationDomain: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/entitlements", () => ({
  getAccessContext: vi.fn(),
  invalidateAccessContext: vi.fn(),
}));

const mocked = prisma as unknown as {
  user: Record<string, ReturnType<typeof vi.fn>>;
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  schoolRosterEntry: Record<string, ReturnType<typeof vi.fn>>;
  organizationDomain: Record<string, ReturnType<typeof vi.fn>>;
};

const LIVE = {
  status: "ACTIVE",
  contractStartDate: new Date("2020-01-01T00:00:00Z"),
  contractEndDate: new Date("2099-01-01T00:00:00Z"),
};

function rosterEntry(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "district1",
    schoolId: "campus2",
    graduationYear: null,
    organization: { ...LIVE, officialName: "Northwest ISD" },
    school: { officialName: "Byron Nelson High School" },
    ...overrides,
  };
}

function domainRecord(org: Record<string, unknown>) {
  return { organization: { id: "district1", officialName: "Northwest ISD", organizationType: "DISTRICT", enrollmentMode: "DOMAIN", ...LIVE, schools: [], ...org } };
}

const TWO_CAMPUSES = [
  { id: "campus1", officialName: "Northwest High School" },
  { id: "campus2", officialName: "Byron Nelson High School" },
];

function student(overrides: Record<string, unknown> = {}) {
  return { id: "s1", email: "kid@nisd.net", emailVerified: new Date(), grade: 11, role: "STUDENT", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetPartnerDomainCache();
  mocked.schoolRosterEntry.findFirst.mockResolvedValue(null);
  mocked.organizationDomain.findFirst.mockResolvedValue(null);
  mocked.studentMembership.findUnique.mockResolvedValue(null);
  mocked.studentMembership.create.mockResolvedValue({});
});

describe("findDistrictMatch", () => {
  it("prefers the roster, which names the campus, over the domain", async () => {
    mocked.schoolRosterEntry.findFirst.mockResolvedValue(rosterEntry({ graduationYear: 2027 }));
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: TWO_CAMPUSES }));

    expect(await findDistrictMatch("Kid@NISD.net")).toEqual({
      kind: "MATCH",
      via: "ROSTER",
      organizationId: "district1",
      organizationName: "Northwest ISD",
      schoolId: "campus2",
      schoolName: "Byron Nelson High School",
      graduationYear: 2027,
    });
    expect(mocked.schoolRosterEntry.findFirst.mock.calls[0][0].where.email).toBe("kid@nisd.net");
    expect(mocked.organizationDomain.findFirst).not.toHaveBeenCalled();
  });

  it("reports a rostered address whose contract isn't live as NOT_LIVE, not as a match", async () => {
    mocked.schoolRosterEntry.findFirst.mockResolvedValue(
      rosterEntry({ organization: { ...LIVE, status: "SUSPENDED", officialName: "Northwest ISD" } }),
    );
    expect(await findDistrictMatch("kid@nisd.net")).toEqual({ kind: "NOT_LIVE" });
  });

  it("matches a one-campus district by domain", async () => {
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: [TWO_CAMPUSES[0]] }));
    expect(await findDistrictMatch("kid@nisd.net")).toMatchObject({
      kind: "MATCH",
      via: "DOMAIN_MATCH",
      schoolId: "campus1",
      schoolName: "Northwest High School",
    });
  });

  it("asks for the campus when a multi-campus district matches by domain", async () => {
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: TWO_CAMPUSES }));
    expect(await findDistrictMatch("kid@nisd.net")).toEqual({
      kind: "NEEDS_CAMPUS",
      organizationId: "district1",
      organizationName: "Northwest ISD",
      campuses: TWO_CAMPUSES,
    });
  });

  it("names the organization when it admits by roster only and the address isn't on it", async () => {
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ enrollmentMode: "ROSTER", schools: TWO_CAMPUSES }));
    expect(await findDistrictMatch("kid@nisd.net")).toEqual({ kind: "NOT_ON_ROSTER", organizationName: "Northwest ISD" });
  });

  it("returns NONE for an address no district knows", async () => {
    expect(await findDistrictMatch("kid@gmail.com")).toEqual({ kind: "NONE" });
  });
});

describe("ensureDistrictMembership", () => {
  it("never enrolls a non-student account", async () => {
    mocked.user.findUnique.mockResolvedValue(student({ role: "TEACHER" }));
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: [TWO_CAMPUSES[0]] }));

    expect(await ensureDistrictMembership("s1")).toBe("NO_PARTNER");
    expect(mocked.studentMembership.create).not.toHaveBeenCalled();
  });

  it("leaves an existing membership alone", async () => {
    mocked.user.findUnique.mockResolvedValue(student());
    mocked.studentMembership.findUnique.mockResolvedValue({ id: "m1" });

    expect(await ensureDistrictMembership("s1")).toBe("ALREADY_MEMBER");
    expect(mocked.studentMembership.create).not.toHaveBeenCalled();
  });

  it("won't act on an address nobody has verified — the whole security model", async () => {
    mocked.user.findUnique.mockResolvedValue(student({ emailVerified: null }));
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: [TWO_CAMPUSES[0]] }));

    expect(await ensureDistrictMembership("s1")).toBe("NEEDS_EMAIL_VERIFICATION");
    expect(mocked.studentMembership.create).not.toHaveBeenCalled();
  });

  it("asks an unverified multi-campus student to confirm first, not to pick a campus they can't use yet", async () => {
    mocked.user.findUnique.mockResolvedValue(student({ emailVerified: null }));
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: TWO_CAMPUSES }));

    expect(await ensureDistrictMembership("s1", { schoolId: "campus1" })).toBe("NEEDS_EMAIL_VERIFICATION");
    expect(mocked.studentMembership.create).not.toHaveBeenCalled();
  });

  it("asks a verified student which campus, rather than guessing one", async () => {
    mocked.user.findUnique.mockResolvedValue(student());
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: TWO_CAMPUSES }));

    expect(await ensureDistrictMembership("s1")).toBe("NEEDS_CAMPUS");
    expect(mocked.studentMembership.create).not.toHaveBeenCalled();
  });

  it("refuses a campus that isn't one of the district's own", async () => {
    mocked.user.findUnique.mockResolvedValue(student());
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: TWO_CAMPUSES }));

    expect(await ensureDistrictMembership("s1", { schoolId: "someone-elses-school" })).toBe("NEEDS_CAMPUS");
    expect(mocked.studentMembership.create).not.toHaveBeenCalled();
  });

  it("enrolls into the campus the student picked", async () => {
    mocked.user.findUnique.mockResolvedValue(student());
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: TWO_CAMPUSES }));

    expect(await ensureDistrictMembership("s1", { schoolId: "campus2" })).toBe("CREATED");
    expect(mocked.studentMembership.create.mock.calls[0][0].data).toMatchObject({
      studentId: "s1",
      organizationId: "district1",
      schoolId: "campus2",
      activationMethod: "DOMAIN_MATCH",
      verifiedSchoolEmail: "kid@nisd.net",
      currentGrade: 11,
    });
  });

  it("takes the grade from the roster's graduation year when onboarding hasn't asked yet", async () => {
    mocked.user.findUnique.mockResolvedValue(student({ grade: null }));
    const graduationYear = new Date().getFullYear() + 2;
    mocked.schoolRosterEntry.findFirst.mockResolvedValue(rosterEntry({ graduationYear }));

    expect(await ensureDistrictMembership("s1")).toBe("CREATED");
    const data = mocked.studentMembership.create.mock.calls[0][0].data;
    expect(data.activationMethod).toBe("ROSTER");
    expect(data.expectedGraduationYear).toBe(graduationYear);
    expect(typeof data.currentGrade).toBe("number");
  });

  it("waits for onboarding when nothing says the grade", async () => {
    mocked.user.findUnique.mockResolvedValue(student({ grade: null }));
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: [TWO_CAMPUSES[0]] }));

    expect(await ensureDistrictMembership("s1")).toBe("NO_GRADE");
    expect(mocked.studentMembership.create).not.toHaveBeenCalled();
  });

  it("treats losing a creation race as already being a member", async () => {
    mocked.user.findUnique.mockResolvedValue(student());
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: [TWO_CAMPUSES[0]] }));
    mocked.studentMembership.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "m1" });
    mocked.studentMembership.create.mockRejectedValue(new Error("Unique constraint failed"));

    expect(await ensureDistrictMembership("s1")).toBe("ALREADY_MEMBER");
  });
});

describe("catchUpDistrictEnrollment", () => {
  const getContext = getAccessContext as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocked.organizationDomain.findMany.mockResolvedValue([{ domain: "nisd.net" }]);
    mocked.schoolRosterEntry.count.mockResolvedValue(0);
  });

  it("says nothing to a student whose email no district knows, without a lookup", async () => {
    getContext.mockResolvedValue({ user: { email: "kid@gmail.com" }, subscription: null, membership: null });

    expect(await catchUpDistrictEnrollment("s1")).toEqual({ outcome: "NO_PARTNER", prompt: null });
    expect(mocked.user.findUnique).not.toHaveBeenCalled();
  });

  it("asks an unverified district student to confirm their email, naming the school", async () => {
    getContext.mockResolvedValue({ user: { email: "kid@nisd.net" }, subscription: null, membership: null });
    mocked.user.findUnique.mockResolvedValue(student({ emailVerified: null }));
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: [TWO_CAMPUSES[0]] }));

    expect(await catchUpDistrictEnrollment("s1")).toEqual({
      outcome: "NEEDS_EMAIL_VERIFICATION",
      prompt: { kind: "CONFIRM_EMAIL", organizationName: "Northwest High School", email: "kid@nisd.net" },
    });
  });

  it("asks a verified multi-campus student to pick their school", async () => {
    getContext.mockResolvedValue({ user: { email: "kid@nisd.net" }, subscription: null, membership: null });
    mocked.user.findUnique.mockResolvedValue(student());
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: TWO_CAMPUSES }));

    expect(await catchUpDistrictEnrollment("s1")).toEqual({
      outcome: "NEEDS_CAMPUS",
      prompt: { kind: "PICK_CAMPUS", organizationName: "Northwest ISD" },
    });
  });

  it("drops the cached access context once it creates a membership, so the same render sees it", async () => {
    getContext.mockResolvedValue({ user: { email: "kid@nisd.net" }, subscription: null, membership: null });
    mocked.user.findUnique.mockResolvedValue(student());
    mocked.organizationDomain.findFirst.mockResolvedValue(domainRecord({ schools: [TWO_CAMPUSES[0]] }));

    expect(await catchUpDistrictEnrollment("s1")).toEqual({ outcome: "CREATED", prompt: null });
    expect(invalidateAccessContext).toHaveBeenCalledWith("s1");
  });

  it("never runs for a student who already has a membership or a subscription", async () => {
    getContext.mockResolvedValue({ user: { email: "kid@nisd.net" }, subscription: { id: "sub" }, membership: null });
    expect((await catchUpDistrictEnrollment("s1")).prompt).toBeNull();
    getContext.mockResolvedValue({ user: { email: "kid@nisd.net" }, subscription: null, membership: { id: "m1" } });
    expect(await catchUpDistrictEnrollment("s1")).toEqual({ outcome: "ALREADY_MEMBER", prompt: null });
    expect(mocked.user.findUnique).not.toHaveBeenCalled();
  });
});
