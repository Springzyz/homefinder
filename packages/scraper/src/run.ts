import { closeDb } from "./db";
import { run } from "./pipeline";

try {
  const pages = Number(process.argv.find((a) => a.startsWith("--pages="))?.split("=")[1] ?? 1);
const portal = process.argv.find((a) => a.startsWith("--portal="))?.split("=")[1];
await run({ notify: !process.argv.includes("--no-notify"), pages, portal });
} finally {
  await closeDb();
}
