import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { InterviewerStage } from "@/components/avatar/InterviewerStage";

export const metadata = { title: "Page not found" };

/** A missing page, said by the interviewer: the same face, glancing around for it. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="frame flex h-16 items-center"><Link href="/" aria-label="Oriel home" className="-ml-1 inline-flex rounded-control p-1"><Logo /></Link></header>
      <main id="content" className="frame flex flex-1 items-center pb-section">
        <div className="page-grid w-full items-center gap-y-6">
          <div className="col-span-4 sm:col-span-8 lg:col-span-6">
            <h1 className="text-display-l text-fg">That page isn&apos;t in the room<span className="text-accent">.</span></h1>
            <p className="mt-5 max-w-prose text-body-l text-fg-muted">The link may be old, or the page may have moved (error 404). Everything else is where you left it.</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href="/" className="inline-flex h-12 items-center rounded-button border border-transparent bg-accent px-6 text-ui font-medium text-on-accent transition-[background-color,transform] duration-press hover:bg-accent-hover active:bg-accent-press active:scale-97">Go to the home page</Link>
              <Link href="/home" className="text-ui text-fg-muted underline decoration-1 underline-offset-text transition-colors duration-press hover:text-fg">Open Oriel</Link>
            </div>
          </div>
          <InterviewerStage personaIds={["hiring_manager"]} className="col-span-4 h-[clamp(12rem,8rem+12vw,22rem)] sm:col-span-8 lg:col-span-6" />
        </div>
      </main>
    </div>
  );
}
