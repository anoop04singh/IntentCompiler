import { createHash } from "node:crypto";
import { EventFragment } from "ethers";
import { z } from "zod";

const input = z
  .object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    type: z.string(),
    indexed: z.boolean(),
  })
  .strict();
export const eventSchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
    inputs: z.array(input).max(32),
    type: z.literal("event").default("event"),
    anonymous: z.literal(false).default(false),
  })
  .strict();
export const definitionSchema = z
  .object({
    network: z.literal("sepolia"),
    contracts: z
      .array(z.string().regex(/^0x[0-9a-fA-F]{40}$/))
      .min(1)
      .max(20),
    events: z.array(eventSchema).min(1).max(12),
    startBlock: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1000),
    // A known active range is required: zero output never counts as a successful test.
    testStartBlock: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1000),
    abiSource: z.string().url(),
  })
  .strict();
export type Definition = z.infer<typeof definitionSchema>;
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const snake = (s: string) =>
  s
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
export const pascal = (s: string) =>
  snake(s)
    .split("_")
    .map((v) => v[0]!.toUpperCase() + v.slice(1))
    .join("");
export function validateDefinition(value: unknown): Definition {
  const d = definitionSchema.parse(value);
  if (d.testStartBlock < d.startBlock)
    throw new Error("testStartBlock must be at or after startBlock");
  d.contracts = [...new Set(d.contracts.map((v) => v.toLowerCase()))].sort();
  const names = new Set<string>();
  const roots = new Set<string>();
  const types = new Set<string>();
  for (const e of d.events) {
    const normalized = pascal(e.name);
    if (
      names.has(normalized) ||
      [
        "Events",
        "DatabaseChanges",
        "Query",
        "String",
        "Boolean",
        "BigInt",
        "Bytes",
        "Int",
        "Float",
        "Id",
        "Self",
        "Super",
        "Crate",
      ].includes(normalized)
    )
      throw new Error(
        "Event names must be distinct after Rust normalization; overloaded events are not supported",
      );
    if (snake(e.name).length > 48)
      throw new Error("Event name is too long for PostgreSQL");
    names.add(normalized);
    const root = normalized[0]!.toLowerCase() + normalized.slice(1);
    if (
      roots.has(root) ||
      roots.has(`${root}s`) ||
      types.has(normalized) ||
      types.has(`${normalized}Filter`)
    )
      throw new Error("Event names collide in the generated query schema");
    roots.add(root);
    roots.add(`${root}s`);
    types.add(normalized);
    types.add(`${normalized}Filter`);
    if (e.inputs.filter((i) => i.indexed).length > 3)
      throw new Error(
        "Non-anonymous events support at most three indexed parameters",
      );
    const fields = new Set<string>();
    for (const i of e.inputs) {
      if (
        !/^(address|bool|string|bytes|bytes([1-9]|[12][0-9]|3[0-2])|u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256))$/.test(
          i.type,
        )
      )
        throw new Error(
          "Supported ABI fields: address, bool, string, bytes1..32, bytes, int8..256, uint8..256. Tuples and arrays require a compiler extension.",
        );
      if (i.indexed && ["string", "bytes"].includes(i.type))
        throw new Error(
          "Indexed dynamic values are hashes and cannot be decoded; select a recoverable event",
        );
      const field = snake(i.name);
      if (field.length > 55)
        throw new Error("ABI field name is too long for PostgreSQL");
      if (fields.has(field))
        throw new Error("ABI parameter names collide after normalization");
      fields.add(field);
    }
    EventFragment.from(e);
  }
  d.events.sort((a, b) => a.name.localeCompare(b.name));
  return d;
}
export function fingerprint(d: Definition): string {
  // Descriptions, test ranges and source URLs do not change indexed data.
  return digest({
    compiler: 2,
    network: d.network,
    contracts: d.contracts,
    events: d.events,
    startBlock: d.startBlock,
  });
}
export function graphType(type: string): string {
  if (/^u?int/.test(type)) return "BigInt";
  if (type === "bool") return "Boolean";
  if (type === "address" || type.startsWith("bytes")) return "Bytes";
  return "String";
}
export function entitySchema(d: Definition): string {
  return (
    d.events
      .map(
        (e) =>
          `type ${pascal(e.name)} {\n  id: ID!\n  blockNumber: BigInt!\n  timestamp: BigInt!\n  transactionHash: Bytes!\n  logIndex: BigInt!\n  contract: Bytes!\n${e.inputs.map((i) => `  arg_${snake(i.name)}: ${graphType(i.type)}!`).join("\n")}\n}`,
      )
      .join("\n\n") + "\n"
  );
}
