"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Field";
import { api, ApiError } from "@/lib/client/api";

const linkCls = "font-medium text-fg underline decoration-1 underline-offset-text";

/** Ask for a reset link. Always ends on the same message, whether or not the email has an account. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError("Enter the email you signed up with."); return; }
    setBusy(true);
    try {
      await api("/api/auth/forgot-password", { method: "POST", json: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div role="status" className="space-y-4 text-body text-fg-muted">
        <p>If there&apos;s an account for <span className="text-fg">{email.trim()}</span>, we&apos;ve sent it a link to choose a new password. The link works for 30 minutes.</p>
        <p>No email? Check your spam folder, or <button type="button" className={linkCls} onClick={() => setSent(false)}>try again</button>.</p>
        <p><Link href="/login" className={linkCls}>Back to sign in</Link></p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined} aria-describedby={error ? "reset-error" : undefined} placeholder="you@company.com" />
        <FieldError id="reset-error">{error}</FieldError>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Button>
      <p className="pt-2 text-center text-ui text-fg-muted">Remembered it? <Link href="/login" className={linkCls}>Sign in</Link></p>
    </form>
  );
}

/** Choose a new password from the emailed link. */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError(`Use 8 or more characters (${password.length} so far).`); return; }
    setBusy(true);
    try {
      await api("/api/auth/reset-password", { method: "POST", json: { token, password } });
      router.push("/home");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <Label htmlFor="password" hint="8 or more characters">New password</Label>
        <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined} aria-describedby={error ? "new-password-error" : undefined} />
        <FieldError id="new-password-error">{error}</FieldError>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={busy}>Set new password</Button>
      <p className="pt-2 text-center text-ui text-fg-muted">This signs you out on every other device. <Link href="/forgot-password" className={linkCls}>Need a new link?</Link></p>
    </form>
  );
}
