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
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // The button is never disabled: say what's missing instead of leaving it grey.
    if (!email.trim() || !password) { setError("Enter your email and a password."); return; }
    if (mode === "signup" && password.length < 8) { setError("Use a password of 8 or more characters."); return; }
    if (mode === "signup" && !accept) { setError("To create an account, agree to the terms and the privacy policy above."); return; }
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
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
      </div>
      <div>
        <Label htmlFor="password" hint={mode === "signup" ? "8 or more characters" : undefined}>Password</Label>
        <div className="relative">
          <Input id="password" type={show ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="pr-20" />
          <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-controls="password"
            className="absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded-sm px-2.5 text-meta font-medium text-fg-muted transition-colors duration-[var(--dur-press)] hover:bg-raised hover:text-fg">{show ? "Hide" : "Show"}</button>
        </div>
      </div>
      {mode === "signup" && (
        <label className="flex cursor-pointer items-start gap-3 text-ui leading-relaxed text-fg-muted">
          <span className="relative mt-0.5 grid shrink-0 place-items-center">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)}
              className="peer size-[18px] cursor-pointer appearance-none rounded-sm border border-control bg-surface transition-colors checked:border-accent checked:bg-accent" />
            <svg viewBox="0 0 12 12" className="pointer-events-none absolute size-3 text-on-accent opacity-0 transition-opacity peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m2.5 6.2 2.3 2.3 4.7-5" /></svg>
          </span>
          <span>I understand Oriel is a practice tool with an AI interviewer, and I agree to the terms and the <a href="/privacy" target="_blank" className="text-fg underline decoration-1 underline-offset-[0.2em]">privacy and biometric policy</a>. Camera and microphone are only used after I consent in the Room.</span>
        </label>
      )}
      <FieldError>{error}</FieldError>
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        {mode === "signup" ? "Create account" : "Sign in"}
      </Button>
      <p className="pt-2 text-center text-ui text-fg-muted">
        {mode === "signup" ? <>Already have an account? <Link href="/login" className="font-medium text-fg underline decoration-1 underline-offset-[0.2em]">Sign in</Link></> : <>New to Oriel? <Link href="/signup" className="font-medium text-fg underline decoration-1 underline-offset-[0.2em]">Create an account</Link></>}
      </p>
    </form>
  );
}
