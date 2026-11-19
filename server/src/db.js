import pg from 'pg';
import fs from 'node:fs';
pg.types.setTypeParser(1082, (v) => v); // DATE -> 'YYYY-MM-DD' string
pg.types.setTypeParser(20, (v) => Number(v)); // BIGINT -> number
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (text, params) => pool.query(text, params);
export async function migrate() {
  await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
}
