import { describe, it, expect } from "vitest";
import { validateDefinition, fingerprint, entitySchema } from "../src/spec.js";
import { generateProject } from "../src/compiler.js";
import { validateQuery } from "../src/query.js";
import { checkOutput } from "../src/output-check.js";
import { usdc } from "../examples/usdc.js";
import YAML from "yaml";
import { readFileSync } from "node:fs";

describe("coverage and compiler", () => {
  it("rejects mainnet definitions in this testnet-only deployment", () => {
    expect(() => validateDefinition({ ...usdc, network: "mainnet" })).toThrow();
  });
  it("reuses equivalent definitions without merging different coverage", () => {
    const d = validateDefinition(usdc);
    expect(fingerprint(d)).toBe(
      fingerprint(
        validateDefinition({
          ...usdc,
          contracts: usdc.contracts.map((x) =>
            x.toUpperCase().replace("0X", "0x"),
          ),
          abiSource: "https://example.com/abi",
          testStartBlock: 11686715,
        }),
      ),
    );
    expect(fingerprint(d)).not.toBe(
      fingerprint(validateDefinition({ ...usdc, startBlock: 11000000 })),
    );
  });
  it("rejects lossy indexed dynamic values and unsupported intents", () => {
    expect(() =>
      validateDefinition({
        ...usdc,
        events: [
          {
            ...usdc.events[0],
            inputs: [{ name: "name", type: "string", indexed: true }],
          },
        ],
      }),
    ).toThrow("cannot be decoded");
    expect(() =>
      validateDefinition({
        ...usdc,
        events: [
          {
            ...usdc.events[0],
            inputs: [{ name: "amounts", type: "uint256[]", indexed: false }],
          },
        ],
      }),
    ).toThrow("compiler extension");
    expect(() =>
      validateDefinition({ ...usdc, aggregate: "volume" }),
    ).toThrow();
  });
  it("generates packable module wiring, typed amounts, and official database sink", () => {
    const files = generateProject(validateDefinition(usdc));
    const manifest = YAML.parse(files["substreams.yaml"]!);
    expect(manifest.modules[1].blockFilter.module).toBe("index_events");
    expect(manifest.modules[2].output.type).toBe(
      "proto:sf.substreams.sink.database.v1.DatabaseChanges",
    );
    expect(files["proto/events.proto"]).toContain("string arg_value");
    expect(files["schema.sql"]).toContain("NUMERIC(78,0)");
    expect(manifest.sink.module).toBe("db_out");
    expect(files["src/lib.rs"]).toContain("event.arg2.to_string()");
    expect(files["src/lib.rs"]).toContain("trx.logs_with_calls()");
  });
});
describe("bounded queries", () => {
  const schema = entitySchema(usdc);
  it("accepts entity reads and bounded variable pagination", () => {
    expect(() =>
      validateQuery("{ transfers(first: 5) { id arg_value } }", schema),
    ).not.toThrow();
    expect(() =>
      validateQuery("query($n:Int!){ transfers(first:$n){id} }", schema, {
        n: 50,
      }),
    ).not.toThrow();
  });
  it.each([
    "mutation { transfers { id } }",
    "{ _meta { deployment } }",
    "{ transfers(first: 10001) { id } }",
    "{ transfers { ...X } } fragment X on Transfer { id }",
    "{ unknown { id } }",
    "{ transfers{ id } } query Second { transfers { id } }",
  ])("rejects %s", (query) =>
    expect(() => validateQuery(query, schema)).toThrow(),
  );
});
describe("output quality", () => {
  it("validates actual Sepolia v4 stdout using the value field", () => {
    const fixture = JSON.parse(
      readFileSync("tests/fixtures/sepolia-db-out.json", "utf8"),
    );
    expect(checkOutput(JSON.stringify(fixture), usdc).rows).toBe(3);
  });
  it("never treats empty output as deployable", () =>
    expect(() => checkOutput("{}", usdc)).toThrow("every event"));
  it("validates typed entity identity and fields", () => {
    const values = {
      block_number: "11686714",
      timestamp: "1700000000",
      transaction_hash: "0x" + "a".repeat(64),
      log_index: "0",
      contract: usdc.contracts[0],
      arg_from: usdc.contracts[0],
      arg_to: usdc.contracts[0],
      arg_value: "340282366920938463463374607431768211456",
    };
    const fields = Object.entries(values).map(([name, newValue]) => ({
      name,
      newValue,
    }));
    const output = JSON.stringify({
      tableChanges: [
        {
          table: "transfers",
          pk: "0x" + "a".repeat(64) + "-0",
          operation: "OPERATION_CREATE",
          fields,
        },
      ],
    });
    expect(checkOutput(output, usdc).rows).toBe(1);
  });
});
