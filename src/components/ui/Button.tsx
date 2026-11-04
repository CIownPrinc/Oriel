import { forwardRef, type ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/*
 * Buttons with a 10px radius (the system's button radius). One accent button per view is the rule: it is the
 * thing to do next. Everything else is outlined or plain text.
 */
const base = "relative inline-flex items-center justify-center gap-2 rounded-button font-medium transition-[background-color,color,border-color,opacity,transform] duration-press ease-enter active:scale-97 disabled:opacity-40 disabled:pointer-events-none select-none whitespace-nowrap";
const accent = "border border-transparent bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press"; // the transparent border is what forced-colors mode draws
const variants: Record<Variant, string> = {
  primary: accent,
  secondary: "border border-control text-fg hover:border-fg-muted hover:bg-surface",
  ghost: "text-fg-muted hover:bg-surface hover:text-fg",
  danger: "border border-control text-danger hover:bg-danger/10",
};
// Touch screens get 44px targets whatever the size; lg matches the landing page's primary action.
const sizes: Record<Size, string> = { sm: "h-8 px-3 text-meta pointer-coarse:h-11", md: "h-10 px-4 text-ui pointer-coarse:h-11", lg: "h-12 px-6 text-ui" };

/** Button styling for elements that can't be a <Button> or a <Link>: a download, a file label. */
export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; loading?: boolean }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="size-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = "primary", size = "md", className, children, ...rest }: { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return <Link href={href} className={cn(base, variants[variant], sizes[size], className)} {...rest}>{children}</Link>;
}

/** An inline link: muted text with an accent underline offset by 0.2em; full-strength text on hover. */
export function TextLink({ href, children, className, external }: { href: string; children: React.ReactNode; className?: string; external?: boolean }) {
  const cls = cn("text-fg-muted underline decoration-accent decoration-1 underline-offset-text transition-colors duration-press hover:text-accent", className);
  return external ? <a href={href} className={cls}>{children}</a> : <Link href={href} className={cls}>{children}</Link>;
}

/** An action that reads like a link (Customize, Stop, Try without the camera): quiet text, an underline, a 44px target. */
export function LinkButton({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn("inline-flex min-h-11 items-center rounded-control text-ui text-fg-muted underline decoration-accent decoration-1 underline-offset-text transition-colors duration-press hover:text-accent disabled:opacity-40", className)} {...rest}>
      {children}
    </button>
  );
}
