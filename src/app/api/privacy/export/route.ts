import { authed } from "@/lib/api/http";
import { audit } from "@/lib/security/audit";
import { exportUserData } from "@/server/privacy/inventory";

/** Download everything Oriel stores about you (the encrypted video plays in Playback). */
export const GET = authed(async (_req, { user }) => {
  const data = await exportUserData(user.id);
  await audit("privacy.export", { userId: user.id });
  return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="oriel-export.json"` } });
}, { limit: 5 });
