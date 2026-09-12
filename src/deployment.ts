import type { DB, Row } from "./db.js";
import type { Config } from "./config.js";
import type { Definition } from "./spec.js";
import { createHash } from "node:crypto";
export class Market {
  constructor(
    readonly db: DB,
    readonly c: Pick<Config, "GRAPH_MARKET_BASE_URL">,
  ) {}
  async request(
    service: string,
    method: string,
    body: unknown,
    token?: string,
  ): Promise<any> {
    const response = await fetch(
      `${this.c.GRAPH_MARKET_BASE_URL}/${service}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new Error(`Market ${method} failed (HTTP ${response.status})`);
    const value = (await response.json()) as any;
    if (value.success === false)
      throw new Error(`Market ${method} was rejected`);
    return value;
  }
  async auth() {
    return this.db.begin(async (tx) => {
      const [row] =
        await tx`select * from graphrail.provider_credentials where id='market' for update`;
      if (!row) throw new Error("Run setup:market login first");
      let value = row.value;
      if (new Date(row.expires_at).getTime() < Date.now() + 60000) {
        const next = await this.request(
          "sf.portalapi.v1.PortalApi",
          "RefreshToken",
          { refresh_token: value.refreshToken },
        );
        if (!next.accessToken || !next.refreshToken)
          throw new Error("Market session expired; login again");
        value = { ...value, ...next };
        await tx`update graphrail.provider_credentials set value=${tx.json(value)},expires_at=${new Date(Date.now() + Number(next.expiresIn) * 1000)} where id='market'`;
      }
      return value as { accessToken: string; organizationId: string };
    });
  }
  async call(method: string, body: Record<string, unknown> = {}) {
    const auth = await this.auth();
    return this.request(
      "sf.portalapi.v1.HostedService",
      method,
      { ...body, organization_id: auth.organizationId },
      auth.accessToken,
    );
  }
  async deploy(slot: Row, d: Definition, url: string) {
    return this.call("Deploy", deploymentRequest(slot, d, url));
  }
  async state(id: string) {
    return this.call("GetDeploymentState", { deployment_id: id });
  }
}
export function deploymentRequest(slot: Row, d: Definition, url: string) {
  if (!slot.secret_ready)
    throw new Error("Hosted database secret has not been staged");
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Package must be public HTTPS");
  const { server, port, user, database, schema, sslmode } =
    slot.postgres_config;
  if (
    schema !== slot.db_schema ||
    !/^gr_[a-f0-9]{32}$/.test(schema) ||
    sslmode !== "require"
  )
    throw new Error("Invalid hosted database configuration");
  return {
    deployment_id: slot.hosted_id ?? slot.deployment_id,
    name: `GraphRail ${slot.pipeline_id}`,
    use_stored_secret: true,
    deployment_request: {
      sink_sql_deployment: {
        spkg: { url },
        network: d.network,
        replica: 1,
        execution_config: {
          start_block: d.startBlock,
          output_module: "db_out",
          module_output_type:
            "proto:sf.substreams.sink.database.v1.DatabaseChanges",
        },
        outputConfig: {
          postgres: { server, port, user, database, schema, sslmode },
        },
      },
    },
  };
}
export function deploymentProgress(body: any) {
  const s = body.deploymentState ?? body.deployment_state ?? {};
  const es = s.executionStates ?? s.execution_states ?? [];
  const failed =
    s.crashloopbackoff ||
    [99, "DEPLOYMENT_STATE_ERROR", 2, "DEPLOYMENT_STATE_DELETED"].includes(
      s.deploymentState ?? s.deployment_state,
    ) ||
    es.some((e: any) => [5, "STATE_FAILING"].includes(e.state));
  const blocks = es.map((e: any) =>
    Number(e.currentBlock ?? e.current_block ?? 0),
  );
  return {
    failed: Boolean(failed),
    active: es.length > 0 || Number(s.replica ?? 0) > 0,
    healthy: Number(s.healthyReplicas ?? s.healthy_replicas ?? 0) > 0,
    indexedBlock: blocks.length ? Math.min(...blocks) : 0,
  };
}
export async function publishPackage(
  c: Pick<
    Config,
    "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "PACKAGE_BUCKET"
  >,
  bytes: Buffer,
) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const origin = new URL(c.SUPABASE_URL);
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".supabase.co"))
    throw new Error("Use your HTTPS Supabase project URL");
  const path = `${c.PACKAGE_BUCKET}/${hash}.spkg`;
  const headers = {
    Authorization: `Bearer ${c.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: c.SUPABASE_SERVICE_ROLE_KEY,
  };
  const upload = await fetch(`${origin.origin}/storage/v1/object/${path}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/octet-stream",
      "x-upsert": "false",
    },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(60000),
    redirect: "error",
  });
  if (!upload.ok) {
    const error = (await upload.json()) as any;
    if (
      !["409", "Duplicate"].includes(String(error.statusCode)) &&
      error.error !== "Duplicate"
    )
      throw new Error("Package upload failed");
  }
  const url = `${origin.origin}/storage/v1/object/public/${path}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60000),
    redirect: "error",
  });
  if (
    !response.ok ||
    createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex") !== hash
  )
    throw new Error("Public package verification failed");
  return { url, hash };
}
