"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/components/ui/cn";

/**
 * Four sections, by what you came to do: start, interview, improve, look back. Each section's
 * pages appear as tabs beneath the bar, so the bar itself stays four words long.
 */
const SECTIONS: { label: string; href: string; pages: [string, string][] }[] = [
  { label: "Home", href: "/home", pages: [["/home", "Home"]] },
  { label: "Interview", href: "/practice", pages: [["/practice", "Set up"], ["/ladder", "Ladder"]] },
  { label: "Improve", href: "/train", pages: [["/train", "Train"], ["/lessons", "Lessons"], ["/drills", "Drills"]] },
  { label: "Results", href: "/playback", pages: [["/playback", "Sessions"], ["/progress", "Progress"]] },
];
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The app's bar, on the same frame as every page beneath it: the mark, then the sections as a
 * quiet row of words (the current one in full-strength text over an accent rule), the account on the right.
 * On phones and tablets, a plain "Menu" opens a full-screen sheet, as on the marketing pages.
 */
export function AppNav({ isAdmin, name, mockProviders }: { isAdmin: boolean; name: string | null; mockProviders: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const isOn = (href: string) => path === href || path.startsWith(`${href}/`);
  const section = SECTIONS.find((x) => x.pages.some(([h]) => isOn(h))) ?? null;
  const account: [string, string][] = [["/profile", "Profile & settings"], ...(isAdmin ? [["/admin", "Admin"] as [string, string]] : [])];

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    const first = requestAnimationFrame(on);
    window.addEventListener("scroll", on, { passive: true });
    return () => { cancelAnimationFrame(first); window.removeEventListener("scroll", on); };
  }, []);
  // The sheet is a disclosure: the page behind is locked, Escape closes it and focus goes back to "Menu".
  useEffect(() => {
    if (!sheet) return;
    document.documentElement.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setSheet(false); toggle.current?.focus(); } };
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = () => { if (wide.matches) setSheet(false); };
    window.addEventListener("keydown", esc);
    wide.addEventListener("change", onWide);
    return () => { document.documentElement.style.overflow = ""; window.removeEventListener("keydown", esc); wide.removeEventListener("change", onWide); };
  }, [sheet]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <header className={cn("sticky top-0 z-40 border-b bg-page transition-colors duration-[var(--dur-state)]", scrolled || sheet ? "border-line" : "border-transparent")}>
        <div className="frame flex h-14 items-center gap-10">
          <Link href="/home" aria-label="Oriel home" className="-ml-1 inline-flex shrink-0 items-center rounded-control p-1" onClick={() => setSheet(false)}><Logo /></Link>
          <nav aria-label="Main" className="hidden h-full items-stretch gap-7 lg:flex">
            {SECTIONS.map(({ href, label }) => {
              const on = section?.href === href;
              return (
                <Link key={href} href={href} aria-current={on ? "true" : undefined}
                  className={cn("relative flex items-center whitespace-nowrap text-ui transition-colors duration-[var(--dur-press)]", on ? "text-fg" : "text-fg-muted hover:text-fg")}>
                  {label}
                  {on && <motion.span layoutId="nav-mark" className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" transition={{ duration: 0.32, ease: EASE }} />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {mockProviders && <span title="No AI provider key configured: the interviewer uses deterministic templates and heuristics." className="hidden text-meta text-warning sm:block">mock AI</span>}
            <AccountMenu name={name} links={account} onSignOut={signOut} active={isOn("/profile") || isOn("/admin")} />
            <button ref={toggle} type="button" onClick={() => setSheet(!sheet)} aria-expanded={sheet} aria-controls="app-sheet"
              className="-mr-2 h-11 rounded-control px-3 text-ui font-medium text-fg lg:hidden">
              {sheet ? "Close" : "Menu"}
            </button>
          </div>
        </div>
        {/* The section's pages, as tabs; only for sections with more than one page. */}
        {section && section.pages.length > 1 && (
          <nav aria-label={section.label} className="frame hidden h-11 items-stretch gap-6 border-t border-line lg:flex">
            {section.pages.map(([href, label]) => {
              const on = isOn(href);
              return (
                <Link key={href} href={href} aria-current={on ? "page" : undefined}
                  className={cn("relative flex items-center text-ui transition-colors duration-[var(--dur-press)]", on ? "text-fg" : "text-fg-muted hover:text-fg")}>
                  {label}
                  {on && <span className="absolute inset-x-0 -bottom-px h-px bg-fg" />}
                </Link>
              );
            })}
          </nav>
        )}
      </header>
      <AnimatePresence>
        {sheet && (
          <motion.div id="app-sheet" className="fixed inset-x-0 bottom-0 top-14 z-40 overflow-y-auto overscroll-contain bg-page lg:hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <nav aria-label="Menu" className="frame flex flex-col pb-10 pt-4">
              {[...SECTIONS, { label: "Account", href: "/profile", pages: account }].map((sec) => (
                <div key={sec.label} className="border-b border-line py-3">
                  {sec.pages.length > 1 && <p className="text-meta text-fg-subtle">{sec.label}</p>}
                  {sec.pages.map(([href, label]) => (
                    <Link key={href} href={href} onClick={() => setSheet(false)} aria-current={isOn(href) ? "page" : undefined}
                      className={cn("flex min-h-12 items-center text-display-m", isOn(href) ? "text-accent" : "text-fg")}>{sec.pages.length > 1 || sec.label === "Account" ? label : sec.label}</Link>
                  ))}
                </div>
              ))}
              <div className="mt-8 flex items-center justify-between gap-4">
                <span className="text-ui text-fg-muted">{name ?? "Signed in"}</span>
                <button type="button" onClick={signOut} className="h-11 rounded-button border border-control px-5 text-ui font-medium text-fg transition-colors duration-[var(--dur-press)] hover:border-fg-muted">Sign out</button>
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function AccountMenu({ name, links, onSignOut, active }: { name: string | null; links: [string, string][]; onSignOut: () => void; active: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); button.current?.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    const first = requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(first); document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  const initial = (name?.trim()[0] ?? "Y").toUpperCase();
  return (
    <div ref={box} className="relative hidden lg:block">
      <button ref={button} type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="Account"
        className={cn("grid size-8 place-items-center rounded-full bg-raised font-display text-body leading-none text-fg transition-shadow duration-[var(--dur-press)]",
          active || open ? "shadow-[0_0_0_1px_var(--color-accent)]" : "hover:shadow-[0_0_0_1px_var(--color-control)]")}>
        {initial}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" aria-label="Account" className="absolute right-0 top-11 w-60 origin-top-right rounded-control bg-surface p-1.5 shadow-sheet"
            initial={{ opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -2 }} transition={{ duration: 0.16, ease: EASE }}>
            <p className="px-3 pb-2 pt-2.5 text-meta text-fg-subtle">{name ? <>Signed in as <span className="font-medium text-fg">{name}</span></> : "Signed in"}</p>
            <div className="my-1 h-px bg-line" />
            {links.map(([href, label]) => (
              <Link key={href} href={href} role="menuitem" onClick={() => setOpen(false)} className="block rounded-sm px-3 py-2 text-ui text-fg outline-none hover:bg-raised focus-visible:bg-raised">{label}</Link>
            ))}
            <button type="button" role="menuitem" onClick={onSignOut} className="block w-full rounded-sm px-3 py-2 text-left text-ui text-fg outline-none hover:bg-raised focus-visible:bg-raised">Sign out</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
