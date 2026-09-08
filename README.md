# lms-mcp

An [MCP](https://modelcontextprotocol.io) server for controlling a **Lyrion Music Server**
(formerly Logitech Media Server / SlimServer / Squeezebox server).

It talks to LMS over its JSON-RPC (CLI-over-HTTP) API on port `9000`, and exposes
playback control, library search and queue management as MCP tools.

## Requirements

- Node.js ≥ 20
- A reachable Lyrion Music Server with the web interface enabled

## Setup

```bash
npm install
npm run build
```

Configure via environment variables (see [.env.example](.env.example)):

| Variable             | Required | Description                                              |
| -------------------- | -------- | -------------------------------------------------------- |
| `LMS_URL`            | yes      | Base URL, e.g. `http://192.168.1.10:9000`                |
| `LMS_USERNAME`       | no       | HTTP basic auth user (only if password protection is on) |
| `LMS_PASSWORD`       | no       | HTTP basic auth password                                 |
| `LMS_DEFAULT_PLAYER` | no       | MAC or exact name of the player to target by default     |
| `MCP_TRANSPORT`      | no       | `stdio` (default) or `http`                              |
| `MCP_HTTP_PORT`      | no       | HTTP transport port (default `3000`)                     |
| `MCP_AUTH_TOKEN`     | no       | Bearer token required on the HTTP endpoint               |

The server supports two transports:

- **stdio** — for running locally, launched by the MCP client as a child process.
- **Streamable HTTP** — a long-running endpoint at `/mcp`, used for the always-on
  Docker deployment. This is the image's default.

## Local use (stdio)

```bash
npm install && npm run build
```

```json
{
  "mcpServers": {
    "lms": {
      "command": "node",
      "args": ["/absolute/path/to/lms-mcp/dist/index.js"],
      "env": { "LMS_URL": "http://192.168.1.10:9000" }
    }
  }
}
```

During development: `npm run dev`.

## Server use (Docker, HTTP)

Multi-arch images (`linux/amd64`, `linux/arm64`) are published to the GitHub
Container Registry on every push to `main` and every `v*` tag:

```
ghcr.io/eggs-gd/lms-mcp:latest
```

Run it with the bundled [`compose.yaml`](compose.yaml):

```bash
cp .env.example .env      # set LMS_URL and MCP_AUTH_TOKEN
docker compose up -d
```

Then point the MCP client at the URL:

```json
{
  "mcpServers": {
    "lms": {
      "url": "http://your-server:3000/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

`GET /health` returns a plain JSON liveness check.

## Tools

| Tool                 | What it does                                                     |
| -------------------- | --------------------------------------------------------------- |
| `list_players`       | List players and their state                                     |
| `now_playing`        | Current track, mode, volume, queue position                      |
| `playback_control`   | play / pause / toggle / stop / next / previous                   |
| `set_volume`         | Absolute (0–100) or relative (`+5` / `-10`)                      |
| `seek`               | Seek to N seconds in the current track                           |
| `set_power`          | Turn a player on/off                                             |
| `search_library`     | Search artists / albums / tracks, returns ids                    |
| `play_music`         | Load / add / insert by library id or URL                         |
| `show_queue`         | List the current play queue                                      |
| `queue_edit`         | clear / remove / move / jump                                     |
| `set_repeat_shuffle` | Set repeat and shuffle modes                                     |
| `raw_command`        | Escape hatch for any LMS CLI command                             |

## Reference

- LMS CLI API docs: `http://<your-server>:9000/html/docs/cli-api.html`

## License

MIT
