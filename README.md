# Smile Battle

1v1 live smile challenge built with **React**, **WebRTC**, and **Supabase** — all on free tiers.

Two players join a lobby, see each other over live video + audio, then compete in a **10-second smile showdown**. Highest average smile score wins.

## Stack (100% free)

| Layer | Service |
|-------|---------|
| Frontend | React + Vite |
| Video/audio | WebRTC peer-to-peer |
| NAT traversal | Google STUN + Open Relay TURN (free) |
| Smile detection | face-api.js (runs in browser) |
| Lobbies + sync | Supabase Postgres + Realtime |
| Hosting | Vercel / Netlify free tier |

## Quick start

### 1. Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) and create a project (free tier).
2. In the SQL Editor, run the migration:
   ```
   supabase/migrations/001_initial.sql
   ```
3. In **Project Settings → API**, copy:
   - Project URL
   - `anon` public key

### 2. Configure the app

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...
```

### 3. Run locally

```bash
npm install
npm run dev
```

Open the URL shown (use two browser tabs or two devices to test 1v1).

> **Camera/mic requires HTTPS in production.** `localhost` works for dev.

### 4. Deploy (optional, free)

```bash
npm run build
```

Deploy the `dist` folder to Vercel or Netlify. Add the same env vars in the dashboard.

## How to play

1. **Player 1** — enter name → **Create lobby** → share the 6-letter code
2. **Player 2** — enter name → **Join lobby** with the code
3. Both players see live video, click **Ready to smile**
4. 3-second countdown → **10-second smile challenge**
5. Live smile score updates on your face → results screen shows the winner

## How it works

```
Player A ←—— WebRTC video/audio ——→ Player B
    ↓                                    ↓
    └———— Supabase Realtime ————————————┘
              (lobby state + WebRTC signaling)
```

- **Supabase** stores lobbies, players, ready state, and final scores
- **Realtime** syncs lobby changes and relays WebRTC offers/answers/ICE candidates
- **Smile score** is computed locally from your webcam using expression detection
- **STUN/TURN** helps peers connect through home routers (free public servers)

## Project structure

```
src/
  components/     # Home, waiting room, battle UI
  hooks/          # Lobby sync, WebRTC, smile detection
  lib/            # Supabase client, lobby API, constants
supabase/
  migrations/     # Database schema
```

## Notes

- No login required — players get a random ID stored in the browser
- Scores are computed client-side (fine for a fun party game)
- If video fails to connect on strict networks, the free TURN server usually fixes it
- For best results: good lighting, face the camera, smile big

## License

MIT
