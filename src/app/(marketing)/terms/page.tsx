import Link from "next/link";
import { contactEmail, paymentsLive } from "@/lib/site";

export const metadata = { title: "Terms", description: "The terms for using Oriel, a practice tool for job interviews." };

/** Plain terms that match what the product does. A draft until reviewed by counsel, like the privacy policy. */
export default function TermsPage() {
  const contact = contactEmail();
  const beta = !paymentsLive();
  return (
    <main id="content" tabIndex={-1} className="frame pb-section pt-[calc(var(--header-h)+var(--spacing-hero))] focus:outline-none">
      <article className="max-w-column text-body text-fg-muted">
        <h1 className="text-display-l text-fg">Terms</h1>
        <p className="mt-5 text-body-l">By creating an account you agree to these terms. They&apos;re short on purpose.</p>
        <p className="mt-4 text-ui text-fg-subtle">Draft, pending legal review. Last updated November 7, 2026.</p>

        <Section title="What Oriel is">
          <p>Oriel is a practice tool. You talk to an AI interviewer and get feedback on your answers. It isn&apos;t a real interview, it isn&apos;t used by employers to screen anyone, and it doesn&apos;t give you answers during a real interview. Don&apos;t use it to do that.</p>
        </Section>

        <Section title="Feedback is a guide, not a verdict">
          <p>Feedback comes from automated measurements and an AI model. It can be wrong, especially camera-based estimates. It doesn&apos;t predict how any real interview will go. <Link href="/trust" className="text-fg underline decoration-1 underline-offset-text">How accurate the feedback is</Link> explains what was tested and what wasn&apos;t.</p>
        </Section>

        <Section title="Your account and your content">
          <ul className="list-disc space-y-2 pl-5">
            <li>Keep your password to yourself. You&apos;re responsible for what happens under your account.</li>
            <li>What you say, upload and record stays yours. You let us store and process it only to run the service for you, as the <Link href="/privacy" className="text-fg underline decoration-1 underline-offset-text">privacy policy</Link> describes.</li>
            <li>You can download your data or delete your account at any time from Profile.</li>
          </ul>
        </Section>

        <Section title="Fair use">
          <p>Don&apos;t try to break, overload or get around the service&apos;s limits, access other people&apos;s data, or upload anything you don&apos;t have the right to share. We may suspend accounts that do.</p>
        </Section>

        <Section title="Plans and payment">
          {beta
            ? <p>Oriel is in beta. Payments aren&apos;t live, so you won&apos;t be charged. Plans and prices may change before payments start, and we&apos;ll say so before charging anyone.</p>
            : <p>Paid plans are billed as shown at checkout. You can cancel at any time; a cancelled plan runs until the end of the period you paid for.</p>}
        </Section>

        <Section title="Availability and changes">
          <p>We try to keep Oriel running and your data safe, but the service is provided as is, without guarantees. We may change these terms; if a change matters, we&apos;ll tell you in the app before it applies.</p>
        </Section>

        {contact && <p className="mt-16 text-ui text-fg-subtle">Questions: <a href={`mailto:${contact}`} className="underline decoration-1 underline-offset-text hover:text-fg">{contact}</a>.</p>}
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-display-m text-fg">{title}</h2>
      {children}
    </section>
  );
}
