import { parse, visit, Kind, buildSchema, validate, execute } from "graphql";
import type { DB } from "./db.js";
import { snake } from "./spec.js";
export function identifier(v: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(v))
    throw new Error("Invalid SQL identifier");
  return `"${v}"`;
}
function definitions(s: string) {
  return [...s.matchAll(/type (\w+)\s*\{([^}]+)\}/g)].map((m) => ({
    name: m[1]!,
    fields: [...m[2]!.matchAll(/(\w+):\s*(\w+)!/g)].map((f) => ({
      name: f[1]!,
      type: f[2]!,
    })),
  }));
}
function querySchema(s: string) {
  const es = definitions(s);
  return buildSchema(
    `scalar BigInt\nscalar Bytes\n${s}\n${es.map((e) => `input ${e.name}Filter { ${e.fields.map((f) => `${f.name}: ${f.type}`).join("\n")} blockNumber_gte: BigInt blockNumber_lte: BigInt }`).join("\n")} type Query {${es
      .map((e) => {
        const r = e.name[0]!.toLowerCase() + e.name.slice(1);
        return `${r}(id:ID!): ${e.name}\n${r}s(first:Int=25,skip:Int=0,where:${e.name}Filter): [${e.name}!]!`;
      })
      .join("\n")}}`,
  );
}
export function validateQuery(
  query: string,
  sdl: string,
  variables: Record<string, unknown> = {},
) {
  if (query.length > 16000 || JSON.stringify(variables).length > 16000)
    throw new Error("Query too large");
  const doc = parse(query, { maxTokens: 2000 });
  if (
    doc.definitions.length !== 1 ||
    doc.definitions[0]?.kind !== Kind.OPERATION_DEFINITION ||
    doc.definitions[0].operation !== "query"
  )
    throw new Error(
      "Exactly one read operation is allowed; fragments are disabled",
    );
  if (doc.definitions[0].selectionSet.selections.length > 5)
    throw new Error("At most five entity reads");
  let fields = 0;
  visit(doc, {
    Directive() {
      throw new Error("Directives are disabled");
    },
    Field(n) {
      if (++fields > 60 || n.name.value.startsWith("__"))
        throw new Error("Query exceeds limits or requests internal metadata");
      for (const a of n.arguments ?? [])
        if (["first", "skip"].includes(a.name.value)) {
          const n =
            a.value.kind === Kind.VARIABLE
              ? variables[a.value.name.value]
              : a.value.kind === Kind.INT
                ? Number(a.value.value)
                : undefined;
          if (
            !Number.isSafeInteger(n) ||
            Number(n) < 0 ||
            Number(n) > (a.name.value === "first" ? 100 : 5000)
          )
            throw new Error("Use first <= 100 and skip <= 5000");
        }
    },
  });
  const schema = querySchema(sdl);
  const errors = validate(schema, doc);
  if (errors.length) throw new Error(errors[0]!.message);
  return { schema, doc };
}
export async function readSql(
  db: DB,
  dbSchema: string,
  sdl: string,
  query: string,
  variables: Record<string, unknown> = {},
) {
  if (!/^gr_[a-f0-9]{32}$/.test(dbSchema))
    throw new Error("Invalid pipeline schema");
  const { schema, doc } = validateQuery(query, sdl, variables);
  const root: Record<string, unknown> = {};
  return db.begin(async (tx) => {
    await tx`set local statement_timeout='15s'`;
    await tx`set transaction read only`;
    for (const e of definitions(sdl)) {
      const name = e.name[0]!.toLowerCase() + e.name.slice(1);
      const read = async (args: any, singular: boolean) => {
        const params: any[] = [];
        const clauses: string[] = [];
        const bind = (v: unknown) => {
          if (
            !["string", "number", "boolean"].includes(typeof v) ||
            (typeof v === "number" && !Number.isSafeInteger(v)) ||
            String(v).length > 4096
          )
            throw new Error("Invalid filter");
          params.push(v);
          return `$${params.length}`;
        };
        if (singular) clauses.push(`id=${bind(args.id)}`);
        for (const [key, value] of Object.entries(args.where ?? {})) {
          if (value === null) continue;
          const column = key.replace(/_(gte|lte)$/, "");
          if (!e.fields.some((f) => f.name === column))
            throw new Error("Unknown filter");
          clauses.push(
            `${identifier(snake(column))}${key.endsWith("_gte") ? ">=" : key.endsWith("_lte") ? "<=" : "="}${bind(value)}`,
          );
        }
        const limit = singular ? 1 : (args.first ?? 25),
          offset = args.skip ?? 0;
        if (
          !Number.isInteger(limit) ||
          limit < 0 ||
          limit > 100 ||
          !Number.isInteger(offset) ||
          offset < 0 ||
          offset > 5000
        )
          throw new Error("Invalid pagination");
        const columns = e.fields
          .map(
            (f) =>
              `${identifier(snake(f.name))}${f.type === "BigInt" ? "::text" : ""} AS "${f.name}"`,
          )
          .join(",");
        const rows = await tx.unsafe(
          `SELECT ${columns} FROM ${identifier(dbSchema)}.${identifier(snake(e.name) + "s")} ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY block_number,id LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
          params,
        );
        return singular ? (rows[0] ?? null) : rows;
      };
      root[name] = (args: any) => read(args, true);
      root[`${name}s`] = (args: any) => read(args, false);
    }
    const result = await execute({
      schema,
      document: doc,
      rootValue: root,
      variableValues: variables,
    });
    if (result.errors)
      throw new Error(
        "Query failed; check field types and pipeline availability",
      );
    if (Buffer.byteLength(JSON.stringify(result.data)) > 2_000_000)
      throw new Error("Result too large; reduce first");
    return result.data;
  });
}
