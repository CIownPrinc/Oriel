import { requireUser } from "@/lib/auth/session";
import { providerStatus } from "@/lib/ai/providers/registry";
import { AppNav } from "@/components/app/AppNav";
import { MotionProvider } from "@/components/ui/MotionProvider";
import { ToastProvider } from "@/components/ui/Toast";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const providers = providerStatus();
  // The motion library loads only where it animates: the signed-in app and onboarding, never the landing page.
  return (
    <MotionProvider>
      <ToastProvider>
        <a href="#content" className="skip-link">Skip to content</a>
        <AppNav isAdmin={user.role === "admin"} name={user.name} mockProviders={providers.llmMock} />
        <main id="content" tabIndex={-1} className="frame pb-section pt-[clamp(2rem,1.25rem+2.5vw,3.5rem)] focus:outline-none">{children}</main>
      </ToastProvider>
    </MotionProvider>
  );
}
