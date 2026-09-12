import { afterEach, expect, it, vi } from "vitest";
import { config } from "../src/config.js";

afterEach(() => vi.unstubAllEnvs());
it.each([
  ["HEDERA_NETWORK", "hedera:mainnet"],
  ["BLOCKY_FACILITATOR_URL", "https://api.blocky402.com"],
  ["SUBSTREAMS_ENDPOINT", "mainnet.eth.streamingfast.io:443"],
])("rejects non-testnet configuration for %s", (name, value) => {
  vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
  vi.stubEnv("HEDERA_PAY_TO", "0.0.123");
  vi.stubEnv(name, value);
  expect(() => config()).toThrow();
});
