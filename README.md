# Off the Record

A live, anonymous, phone-based retro for a room of about 40 people, ending with everything shredded. Built for Saskatoon DevTalk, November 25, 2026. The full design is in [`Off the Record DevTalk Retro Spec.md`](./Off%20the%20Record%20DevTalk%20Retro%20Spec.md), which is the source of truth.

## What it does

Three views on one small server:

- **Phone** (`/`): private notes that never leave the phone, then pick up to 3 to share as cards; react to one card at a time with emojis; during the walk-through, "look up", with light taps (stay, move on, go back, ask for an anonymous pause) and anonymous comments during pauses.
- **Projector** (`/projector`): join QR and trust disclosure, the current card with its emoji mix, live comments, the emotional fingerprint, and the shredder.
- **Facilitator** (`/facilitate?t=<token>`): everything, plus every control. Works on several devices at once.

## Privacy, and how to check it

- No logins, no names. Cards are stored with no author and no timestamp. Phones are known only by a random id, with counts against it.
- Private notes stay in the phone's tab (sessionStorage) and are wiped on close or shred.
- Only card text goes to Anthropic (Claude Haiku 5.5) for grouping: `server/cluster.js`.
- No request logs anywhere: the app prints nothing about requests (`server/index.js`), Caddy discards all logging (`deploy/Caddyfile`), the system journal is kept in memory only (`deploy/provision.sh`).
- The shred deletes the database and every file in the data directory (`server/db.js`). `test/shred.test.js` runs a whole session, shreds, and checks no file, log line or screen still holds anything, and that the server printed no IP address.

## Run it locally

Needs Node 22.13 or later.

```sh
npm install
npm run dev          # facilitator token is "dev"
npm test
```

Open `http://localhost:3000/` (phone), `/projector`, and `/facilitate?t=dev`. Without `ANTHROPIC_API_KEY` the cards are grouped locally, one card per group.

| Env var | Meaning |
| --- | --- |
| `FACILITATOR_TOKEN` | Required. The secret in the facilitator URL. |
| `ANTHROPIC_API_KEY` | For grouping with Claude Haiku. |
| `PUBLIC_URL` | What the QR code points to. |
| `DATA_DIR` | Where the one SQLite file lives (default `./data`). |
| `REPO_URL` | Shown on the projector. |

## Deploy

An EC2 instance (Amazon Linux 2023, arm64) with `deploy/provision.sh` as user data, Caddy in front for HTTPS, and `deploy/deploy.sh <host>` to copy the app and restart it. Put `FACILITATOR_TOKEN` and `ANTHROPIC_API_KEY` in `/etc/otr.env` (mode 600) on the server. No EBS snapshots, no AWS Backup, no VPC flow logs, no load balancer. Terminate the instance after the event.

## Update the name lists

`public/lists/first-names.txt` is generated: `node scripts/build-first-names.mjs path/to/baby-names.csv` (from [hadley/data-baby-names](https://github.com/hadley/data-baby-names), public domain), plus `scripts/first-names-extra.txt`. `public/lists/companies.txt` is edited by hand.

## License

MIT
