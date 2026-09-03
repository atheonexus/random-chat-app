# StrangerText

A minimal random text-chat site: visitors confirm they're 18+ with a checkbox
(no account, no email), then get paired with a random stranger for one-on-one
text chat. No video.

## What's built in

- **Random pairing** — a simple waiting-queue matcher (`server.js`), two
  people, one room at a time.
- **Age gate** — a self-declared checkbox on the landing page. This is a
  weak control (see "Before you take this live" below).
- **Automatic minor-disclosure detection** — if a message looks like someone
  stating they're under 18 ("im 14", "16f", "age: 15", etc.), the chat ends
  immediately for both people and the event is logged to `reports.jsonl`.
  It's regex-based, so it will miss things and occasionally false-positive
  (which just ends a chat and lets both people requeue — a safe failure mode).
- **Self-harm language response** — if a message contains language like
  "kill myself" or "suicidal", the sender (only) gets an automated message
  pointing to https://findahelpline.com (a global directory) and 988 in the
  US. The chat is *not* ended for this — the person may just want to keep
  talking, and cutting them off could make things worse.
- **Profanity filter** — outgoing messages are cleaned with the `bad-words`
  library.
- **Rate limiting** — max 6 messages per 2 seconds per person, to slow down
  spam/flooding.
- **Report button** — ends the chat, and appends a record to
  `reports.jsonl` with a timestamp, the reported party's ephemeral socket
  id, the reason given, and the last ~20 messages exchanged in that room
  (kept only in memory during the chat — nothing is logged persistently
  unless reported or auto-flagged).
- **Skip / Next** and **Leave** buttons.
- Messages are rendered as text only (`textContent`), so nothing typed in
  chat can inject HTML/JS into the page.

## Running it locally

```bash
npm install
npm start
```

Then open http://localhost:3000 in two different browser windows (or one
normal + one incognito) to simulate two strangers meeting.

## Before you take this live

This is a working MVP, not a production-ready public service. A few things
worth doing before real strangers start using it:

1. **Age verification is currently just a checkbox.** Anyone can lie. If
   you want this to hold up, look at a third-party age-verification/estimation
   service, and decide how much friction you're willing to add in exchange
   for a real control.
2. **Human moderation.** The automated filters here catch obvious cases but
   nothing sophisticated. Plan to actually read `reports.jsonl` (or wire it
   into something like a Slack webhook / simple admin dashboard) and act on
   it, especially anything flagged `auto_minor_disclosure`.
3. **Legal review.** Operating a stranger-chat service touches age-related
   regulations that vary by country/state (e.g., various "kids online
   safety" and app-accountability laws), and if you ever encounter child
   sexual abuse material you may have mandatory reporting obligations (e.g.,
   to NCMEC in the US). Talk to a lawyer before this is public, not after.
4. **Abuse from a single person spamming reconnects.** There's currently no
   IP-based cooldown or ban list — someone removed for cause can just
   reconnect immediately. Consider tracking hashed IPs (not raw IPs, for
   privacy) to slow down repeat offenders.
5. **Scaling past one server.** The matchmaking queue lives in memory on a
   single Node process. Fine for a single instance; if you outgrow one
   server/dyno you'll need to move the queue into something shared (Redis,
   for example) so pairing works across instances.

## Deploying

This is a plain Node + Express + Socket.io app, so it runs anywhere that
supports persistent WebSocket connections and lets you run `npm start`.
Two easy options:

**Render** (render.com) — free tier available.
1. Push this folder to a GitHub repo.
2. New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Deploy. Render gives you a URL automatically.

**Railway** (railway.app) — similarly: connect the repo, it auto-detects
Node, deploys, gives you a URL.

Avoid classic serverless platforms (e.g. plain Vercel functions) for this —
they don't keep a persistent process running, which breaks the in-memory
matchmaking queue and WebSocket connections. A VPS (e.g. a small
DigitalOcean droplet) works too if you'd rather run it yourself; put it
behind Caddy or nginx for free HTTPS.

## File layout

```
server.js          # matchmaking, chat relay, safety logic
public/index.html  # landing/age-gate + guidelines + chat markup
public/style.css
public/app.js       # client-side socket logic
```
