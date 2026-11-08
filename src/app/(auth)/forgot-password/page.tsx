import { ForgotPasswordForm } from "@/components/auth/ResetForms";
import { canDeliverEmail } from "@/lib/email";
import { contactEmail } from "@/lib/site";

export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  const contact = contactEmail();
  return (
    <>
      <h1 className="text-display-l text-fg">Reset your password<span className="text-accent">.</span></h1>
      {canDeliverEmail() ? (
        <>
          <p className="mb-9 mt-3 text-body-l text-fg-muted">We&apos;ll email you a link to choose a new one.</p>
          <ForgotPasswordForm />
        </>
      ) : (
        <p className="mt-3 text-body-l text-fg-muted">
          Password reset by email isn&apos;t set up yet.{" "}
          {contact ? <>Write to <a href={`mailto:${contact}?subject=Password%20reset`} className="text-fg underline decoration-1 underline-offset-text">{contact}</a> from the email you signed up with and we&apos;ll help.</> : "Please try again later."}
        </p>
      )}
    </>
  );
}
