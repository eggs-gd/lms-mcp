/**
 * Thin client for the Lyrion Music Server (LMS) JSON-RPC / CLI-over-HTTP API.
 *
 * Every LMS CLI command is reachable through a single POST to `/jsonrpc.js`:
 *
 *   { "id": 1, "method": "slim.request", "params": [ <playerId>, [ <cmd>, ...<args> ] ] }
 *
 * `<playerId>` is a player MAC address, or `"-"` / `""` for server-scoped
 * commands (e.g. `serverstatus`, `players`, `search`).
 *
 * Docs: http://<server>:9000/html/docs/cli-api.html
 */

export interface LmsClientOptions {
  /** Base URL of the LMS web UI, e.g. `http://192.168.1.10:9000` */
  url: string;
  username?: string;
  password?: string;
  /** Request timeout in ms (default 10000) */
  timeoutMs?: number;
}

export type LmsParam = string | number;

/** Result payload of a `slim.request` call; shape depends on the command. */
export type LmsResult = Record<string, unknown>;

export class LmsError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LmsError";
  }
}

export class LmsClient {
  private readonly endpoint: string;
  private readonly authHeader?: string;
  private readonly timeoutMs: number;
  private requestId = 0;

  constructor(opts: LmsClientOptions) {
    const base = opts.url.replace(/\/+$/, "");
    this.endpoint = `${base}/jsonrpc.js`;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    if (opts.username != null && opts.password != null) {
      const token = Buffer.from(`${opts.username}:${opts.password}`).toString("base64");
      this.authHeader = `Basic ${token}`;
    }
  }

  /**
   * Execute a raw CLI command.
   *
   * @param playerId  Player MAC, or `"-"` for server-scoped commands.
   * @param command   Command tokens, e.g. `["mixer", "volume", "+5"]`.
   */
  async request(playerId: string, command: LmsParam[]): Promise<LmsResult> {
    const body = JSON.stringify({
      id: ++this.requestId,
      method: "slim.request",
      params: [playerId, command],
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.authHeader ? { Authorization: this.authHeader } : {}),
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : "failed";
      throw new LmsError(`Request to LMS ${reason} (${this.endpoint})`, err);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new LmsError(`LMS responded ${res.status} ${res.statusText}`);
    }

    let json: { result?: LmsResult; error?: unknown };
    try {
      json = (await res.json()) as typeof json;
    } catch (err) {
      throw new LmsError("LMS returned a non-JSON response", err);
    }

    if (json.error) {
      throw new LmsError(`LMS error: ${JSON.stringify(json.error)}`);
    }
    return json.result ?? {};
  }

  /** Server-scoped command (playerId = `"-"`). */
  serverRequest(command: LmsParam[]): Promise<LmsResult> {
    return this.request("-", command);
  }
}
