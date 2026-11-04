"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/components/ui/cn";

const LINKS = [["/#how", "Interviewers"], ["/#read", "The Read"], ["/#privacy", "Privacy"], ["/#pricing", "Pricing"]] as const;

/**
 * Almost invisible until needed: transparent over the first screen, near-opaque page colour with a
 * hairline once you scroll. One filled button, kept smaller than the hero's so the hero leads.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    const first = requestAnimationFrame(on);
    window.addEventListener("scroll", on, { passive: true });
    return () => { cancelAnimationFrame(first); window.removeEventListener("scroll", on); };
  }, []);

  // The menu is a disclosure: focus moves in, Escape closes it, the page behind is locked and inert.
  useEffect(() => {
    if (!open) return;
    const behind = [document.getElementById("content"), document.querySelector("footer")].filter((x): x is HTMLElement => !!x);
    document.documentElement.style.overflow = "hidden";
    behind.forEach((el) => { el.inert = true; });
    const first = requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>("a")?.focus());
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", esc);
    // Widening the window past the menu's breakpoint hides it, so release the page too.
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = () => { if (wide.matches) setOpen(false); };
    wide.addEventListener("change", onWide);
    return () => {
      cancelAnimationFrame(first);
      document.documentElement.style.overflow = "";
      behind.forEach((el) => { el.inert = false; });
      window.removeEventListener("keydown", esc);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => toggle.current?.focus());
  }

  return (
    <>
      <header className={cn("fixed inset-x-0 top-0 z-50 border-b transition-colors duration-[var(--dur-state)]", scrolled || open ? "border-line bg-page" : "border-transparent bg-transparent")}>
        <div className="frame flex h-16 items-center justify-between gap-6">
          <Link href="/" aria-label="Oriel home" className="-ml-1 inline-flex shrink-0 items-center rounded-control p-1" onClick={() => setOpen(false)}><Logo /></Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {LINKS.map(([href, label]) => (
              <a key={href} href={href} className="whitespace-nowrap rounded-control px-3 py-2 text-ui text-fg-muted transition-colors duration-[var(--dur-press)] hover:text-fg">{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Link href="/home" className="hidden h-9 items-center whitespace-nowrap rounded-button border border-control px-4 text-ui font-medium text-fg transition-[background-color,border-color,transform] duration-[var(--dur-press)] hover:border-fg-muted hover:bg-surface active:scale-[0.97] sm:inline-flex">Open Oriel</Link>
            ) : (
              <>
                <Link href="/login" className="hidden whitespace-nowrap rounded-control px-3 py-2 text-ui text-fg-muted transition-colors duration-[var(--dur-press)] hover:text-fg lg:block">Sign in</Link>
                <Link href="/signup" className="hidden h-9 items-center whitespace-nowrap rounded-button border border-control px-4 text-ui font-medium text-fg transition-[background-color,border-color,transform] duration-[var(--dur-press)] hover:border-fg-muted hover:bg-surface active:scale-[0.97] sm:inline-flex">Start practicing</Link>
              </>
            )}
            <button ref={toggle} type="button" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-controls="site-menu"
              className="-mr-2 h-11 rounded-control px-3 text-ui font-medium text-fg lg:hidden">
              {open ? "Close" : "Menu"}
            </button>
          </div>
        </div>
      </header>
      {open && (
        <div ref={menu} id="site-menu" className="fixed inset-x-0 bottom-0 top-16 z-50 overflow-y-auto overscroll-contain bg-page transition-[opacity,translate] duration-[var(--dur-state)] ease-[var(--ease-enter)] starting:-translate-y-1 starting:opacity-0 lg:hidden">
          <nav aria-label="Menu" className="frame flex flex-col pb-10 pt-2">
            {LINKS.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="flex min-h-14 items-center border-b border-line text-display-m text-fg">{label}</a>
            ))}
            <div className="mt-8 flex flex-col gap-3">
              {signedIn ? (
                <Link href="/home" onClick={() => setOpen(false)} className="inline-flex h-12 items-center justify-center rounded-button border border-transparent bg-accent text-ui font-medium text-on-accent">Open Oriel</Link>
              ) : (
                <>
                  <Link href="/signup" onClick={() => setOpen(false)} className="inline-flex h-12 items-center justify-center rounded-button border border-transparent bg-accent text-ui font-medium text-on-accent">Start practicing</Link>
                  <Link href="/login" onClick={() => setOpen(false)} className="inline-flex h-12 items-center justify-center text-ui text-fg-muted underline decoration-1 underline-offset-[0.2em]">Sign in</Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
