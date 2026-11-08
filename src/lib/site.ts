import "server-only";

/**
 * Public details about the deployment, from the environment. Unset values stay unset: the
 * site hides a contact link rather than pointing it at an address nobody reads.
 */
export function siteUrl(): string {
  return (process.env.ORIEL_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** Where people write to (support, privacy, sales). Null when the deployment hasn't set one. */
export function contactEmail(): string | null {
  const v = process.env.ORIEL_CONTACT_EMAIL?.trim();
  return v && /^\S+@\S+\.\S+$/.test(v) ? v : null;
}

/** Whether real payments are live. Until then every plan's features are free (beta). */
export function paymentsLive(): boolean {
  return process.env.ORIEL_PAYMENTS === "stripe";
}
