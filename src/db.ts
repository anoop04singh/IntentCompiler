import postgres from "postgres";
import type { Config } from "./config.js";
export function database(c: Pick<Config, "DATABASE_URL" | "DATABASE_SSL">) {
  return postgres(c.DATABASE_URL, {
    ssl: c.DATABASE_SSL ? "require" : false,
    prepare: false,
    max: 8,
    connect_timeout: 10,
    idle_timeout: 20,
  });
}
export type DB = ReturnType<typeof database>;
export type Row = Record<string, any>;

// postgres.js reserved connections do not expose begin(). Keep transactions on
// that connection so the session advisory lock continues to protect settlement.
export async function transaction<T>(
  db: DB,
  fn: (tx: DB) => Promise<T>,
): Promise<T> {
  if (typeof db.begin === "function") return db.begin(fn as any) as Promise<T>;
  await db.unsafe("BEGIN");
  try {
    const result = await fn(db);
    await db.unsafe("COMMIT");
    return result;
  } catch (error) {
    await db.unsafe("ROLLBACK");
    throw error;
  }
}
