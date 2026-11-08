import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/ResetForms";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="text-display-l text-fg">Choose a new password<span className="text-accent">.</span></h1>
      {token ? (
        <>
          <p className="mb-9 mt-3 text-body-l text-fg-muted">Then you&apos;re signed in.</p>
          <ResetPasswordForm token={token} />
        </>
      ) : (
        <p className="mt-3 text-body-l text-fg-muted">
          This link is missing its code. Open the link from the email again, or <Link href="/forgot-password" className="text-fg underline decoration-1 underline-offset-text">ask for a new one</Link>.
        </p>
      )}
    </>
  );
}
