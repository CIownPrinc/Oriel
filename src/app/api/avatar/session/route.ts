import { authed, json } from "@/lib/api/http";
import { canUseAvatarMinutes } from "@/lib/billing/entitlements";
import { loadEntitlementContext } from "@/lib/billing/entitlement-context";

/**
 * Issues a short-lived managed-avatar session token. The vendor secret
 * (AVATAR_PROVIDER_API_KEY) stays on the server. Returns 501 until a vendor is wired.
 */
export const POST = authed(async (_req, { user }) => {
  const verdict = canUseAvatarMinutes(await loadEntitlementContext(user.id), 1);
  if (!verdict.allowed) return json({ error: verdict.reason }, { status: 402 });
  if (!process.env.AVATAR_PROVIDER || !process.env.AVATAR_PROVIDER_API_KEY) {
    return json({ error: "Managed avatar provider is not configured; using the on-device interviewer." }, { status: 501 });
  }
  return json({ error: `Avatar provider "${process.env.AVATAR_PROVIDER}" adapter is not implemented yet.` }, { status: 501 });
}, { limit: 10, shared: true });
