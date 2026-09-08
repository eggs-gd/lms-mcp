export interface HttpConfig {
  host: string;
  port: number;
  path: string;
  /** Optional bearer token required on the MCP endpoint. */
  token?: string;
}

export interface Config {
  url: string;
  username?: string;
  password?: string;
  defaultPlayer?: string;
  /** How MCP clients connect: local stdio pipe, or a network HTTP endpoint. */
  transport: "stdio" | "http";
  http: HttpConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.LMS_URL?.trim();
  if (!url) {
    throw new Error("LMS_URL is required (e.g. http://192.168.1.10:9000)");
  }

  const transport = (env.MCP_TRANSPORT?.trim() || "stdio").toLowerCase();
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`MCP_TRANSPORT must be "stdio" or "http" (got "${transport}")`);
  }

  return {
    url,
    username: env.LMS_USERNAME?.trim() || undefined,
    password: env.LMS_PASSWORD?.trim() || undefined,
    defaultPlayer: env.LMS_DEFAULT_PLAYER?.trim() || undefined,
    transport,
    http: {
      host: env.MCP_HTTP_HOST?.trim() || "0.0.0.0",
      port: Number(env.MCP_HTTP_PORT?.trim() || env.PORT?.trim() || 3000),
      path: env.MCP_HTTP_PATH?.trim() || "/mcp",
      token: env.MCP_AUTH_TOKEN?.trim() || undefined,
    },
  };
}
