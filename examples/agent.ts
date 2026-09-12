import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { createx402MCPClient } from "@x402/mcp";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { usdc } from "./usdc.js";
if (!process.env.BUYER_ACCOUNT_ID || !process.env.BUYER_PRIVATE_KEY)
  throw new Error(
    "Configure buyer credentials locally; never send private keys to GraphRail",
  );
const signer = createClientHederaSigner(
  process.env.BUYER_ACCOUNT_ID,
  PrivateKey.fromString(process.env.BUYER_PRIVATE_KEY),
  { network: "hedera:testnet" },
);
let spent = 0n;
const budget = BigInt(process.env.BUYER_MAX_PAYMENT || "100100000");
const client = createx402MCPClient({
  name: "graphrail-example-buyer",
  version: "1.0.0",
  schemes: [
    { network: "hedera:testnet", client: new ExactHederaScheme(signer) },
  ],
  autoPayment: true,
  onPaymentRequested: async ({ paymentRequired }) => {
    const req = paymentRequired.accepts[0];
    if (
      !req ||
      req.network !== "hedera:testnet" ||
      req.asset !== "0.0.0" ||
      req.payTo !== process.env.HEDERA_PAY_TO
    )
      return false;
    const amount = BigInt(req.amount);
    if (spent + amount > budget) return false;
    spent += amount;
    return true;
  },
});
await client.connect(
  new StreamableHTTPClientTransport(
    new URL(`${process.env.PUBLIC_URL || "http://localhost:3000"}/mcp`),
  ),
);
function data(r: any) {
  if (r.isError) throw new Error(JSON.stringify(r.content));
  return r.structuredContent ?? JSON.parse(r.content[0].text);
}
try {
  console.log(data(await client.callTool("list_pipelines", {})));
  const plan = data(
    await client.callTool("create_pipeline", {
      prompt: "Index USDC Transfer events on Ethereum from block 19000000",
      definition: usdc,
    }),
  );
  console.log("Quote:", plan);
  const pipelineId = plan.matched ?? plan.pipelineId;
  if (!plan.matched)
    console.log(
      data(
        await client.callTool("commission_pipeline", {
          planId: plan.planId,
          requestId: randomUUID(),
        }),
      ),
    );
  let ready = false;
  for (let i = 0; i < 180; i++) {
    const status = data(
      await client.callTool("get_pipeline_status", { pipelineId }),
    );
    console.log(status.status);
    if (status.status === "ready") {
      ready = true;
      break;
    }
    if (status.status === "failed") throw new Error(status.errorCode);
    await setTimeout(10000);
  }
  if (!ready)
    throw new Error("Still indexing; resume polling with the pipelineId above");
  console.log(
    data(
      await client.callTool("query_pipeline", {
        pipelineId,
        query:
          "{ transfers(first: 5) { id arg_from arg_to arg_value blockNumber } }",
        variables: {},
        requestId: randomUUID(),
      }),
    ),
  );
} finally {
  await client.close();
}
