/**
 * Grant or revoke admin for an existing account. Needs direct access to the database
 * (DATABASE_PATH locally, or TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for a deployment),
 * which is what keeps it out of reach of public signup.
 *
 *   npm run admin:grant -- someone@example.com
 *   npm run admin:revoke -- someone@example.com
 *
 * The account is signed out everywhere, so the new role applies on its next sign-in.
 */
async function setRoleFromArgs() {
  const [role, email] = process.argv.slice(2);
  if ((role !== "admin" && role !== "user") || !email) {
    console.error("Usage: set-role.ts <admin|user> <email>");
    process.exit(2);
  }
  const { setAccountRole } = await import("@/server/accounts");
  const { audit } = await import("@/lib/security/audit");
  if (!(await setAccountRole(email, role))) {
    console.error(`No account with the email ${email}. They need to sign up first.`);
    process.exit(1);
  }
  await audit("admin.role_changed", { data: { email_domain: email.split("@")[1] ?? null, role, via: "cli" } });
  console.log(`${email} is now ${role === "admin" ? "an admin" : "a regular user"}. Their sessions were signed out.`);
}

setRoleFromArgs().catch((err) => {
  console.error(err);
  process.exit(1);
});
