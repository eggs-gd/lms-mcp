import { LmsClient, LmsError } from "./client.js";

export interface PlayerInfo {
  playerId: string;
  name: string;
  model: string;
  power: boolean;
  connected: boolean;
  isPlaying: boolean;
}

interface RawPlayer {
  playerid?: string;
  name?: string;
  modelname?: string;
  model?: string;
  power?: number;
  connected?: number;
  isplaying?: number;
}

/** Fetch the list of players known to the server. */
export async function listPlayers(client: LmsClient): Promise<PlayerInfo[]> {
  const result = await client.serverRequest(["serverstatus", 0, 999]);
  const players = (result.players_loop as RawPlayer[] | undefined) ?? [];
  return players.map((p) => ({
    playerId: p.playerid ?? "",
    name: p.name ?? p.playerid ?? "(unknown)",
    model: p.modelname ?? p.model ?? "",
    power: p.power === 1,
    connected: p.connected === 1,
    isPlaying: p.isplaying === 1,
  }));
}

/**
 * Resolve a player reference (MAC address or exact name, case-insensitive) to a
 * player MAC. When `ref` is undefined, falls back to `LMS_DEFAULT_PLAYER`, and
 * if that is unset and exactly one player exists, that one.
 */
export async function resolvePlayerId(
  client: LmsClient,
  ref: string | undefined,
  defaultPlayer: string | undefined,
): Promise<string> {
  const wanted = (ref ?? defaultPlayer)?.trim();
  const players = await listPlayers(client);

  if (players.length === 0) {
    throw new LmsError("No players are connected to the server");
  }

  if (!wanted) {
    if (players.length === 1) return players[0].playerId;
    throw new LmsError(
      `Multiple players available — specify one of: ${players.map((p) => p.name).join(", ")}`,
    );
  }

  const macLike = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(wanted);
  const match = players.find((p) =>
    macLike
      ? p.playerId.toLowerCase() === wanted.toLowerCase()
      : p.name.toLowerCase() === wanted.toLowerCase(),
  );
  if (!match) {
    throw new LmsError(
      `No player matches "${wanted}". Known players: ${players.map((p) => p.name).join(", ")}`,
    );
  }
  return match.playerId;
}
