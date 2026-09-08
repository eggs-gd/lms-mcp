import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { LmsClient } from "./lms/client.js";
import { registerTools } from "./tools/index.js";

export const SERVER_NAME = "lms-mcp";
export const SERVER_VERSION = "0.2.0";

/** Build a fully configured MCP server instance (not yet connected to a transport). */
export function createMcpServer(config: Config): McpServer {
  const client = new LmsClient({
    url: config.url,
    username: config.username,
    password: config.password,
  });

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, client, config);
  return server;
}
