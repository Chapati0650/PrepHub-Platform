import { describe, expect, it } from "vitest";
import { resolveBranding, type BrandingSource } from "./resolve";
import { checkLogoDimensions } from "./upload-logo";

const none = (officialName: string): BrandingSource => ({ officialName, logoMediaId: null, brandName: null, brandColor: null });
const district: BrandingSource = { officialName: "Houston Independent School District", logoMediaId: "logo-d", brandName: "Houston ISD", brandColor: "#00205B" };

describe("resolveBranding", () => {
  it("returns null when neither campus nor district has branding", () => {
    expect(resolveBranding(none("Demo High"), none("District"))).toBeNull();
    expect(resolveBranding(none("Demo High"), null)).toBeNull();
  });

  it("inherits the district's branding when the campus sets none", () => {
    expect(resolveBranding(none("Demo High"), district)).toEqual({
      name: "Houston ISD",
      logoMediaId: "logo-d",
      accent: { color: "#00205B", textColor: "#FFFFFF" },
      inherited: true,
    });
  });

  it("lets a campus override with its own identity, keeping the district color", () => {
    const campus: BrandingSource = { officialName: "Demo High", logoMediaId: "logo-c", brandName: null, brandColor: null };
    expect(resolveBranding(campus, district)).toEqual({
      name: "Demo High",
      logoMediaId: "logo-c",
      accent: { color: "#00205B", textColor: "#FFFFFF" },
      inherited: false,
    });
  });

  it("a campus color alone keeps the district's logo and name together", () => {
    const campus: BrandingSource = { officialName: "Demo High", logoMediaId: null, brandName: null, brandColor: "#FFD100" };
    const r = resolveBranding(campus, district)!;
    expect(r.name).toBe("Houston ISD");
    expect(r.logoMediaId).toBe("logo-d");
    expect(r.accent?.color).toBe("#FFD100");
  });

  it("works for a standalone school with only a color", () => {
    const r = resolveBranding({ officialName: "Lone School", logoMediaId: null, brandName: null, brandColor: "#BA0C2F" }, null)!;
    expect(r.name).toBe("Lone School");
    expect(r.logoMediaId).toBeNull();
    expect(r.inherited).toBe(false);
  });

  it("drops an unusable stored color but keeps the identity", () => {
    const r = resolveBranding({ ...district!, brandColor: "#FFFFFF" }, null)!;
    expect(r.accent).toBeNull();
    expect(r.logoMediaId).toBe("logo-d");
  });
});

describe("checkLogoDimensions", () => {
  it("accepts ordinary logos and rejects tiny or extreme-aspect ones", () => {
    expect(checkLogoDimensions(400, 120).ok).toBe(true);
    expect(checkLogoDimensions(16, 200).ok).toBe(false);
    expect(checkLogoDimensions(1200, 100).ok).toBe(false);
  });
});
