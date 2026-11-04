import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { ButtonLink, TextLink } from "@/components/ui/Button";
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
              <ButtonLink href="/" size="lg">Go to the home page</ButtonLink>
              <TextLink href="/home" className="text-ui">Open Oriel</TextLink>
            </div>
          </div>
          <InterviewerStage personaIds={["hiring_manager"]} className="col-span-4 h-[clamp(12rem,8rem+12vw,22rem)] sm:col-span-8 lg:col-span-6" />
        </div>
      </main>
    </div>
  );
}
