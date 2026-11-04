"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Field";
import { api, ApiError } from "@/lib/client/api";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Field errors appear once you've left a field (or tried to submit), never while you're still typing.
  const [touched, setTouched] = useState({ email: false, password: false, accept: false });
  const emailError = touched.email && !/^\S+@\S+\.\S+$/.test(email.trim()) ? (email.trim() ? "That doesn't look like an email address." : "Enter your email.") : null;
  const passwordError = touched.password ? (!password ? "Enter a password." : mode === "signup" && password.length < 8 ? `Use 8 or more characters (${password.length} so far).` : null) : null;
  const acceptError = mode === "signup" && touched.accept && !accept ? "To create an account, agree to the terms and the privacy policy." : null;
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // The button is never disabled: say what's missing, next to the field it's about.
    setTouched({ email: true, password: true, accept: true });
    const bad = !/^\S+@\S+\.\S+$/.test(email.trim()) || !password || (mode === "signup" && (password.length < 8 || !accept));
    if (bad) { document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        await api("/api/auth/signup", { method: "POST", json: { email, password, acceptTerms: accept } });
        router.push("/onboarding");
      } else {
        const r = await api<{ onboarded: boolean }>("/api/auth/login", { method: "POST", json: { email, password } });
        router.push(r.onboarded ? "/home" : "/onboarding");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          aria-invalid={emailError ? true : undefined} aria-describedby={emailError ? "email-error" : undefined} placeholder="you@company.com" />
        <FieldError id="email-error">{emailError}</FieldError>
      </div>
      <div>
        <Label htmlFor="password" hint={mode === "signup" ? "8 or more characters" : undefined}>Password</Label>
        <div className="relative">
          <Input id="password" type={show ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={passwordError ? true : undefined} aria-describedby={passwordError ? "password-error" : undefined} className="pr-20" />
          <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-controls="password"
            className="absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded-sm px-2.5 text-meta font-medium text-fg-muted transition-colors duration-press hover:bg-raised hover:text-fg">{show ? "Hide" : "Show"}</button>
        </div>
        <FieldError id="password-error">{passwordError}</FieldError>
      </div>
      {mode === "signup" && (
        <label className="flex cursor-pointer items-start gap-3 text-ui leading-relaxed text-fg-muted">
          <span className="relative mt-0.5 grid shrink-0 place-items-center">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} aria-invalid={acceptError ? true : undefined} aria-describedby={acceptError ? "accept-error" : undefined}
              className="peer size-[18px] cursor-pointer appearance-none rounded-sm border border-control bg-surface transition-colors checked:border-accent checked:bg-accent" />
            <svg viewBox="0 0 12 12" className="pointer-events-none absolute size-3 text-on-accent opacity-0 transition-opacity peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m2.5 6.2 2.3 2.3 4.7-5" /></svg>
          </span>
          <span>I understand Oriel is a practice tool with an AI interviewer, and I agree to the terms and the <a href="/privacy" target="_blank" className="text-fg underline decoration-1 underline-offset-text">privacy and biometric policy</a>. Camera and microphone are only used after I consent in the Room.</span>
        </label>
      )}
      {mode === "signup" && <FieldError id="accept-error">{acceptError}</FieldError>}
      <FieldError>{error}</FieldError>
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        {mode === "signup" ? "Create account" : "Sign in"}
      </Button>
      <p className="pt-2 text-center text-ui text-fg-muted">
        {mode === "signup" ? <>Already have an account? <Link href="/login" className="font-medium text-fg underline decoration-1 underline-offset-text">Sign in</Link></> : <>New to Oriel? <Link href="/signup" className="font-medium text-fg underline decoration-1 underline-offset-text">Create an account</Link></>}
      </p>
    </form>
  );
}
