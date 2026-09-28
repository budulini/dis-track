import 'dotenv/config';
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { saveSpotifyRefreshToken } from './spotify';

const redirectUri = 'http://127.0.0.1:8888/callback';
const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error('Configure Spotify Client ID and Client Secret first.');
let state = '';
let completed = false;
let exchanging = false;
const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const url = new URL(request.url || '/', redirectUri);
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    if (completed) { response.end('Spotify connected. You can close this tab.'); return; }
    if (url.pathname === '/' || url.pathname === '/login') {
        state = randomBytes(32).toString('hex');
        const authorize = new URL('https://accounts.spotify.com/authorize');
        authorize.search = new URLSearchParams({
            client_id: clientId, response_type: 'code', redirect_uri: redirectUri,
            scope: 'playlist-read-private playlist-read-collaborative', state
        }).toString();
        response.writeHead(302, { Location: authorize.toString() });
        response.end(); return;
    }
    if (url.pathname !== '/callback') { response.writeHead(404); response.end(); return; }
    const received = url.searchParams.get('state') || '';
    if (!state || Buffer.byteLength(received) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(received), Buffer.from(state))) {
        response.writeHead(400); response.end('Authorization state mismatch. Start again at /login.'); return;
    }
    if (exchanging) { response.writeHead(409); response.end('Authorization is already in progress.'); return; }
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.has('error')) {
        state = ''; response.writeHead(400); response.end('Authorization was not granted. Start again at /login.'); return;
    }
    exchanging = true;
    state = '';
    try {
        const result = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
            signal: AbortSignal.timeout(15_000)
        });
        if (!result.ok) throw new Error('Spotify rejected the authorization exchange.');
        const data = await result.json() as { refresh_token?: string };
        if (!data.refresh_token) throw new Error('Spotify returned no refresh token.');
        saveSpotifyRefreshToken(data.refresh_token);
        completed = true;
        console.log('Spotify authorization saved successfully.');
        response.writeHead(303, { Location: '/success' });
        response.end();
    } catch {
        response.writeHead(502); response.end('Authorization could not be saved. Please restart at /login.');
        console.error('Spotify authorization failed; no credentials were logged.');
    } finally { exchanging = false; }
});
server.listen(8888, '127.0.0.1', () => console.log('Spotify authorization ready on loopback port 8888.'));
server.on('error', () => { console.error('Could not open the Spotify authorization listener.'); process.exitCode = 1; });
setTimeout(() => { server.closeAllConnections(); server.close(); }, 30 * 60_000).unref();
