import Link from "next/link";
import { CURRENT_PRIVACY_VERSION } from "@/lib/legal";

export const metadata = { title: "Privacy Policy — PrepHub" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <Link href="/" className="text-sm underline">
          Back to PrepHub
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Version {CURRENT_PRIVACY_VERSION}</p>

      <section className="flex flex-col gap-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold">1. Information We Collect</h2>
        <p>We collect the information necessary to run PrepHub:</p>
        <ul className="list-inside list-disc">
          <li>Account information: first name, email address, and grade level.</li>
          <li>Authentication information: a securely hashed password, or a Google account link if you sign in with Google.</li>
          <li>School verification information: a verified school email address, when you connect a school or district account.</li>
          <li>Learning activity: diagnostic and practice-set responses, Ability Scores, and Predicted SAT Score history.</li>
          <li>Billing information: subscription and payment status, handled by our payment processor, Stripe. PrepHub never stores your card details directly.</li>
        </ul>

        <h2 className="text-lg font-semibold">2. How We Use Information</h2>
        <p>We use your information to:</p>
        <ul className="list-inside list-disc">
          <li>Operate your account and personalize your practice sets and Predicted SAT Score.</li>
          <li>Verify school or district eligibility for school-sponsored access.</li>
          <li>Process payments for individual subscriptions.</li>
          <li>Provide aggregate, non-identifying statistics to your school community (see below) and, where applicable, to school administrators.</li>
        </ul>

        <h2 className="text-lg font-semibold">3. School Administrator Visibility</h2>
        <p>
          Administrators at a partnered school or district can see aggregate, organization-level statistics about their students.
          Individual predicted scores, individual mastery levels, and individual question-level performance are never shown to
          other students. Our School Community page in particular never displays individual names, scores, or rankings — only
          school-wide totals.
        </p>

        <h2 className="text-lg font-semibold">4. Third Parties</h2>
        <p>We share information with a small number of service providers, only as needed to operate PrepHub:</p>
        <ul className="list-inside list-disc">
          <li>Stripe — payment processing for individual subscriptions.</li>
          <li>Google — optional sign-in, if you choose to use it.</li>
        </ul>
        <p>We do not sell your personal information.</p>

        <h2 className="text-lg font-semibold">5. Children&apos;s Privacy</h2>
        <p>
          PrepHub requires every account holder to confirm they are at least 13 years old at signup. We do not knowingly collect
          information from children under 13.
        </p>

        <h2 className="text-lg font-semibold">6. Data Retention and Deletion</h2>
        <p>
          You can delete your account at any time from Settings. Deleting your account removes your personal information and
          disables login, but your historical learning activity is preserved in an anonymized form — no longer linked to
          identifying information — for legal, reporting, and academic-integrity purposes.
        </p>

        <h2 className="text-lg font-semibold">7. Security</h2>
        <p>
          Passwords are stored using industry-standard hashing, never in plain text. All authorization checks happen on our
          servers, not just in the interface you see.
        </p>

        <h2 className="text-lg font-semibold">8. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Material changes will be reflected in a new version date above.
        </p>

        <h2 className="text-lg font-semibold">9. Contact</h2>
        <p>Questions about this policy can be sent to the account owner administering your PrepHub instance.</p>
      </section>
    </div>
  );
}
