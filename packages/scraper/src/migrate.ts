import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.SUPABASE_CONNECTIONSTRING, ssl: { rejectUnauthorized: false } });
await client.connect();
const existing = await client.query(
  "select table_name from information_schema.tables where table_schema='public'",
);
console.log("existing public tables:", existing.rows.map((r) => r.table_name));
if (process.argv.includes("--check")) process.exit(0);
await client.query("create table if not exists _migrations (name text primary key, applied_at timestamptz default now())");
const dir = new URL("../../../supabase/migrations/", import.meta.url);
for (const f of readdirSync(dir).sort()) {
  const done = await client.query("select 1 from _migrations where name=$1", [f]);
  if (done.rowCount) continue;
  await client.query("begin");
  try {
    await client.query(readFileSync(new URL(f, dir), "utf8"));
    await client.query("insert into _migrations(name) values ($1)", [f]);
    await client.query("commit");
    console.log("applied", f);
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}
await client.end();
