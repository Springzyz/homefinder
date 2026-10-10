import { closeDb, db } from "./db";

// Usage: send any message (e.g. /start) to your bot in Telegram, then run `pnpm link-telegram`.
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
const res = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json() as any;
const msg = [...(res.result ?? [])].reverse().find((u: any) => u.message?.chat?.id)?.message;
if (!msg) {
  console.error("No messages found. Open your bot in Telegram, press Start / send 'hi', then rerun.");
  process.exit(1);
}
await db().query("update settings set telegram_chat_id=$1 where id=1", [String(msg.chat.id)]);
await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: msg.chat.id, text: "✅ HomeFinder linked. You'll get deal alerts here." }),
});
console.log(`Linked chat with ${msg.chat.first_name ?? "user"}.`);
await closeDb();
