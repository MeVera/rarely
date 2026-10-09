# Rarely

A daily word game. Everyone gets the same 20 prompts each day (resetting at midnight Melbourne time), 30 seconds per prompt. Wrong guesses just say "Incorrect" so you can try again; your first correct answer scores and ends the round. Rarer answers score more.

- **Frontend**: Vite + vanilla TypeScript + plain CSS → Cloudflare Pages.
- **Backend**: one Cloudflare Worker (`worker/`) with D1, a KV namespace for `tiers.json`, and an hourly cron.
- No accounts, no ads. Players are an anonymous UUID in localStorage.

## Run locally

```bash
npm install
npm run db:migrate:local      # create local D1 tables
npm run worker:dev            # API on http://127.0.0.1:8787 (admin token comes from .dev.vars)
npm run dev                   # game on http://localhost:5173, /api proxied to the Worker
```

The game works without the Worker. It falls back to the starting tiers in `prompts.json` and queues the day's submission until the API is reachable again.

- Tests: `npm test` (match, scoring, daily schedule/DST, stats, share, submit validation)
- Validate the answer bank: `npm run validate`
- Typecheck both parts: `npm run typecheck`
- Simulate players against the local API: `npx tsx scripts/simulate-players.ts 99` (then `... 1 99` for the 100th)
- Trigger the cron locally: `curl "http://127.0.0.1:8787/__scheduled?cron=7+*+*+*+*"`
- Admin: http://127.0.0.1:8787/admin (token `dev-admin-token` locally, from `.dev.vars`)

## Add prompts

Append an object to `src/data/prompts.json`:

```json
{ "id": "kitchen-gadgets", "prompt": "Name a kitchen gadget", "answers": { "toaster": 1, "garlic press": 4, "zester|microplane": 5 } }
```

- `id`: a unique lowercase slug. Starting tiers run from 1 (most common) to 5 (rarest).
- `"a|b"` lists aliases: `a` is the answer shown, and `b` is also accepted.
- Run `npm run validate`. It checks ids, tiers, duplicates after normalization (including plurals and spellings), and at least 100 answers per prompt.
- Run `npm run build:extras` to regenerate the dictionary-verified answers (see below), and add a WordNet category for the new prompt in `CATEGORIES` in `scripts/build-extras.ts` if one fits.
- Deploy **both** parts, because the Worker bundles `prompts.json` too.

Changing the number of prompts changes the shuffled schedule from that day on. Deploy prompt changes just after midnight Melbourne time. Players already part-way through a day keep the prompts saved on their device.

## Answers that aren't in the list (no server needed)

`scripts/build-extras.ts` uses WordNet (an open English dictionary, via the `wordnet-db` package) at build time to write `src/data/extras/<promptId>.json`:

- **Category prompts** (fruit, mammals, rivers, diseases…): every word WordNet files under that category. Each prompt maps to one or more WordNet senses in `CATEGORIES`. Use `npx tsx scripts/wordnet.ts inspect <word>` to see the senses.
- **Letter-rule prompts** (QU-, -IGHT, -TION, palindromes…): every dictionary word that obeys the rule. Inflections count when the typed word obeys the rule and its stem is a real word ("shouted").

The game loads the files for the day's 20 prompts as small static chunks. An answer that misses the hand-built list but matches these scores `EXTRA_TIER` (Rare, 85). Profanity is always rejected, and typo-tolerance only applies to the hand-built list. Open-ended prompts with no dictionary category ("something that is round") still rely on the hand-built list.

## Tune the formula

Everything is a named export in `src/lib/scoring.ts`: `TIER_POINTS`, `MIN_PLAYERS` (100), `TIER_PRIORS`, `PRIOR_WEIGHT_K` (20), `RARITY_OFFSET`/`RARITY_STEP` (0.6/0.5), `AUTO_ADD_MIN_PLAYERS` (10), `NEW_ANSWER_STARTING_TIER` (5) and `EXTRA_TIER` (4, for dictionary-verified answers). Game constants (`TIMEZONE`, rounds, seconds, schedule epoch) live in `src/config.ts`. Matching rules (spelling map, plurals, fuzzy length) live in `src/lib/match.ts`. The profanity list is in `src/lib/blocklist.ts`.

## How rarity updates

The Worker cron fires hourly. It does the work only when the Melbourne date differs from the last successful run, which is stored in D1, so daylight saving needs no cron edits. For each prompt it:

1. counts N, the distinct players all time;
2. for prompts with N ≥ 100, auto-adds unlisted answers that 10 or more distinct players gave, skipping any on the blocklist (starting tier 5);
3. publishes `tiers.json` to KV (`{ version, date, prompts: { id: { usingPlayerData, players, tiers } } }`).

The client fetches `tiers.json` once at the start of a day and freezes it in the saved game, so points never change mid-game. Everything else goes to the admin review queue, where you can approve (with a tier), reject or ban. Ban also removes a bank answer. The admin page also shows each prompt's N and progress toward 100.

## Deploy

**Worker**

```bash
npx wrangler login
npx wrangler d1 create rarely               # paste database_id into wrangler.toml
npx wrangler kv namespace create TIERS      # paste id into wrangler.toml
npm run db:migrate:remote
npx wrangler secret put ADMIN_TOKEN         # a long random string
npx wrangler secret put IP_SALT             # optional, salts hashed IPs for rate limiting
npm run worker:deploy
```

Optionally set `ALLOWED_ORIGIN` in `wrangler.toml` to your Pages URL.

**Frontend (Cloudflare Pages)**: build command `npm run build`, output directory `dist`. Point the game at the API in one of two ways:

- Set the build env var `VITE_API_BASE=https://rarely-api.<your-subdomain>.workers.dev`.
- Or add a Worker route `yourdomain.com/api/*`. The Worker accepts paths with or without `/api`, and the default `VITE_API_BASE` is `/api`.

Admin lives at `<worker-url>/admin`.
