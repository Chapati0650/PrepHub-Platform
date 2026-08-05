import Link from "next/link";
import { School, CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DirectorySearch } from "./directory-search";

// PRD-002 §5: shown to a student who hasn't chosen an access method yet.
export default function AccessSelectionPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Choose how you&apos;ll access PrepHub</h1>
        <p className="text-muted-foreground">
          Select the option that applies to you. You can change your access method later.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <School className="mb-2 size-6 text-muted-foreground" aria-hidden />
            <CardTitle>Access Through My School</CardTitle>
            <CardDescription>My school or district provides PrepHub access.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/access/verify-school">Continue</Link>} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CreditCard className="mb-2 size-6 text-muted-foreground" aria-hidden />
            <CardTitle>Individual Subscription</CardTitle>
            <CardDescription>I want to purchase PrepHub for myself.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link href="/pricing">View Plans</Link>} />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium">Not sure if your school has PrepHub?</h2>
          <p className="text-sm text-muted-foreground">Search for your school or district below.</p>
        </div>
        <DirectorySearch />
      </div>

      {/* PRD-012 §5/§26: the diagnostic is free for every student, including
          those who haven't chosen an access method yet — it must remain
          reachable from here rather than gating behind school/subscription choice. */}
      <p className="text-sm text-muted-foreground">
        Not ready to choose?{" "}
        <Link href="/diagnostic" className="underline underline-offset-2 hover:text-foreground">
          Take the free diagnostic first
        </Link>
        .
      </p>
    </div>
  );
}
