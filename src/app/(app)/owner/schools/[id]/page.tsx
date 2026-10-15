import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { getOrganizationDetail, listAllSchools } from "@/lib/owner/organizations";
import { listMemberships } from "@/lib/owner/memberships";
import { listRoster } from "@/lib/owner/roster";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusActions } from "./status-actions";
import { EditOrganizationForm } from "./edit-organization-form";
import { CommunityGoalForm } from "./community-goal-form";
import { TotalEnrollmentForm } from "./total-enrollment-form";
import { AdministratorsPanel } from "./administrators-panel";
import { AddSchoolForm } from "./add-school-form";
import { MembershipsPanel } from "./memberships-panel";
import { RosterPanel } from "./roster-panel";
import { LogoForm } from "./logo-form";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await getOrganizationDetail(id);
  const memberships = await listMemberships(id);
  const allSchools = await listAllSchools();
  const roster = await listRoster(id);

  const eligibleSchools =
    org.organizationType === "DISTRICT"
      ? org.schools.map((s) => ({ id: s.id, officialName: s.officialName }))
      : [{ id: org.id, officialName: org.officialName }];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <div>
        <Link href="/owner/schools" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          Back to Schools
        </Link>
      </div>

      <PageHeader
        title={org.officialName}
        description={org.organizationType === "DISTRICT" ? "District" : "School"}
      >
        <Badge variant={org.status === "ACTIVE" ? "default" : "secondary"}>{org.status}</Badge>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusActions id={org.id} status={org.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditOrganizationForm
            id={org.id}
            officialName={org.officialName}
            city={org.city}
            state={org.state}
            schoolYear={org.schoolYear}
            contractStartDate={org.contractStartDate}
            contractEndDate={org.contractEndDate}
            internalNotes={org.internalNotes}
          />
        </CardContent>
      </Card>

      {org.organizationType === "SCHOOL" && (
        <Card>
          <CardHeader>
            <CardTitle>Enrollment</CardTitle>
            <CardDescription>
              Drives the Registered PrepHub Students / Registration Percentage shown on this school&apos;s Admin Overview
              (PRD-011 §9).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TotalEnrollmentForm id={org.id} totalEnrollment={org.totalEnrollment} />
          </CardContent>
        </Card>
      )}

      {org.organizationType === "SCHOOL" && (
        <Card>
          <CardHeader>
            <CardTitle>Community Goal</CardTitle>
            <CardDescription>Shown on this school&apos;s students&apos; School Community page (PRD-009 §7).</CardDescription>
          </CardHeader>
          <CardContent>
            <CommunityGoalForm
              id={org.id}
              communityGoalMetric={org.communityGoalMetric}
              communityGoalTarget={org.communityGoalTarget}
            />
          </CardContent>
        </Card>
      )}

      {org.organizationType === "DISTRICT" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Schools</CardTitle>
              <AddSchoolForm
                districtId={org.id}
                districtCity={org.city}
                districtState={org.state}
                districtSchoolYear={org.schoolYear}
                contractStartDate={org.contractStartDate}
                contractEndDate={org.contractEndDate}
              />
            </div>
          </CardHeader>
          <CardContent>
            {org.schools.length === 0 ? (
              <EmptyState icon={Building2} title="No schools added yet" />
            ) : (
              <ul className="flex flex-col gap-2">
                {org.schools.map((school) => (
                  <li key={school.id} className="flex items-center justify-between text-sm">
                    <span>{school.officialName}</span>
                    <Link href={`/owner/schools/${school.id}`} className="underline">
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Administrators</CardTitle>
          <CardDescription>Each administrator uses a separate account.</CardDescription>
        </CardHeader>
        <CardContent>
          <AdministratorsPanel
            organizationId={org.id}
            administrators={org.administratorAssigns.map((a) => ({
              assignmentId: a.id,
              scope: a.scope,
              userId: a.user.id,
              firstName: a.user.firstName,
              email: a.user.email,
            }))}
          />
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>District branding</CardTitle>
          <CardDescription>
            Shown to this organization&apos;s students inside the product, so PrepHub reads as something their school
            provides.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LogoForm id={org.id} logoMediaId={org.logoMediaId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roster &amp; access</CardTitle>
          <CardDescription>
            Who this organization lets in, and the list of students it has told us are eligible. A roster entry
            is not an account — students still sign up themselves and are recognised when they do.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RosterPanel
            id={org.id}
            enrollmentMode={org.enrollmentMode}
            entries={roster.entries}
            total={roster.total}
            joined={roster.joined}
            hasDomain={org.domains.some((d) => d.isActive)}
            multiCampus={eligibleSchools.length > 1}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Students</CardTitle>
        </CardHeader>
        <CardContent>
          <MembershipsPanel
            organizationId={org.id}
            memberships={memberships.map((m) => ({
              id: m.id,
              status: m.status,
              currentGrade: m.currentGrade,
              expectedGraduationYear: m.expectedGraduationYear,
              verifiedSchoolEmail: m.verifiedSchoolEmail,
              student: { firstName: m.student.firstName, email: m.student.email },
            }))}
            schools={eligibleSchools}
            transferTargets={allSchools.filter((s) => s.id !== org.id)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
