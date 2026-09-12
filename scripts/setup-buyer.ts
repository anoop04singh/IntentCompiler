import "dotenv/config";
import {
  Client,
  PrivateKey,
  AccountCreateTransaction,
  Hbar,
  TransactionId,
  TransactionReceiptQuery,
} from "@hiero-ledger/sdk";
import { updateEnv } from "../src/env-file.js";
if (process.env.HEDERA_NETWORK !== "hedera:testnet")
  throw new Error("Buyer setup is testnet only");
if (process.env.BUYER_ACCOUNT_ID) {
  console.log("Buyer account already configured; no account created.");
  process.exit(0);
}
const client = Client.forTestnet().setOperator(
  process.env.HEDERA_OPERATOR_ID!,
  PrivateKey.fromString(process.env.HEDERA_OPERATOR_KEY!),
);
try {
  let id: string;
  if (process.env.BUYER_CREATION_TRANSACTION_ID) {
    const receipt = await new TransactionReceiptQuery()
      .setTransactionId(
        TransactionId.fromString(process.env.BUYER_CREATION_TRANSACTION_ID),
      )
      .execute(client);
    if (!receipt.accountId)
      throw new Error(
        "Buyer creation needs ledger reconciliation; refusing to fund a duplicate account",
      );
    id = receipt.accountId.toString();
  } else {
    const key = process.env.BUYER_PRIVATE_KEY
      ? PrivateKey.fromString(process.env.BUYER_PRIVATE_KEY)
      : PrivateKey.generateECDSA();
    const txId = TransactionId.generate(process.env.HEDERA_OPERATOR_ID!);
    await updateEnv({
      BUYER_PRIVATE_KEY: key.toStringDer(),
      BUYER_CREATION_TRANSACTION_ID: txId.toString(),
    });
    const response = await new AccountCreateTransaction()
      .setTransactionId(txId)
      .setKeyWithoutAlias(key.publicKey)
      .setInitialBalance(new Hbar(2))
      .setMaxTransactionFee(new Hbar(1))
      .execute(client);
    const receipt = await response.getReceipt(client);
    id = receipt.accountId!.toString();
  }
  await updateEnv({ BUYER_ACCOUNT_ID: id });
  console.log(
    `Testnet buyer ${id} configured with 2 test HBAR initial funding. Its private key remains in .env.`,
  );
} finally {
  client.close();
}
