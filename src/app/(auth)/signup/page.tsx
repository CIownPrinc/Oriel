import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/home");
  return (
    <>
      <h1 className="text-display-l text-fg">Start practicing.</h1>
      <p className="mb-9 mt-3 text-body-l text-fg-muted">Free to try. No card required.</p>
      <AuthForm mode="signup" />
    </>
  );
}
