# dis-track

## API Endpoints

- `POST /api/login` – Exchange a Discord OAuth2 code for tokens. Requires `code` and `redirectUri` in the request body.
- `GET /api/bot/guilds` – Returns guilds the bot is in. Requires the bot token via environment variable.

## Docker Compose

1. Copy `.env.example` to `.env` and fill in your Discord and Spotify credentials.
2. Run `docker-compose up --build` to build and start the API server.

The API will be available on the port specified in `API_PORT` (defaults to 3000).

## Topgun: Discord bot and web API

The `docker-compose.bot.yml` deployment runs the API and Discord bot together.
It joins the external `proxy-public` network with alias `dis-track`, serving
HTTP on port 3000 without publishing a host port. The separate frontend in
`/home/janko/dis-track-web` proxies `/api/` to `http://dis-track:3000`.
Configure Traefik to forward `disbot.slavetraders.tech` to `http://dis-track-web:80`.
The backend root serves Swagger; its diagnostic page is `/test/testsite.html`.
Deployment directory: `/home/janko/dis-track` on `janko@77.236.222.115`.

1. Copy `.env.example` to `.env` if it does not exist and set `DISCORD_TOKEN`.
   Spotify support additionally uses `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
   and optionally `SPOTIFY_REFRESH_TOKEN`. Leave unused credentials empty.
   Client ID and secret support public tracks and albums, matched to audio on
   YouTube. Playlists require the Spotify authorization step below.
2. Provide `cookies.json` as a JSON cookie export, or use `[]` when no YouTube
   cookies are available. Protect `.env` and `cookies.json` with `chmod 600`.
3. Create the private token directory: `mkdir -p spotify-data && chmod 700 spotify-data`.
4. Build and start:

   ```sh
   cd /home/janko/dis-track
   docker compose -f docker-compose.bot.yml up --build -d
   docker compose -f docker-compose.bot.yml logs --tail=50 bot
   ```

The bot restarts automatically after a process exit or server reboot while Docker
is running. A running container alone does not confirm a successful Discord login;
check the logs and test a command in Discord.

If slash commands have not already been registered for your guild, set `CLIENT_ID`
and `GUILD_ID` in `.env`, then run:

```sh
docker compose -f docker-compose.bot.yml run --rm bot node dist/register.js
```

After changing `.env`, run `docker compose -f docker-compose.bot.yml up -d` again.


## Authorize Spotify playlists

In the Spotify Developer Dashboard, add exactly `http://127.0.0.1:8888/callback`
as a redirect URI. Development-mode playlist access is restricted to playlists
owned by or collaborated on by the connected Spotify account.

On Topgun, start the temporary login helper (expires after 30 minutes):

```sh
cd /home/janko/dis-track
docker run --rm -d --name dis-track-spotify-auth --network host \
  --user "$(id -u):$(id -g)" --env-file .env \
  -v "$PWD/spotify-data:/app/spotify-data" \
  --entrypoint node dis-track-bot dist/spotify-auth.js
```

On your computer, open an SSH tunnel and keep it running:

```sh
ssh -N -L 127.0.0.1:8888:127.0.0.1:8888 janko@77.236.222.115
```

Open `http://127.0.0.1:8888/login` and authorize playlist read access.
The helper stores the refresh token in `spotify-data/token.json` (mode 600),
without printing it. The bot reads it on demand and persists rotated tokens.
The directory is excluded from Git and Docker build contexts.

After successful authorization, stop the helper with
`docker stop dis-track-spotify-auth` and close the SSH tunnel. No public web port
is needed. Use `/play` with a Spotify playlist URL to queue its available music
tracks in order. Podcasts, local files and unavailable tracks are skipped.
Spotify metadata is matched to YouTube audio; matches may differ from the original.

Run focused Spotify regression checks with:

```sh
npm run build && node --test tests/spotify.cjs
```

## Shuffle and large queues

- Web shuffle: `POST /api/controls/{guildId}/shuffle`. Discord supports `/shuffle`
  (register it first) and `!shuffle`. These reorder upcoming songs only.
- `GET /api/queue/{guildId}?offset=0&limit=50&search=...` returns at most 100 entries
  with stable entry IDs, positions, `count`, `filteredCount` and `hasMore`.
- Spotify playlist metadata is reused at import. Other queue metadata loads in
  the background with three workers; HTTP responses do not wait for extraction.
- Queue state remains in memory and is cleared when the bot restarts.

Run backend checks with `npm run build && node --test tests/*.cjs`.
