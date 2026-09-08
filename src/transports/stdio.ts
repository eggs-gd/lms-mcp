import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Config } from "../config.js";
import { createMcpServer } from "../server.js";

export async function runStdio(config: Config): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP channel; log to stderr.
  console.error(`lms-mcp (stdio) → ${config.url}`);
}
