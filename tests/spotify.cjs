const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SPOTIFY_CLIENT_ID = 'test-id';
process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
process.env.SPOTIFY_REFRESH_TOKEN = 'test-refresh';
process.env.SPOTIFY_TOKEN_FILE = '/tmp/dis-track-test-nonexistent-token.json';
const { spotifyTracks, publicSpotifyTrack } = require('../dist/spotify');
const track = id => ({ type: 'track', id, name: id, artists: [{ name: 'Artist' }], duration_ms: 120000 });

test('playlist pages keep order and duplicates, skip null/local/episode entries and refresh once', async () => {
    let tokens = 0;
    global.fetch = async (url, options) => {
        url = String(url);
        if (url.endsWith('/api/token')) {
            tokens++;
            assert.equal(options.body.get('grant_type'), 'refresh_token');
            return { ok: true, json: async () => ({ access_token: 'test', expires_in: 3600 }) };
        }
        assert.equal(options.headers.Authorization, 'Bearer test');
        if (url.includes('offset=50')) return { ok: true, json: async () => ({ items: [{ item: track('B') }, { item: track('A') }], next: null }) };
        assert.match(url, /\/playlists\/abc\/items\?/);
        return { ok: true, json: async () => ({ items: [
            { item: track('A') }, { item: null }, { item: { ...track('L'), is_local: true } },
            { item: { ...track('E'), type: 'episode' } }
        ], next: 'https://api.spotify.com/v1/playlists/abc/items?offset=50' }) };
    };
    const tracks = await spotifyTracks('https://open.spotify.com/playlist/abc?si=test');
    assert.deepEqual(tracks.map(t => t.name), ['A', 'B', 'A']);
    assert.equal(tokens, 1);
});

test('denied playlist produces actionable access error', async () => {
    global.fetch = async () => ({ ok: false, status: 403 });
    await assert.rejects(spotifyTracks('https://open.spotify.com/playlist/denied'), /owned by/);
});

test('pagination never forwards bearer tokens outside Spotify', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return { ok: true, json: async () => ({ items: [], next: 'https://example.com/steal' }) }; };
    await assert.rejects(spotifyTracks('https://open.spotify.com/playlist/abc'), /pagination/);
    assert.equal(calls, 1);
});

test('public tracks use client credentials independently of playlist authorization', async () => {
    global.fetch = async (url, options) => {
        if (String(url).endsWith('/api/token')) {
            assert.equal(options.body.get('grant_type'), 'client_credentials');
            return { ok: true, json: async () => ({ access_token: 'public', expires_in: 3600 }) };
        }
        return { ok: true, json: async () => track('A') };
    };
    assert.equal((await publicSpotifyTrack('https://open.spotify.com/intl-cs/track/A')).name, 'A');
});
