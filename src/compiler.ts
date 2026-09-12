import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EventFragment, Interface } from "ethers";
import YAML from "yaml";
import {
  type Definition,
  entitySchema,
  graphType,
  pascal,
  snake,
} from "./spec.js";

export function generateProject(d: Definition): Record<string, string> {
  const declarations = d.events
    .map(
      (e) => `message ${pascal(e.name)} {
 string id = 1; uint64 block_number = 2; int64 timestamp = 3;
 string transaction_hash = 4; uint32 log_index = 5; string contract = 6;
 ${e.inputs.map((i, n) => `${i.type === "bool" ? "bool" : "string"} arg_${snake(i.name)} = ${n + 7};`).join("\n ")}
}`,
    )
    .join("\n");
  const abi = d.events.map((e) => ({
    ...e,
    inputs: e.inputs.map((i, n) => ({ ...i, name: `arg${n}` })),
  }));
  const proto = `syntax = "proto3";\npackage graphrail.v1;\n${declarations}\nmessage Events {\n${d.events.map((e, n) => `repeated ${pascal(e.name)} event${n} = ${n + 1};`).join("\n")}\n}\n`;
  const decode = d.events
    .map(
      (e, n) => `
      if let Some(event) = abi::events::${pascal(e.name)}::match_and_decode(log) {
        out.event${n}.push(pb::${pascal(e.name)} {
          id: format!("{}-{}", hex0x(&trx.hash), log.index), block_number: block.number,
          timestamp: block.header.as_ref().and_then(|h| h.timestamp.as_ref()).map(|t| t.seconds).unwrap_or_default(),
          transaction_hash: hex0x(&trx.hash), log_index: log.index, contract: address.clone(),
          ${e.inputs.map((i, k) => `arg_${snake(i.name)}: ${i.type === "bool" ? `event.arg${k}` : i.type === "string" ? `event.arg${k}` : graphType(i.type) === "Bytes" ? `hex0x(&event.arg${k})` : `event.arg${k}.to_string()`},`).join("\n          ")}
        });
      }`,
    )
    .join("\n");
  const changes = d.events
    .map(
      (e, n) => `
  for event in events.event${n} {
    tables.create_row("${snake(e.name)}s", event.id)
      .set("block_number", event.block_number)
      .set("timestamp", event.timestamp)
      .set("transaction_hash", event.transaction_hash)
      .set("log_index", event.log_index)
      .set("contract", event.contract)
      ${e.inputs.map((i) => `.set("arg_${snake(i.name)}", event.arg_${snake(i.name)})`).join("\n      ")};
  }`,
    )
    .join("\n");
  const ddl = d.events
    .map(
      (e) => `CREATE TABLE IF NOT EXISTS ${snake(e.name)}s (
 id TEXT PRIMARY KEY, block_number BIGINT NOT NULL, timestamp BIGINT NOT NULL,
 transaction_hash TEXT NOT NULL, log_index BIGINT NOT NULL, contract TEXT NOT NULL${e.inputs.length ? "," : ""}
 ${e.inputs.map((i) => `arg_${snake(i.name)} ${graphType(i.type) === "BigInt" ? "NUMERIC(78,0)" : i.type === "bool" ? "BOOLEAN" : "TEXT"} NOT NULL`).join(",\n ")}
);
CREATE INDEX IF NOT EXISTS ${snake(e.name)}s_block ON ${snake(e.name)}s(block_number, id);
`,
    )
    .join("\n");
  // Cross-library fixtures: ethers encodes independently; Rust Abigen must recover exact values.
  const fixtures = d.events
    .map((e, n) => {
      const values = e.inputs.map((i) =>
        i.type === "bool"
          ? true
          : i.type === "address"
            ? "0x" + "ab".repeat(20)
            : i.type === "string"
              ? "GraphRail fixture"
              : i.type === "bytes"
                ? "0xaabb"
                : i.type.startsWith("bytes")
                  ? "0x" + "ab".repeat(Number(i.type.slice(5)))
                  : i.type.startsWith("uint")
                    ? ((1n << BigInt(i.type.slice(4))) - 1n).toString()
                    : (-(1n << (BigInt(i.type.slice(3)) - 1n))).toString(),
      );
      const iface = new Interface([e]);
      const encoded = iface.encodeEventLog(iface.getEvent(e.name)!, values);
      const bytes = (h: string) =>
        `vec![${Buffer.from(h.slice(2), "hex").join(",")}]`;
      return `#[test] fn decodes_event_${n}_without_precision_loss() {
      let log=eth::Log {address:${bytes(d.contracts[0]!)},topics:vec![${encoded.topics.map(bytes).join(",")}],data:${bytes(encoded.data)},index:7,ordinal:7,..Default::default()};
      let block=eth::Block {number:19000000,transaction_traces:vec![eth::TransactionTrace {hash:vec![0xab;32],status:1,calls:vec![eth::Call {logs:vec![log.clone()],..Default::default()}],..Default::default()}],..Default::default()};
      let events=substreams::testing::map!(map_events(block.clone())).unwrap();
      assert_eq!(events.event${n}.len(),1);
      ${e.inputs.map((i, k) => `assert_eq!(events.event${n}[0].arg_${snake(i.name)}, ${typeof values[k] === "boolean" ? String(values[k]) : JSON.stringify(values[k])});`).join("\n      ")}
      let changes=substreams::testing::map!(db_out(events)).unwrap();assert_eq!(changes.table_changes.len(),1);
      assert_eq!(changes.table_changes[0].table,"${snake(e.name)}s");
      let mut reverted=block;reverted.transaction_traces[0].calls[0].state_reverted=true;
      let empty=substreams::testing::map!(map_events(reverted)).unwrap();assert!(empty.event${n}.is_empty());
    }`;
    })
    .join("\n");
  const rust = `use substreams::{errors::Error, Hex};
use substreams_ethereum::{pb::eth::v2 as eth, Event};
mod abi { include!(concat!(env!("OUT_DIR"), "/abi.rs")); }
mod pb { include!(concat!(env!("OUT_DIR"), "/graphrail.v1.rs")); }
use substreams_database_change::{tables::Tables, pb::sf::substreams::sink::database::v1::DatabaseChanges};
fn hex0x(bytes: &[u8]) -> String { format!("0x{}", Hex::encode(bytes)) }
const CONTRACTS: &[&str] = &[${d.contracts.map((v) => JSON.stringify(v)).join(",")}];
const TOPICS: &[&str] = &[${d.events.map((e) => JSON.stringify(EventFragment.from(e).topicHash)).join(",")}];
#[substreams::handlers::map]
pub fn index_events(block: eth::Block) -> Result<substreams::pb::sf::substreams::index::v1::Keys, Error> {
 for trx in block.transactions() {
  for (log, _) in trx.logs_with_calls() {
   if CONTRACTS.contains(&hex0x(&log.address).as_str()) && log.topics.first().map(|t| TOPICS.contains(&hex0x(t).as_str())).unwrap_or(false) {
    return Ok(substreams::pb::sf::substreams::index::v1::Keys { keys: vec!["match".into()] });
   }
  }
 }
 Ok(substreams::pb::sf::substreams::index::v1::Keys { keys: vec![] })
}
#[substreams::handlers::map]
pub fn map_events(block: eth::Block) -> Result<pb::Events, Error> {
 let mut out = pb::Events::default();
 for trx in block.transactions() {
  for (log, _) in trx.logs_with_calls() {
   let address = hex0x(&log.address);
   if !CONTRACTS.contains(&address.as_str()) { continue; }
   ${decode}
  }
 }
 Ok(out)
}
#[substreams::handlers::map]
pub fn db_out(events: pb::Events) -> Result<DatabaseChanges, Error> {
 let mut tables = Tables::new();
 ${changes}
 Ok(tables.to_database_changes())
}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn empty_block_produces_no_entities() {
  let events = substreams::testing::map!(map_events(eth::Block::default())).unwrap();
  let result = substreams::testing::map!(db_out(events)).unwrap();
 assert!(result.table_changes.is_empty());
 }
 ${fixtures}
}
`;
  const manifest = {
    specVersion: "v0.1.0",
    package: {
      name: "graphrail_pipeline",
      version: "v0.1.0",
      description: "Typed EVM events generated by GraphRail",
      url: "https://thegraph.com/docs/en/substreams/",
    },
    network: d.network,
    imports: {
      // v1.22 includes SQL Service descriptors. Importing the legacy SQL
      // protodefs package duplicates its deprecated Service during live decoding.
      database:
        "https://github.com/streamingfast/substreams-sink-database-changes/releases/download/v4.0.0/substreams-sink-database-changes-v4.0.0.spkg",
    },
    protobuf: { files: ["events.proto"], importPaths: ["./proto"] },
    binaries: {
      default: {
        type: "wasm/rust-v1",
        file: "./target/wasm32-unknown-unknown/release/graphrail_pipeline.wasm",
      },
    },
    modules: [
      {
        name: "index_events",
        kind: "blockIndex",
        initialBlock: d.startBlock,
        inputs: [{ source: "sf.ethereum.type.v2.Block" }],
        output: { type: "proto:sf.substreams.index.v1.Keys" },
      },
      {
        name: "map_events",
        kind: "map",
        initialBlock: d.startBlock,
        blockFilter: { module: "index_events", query: { string: "match" } },
        inputs: [{ source: "sf.ethereum.type.v2.Block" }],
        output: { type: "proto:graphrail.v1.Events" },
      },
      {
        name: "db_out",
        kind: "map",
        initialBlock: d.startBlock,
        inputs: [{ map: "map_events" }],
        output: {
          type: "proto:sf.substreams.sink.database.v1.DatabaseChanges",
        },
      },
    ],
    sink: {
      module: "db_out",
      type: "sf.substreams.sink.sql.service.v1.Service",
      config: { schema: "./schema.sql", engine: "postgres" },
    },
  };
  return {
    "Cargo.toml": `[package]\nname = "graphrail-pipeline"\nversion = "0.1.0"\nedition = "2021"\n[lib]\ncrate-type = ["cdylib", "rlib"]\n[dependencies]\nsubstreams = "0.7.4"\nsubstreams-ethereum = "0.11"\nprost = "0.13"\nprost-types = "0.13"\nethabi = "17"\nsubstreams-database-change = "4"\n[build-dependencies]\nsubstreams-ethereum = "0.11"\nprost-build = "0.13"\n[profile.release]\nlto = true\nopt-level = "s"\nstrip = "debuginfo"\n`,
    "build.rs": `fn main() {\n let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());\n substreams_ethereum::Abigen::new("Contract", "abi/events.json").unwrap().generate().unwrap().write_to_file(out.join("abi.rs")).unwrap();\n prost_build::compile_protos(&["proto/events.proto"], &["proto"]).unwrap();\n println!("cargo:rerun-if-changed=abi/events.json");\n println!("cargo:rerun-if-changed=proto");\n}\n`,
    "abi/events.json": JSON.stringify(abi, null, 2),
    "proto/events.proto": proto,
    "src/lib.rs": rust,
    "substreams.yaml": YAML.stringify(manifest),
    "schema.graphql": entitySchema(d),
    "schema.sql": ddl,
    "README.md": `# graphrail_pipeline\n\nTyped ${d.events.map((e) => e.name).join(", ")} events on ${d.network}.\n\n## Overview\nIndexes the selected contracts from block ${d.startBlock}. Each ABI event has its own protobuf message and typed PostgreSQL table.\n\n## Modules\n| Name | Kind | Output | Purpose |\n| --- | --- | --- | --- |\n| index_events | blockIndex | Keys | Skip irrelevant blocks |\n| map_events | map | Events | Typed decoded events |\n| db_out | map | DatabaseChanges | Hosted PostgreSQL ingestion |\n\n## Prerequisites\nRust, wasm32-unknown-unknown, protoc, buf, Substreams CLI and SUBSTREAMS_API_KEY.\n\n## Quick Start\n\n\`substreams run substreams.yaml db_out -s ${d.testStartBlock} -t +100 -o jsonl\`\n`,
  };
}
export async function writeProject(
  root: string,
  files: Record<string, string>,
) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}
