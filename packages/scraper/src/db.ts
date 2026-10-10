import pg from "pg";

let pool: pg.Pool | undefined;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: process.env.SUPABASE_CONNECTIONSTRING, ssl: { rejectUnauthorized: false }, max: 3 });
  return pool;
}
export const closeDb = () => pool?.end();
