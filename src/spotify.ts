import fs from 'node:fs';
import path from 'node:path';

export class SpotifyError extends Error {}
export const spotifyTokenFile = process.env.SPOTIFY_TOKEN_FILE || '/app/spotify-data/token.json';

export function saveSpotifyRefreshToken(refreshToken: string): void {
    fs.mkdirSync(path.dirname(spotifyTokenFile), { recursive: true, mode: 0o700 });
    const owner = fs.existsSync(spotifyTokenFile) ? fs.statSync(spotifyTokenFile) : undefined;
    const temporary = `${spotifyTokenFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ refresh_token: refreshToken }), { mode: 0o600 });
    if (owner && process.getuid?.() === 0) fs.chownSync(temporary, owner.uid, owner.gid);
    fs.renameSync(temporary, spotifyTokenFile);
}

function refreshToken(): string | undefined {
    if (fs.existsSync(spotifyTokenFile)) {
        return JSON.parse(fs.readFileSync(spotifyTokenFile, 'utf8')).refresh_token;
    }
    return process.env.SPOTIFY_REFRESH_TOKEN || undefined;
}

const tokens = new Map<boolean, { value: string; expiresAt: number }>();
const pending = new Map<boolean, Promise<string>>();
async function accessToken(user: boolean): Promise<string> {
    const cached = tokens.get(user);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const inflight = pending.get(user);
    if (inflight) return inflight;
    const request = (async () => {
        const clientId = process.env.SPOTIFY_CLIENT_ID;
        const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        if (!clientId || !clientSecret) throw new SpotifyError('Spotify credentials are not configured.');
        const refresh = user ? refreshToken() : undefined;
        if (user && !refresh) throw new SpotifyError('Spotify playlists require account authorization. Ask the bot owner to connect Spotify.');
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams(refresh
                ? { grant_type: 'refresh_token', refresh_token: refresh }
                : { grant_type: 'client_credentials' }),
            signal: AbortSignal.timeout(15_000)
        });
        if (!response.ok) throw new SpotifyError(user
            ? 'Spotify authorization expired or was denied. Ask the bot owner to reconnect Spotify.'
            : `Spotify authentication failed (HTTP ${response.status}).`);
        const data = await response.json() as { access_token: string; expires_in: number; refresh_token?: string };
        if (!data.access_token) throw new SpotifyError('Spotify returned no access token.');
        if (data.refresh_token) saveSpotifyRefreshToken(data.refresh_token);
        tokens.set(user, { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 });
        return data.access_token;
    })();
    pending.set(user, request);
    try { return await request; } finally { pending.delete(user); }
}

async function spotifyGet(endpoint: string, user: boolean, retry = true): Promise<any> {
    const url = new URL(endpoint, 'https://api.spotify.com/v1/');
    if (url.origin !== 'https://api.spotify.com' || !url.pathname.startsWith('/v1/')) {
        throw new SpotifyError('Invalid Spotify pagination URL.');
    }
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${await accessToken(user)}` },
        signal: AbortSignal.timeout(15_000)
    });
    if (response.status === 401 && retry) {
        tokens.delete(user);
        return spotifyGet(endpoint, user, false);
    }
    if (response.status === 403 || response.status === 404) {
        throw new SpotifyError(user
            ? 'Spotify denied playlist access. Use a playlist owned by, or shared for collaboration with, the connected Spotify account.'
            : 'Spotify could not access this track or album.');
    }
    if (response.status === 429) throw new SpotifyError('Spotify is rate limiting requests. Please try again later.');
    if (!response.ok) throw new SpotifyError(`Spotify lookup failed (HTTP ${response.status}).`);
    return response.json();
}

export interface SpotifyTrack {
    type: 'track'; name: string; artists: { name: string }[];
    thumbnail?: { url: string }; url: string; durationRaw: string;
}
function mapTrack(track: any): SpotifyTrack | null {
    if (!track || track.type !== 'track' || !track.id || track.is_local || track.is_playable === false) return null;
    const seconds = Math.floor((track.duration_ms || 0) / 1000);
    return {
        type: 'track', name: track.name || 'Unknown', artists: track.artists || [],
        thumbnail: track.album?.images?.[0], url: `https://open.spotify.com/track/${track.id}`,
        durationRaw: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    };
}
function parseLink(url: string) {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/(?:intl-[^/]+\/)?(track|playlist|album)\/([a-zA-Z0-9]+)\/?$/);
    if (parsed.hostname !== 'open.spotify.com' || !match) throw new SpotifyError('Use a Spotify track, album or playlist link.');
    return { type: match[1], id: match[2] };
}

export async function publicSpotifyTrack(url: string): Promise<SpotifyTrack> {
    const { type, id } = parseLink(url);
    if (type !== 'track') throw new SpotifyError('Expected a Spotify track link.');
    const track = mapTrack(await spotifyGet(`tracks/${id}?market=US`, false));
    if (!track) throw new SpotifyError('This Spotify track is unavailable.');
    return track;
}

/** Read every page in order, preserving deliberate duplicates and omitting non-music items. */
export async function spotifyTracks(url: string): Promise<SpotifyTrack[]> {
    const { type, id } = parseLink(url);
    if (type === 'track') return [await publicSpotifyTrack(url)];
    const user = type === 'playlist';
    let next: string | null = user
        ? `playlists/${id}/items?limit=50&market=US`
        : `albums/${id}/tracks?limit=50&market=US`;
    const tracks: SpotifyTrack[] = [];
    const visited = new Set<string>();
    while (next) {
        if (visited.has(next)) throw new SpotifyError('Spotify returned a repeated playlist page.');
        visited.add(next);
        const page = await spotifyGet(next, user);
        for (const entry of page.items || []) {
            const track = mapTrack(user ? entry.item ?? entry.track : entry);
            if (track) tracks.push(track);
        }
        next = page.next || null;
    }
    return tracks;
}
