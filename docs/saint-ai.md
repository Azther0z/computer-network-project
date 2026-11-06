# Saint's AI emoji firework

An authenticated user chooses AI effect on a saved message. The backend reads that message through persisted membership and group-history visibility checks. Cloudflare Clef chooses an emoji for a brief effect on the requesting browser. The effect does not become a saved reaction or a room broadcast.

## Meaning and catalog

Match the selected message's tone or communicative intent. For a neutral message, choose a subject-related emoji. English and Thai are required. Clearly fitting alternatives count even when they differ from an expected example. Ambiguous meanings need human review.

The source is the pinned Unicode 17 `emoji-test.txt` in `backend/src/emoji/data/`. It contains 3,944 fully-qualified sequences. The implementation preserves complete joined sequences and flags. It excludes standalone components and duplicate unqualified spellings.

The selectable set contains 1,706 default forms. It excludes skin modifiers and gender variants with a neutral equivalent, including explicit aliases for royalty, Santa, pregnancy and couples. This follows the user's always-default policy, even when a message requests a variant. The backend offers only selectable IDs and validates the final emoji against the same set. It does not silently replace a disallowed provider result.

Clef supports at most 255 options per Choice. The selector uses category, subgroup and bounded partitions as needed. Smileys & Emotion fits directly in one 171-option question. Country descriptions preserve their complete names. Singleton branches resolve locally, and no message needs more than four provider calls.

The catalog can contain a valid sequence that an older device cannot display. Inspect the intended demonstration devices. The local browser checks cover common emoji, English, Thai, and numerals. They do not establish rendering support for every sequence.

## Request and privacy

The event is `message.emojiSuggest` with exactly `{roomId, messageId}`. Success data is `{emoji}`. The browser supplies no text, sender identity, or membership claim. Missing and historically inaccessible selected messages return `MESSAGE_NOT_AVAILABLE`.

Each provider payload contains only the selected persisted text, fixed instructions, and descriptions for the current choices. It contains no unrelated history, account names, room IDs, session cookies, or passwords. The account ID and API token are used only for server-side provider authentication. Never put those values in `NEXT_PUBLIC_` variables or browser storage.

The server rechecks identity and message visibility after selection. Logout and disconnect cancel pending provider work. The browser discards results from a message view that unmounted. Core chat continues to work when AI credentials are absent.

One account can start an AI request every ten seconds and have one request in flight. The backend permits two concurrent AI requests. These limits are transient and reset with the process. They are not a billing cap. The provider operation has an eight-second total deadline, below the ten-second browser acknowledgement timeout.

Provider errors, quota exhaustion, invalid output and timeouts return safe errors. The UI offers manual retry. No provider request or UI action is automatically replayed. The server does not invent an AI result. A valid but semantically wrong emoji cannot always be detected automatically.

## Local startup with real AI

Use Node 24.19.0 and install the locked dependencies in `backend/` and `frontend/`. Start the frontend normally on `http://localhost:3000`. Keep the backend's `FRONTEND_ORIGIN` consistent with that address.

From the repository root, start the backend with private prompts:

```bash
bash backend/scripts/start-with-ai.sh
```

If the verified local runtime is under ignored `work/runtime/`, put it on PATH for this command:

```bash
PATH="$PWD/work/runtime/node-v24.19.0-linux-x64/bin:$PATH" bash backend/scripts/start-with-ai.sh
```

Paste the Account ID and Workers AI token only at the hidden terminal prompts. Do not paste them into chat. The script creates no credential file and disables shell tracing. The values remain in the backend process environment until it stops. Do not log that environment.

Create the token through Cloudflare's Workers AI REST setup panel. Review the current account plan and usage before live requests. The application does not upgrade the account or configure billing. Follow the [official REST setup guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/).

For public deployment, use a private server-side secret mechanism. The interactive helper is for local development. No real AI credentials were stored or configured by the implementation work.

## Verification

Backend checks are `npm run typecheck` and `npm test` from `backend/`. Frontend checks are `npm test`, `npm run lint`, and `npm run build` from `frontend/`. The AI tests use synthetic credentials, in-memory SQLite, and real local HTTP for transport failures. They do not call Cloudflare.

Tests cover authentication, nonmembership, pre-join exclusion, persisted-text-only input, invalid and prohibited provider output, quota errors, redirects, malformed JSON, timeouts, cooldown, duplicate in-flight requests, and stale identity results. Frontend tests cover explicit activation, safe errors, manual retry, stale results, and effect expiry. Browser checks verify requester-only display across two tabs and reduced-motion CSS.

The production server entry point was also exercised through real Socket.IO clients. Without credentials, the registered AI event returns `AI_UNAVAILABLE`. A nonmember is rejected before provider access. The browser verification boot used real auth/room/AI handlers with the local provider stand-in. That boot does not establish session-cookie restoration; the main server and earlier core checks cover that behavior separately.

The physical two-computer demonstration and a live check of the integrated default-filtered selector remain pending. The recorded live model evaluation below uses the previous candidate tree, before default variants were removed. The application now guarantees the variant rule structurally, but the changed candidate set still needs a focused live rehearsal.

## Local provider simulation

Postman CLI 1.77.0 ran the committed local stand-in. It implements the documented request/response shape and deterministic synthetic outputs. It is not provider-owned and does not measure model quality. The CLI workspace status was unavailable, so no published owner mock was searched or imported. Orbit discovery did not return a suitable Clef endpoint; the official contract and live response evidence supplied the format.

Start it from the repository root:

```bash
postman simulation run postman/simulations/clef-local/clef-local.sim.yaml --port 4010 --no-history --output ndjson
```

The local provider URL is `http://127.0.0.1:4010/clef/client/v4/accounts/00000000000000000000000000000000/ai/run/@cf/cloudflare/clef`. Use only the literal synthetic token `synthetic-test-token` with it. `ClefSelector` accepts an endpoint in its constructor for local verification. The application server never reads an endpoint override from clients or environment variables.

The stand-in has test controls under `/clef/__scenario/success`, `/quota`, `/failure`, `/timeout`, `/invalid`, and `/unsafe`. Select one through its full `/clef/__scenario/<name>` path. `/clef/__stats` reports call counts. These controls are not Cloudflare endpoints. Restart the simulation after changing its handler. Read the adjacent context file for evidence and unresolved assumptions.

## Recorded model evaluation

The user selected Clef after a broader run on November 6, 2026. The frozen semantic rubric preceded that run. The sample contains eight English/Thai pairs that were absent from the earlier live pilots. The review is an assistant interpretation, not independent human validation or a full-catalog accuracy estimate.

| Observation | Result |
| --- | --- |
| Completed messages / provider calls | 16 / 40 |
| Meaning fits | 15 / 16 |
| Meaning and default policy fit | 14 / 16 |
| English meaning / policy-compliant fit | 8 / 8; 7 / 8 |
| Thai meaning / policy-compliant fit | 7 / 8; 7 / 8 |
| Median / p95 total latency | 1.536 s / 2.049 s |
| Reported input tokens | 59,997 |
| Estimated neurons | 1,310; not an account balance |

Both languages produced matching results for affection, anger, thinking, sleepiness, noodles, guitars and laptops. An English request for a dark-skinned thumbs-up produced that prohibited variant. The Thai counterpart produced an unrelated beginner symbol. The user accepted occasional semantic mistakes and selected Clef, with default variants enforced in code.

The [raw synthetic-message report](ai-evaluation/clef-broader-2026-11-06.json) remains unchanged. The [separate review](ai-evaluation/clef-broader-review-2026-11-06.json) records per-message judgments. Neither file contains credentials, account IDs or real chat history. The model prompt is `CLEF_INSTRUCTIONS` in `backend/src/emoji/clef.ts`.

[Cloudflare's model documentation](https://developers.cloudflare.com/workers-ai/models/clef/) and [hosted schema](https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/workers-ai-models/clef.json) define the integration contract. [Unicode's versioned source](https://unicode.org/Public/17.0.0/emoji/emoji-test.txt) defines the catalog and includes its license notice.
