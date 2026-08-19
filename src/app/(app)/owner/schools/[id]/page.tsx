import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { getOrganizationDetail, listAllSchools } from "@/lib/owner/organizations";
import { listMemberships } from "@/lib/owner/memberships";
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

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await getOrganizationDetail(id);
  const memberships = await listMemberships(id);
  const allSchools = await listAllSchools();

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
        icon={Building2}
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
