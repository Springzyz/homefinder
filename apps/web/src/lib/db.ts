import pg from "pg";

const g = globalThis as unknown as { __pool?: pg.Pool };
export const pool = (g.__pool ??= new pg.Pool({
  connectionString: process.env.SUPABASE_CONNECTIONSTRING,
  ssl: { rejectUnauthorized: false },
  max: 3,
}));

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[];
}
