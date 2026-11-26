# Off the Record

A live, anonymous, phone-based retro for a room of about 40 people, ending with everything shredded. Built for Saskatoon DevTalk, November 25, 2026. The full design is in [`Off the Record DevTalk Retro Spec.md`](./Off%20the%20Record%20DevTalk%20Retro%20Spec.md), which is the source of truth.

## What it does

Three views on one small server:

- **Phone** (`/`): private notes that never leave the phone, then pick up to 3 to share as cards; react to one card at a time with emojis, then add one thought at the end of the deck if you like; during the walk-through, "look up", with nothing to tap. Before Join, phones see the teaser, then "Starting soon".
- **Projector** (`/projector`): the scripted demo on a drawn phone, join QR and trust disclosure, each theme as a folder tab with its haiku, the current card with its emoji mix, the last slide's afterthoughts, a draining bar for the walk-through's pace, the emotional fingerprint, and the shredder.
- **Facilitator** (`/facilitate?t=<token>`): everything, plus every control: stepping through the demo, the talk clock, a "Ready for ...?" prompt to confirm each move, and pause, back and next in the walk-through. Works on several devices at once.

The flow runs on a 25-minute talk clock: demo, join, submit, grouping (starts at the 1-minute warning), react (emojis, then one thought at the end), a self-running walk-through that ends on the afterthoughts or "Anything else? Out loud.", the finale, the shred, and the closing.

## Privacy, and how to check it

- No logins, no names. Cards are stored with no author and no timestamp. Phones are known only by a random id, with counts against it.
- Private notes stay in the phone's tab (sessionStorage) and are wiped on close or shred.
- Only card and thought text goes to Anthropic (Claude Haiku 5.5): cards for grouping (`server/cluster.js`) and, while nudges are on, for picking which writing prompt phones show (`server/nudges.js`); cards and thoughts for a check for harsh wording that only the facilitator sees (`server/moderation.js`).
- No request logs anywhere: the app prints nothing about requests (`server/index.js`), Caddy discards all logging (`deploy/Caddyfile`), the system journal is kept in memory only (`deploy/provision.sh`).
- The shred deletes the database and every file in the data directory (`server/db.js`). `test/shred.test.js` runs a whole session, shreds, and checks no file, log line or screen still holds anything, and that the server printed no IP address.

## Run it locally

Needs Node 22.13 or later.

```sh
npm install
npm run dev          # facilitator token is "dev"
npm test
```

Open `http://localhost:3000/` (phone), `/projector`, and `/facilitate?t=dev`. Without `ANTHROPIC_API_KEY` the cards are grouped locally, one card per group, and nothing is checked for harsh wording (every card reads "not checked"; "Mark the rest reviewed" clears them in one tap).

| Env var | Meaning |
| --- | --- |
| `FACILITATOR_TOKEN` | Required. The secret in the facilitator URL. |
| `ANTHROPIC_API_KEY` | For grouping, and the harshness check, with Claude Haiku. |
| `PUBLIC_URL` | What the QR code points to. |
| `DATA_DIR` | Where the one SQLite file lives (default `./data`). |
| `REPO_URL` | Shown on the projector. |
| `TALK_MINUTES` | Length of the talk clock in minutes (default 25). The walk-through finishes on it. |

## The demo

The session starts on a teaser page (the demo file's optional `teaser`: a title and up to four lines; and an optional `credits`, a title and up to 12 lines that roll beside the feedback QR at the closing, with photos added on the projector's teaser screen that stay in that tab only), then the demo plays on a loop until the talk clock starts. The demo shows the content in `demo/example.json`. To use your own, copy it to `demo/local.json` and edit it: that file is gitignored, so it stays out of the repo, but `deploy/deploy.sh` still copies it to the server. An optional `wifi` (`network`, and optionally `password` and `note`) shows the venue's guest Wi-Fi in the projector's bottom-right corner from the teaser through the join screen. If it is invalid, the server prints `demo: local file invalid, using the example` and uses the example.

## Deploy

An EC2 instance (Amazon Linux 2023, arm64) with `deploy/provision.sh` as user data, Caddy in front for HTTPS, and `deploy/deploy.sh <host>` to copy the app and restart it. Put `FACILITATOR_TOKEN` and `ANTHROPIC_API_KEY` in `/etc/otr.env` (mode 600) on the server. No EBS snapshots, no AWS Backup, no VPC flow logs, no load balancer. Terminate the instance after the event.

## Update the name lists

`public/lists/first-names.txt` is generated: `node scripts/build-first-names.mjs path/to/baby-names.csv` (from [hadley/data-baby-names](https://github.com/hadley/data-baby-names), public domain), plus `scripts/first-names-extra.txt`. `public/lists/companies.txt` is edited by hand.

## License

MIT
