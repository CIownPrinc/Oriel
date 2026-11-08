import "server-only";

/**
 * Transactional email. Sends through Resend's HTTP API when RESEND_API_KEY and ORIEL_EMAIL_FROM
 * are set. Without them, development prints the message to the server log so the flow can be
 * tried locally, and production reports that email isn't available instead of pretending.
 */
export type Email = { to: string; subject: string; text: string };

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.ORIEL_EMAIL_FROM;
}

/** Whether a reset link can reach someone: real email, or the dev log. */
export function canDeliverEmail(): boolean {
  return emailConfigured() || process.env.NODE_ENV !== "production";
}

export async function sendEmail(message: Email): Promise<void> {
  if (!emailConfigured()) {
    if (process.env.NODE_ENV === "production") throw new Error("Email isn't configured (RESEND_API_KEY, ORIEL_EMAIL_FROM)");
    console.info(`[email] to ${message.to}: ${message.subject}\n${message.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.ORIEL_EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
  });
  if (!res.ok) throw new Error(`Email provider refused the message (${res.status})`);
}
