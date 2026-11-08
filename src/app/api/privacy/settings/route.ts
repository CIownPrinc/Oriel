import { authed, json, parseBody } from "@/lib/api/http";
import { PrivacySettings, updatePrivacySettings } from "@/server/privacy/settings";

export const PATCH = authed(async (req, { user }) => {
  const settings = await parseBody(req, PrivacySettings);
  await updatePrivacySettings(user.id, settings, req.headers.get("user-agent"));
  return json({ ok: true });
}, { limit: 30 });
