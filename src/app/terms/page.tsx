import Link from "next/link";
import { CURRENT_TOS_VERSION } from "@/lib/legal";

export const metadata = { title: "Terms of Service — PrepHub" };

export default function TermsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <Link href="/" className="text-sm underline">
          Back to PrepHub
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">Terms of Service</h1>
      <p className="text-sm text-muted-foreground">Version {CURRENT_TOS_VERSION}</p>

      <section className="flex flex-col gap-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">1. Acceptance of Terms</h2>
        <p>
          By creating a PrepHub account or using the PrepHub service (&quot;PrepHub,&quot; &quot;we,&quot; &quot;us&quot;), you agree
          to these Terms of Service. If you do not agree, do not use PrepHub.
        </p>

        <h2 className="text-lg font-semibold">2. Eligibility</h2>
        <p>
          PrepHub is intended for students preparing for the SAT. You must be at least 13 years old to create an account. If you are
          under 18, you should have a parent or guardian&apos;s permission to use PrepHub.
        </p>

        <h2 className="text-lg font-semibold">3. Accounts</h2>
        <p>
          You are responsible for keeping your login credentials secure and for all activity under your account. A single account may
          be linked to an individual subscription, a partnered school or district, or both — your login, your access method, and your
          learning history are tracked separately, and changing one never deletes another.
        </p>

        <h2 className="text-lg font-semibold">4. Subscriptions and Billing</h2>
        <p>
          Individual subscriptions are billed through Stripe on a recurring basis (monthly or annual) until canceled. Canceling stops
          future renewals but keeps access through the end of the current billing period. Some students access PrepHub through a
          school or district contract instead of a personal subscription; that access is governed by the applicable
          institutional agreement and ends when the school&apos;s contract ends or the student is no longer enrolled.
        </p>

        <h2 className="text-lg font-semibold">5. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul className="list-inside list-disc">
          <li>Share your account credentials with another person.</li>
          <li>Attempt to copy, scrape, or redistribute PrepHub&apos;s question content.</li>
          <li>Interfere with or attempt to circumvent PrepHub&apos;s security or access controls.</li>
          <li>Use PrepHub for any purpose other than personal SAT preparation.</li>
        </ul>

        <h2 className="text-lg font-semibold">6. Content Ownership</h2>
        <p>
          All questions, explanations, videos, and other instructional content on PrepHub are owned by PrepHub or its licensors.
          Your own responses, study activity, and account information remain yours, subject to our{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>

        <h2 className="text-lg font-semibold">7. Disclaimers</h2>
        <p>
          PrepHub&apos;s Predicted SAT Score is an estimate based on your practice performance. It is not a guarantee of your actual
          SAT score. PrepHub is provided &quot;as is&quot; without warranties of any kind.
        </p>

        <h2 className="text-lg font-semibold">8. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, PrepHub is not liable for indirect, incidental, or consequential damages arising
          from your use of the service, including reliance on any Predicted SAT Score.
        </p>

        <h2 className="text-lg font-semibold">9. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. Material changes will be reflected in a new version date above. Continued use
          of PrepHub after a change constitutes acceptance of the updated Terms.
        </p>

        <h2 className="text-lg font-semibold">10. Contact</h2>
        <p>Questions about these Terms can be sent to the account owner administering your PrepHub instance.</p>
      </section>
    </div>
  );
}
