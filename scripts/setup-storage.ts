import "dotenv/config";
import { z } from "zod";
const env = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    PACKAGE_BUCKET: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .default("graphrail-packages"),
  })
  .parse(process.env);
const headers = {
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  "Content-Type": "application/json",
};
const origin = new URL(env.SUPABASE_URL);
if (origin.protocol !== "https:" || !origin.hostname.endsWith(".supabase.co"))
  throw new Error("Use your Supabase HTTPS project URL");
const existing = await fetch(
  `${origin.origin}/storage/v1/bucket/${env.PACKAGE_BUCKET}`,
  { headers, signal: AbortSignal.timeout(15000), redirect: "error" },
);
if (existing.ok) {
  const b = (await existing.json()) as any;
  if (!b.public)
    throw new Error("Package bucket must be public; use a dedicated bucket");
  console.log("Public package bucket exists.");
} else {
  const r = await fetch(`${origin.origin}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: env.PACKAGE_BUCKET,
      name: env.PACKAGE_BUCKET,
      public: true,
      file_size_limit: 100000000,
      allowed_mime_types: ["application/octet-stream"],
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!r.ok) throw new Error("Could not create package bucket");
  console.log(
    "Created public package bucket. Only compiled packages belong here.",
  );
}
