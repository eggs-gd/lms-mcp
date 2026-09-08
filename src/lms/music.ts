import { LmsClient } from "./client.js";

export interface Favorite {
  name: string;
  url?: string;
  /** Browse id — only stable for an unfiltered listing; prefer `url` to play. */
  id: string;
  isAudio: boolean;
  hasItems: boolean;
}

export interface SavedPlaylist {
  playlistId: number;
  name: string;
}

export interface LibraryHit {
  artists: { artistId: number; name: string }[];
  albums: { albumId: number; title: string }[];
  tracks: { trackId: number; title: string }[];
}

interface RawFavorite {
  id?: string;
  name?: string;
  url?: string;
  isaudio?: number;
  hasitems?: number;
}

/** List favorites, optionally filtered by a substring `query` (server-side). */
export async function getFavorites(
  client: LmsClient,
  query: string | undefined,
  limit: number,
): Promise<Favorite[]> {
  const cmd: (string | number)[] = ["favorites", "items", 0, limit, "want_url:1"];
  if (query) cmd.push(`search:${query}`);
  const r = await client.serverRequest(cmd);
  const loop = (r.loop_loop as RawFavorite[] | undefined) ?? [];
  return loop.map((f) => ({
    name: f.name ?? "",
    url: f.url,
    id: String(f.id ?? ""),
    isAudio: f.isaudio === 1,
    hasItems: f.hasitems === 1,
  }));
}

/** List saved playlists, optionally filtered by a substring `query` (client-side). */
export async function getPlaylists(
  client: LmsClient,
  query: string | undefined,
): Promise<SavedPlaylist[]> {
  const r = await client.serverRequest(["playlists", 0, 200]);
  const loop = (r.playlists_loop as { id?: number; playlist?: string }[] | undefined) ?? [];
  let out = loop.map((p) => ({ playlistId: Number(p.id), name: String(p.playlist ?? "") }));
  if (query) {
    const q = query.toLowerCase();
    out = out.filter((p) => p.name.toLowerCase().includes(q));
  }
  return out;
}

/** Search the music library (artists / albums / tracks). */
export async function searchLibrary(
  client: LmsClient,
  query: string,
  limit: number,
): Promise<LibraryHit> {
  const r = await client.serverRequest(["search", 0, limit, `term:${query}`]);
  const pick = <T>(loop: unknown) => (loop as T[] | undefined) ?? [];
  return {
    artists: pick<{ contributor_id: number; contributor: string }>(r.contributors_loop).map((a) => ({
      artistId: a.contributor_id,
      name: a.contributor,
    })),
    albums: pick<{ album_id: number; album: string }>(r.albums_loop).map((a) => ({
      albumId: a.album_id,
      title: a.album,
    })),
    tracks: pick<{ track_id: number; track: string }>(r.tracks_loop).map((t) => ({
      trackId: t.track_id,
      title: t.track,
    })),
  };
}

/**
 * Rank candidates against a lowercased query: exact match wins, then a
 * prefix match, otherwise the first candidate (the list is already relevance
 * ordered / substring filtered). Returns undefined for an empty list.
 */
export function bestMatch<T>(items: T[], queryLower: string, name: (item: T) => string): T | undefined {
  if (items.length === 0) return undefined;
  const exact = items.find((i) => name(i).toLowerCase() === queryLower);
  if (exact) return exact;
  const prefix = items.find((i) => name(i).toLowerCase().startsWith(queryLower));
  return prefix ?? items[0];
}
