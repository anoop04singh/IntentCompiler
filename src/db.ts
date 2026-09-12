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
