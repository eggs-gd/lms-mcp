import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "../config.js";
import { createMcpServer } from "../server.js";

/**
 * Stateless Streamable HTTP transport: a fresh MCP server + transport per
 * request, no session tracking. Suitable for a small always-on deployment
 * behind Docker.
 */
export async function runHttp(config: Config): Promise<void> {
  const { host, port, path, token } = config.http;
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, server: "lms-mcp", lms: config.url });
  });

  if (token) {
    app.use(path, (req, res, next) => {
      if (req.header("authorization") !== `Bearer ${token}`) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      next();
    });
  }

  app.post(path, async (req: Request, res: Response) => {
    const server = createMcpServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request failed:", err);
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    }
  });

  const notAllowed = (_req: Request, res: Response) =>
    res.status(405).json({ error: "method not allowed" });
  app.get(path, notAllowed);
  app.delete(path, notAllowed);

  await new Promise<void>((resolve) => {
    app.listen(port, host, () => resolve());
  });
  console.error(`lms-mcp (http) on http://${host}:${port}${path} → ${config.url}`);
  if (!token) {
    console.error("warning: MCP_AUTH_TOKEN is not set — the endpoint is unauthenticated");
  }
}
