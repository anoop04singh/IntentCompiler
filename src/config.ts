import "dotenv/config";
import { z } from "zod";

const amount = z.string().regex(/^[1-9][0-9]*$/);
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  TRUST_LOOPBACK_PROXY: bool.default("false"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool.default("true"),
  HEDERA_NETWORK: z.literal("hedera:testnet").default("hedera:testnet"),
  HEDERA_PAY_TO: z.string().regex(/^0\.0\.[1-9][0-9]*$/),
  HEDERA_OPERATOR_ID: z.string().default(""),
  HEDERA_OPERATOR_KEY: z.string().default(""),
  HEDERA_HCS_TOPIC_ID: z.string().default(""),
  BLOCKY_FACILITATOR_URL: z
    .literal("https://api.testnet.blocky402.com")
    .default("https://api.testnet.blocky402.com"),
  BLOCKY_API_KEY: z.string().default(""),
  PAYMENT_ASSET: z
    .string()
    .regex(/^0\.0\.[0-9]+$/)
    .default("0.0.0"),
  COMMISSION_AMOUNT: amount.default("100000000"),
  QUERY_AMOUNT: amount.default("100000"),
  COMMISSIONING_ENABLED: bool.default("false"),
  SUBSTREAMS_API_KEY: z.string().default(""),
  SUBSTREAMS_BIN: z.string().default("substreams"),
  SUBSTREAMS_ENDPOINT: z
    .literal("sepolia.eth.streamingfast.io:443")
    .default("sepolia.eth.streamingfast.io:443"),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  PACKAGE_BUCKET: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("graphrail-packages"),
  GRAPH_MARKET_BASE_URL: z
    .string()
    .url()
    .default("https://admin.streamingfast.io"),
  BUILD_ROOT: z.string().default("./builds"),
  BUILD_TIMEOUT_MS: z.coerce.number().int().positive().default(900000),
  OUTPUT_TEST_BLOCKS: z.coerce.number().int().min(1).max(1000).default(100),
  WORKER_POLL_MS: z.coerce.number().int().min(1000).default(3000),
});
export type Config = z.infer<typeof schema>;
export function config(): Config {
  return schema.parse(process.env);
}
