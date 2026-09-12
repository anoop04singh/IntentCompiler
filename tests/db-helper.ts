import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { DB } from "../src/db.js";

export async function testDB() {
  const pg = new PGlite();
  await pg.exec("create role anon; create role authenticated;");
  await pg.exec(
    await readFile("supabase/migrations/001_graphrail.sql", "utf8"),
  );
  const locks = new Set<string>();
  const sql: any = async (strings: TemplateStringsArray, ...params: any[]) => {
    const text = strings.reduce((s, v, i) => s + (i ? `$${i}` : "") + v, "");
    if (text.includes("pg_try_advisory_lock")) {
      const key = params[0];
      if (locks.has(key)) return [{ locked: false }];
      locks.add(key);
      return [{ locked: true }];
    }
    if (text.includes("pg_advisory_unlock")) {
      locks.delete(params[0]);
      return [];
    }
    return (await pg.query(text, params)).rows;
  };
  sql.unsafe = async (text: string, params: any[] = []) =>
    (await pg.query(text, params)).rows;
  sql.json = (value: any) => JSON.stringify(value);
  sql.begin = async (fn: any) => {
    await pg.exec("BEGIN");
    try {
      const value = await fn(sql);
      await pg.exec("COMMIT");
      return value;
    } catch (e) {
      await pg.exec("ROLLBACK");
      throw e;
    }
  };
  sql.reserve = async () => {
    const reserved: any = (...args: any[]) => sql(...args);
    reserved.unsafe = sql.unsafe;
    reserved.json = sql.json;
    reserved.release = () => {};
    return reserved;
  };
  sql.release = () => {};
  return { db: sql as DB, pg, close: () => pg.close() };
}
