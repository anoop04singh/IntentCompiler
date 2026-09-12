import { type Definition, snake, graphType } from "./spec.js";
export function checkOutput(text: string, d: Definition, blocks = 100) {
  const found = new Set<string>();
  let count = 0;
  function inspect(value: any) {
    if (!value || typeof value !== "object") return;
    const changes = value.tableChanges ?? value.table_changes;
    if (Array.isArray(changes))
      for (const change of changes) {
        const event = d.events.find(
          (e) => `${snake(e.name)}s` === change.table,
        );
        if (!event || !/^0x[0-9a-f]{64}-[0-9]+$/.test(change.pk ?? ""))
          throw new Error("Invalid row identity");
        if (![1, "OPERATION_CREATE", "CREATE"].includes(change.operation))
          throw new Error("Unexpected row operation");
        const fields = new Map<string, string>(
          (change.fields ?? []).map((f: any) => [
            f.name,
            f.newValue ?? f.new_value ?? "",
          ]),
        );
        for (const name of [
          "block_number",
          "timestamp",
          "transaction_hash",
          "log_index",
          "contract",
          ...event.inputs.map((i) => `arg_${snake(i.name)}`),
        ])
          if (!fields.has(name)) throw new Error(`Missing field ${name}`);
        if (!d.contracts.includes(fields.get("contract")!))
          throw new Error("Unrequested contract");
        const block = fields.get("block_number")!;
        if (
          !/^\d+$/.test(block) ||
          BigInt(block) < BigInt(d.testStartBlock) ||
          BigInt(block) >= BigInt(d.testStartBlock + blocks)
        )
          throw new Error("Block outside test range");
        if (!/^0x[0-9a-f]{64}$/.test(fields.get("transaction_hash")!))
          throw new Error("Invalid transaction hash");
        if (
          change.pk !==
          `${fields.get("transaction_hash")}-${fields.get("log_index")}`
        )
          throw new Error("Inconsistent row identity");
        for (const name of ["timestamp", "log_index"])
          if (!/^\d+$/.test(fields.get(name)!))
            throw new Error(`Invalid ${name}`);
        for (const input of event.inputs) {
          const v = fields.get(`arg_${snake(input.name)}`)!;
          const type = graphType(input.type);
          if (typeof v !== "string")
            throw new Error("Database values must be strings");
          if (type === "BigInt" && !/^-?\d+$/.test(v))
            throw new Error("Amounts must be exact decimal strings");
          if (type === "Boolean" && !["true", "false"].includes(v))
            throw new Error("Invalid boolean");
          if (type === "Bytes" && !/^0x(?:[0-9a-f]{2})*$/.test(v))
            throw new Error("Invalid bytes");
        }
        found.add(event.name);
        count++;
      }
    for (const child of Object.values(value))
      if (Array.isArray(child)) child.forEach(inspect);
      else if (child && typeof child === "object") inspect(child);
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    let v;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    inspect(v);
  }
  const missing = d.events.filter((e) => !found.has(e.name));
  if (!count || missing.length)
    throw new Error(
      `Output quality check needs a sample of every event; missing: ${missing.map((e) => e.name).join(", ")}`,
    );
  return { rows: count, events: [...found] };
}
