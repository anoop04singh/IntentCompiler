import "dotenv/config";
import { readFile } from "node:fs/promises";
import { database } from "../src/db.js";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env");
const db = database({
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_SSL: process.env.DATABASE_SSL !== "false",
});
try {
  await db`create table if not exists public.graphrail_migrations (name text primary key, applied_at timestamptz default now())`;
  await db`revoke all on public.graphrail_migrations from public,anon,authenticated`;
  const [done] =
    await db`select name from public.graphrail_migrations where name='001_graphrail'`;
  if (!done)
    await db.begin(async (tx) => {
      await tx.unsafe(
        await readFile("supabase/migrations/001_graphrail.sql", "utf8"),
      );
      await tx`insert into public.graphrail_migrations(name)values('001_graphrail')`;
    });
  console.log(
    done
      ? "GraphRail schema already installed."
      : "GraphRail schema installed.",
  );
} finally {
  await db.end();
}
