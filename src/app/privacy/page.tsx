import Link from "next/link";
import { CURRENT_PRIVACY_VERSION } from "@/lib/legal";
import { SCHOOLS_CONTACT_EMAIL } from "@/components/marketing/site-chrome";

// The root layout's template adds " · PrepHub".
export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
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
          <li>
            School information, when your school or district provides PrepHub: your verified school email address, your campus,
            and your graduation year.
          </li>
          <li>
            Class information, when you join a teacher&apos;s class: the last name you give that class. Only that class&apos;s
            teacher sees it; your account itself holds your first name only.
          </li>
          <li>
            Learning activity: your answers in the Diagnostic, Practice Sets, Focused Practice, the 800 Club, 1v1 Rush, the Daily
            Challenge and homework, along with Ability Scores and Predicted SAT Score history.
          </li>
          <li>Billing information: subscription and payment status, handled by our payment processor, Stripe. PrepHub never stores your card details directly.</li>
        </ul>

        <h2 className="text-lg font-semibold">2. How We Use Information</h2>
        <p>We use your information to:</p>
        <ul className="list-inside list-disc">
          <li>Operate your account and personalize your practice sets and Predicted SAT Score.</li>
          <li>Verify school or district eligibility for school-sponsored access.</li>
          <li>Process payments for individual subscriptions.</li>
          <li>Show your school, your teachers and your classmates exactly what Section 3 describes, and nothing more.</li>
          <li>Send account email: password resets, results, reminders you can turn off, and homework and school announcements.</li>
        </ul>

        <h2 className="text-lg font-semibold">3. Who Can See What</h2>
        <ul className="list-inside list-disc">
          <li>
            School administrators, for students registered through their school: first name, school email, graduation year, and
            how much work a student has done (questions answered, sessions finished, study time, last active date).
            Administrators never see whether answers were right, Ability Scores, mastery, or predicted scores. School-wide
            figures are totals, and figures for very small groups are withheld.
          </li>
          <li>
            Teachers, for a class you choose to join: your first name, the last name you give the class, your email address, and
            your answers and results on the homework they assign. Nothing else from your account.
          </li>
          <li>
            Other students never see your scores, mastery, or answers, with two exceptions you take part in: a 1v1 Rush opponent
            sees your first name and the result of that match, and your school&apos;s weekly Rush leaderboard shows your first
            name, class year, and best score that week to students at your school. You can hide yourself from the leaderboard in
            Settings, and a school or district can turn it off.
          </li>
          <li>The School Community page shows school-wide totals only, never names, scores, or rankings.</li>
        </ul>

        <h2 className="text-lg font-semibold">4. Third Parties</h2>
        <p>We share information with a small number of service providers, only as needed to operate PrepHub:</p>
        <ul className="list-inside list-disc">
          <li>Stripe — payment processing for individual subscriptions.</li>
          <li>Google — optional sign-in, if you choose to use it.</li>
          <li>Resend — delivering email.</li>
          <li>Netlify, Neon and Cloudflare — hosting the site, its database, and uploaded images and videos.</li>
          <li>Upstash — counting sign-in attempts to slow down abuse; it stores only scrambled (hashed) identifiers.</li>
          <li>YouTube — lesson videos, embedded in privacy-enhanced mode.</li>
          <li>
            AI model providers (Anthropic, DeepSeek) — used to prepare question content and explanations. They are never sent
            anything a student writes or any information about a student.
          </li>
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
          identifying information — for legal, reporting, and academic-integrity purposes. Copies of emails we have sent are
          deleted after 30 days.
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
        <p>
          Questions about this policy, or a request about your information, can be sent to{" "}
          <a href={`mailto:${SCHOOLS_CONTACT_EMAIL}`} className="underline">
            {SCHOOLS_CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </main>
  );
}
