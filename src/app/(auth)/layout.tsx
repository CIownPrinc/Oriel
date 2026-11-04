import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { InterviewerStage } from "@/components/avatar/InterviewerStage";

/**
 * Sign-in sits beside the interviewer you'll practise with: the real avatar, idle, and a question
 * in its voice (the serif). No stock photography, no invented recording. Phones get the form alone.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="hidden bg-surface px-10 py-6 lg:flex lg:flex-col lg:justify-between xl:px-14">
        <Link href="/" aria-label="Oriel home" className="-ml-1 inline-flex self-start rounded-control p-1"><Logo /></Link>
        <figure className="w-full max-w-prose self-center">
          <InterviewerStage personaIds={["hiring_manager"]} className="mx-auto h-[clamp(14rem,9rem+12vw,22rem)] w-full" />
          <blockquote className="hang -mt-2 text-display-m text-fg">“Tell me about a time you had to make a decision without all the data you wanted.”</blockquote>
          <figcaption className="mt-4 text-ui text-fg-muted"><span className="text-fg">Daniel</span>, hiring manager. One of six interviewers you can practice with.</figcaption>
        </figure>
        <p className="text-meta text-fg-subtle">Practice only. Your interviewer is an AI, and every session says so.</p>
      </aside>
      <div className="relative flex min-h-dvh flex-col px-5 sm:px-8">
        <header className="flex h-14 items-center lg:hidden"><Link href="/" aria-label="Oriel home" className="-ml-1 inline-flex rounded-control p-1"><Logo /></Link></header>
        <main id="content" className="m-auto w-full max-w-[400px] py-12">{children}</main>
        <footer className="pb-6 text-center text-meta text-fg-subtle lg:hidden">Practice only. Your interviewer is an AI.</footer>
      </div>
    </div>
  );
}
