"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FieldError, Segmented } from "@/components/ui/Field";
import { api, ApiError } from "@/lib/client/api";
import { CATEGORIES, competenciesFor, type Category } from "@/lib/training/competencies";

/** Choose an interview type, then a skill (or let Oriel choose), and start. */
export function StartPractice({ defaultCategory }: { defaultCategory: Category }) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>(defaultCategory);
  const [skill, setSkill] = useState<string>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skills = competenciesFor(category);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/training", { method: "POST", json: { category, competencyId: skill === "auto" ? null : skill } });
      router.push(`/train/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start the practice.");
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="text-ui font-medium text-fg">Interview type</h3>
      <Segmented className="mt-3" name="Interview type" value={category} onChange={(v) => { setCategory(v); setSkill("auto"); }}
        options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} />
      <h3 className="mt-8 text-ui font-medium text-fg">Skill</h3>
      <Segmented className="mt-3" name="Skill" value={skill} onChange={setSkill}
        options={[{ value: "auto", label: "Choose for me", hint: "A skill you haven't tried yet, or one that didn't stick" }, ...skills.map((s) => ({ value: s.id, label: s.label, hint: s.summary }))]} />
      <Button size="lg" className="mt-8" onClick={start} loading={busy}>Start practice</Button>
      <p className="mt-3 text-meta text-fg-subtle">About ten minutes. You won&apos;t see what&apos;s being assessed until the end.</p>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

/** Start or resume a scheduled review. */
export function StartReview({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="secondary" size="sm" loading={busy} aria-label={`Start review: ${label}`} onClick={async () => {
      setBusy(true);
      try {
        const r = await api<{ id: string }>(`/api/training/reviews/${id}`, { method: "POST" });
        router.push(`/train/${r.id}`);
      } catch {
        setBusy(false);
      }
    }}>Start review</Button>
  );
}
