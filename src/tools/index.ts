import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { LmsClient, LmsError, type LmsParam } from "../lms/client.js";
import { listPlayers, resolvePlayerId } from "../lms/players.js";
import { bestMatch, getFavorites, getPlaylists, searchLibrary } from "../lms/music.js";

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
    "search",
    {
      title: "Search",
      description:
        "Search everything a track can come from, in one call: favorites (saved radio streams / stations — listed FIRST), saved playlists, then the music library (artists, albums, tracks). Use this before play_music. Omit `query` to just browse favorites and playlists. Anything with a `url` or an id can be handed to play_music.",
      inputSchema: {
        query: z.string().optional().describe("Substring to match; omit to list favorites and playlists."),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    ({ query, limit }) =>
      tool(async () => {
        const [favorites, playlists, library] = await Promise.all([
          getFavorites(client, query, limit),
          getPlaylists(client, query),
          query ? searchLibrary(client, query, limit) : Promise.resolve(null),
        ]);
        return json({
          favorites: favorites.map((f) => ({ name: f.name, url: f.url, playable: f.isAudio && !!f.url })),
          playlists,
          artists: library?.artists ?? [],
          albums: library?.albums ?? [],
          tracks: library?.tracks ?? [],
        });
      }),
  );

  server.registerTool(
    "play",
    {
      title: "Play by name",
      description:
        "Play something from a free-text name in ONE call. Resolves in priority order: favorite (radio/station) → saved playlist → album → artist → track, then starts it. Returns what it matched. Use this for requests like \"play liquid dnb\" / \"put on some jazz\"; use play_music only when you already have an id or URL.",
      inputSchema: {
        query: z.string().min(1),
        mode: z.enum(["load", "add", "insert"]).default("load"),
        ...playerArg,
      },
    },
    ({ query, mode, player }) =>
      tool(async () => {
        const id = await resolve(player);
        const q = query.trim();
        const ql = q.toLowerCase();
        const verb = mode === "load" ? "play" : mode;

        const favs = (await getFavorites(client, q, 20)).filter((f) => f.isAudio && f.url);
        const fav = bestMatch(favs, ql, (f) => f.name);
        if (fav) {
          await client.request(id, ["playlist", verb, fav.url as string]);
          return json({ matched: "favorite", name: fav.name, mode, player: id });
        }

        const pls = await getPlaylists(client, q);
        const pl = bestMatch(pls, ql, (p) => p.name);
        if (pl) {
          await client.request(id, ["playlistcontrol", `cmd:${mode}`, `playlist_id:${pl.playlistId}`]);
          return json({ matched: "playlist", name: pl.name, mode, player: id });
        }

        const lib = await searchLibrary(client, q, 5);
        const target =
          (lib.albums[0] && { kind: "album", field: "album_id", id: lib.albums[0].albumId, name: lib.albums[0].title }) ||
          (lib.artists[0] && { kind: "artist", field: "artist_id", id: lib.artists[0].artistId, name: lib.artists[0].name }) ||
          (lib.tracks[0] && { kind: "track", field: "track_id", id: lib.tracks[0].trackId, name: lib.tracks[0].title });
        if (target) {
          await client.request(id, ["playlistcontrol", `cmd:${mode}`, `${target.field}:${target.id}`]);
          return json({ matched: target.kind, name: target.name, mode, player: id });
        }

        throw new LmsError(`Nothing matched "${q}" in favorites, playlists or the library`);
      }),
  );

  server.registerTool(
    "play_music",
    {
      title: "Play music by id / URL",
      description:
        "Play a specific item you already have an identifier for (from `search`), or a direct stream URL. For playing by name, use `play` instead. mode 'load' replaces the queue and plays, 'add' appends, 'insert' plays next.",
      inputSchema: {
        mode: z.enum(["load", "add", "insert"]).default("load"),
        trackId: z.number().int().optional(),
        albumId: z.number().int().optional(),
        artistId: z.number().int().optional(),
        genreId: z.number().int().optional(),
        playlistId: z.number().int().optional(),
        url: z.string().url().optional().describe("Direct stream URL, e.g. a favorite's url from `search`."),
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
        "Escape hatch for LMS CLI commands not covered by the other tools. Prefer `search` / `play` / `play_music` / `queue_edit` first — they already handle favorites, playlists and the library. See http://<server>:9000/html/docs/cli-api.html. Example command: [\"mixer\",\"muting\",\"1\"].",
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
