import "dotenv/config";
import { database } from "../src/db.js";
import { Market } from "../src/deployment.js";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
const db = database({
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_SSL: process.env.DATABASE_SSL !== "false",
});
const market = new Market(db, {
  GRAPH_MARKET_BASE_URL:
    process.env.GRAPH_MARKET_BASE_URL || "https://admin.streamingfast.io",
});
try {
  const action = process.argv[2];
  if (action === "start") {
    const r = await market.request(
      "sf.portalapi.v1.PortalApi",
      "DeviceAuthorize",
      { client_name: "GraphRail operator" },
    );
    await db`insert into graphrail.provider_credentials(id,value,expires_at)values('market-device',${db.json({ deviceCode: r.deviceCode })},${new Date(Date.now() + Number(r.expiresIn) * 1000)}) on conflict(id) do update set value=excluded.value,expires_at=excluded.expires_at`;
    console.log(
      `Open ${r.verificationUriComplete || r.verificationUri}\nCode: ${r.userCode}\nAfter approving in your browser, run npm run setup:market -- finish. No background polling.`,
    );
  } else if (action === "finish") {
    const [row] =
      await db`select * from graphrail.provider_credentials where id='market-device'`;
    if (!row || new Date(row.expires_at).getTime() < Date.now())
      throw new Error("Login expired; run start again");
    const r = await market.request("sf.portalapi.v1.PortalApi", "DeviceToken", {
      device_code: row.value.deviceCode,
    });
    if (r.status !== "DEVICE_TOKEN_STATUS_APPROVED")
      throw new Error(
        "Login is not approved. Approve in browser before running finish again.",
      );
    if (!r.accessToken || !r.refreshToken || !r.organizationId)
      throw new Error("Incomplete login response");
    await db`insert into graphrail.provider_credentials(id,value,expires_at)values('market',${db.json(r)},${new Date(Date.now() + Number(r.expiresIn) * 1000)}) on conflict(id) do update set value=excluded.value,expires_at=excluded.expires_at`;
    await db`delete from graphrail.provider_credentials where id='market-device'`;
    console.log(
      "Market session saved privately in Supabase. Tokens are never sent to MCP clients.",
    );
  } else throw new Error("Usage: npm run setup:market -- start|finish");
} finally {
  await db.end();
}
