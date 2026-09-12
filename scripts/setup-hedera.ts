import "dotenv/config";
import { Client, PrivateKey, TopicCreateTransaction } from "@hiero-ledger/sdk";
import { updateEnv } from "../src/env-file.js";
// An account must first be created/funded through the Hedera testnet portal.
if (!process.env.HEDERA_OPERATOR_ID || !process.env.HEDERA_OPERATOR_KEY)
  throw new Error(
    "Create/fund a testnet account and set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env",
  );
if (
  process.env.HEDERA_NETWORK &&
  process.env.HEDERA_NETWORK !== "hedera:testnet"
)
  throw new Error("Setup script is testnet only");
if (process.env.HEDERA_HCS_TOPIC_ID) {
  console.log("HCS topic is already configured; no new topic created.");
  process.exit(0);
}
const key = PrivateKey.fromString(process.env.HEDERA_OPERATOR_KEY);
const client = Client.forTestnet().setOperator(
  process.env.HEDERA_OPERATOR_ID,
  key,
);
try {
  const response = await new TopicCreateTransaction()
    .setTopicMemo("GraphRail marketplace provenance v1")
    .setSubmitKey(key.publicKey)
    .setAdminKey(key.publicKey)
    .execute(client);
  const receipt = await response.getReceipt(client);
  await updateEnv({ HEDERA_HCS_TOPIC_ID: receipt.topicId!.toString() });
  console.log(
    `Created Hedera testnet HCS topic ${receipt.topicId!.toString()} and saved its ID in .env.`,
  );
} finally {
  client.close();
}
