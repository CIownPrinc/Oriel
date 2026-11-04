import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

const linkCls = "inline-block py-1 text-fg-muted transition-colors duration-press hover:text-fg";

/** The colophon, on the page grid: what Oriel is and how to reach it, then the directory from the spine. */
export function SiteFooter({ signedIn }: { signedIn: boolean }) {
  const columns: [string, [string, string][]][] = [
    ["Product", [["/#how", "Interviewers"], ["/#read", "The Read"], ["/#practice", "Lessons and drills"], ["/#pricing", "Pricing"]]],
    ["Practice", signedIn
      ? [["/home", "Open Oriel"], ["/practice", "Practice an interview"], ["/progress", "Your progress"]]
      : [["/signup", "Start practicing"], ["/login", "Sign in"]]],
    ["Trust", [["/#privacy", "How your data is handled"], ["/trust", "How accurate is the Read"], ["/privacy", "Privacy and biometric policy"]]],
  ];
  return (
    <footer className="border-t border-line text-ui">
      <div className="frame">
        <div className="page-grid gap-y-10 py-12 lg:py-16">
          <div className="col-span-4 sm:col-span-8 lg:col-span-6">
            <Link href="/" aria-label="Oriel home" className="-ml-1 inline-flex rounded-control p-1"><Logo /></Link>
            <p className="mt-4 max-w-[32ch] text-fg-muted">Practice only. Your interviewer is an AI, and every session says so.</p>
            <ul className="mt-5">
              <li><a href="mailto:hello@oriel.example" className={linkCls}>hello@oriel.example</a></li>
              <li><a href="mailto:hello@oriel.example?subject=Campus" className={linkCls}>Career centers</a></li>
            </ul>
          </div>
          <nav aria-label="Footer" className="col-span-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:col-span-8 sm:grid-cols-3 sm:gap-x-6 lg:col-span-6 lg:col-start-7">
            {columns.map(([title, links]) => (
              <div key={title}>
                <p className="font-medium text-fg">{title}</p>
                <ul className="mt-3">
                  {links.map(([href, label]) => <li key={href}><Link href={href} className={linkCls}>{label}</Link></li>)}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="flex flex-col gap-1 border-t border-line py-6 text-meta text-fg-subtle sm:flex-row sm:justify-between sm:gap-8">
          <p>© {new Date().getFullYear()} Oriel</p>
          <p>Not used to screen candidates. Never feeds you answers in a real interview.</p>
        </div>
      </div>
    </footer>
  );
}
