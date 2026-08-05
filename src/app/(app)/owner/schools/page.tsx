import Link from "next/link";
import { listOrganizations } from "@/lib/owner/organizations";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateOrganizationForm } from "./create-organization-form";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// PRD-017 §18: the Owner's fourth primary page — a compact table over every
// organization. Deliberately no seat-limit column/controls (§11: unlimited access).
export default async function OwnerSchoolsPage() {
  const organizations = await listOrganizations();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Schools</h1>
        <CreateOrganizationForm />
      </div>

      {organizations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No organizations yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead>Active Students</TableHead>
                <TableHead>Administrators</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">{org.officialName}</TableCell>
                  <TableCell>{org.organizationType === "DISTRICT" ? "District" : "School"}</TableCell>
                  <TableCell>
                    <Badge variant={org.status === "ACTIVE" ? "default" : "secondary"}>
                      {org.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(org.contractStartDate)} – {formatDate(org.contractEndDate)}
                  </TableCell>
                  <TableCell>{org.activeStudentCount}</TableCell>
                  <TableCell>{org.administratorCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(org.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <Link href={`/owner/schools/${org.id}`} className="text-sm underline">
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
