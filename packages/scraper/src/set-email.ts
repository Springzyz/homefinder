import { closeDb, db } from "./db";

// Usage: pnpm set-email you@example.com
// With Resend's free test sender (onboarding@resend.dev) this must be the email of your Resend account.
const email = process.argv[2];
if (!email?.includes("@")) throw new Error("usage: pnpm set-email you@example.com");
await db().query("update settings set notify_email=$1 where id=1", [email]);
console.log(`Alerts will be emailed to ${email}`);
await closeDb();
