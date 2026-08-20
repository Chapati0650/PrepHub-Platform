import { Users } from "lucide-react";
import { getUserDirectory, type UserAccessType } from "@/lib/owner/users";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  SCHOOL_ADMINISTRATOR: "School Administrator",
  STUDENT: "Student",
};

const ACCESS_LABELS: Record<UserAccessType, string> = {
  INDIVIDUAL: "Individual",
  SCHOOL: "School-Sponsored",
  SCHOOL_ADMIN: "Admin Access",
  NONE: "Free",
};

function accessBadgeVariant(accessType: UserAccessType): "default" | "secondary" | "outline" {
  if (accessType === "INDIVIDUAL" || accessType === "SCHOOL") return "default";
  if (accessType === "SCHOOL_ADMIN") return "outline";
  return "secondary";
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// The Owner's platform-wide "every account, and who's paying" view — no
// other Owner page shows this; the others (Schools, Content) are scoped to
// a single school or the question bank. Deliberately a plain read-only
// table, not editable here — student info edits already live in the School
// Administrator's own Student Directory, scoped to their school.
export default async function OwnerUsersPage() {
  const { entries, stats } = await getUserDirectory();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader icon={Users} title="Users" description="Every account on PrepHub, and who's paying." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Users" value={stats.totalUsers.toLocaleString()} />
        <Stat label="Students" value={stats.totalStudents.toLocaleString()} />
        <Stat label="Premium" value={stats.premiumUsers.toLocaleString()} />
        <Stat label="Individual / School" value={`${stats.individualPremium} / ${stats.schoolPremium}`} />
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={Users} title="No users yet" description="Accounts will appear here as people sign up." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.firstName}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.email}</TableCell>
                  <TableCell>{ROLE_LABELS[entry.role] ?? entry.role}</TableCell>
                  <TableCell>
                    <Badge variant={accessBadgeVariant(entry.accessType)}>{ACCESS_LABELS[entry.accessType]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(entry.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className="font-heading text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
