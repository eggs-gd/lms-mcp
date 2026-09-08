import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { LmsClient, LmsError, type LmsParam } from "../lms/client.js";
import { listPlayers, resolvePlayerId } from "../lms/players.js";

/** Wrap a handler so LmsError surfaces as a clean tool error instead of a stack trace. */
function tool<T>(fn: () => Promise<T>) {
  return fn().catch((err) => {
    if (err instanceof LmsError) {
      return { isError: true as const, content: [{ type: "text" as const, text: err.message }] };
    }
    throw err;
  });
}

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const playerArg = {
  player: z
    .string()
    .optional()
    .describe("Player MAC address or exact name. Defaults to LMS_DEFAULT_PLAYER or the only player."),
};

interface RawTrack {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  tracknum?: number;
  url?: string;
  artwork_url?: string;
  coverid?: string;
}

export function registerTools(server: McpServer, client: LmsClient, config: Config): void {
  const resolve = (ref?: string) => resolvePlayerId(client, ref, config.defaultPlayer);

  server.registerTool(
    "list_players",
    {
      title: "List players",
      description: "List all Squeezebox / squeezelite players known to the server and their state.",
      inputSchema: {},
    },
    () => tool(async () => json(await listPlayers(client))),
  );

  server.registerTool(
    "now_playing",
    {
      title: "Now playing",
      description: "Show the current track, playback mode, volume and queue position for a player.",
      inputSchema: { ...playerArg },
    },
    ({ player }) =>
      tool(async () => {
        const id = await resolve(player);
        const status = await client.request(id, ["status", "-", 1, "tags:aAlKcdrtuN"]);
        const cur = ((status.playlist_loop as RawTrack[] | undefined) ?? [])[0] ?? {};
        return json({
          player: status.player_name ?? id,
          mode: status.mode ?? "unknown",
          volume: status["mixer volume"],
          repeat: status["playlist repeat"],
          shuffle: status["playlist shuffle"],
          position: status.playlist_cur_index,
          queueLength: status.playlist_tracks,
          elapsed: status.time,
          track: {
            title: cur.title,
            artist: cur.artist,
            album: cur.album,
            duration: cur.duration,
            url: cur.url,
          },
        });
      }),
  );

  server.registerTool(
    "playback_control",
    {
      title: "Playback control",
      description: "Control transport: play, pause, toggle, stop, next or previous track.",
      inputSchema: {
        action: z.enum(["play", "pause", "toggle", "stop", "next", "previous"]),
        ...playerArg,
      },
    },
    ({ action, player }) =>
      tool(async () => {
        const id = await resolve(player);
        const cmd: Record<typeof action, LmsParam[]> = {
          play: ["play"],
          pause: ["pause", 1],
          toggle: ["pause"],
          stop: ["stop"],
          next: ["playlist", "index", "+1"],
          previous: ["playlist", "index", "-1"],
        };
        await client.request(id, cmd[action]);
        return json({ ok: true, action, player: id });
      }),
  );

  server.registerTool(
    "set_volume",
    {
      title: "Set volume",
      description: "Set absolute volume (0-100) or a relative change like +5 / -10.",
      inputSchema: {
        volume: z.union([z.number().min(0).max(100), z.string().regex(/^[+-]\d{1,3}$/)]),
        ...playerArg,
      },
    },
    ({ volume, player }) =>
      tool(async () => {
        const id = await resolve(player);
        await client.request(id, ["mixer", "volume", String(volume)]);
        const status = await client.request(id, ["status"]);
        return json({ ok: true, volume: status["mixer volume"], player: id });
      }),
  );

  server.registerTool(
    "seek",
    {
      title: "Seek",
      description: "Seek to a position (seconds from start) in the current track.",
      inputSchema: { seconds: z.number().min(0), ...playerArg },
    },
    ({ seconds, player }) =>
      tool(async () => {
        const id = await resolve(player);
        await client.request(id, ["time", seconds]);
        return json({ ok: true, seconds, player: id });
      }),
  );

  server.registerTool(
    "set_power",
    {
      title: "Set power",
      description: "Turn a player on or off.",
      inputSchema: { on: z.boolean(), ...playerArg },
    },
    ({ on, player }) =>
      tool(async () => {
        const id = await resolve(player);
        await client.request(id, ["power", on ? 1 : 0]);
        return json({ ok: true, on, player: id });
      }),
  );

  server.registerTool(
    "search_library",
    {
      title: "Search library",
      description:
        "Search the music library. Returns matching artists, albums and tracks with the ids used by play_music.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    ({ query, limit }) =>
      tool(async () => {
        const r = await client.serverRequest(["search", 0, limit, `term:${query}`]);
        const pick = <T,>(loop: unknown) => ((loop as T[] | undefined) ?? []);
        return json({
          artists: pick<{ contributor_id: number; contributor: string }>(r.contributors_loop).map(
            (a) => ({ artistId: a.contributor_id, name: a.contributor }),
          ),
          albums: pick<{ album_id: number; album: string }>(r.albums_loop).map((a) => ({
            albumId: a.album_id,
            title: a.album,
          })),
          tracks: pick<{ track_id: number; track: string }>(r.tracks_loop).map((t) => ({
            trackId: t.track_id,
            title: t.track,
          })),
        });
      }),
  );

  server.registerTool(
    "play_music",
    {
      title: "Play music",
      description:
        "Load or queue music by library id (from search_library) or by direct URL. mode 'load' replaces the queue and plays, 'add' appends, 'insert' plays next.",
      inputSchema: {
        mode: z.enum(["load", "add", "insert"]).default("load"),
        trackId: z.number().int().optional(),
        albumId: z.number().int().optional(),
        artistId: z.number().int().optional(),
        genreId: z.number().int().optional(),
        playlistId: z.number().int().optional(),
        url: z.string().url().optional(),
        ...playerArg,
      },
    },
    ({ mode, trackId, albumId, artistId, genreId, playlistId, url, player }) =>
      tool(async () => {
        const id = await resolve(player);
        if (url) {
          const verb = mode === "load" ? "play" : mode;
          await client.request(id, ["playlist", verb, url]);
          return json({ ok: true, mode, url, player: id });
        }
        const spec: Array<[string, number | undefined]> = [
          ["track_id", trackId],
          ["album_id", albumId],
          ["artist_id", artistId],
          ["genre_id", genreId],
          ["playlist_id", playlistId],
        ];
        const selector = spec.find(([, v]) => v != null);
        if (!selector) {
          throw new LmsError("Provide one of trackId / albumId / artistId / genreId / playlistId / url");
        }
        await client.request(id, [
          "playlistcontrol",
          `cmd:${mode}`,
          `${selector[0]}:${selector[1]}`,
        ]);
        return json({ ok: true, mode, [selector[0]]: selector[1], player: id });
      }),
  );

  server.registerTool(
    "show_queue",
    {
      title: "Show queue",
      description: "List the current play queue (playlist) for a player.",
      inputSchema: { limit: z.number().int().min(1).max(200).default(50), ...playerArg },
    },
    ({ limit, player }) =>
      tool(async () => {
        const id = await resolve(player);
        const r = await client.request(id, ["status", 0, limit, "tags:aldt"]);
        const tracks = ((r.playlist_loop as RawTrack[] | undefined) ?? []).map((t, i) => ({
          index: i,
          title: t.title,
          artist: t.artist,
          album: t.album,
        }));
        return json({
          player: id,
          current: r.playlist_cur_index,
          count: r.playlist_tracks,
          tracks,
        });
      }),
  );

  server.registerTool(
    "queue_edit",
    {
      title: "Edit queue",
      description: "Clear the queue, remove a track by index, move a track, or jump to an index.",
      inputSchema: {
        action: z.enum(["clear", "remove", "move", "jump"]),
        index: z.number().int().min(0).optional(),
        toIndex: z.number().int().min(0).optional(),
        ...playerArg,
      },
    },
    ({ action, index, toIndex, player }) =>
      tool(async () => {
        const id = await resolve(player);
        switch (action) {
          case "clear":
            await client.request(id, ["playlist", "clear"]);
            break;
          case "remove":
            if (index == null) throw new LmsError("'remove' needs index");
            await client.request(id, ["playlist", "delete", index]);
            break;
          case "move":
            if (index == null || toIndex == null) throw new LmsError("'move' needs index and toIndex");
            await client.request(id, ["playlist", "move", index, toIndex]);
            break;
          case "jump":
            if (index == null) throw new LmsError("'jump' needs index");
            await client.request(id, ["playlist", "index", index]);
            break;
        }
        return json({ ok: true, action, player: id });
      }),
  );

  server.registerTool(
    "set_repeat_shuffle",
    {
      title: "Set repeat / shuffle",
      description: "Set repeat (off/one/all) and/or shuffle (off/songs/albums) for a player.",
      inputSchema: {
        repeat: z.enum(["off", "one", "all"]).optional(),
        shuffle: z.enum(["off", "songs", "albums"]).optional(),
        ...playerArg,
      },
    },
    ({ repeat, shuffle, player }) =>
      tool(async () => {
        const id = await resolve(player);
        if (repeat) await client.request(id, ["playlist", "repeat", { off: 0, one: 1, all: 2 }[repeat]]);
        if (shuffle)
          await client.request(id, ["playlist", "shuffle", { off: 0, songs: 1, albums: 2 }[shuffle]]);
        return json({ ok: true, repeat, shuffle, player: id });
      }),
  );

  server.registerTool(
    "raw_command",
    {
      title: "Raw CLI command",
      description:
        "Escape hatch: run an arbitrary LMS CLI command. See http://<server>:9000/html/docs/cli-api.html. Example command: [\"mixer\",\"muting\",\"1\"].",
      inputSchema: {
        command: z.array(z.union([z.string(), z.number()])).min(1),
        player: z.string().optional().describe("Player MAC/name, or omit for a server-scoped command."),
      },
    },
    ({ command, player }) =>
      tool(async () => {
        const id = player ? await resolve(player) : "-";
        return json(await client.request(id, command as LmsParam[]));
      }),
  );
}
