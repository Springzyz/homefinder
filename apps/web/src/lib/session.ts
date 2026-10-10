// Edge-compatible (Web Crypto) so it works in middleware and server actions alike.
const enc = new TextEncoder();
const COOKIE = "hf_session";
export { COOKIE };

async function hmac(msg: string): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makeToken(days = 30): Promise<string> {
  const exp = String(Date.now() + days * 864e5);
  return `${exp}.${await hmac(exp)}`;
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = await hmac(exp);
  let diff = good.length ^ sig.length;
  for (let i = 0; i < good.length; i++) diff |= good.charCodeAt(i) ^ (sig.charCodeAt(i) || 0);
  return diff === 0;
}
