import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/home");
  return (
    <>
      <h1 className="text-display-l text-fg">Welcome back<span className="text-accent">.</span></h1>
      <p className="mb-9 mt-3 text-body-l text-fg-muted">Pick up where you left off.</p>
      <AuthForm mode="login" />
    </>
  );
}
