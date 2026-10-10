import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { COOKIE, makeToken } from "@/lib/session";

async function login(form: FormData) {
  "use server";
  const given = Buffer.from(String(form.get("password") ?? ""));
  const want = Buffer.from(process.env.APP_PASSWORD ?? "");
  const ok = want.length > 0 && given.length === want.length && timingSafeEqual(given, want);
  if (!ok) redirect("/login?error=1");
  (await cookies()).set(COOKIE, await makeToken(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86400 });
  redirect("/");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto mt-32 max-w-sm px-4">
      <h1 className="mb-1 text-2xl font-semibold">HomeFinder</h1>
      <p className="mb-6 text-sm text-muted">Private deal tracker</p>
      <form action={login} className="space-y-3">
        <input name="password" type="password" placeholder="Password" autoFocus className="input" />
        {error && <p className="text-sm text-[var(--above)]">Wrong password.</p>}
        <button className="btn w-full">Sign in</button>
      </form>
    </main>
  );
}
