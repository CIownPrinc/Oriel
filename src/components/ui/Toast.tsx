"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "success" | "danger";
type Item = { id: number; message: string; tone: Tone };
const Ctx = createContext<(message: string, tone?: Tone) => void>(() => {});

/** Confirm that something happened: "Saved", "Deleted". One line, bottom of the screen, gone in 4s. */
export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(0);
  const toast = useCallback((message: string, tone: Tone = "success") => {
    const id = ++next.current;
    setItems((xs) => [...xs.slice(-2), { id, message, tone }]);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => <ToastItem key={t.id} item={t} onDone={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} />)}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ item, onDone }: { item: Item; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 4000); return () => clearTimeout(t); }, [onDone]);
  const dot = { neutral: "bg-fg-subtle", success: "bg-accent", danger: "bg-danger" }[item.tone];
  return (
    <div className="pointer-events-auto flex animate-enter items-center gap-3 rounded-button bg-raised px-4 py-3 text-ui text-fg shadow-sheet">
      <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden />
      {item.message}
    </div>
  );
}
