#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { runHttp } from "./transports/http.js";
import { runStdio } from "./transports/stdio.js";

async function main(): Promise<void> {
  // Load a local .env if present (Node >= 20.12).
  try {
    process.loadEnvFile();
  } catch {
    // no .env file — fine
  }

  const config = loadConfig();
  if (config.transport === "http") {
    await runHttp(config);
  } else {
    await runStdio(config);
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
