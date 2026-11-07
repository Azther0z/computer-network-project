# Talkmato

A tomato-themed browser chat application for the Computer Networks term project.

*Small talks, fresh connections.*

## Overview

- Create an account with a unique name and sign in to see who is online.
- Send private messages in separate chat rooms.
- Create groups, view members, and choose which groups to join.
- Group messages are visible only to members.
- Sign in to restore the same identity, group memberships and saved chat history.
- Room-scoped typing indicators and an AI-selected emoji firework for a selected message.

## Stack

| Part | Technology |
| --- | --- |
| Frontend | Next.js (React) + TypeScript |
| Backend | Node.js + TypeScript + Socket.IO |
| Communication | Socket.IO events over WebSocket, with JSON payloads |
| Runtime | One backend process; live connections and typing in memory |
| Saved data | Persistent accounts, rooms, memberships and messages; SQLite via Node `node:sqlite` |

Browsers connect directly to the backend. A new transport connection requires account sign-in before chat commands; saved history is then loaded from the backend. Restart durability requires persistent database storage.

## Project structure

```text
frontend/                 # Next.js (React) UI
  src/app/                # Pages, layout and styles
  src/components/auth/    # Register/sign-in forms, auth gate and live directory
  src/lib/                # Shared client DTOs and authenticated Socket.IO lifecycle
backend/                  # Node.js + Socket.IO + SQLite
  src/
    server.ts             # Server startup and configuration
    auth-handlers.ts      # Argon2id accounts, socket identity and live presence
    storage.ts            # Persistent accounts, rooms and message queries
    schema.sql            # Database tables and constraints
    types.ts              # Backend data and event types
  test/storage.test.ts    # Storage behavior tests
  data/                   # Ignored local SQLite database files
docs/                     # Requirements, design and Figma SVGs
compose.yaml              # Frontend, backend, Caddy, and persistent volumes
deploy/                   # Caddy routing
.github/workflows/        # Pull-request checks
cloudbuild.yaml           # Main-branch builds and reviewed GCE delivery
README.md
AGENTS.md
```

**Status:** The live conversation UI, accounts, persistent history, room-scoped typing, and Saint's Clef emoji effect are implemented locally. AI credentials remain server-side and are optional for core chat. Google Cloud delivery is prepared through [Cloud Build and Docker Compose](docs/deployment.md). The user reports that its project, network, subnet, and firewall rules exist. Cloud Build trigger/IAM setup, VM creation, private Artifact Registry publication, Secret Manager configuration, and public deployment remain pending. The two-physical-computer demonstration remains pending.

## Authentication integration

Run the backend and frontend separately with `npm install` and `npm run dev` in each directory. Development uses Node 24.19.0. The default backend is `http://localhost:8080`, with frontend origin `http://localhost:3000`; see the `.env.example` files for configuration.

`AuthGate` mounts one `useAccountAuth` hook. A client wrapper can supply a render callback receiving `snapshot`, `socket`, `request`, and `logout` for the conversation UI. `request(event, payload)` refuses disconnected/unauthenticated calls and uses acknowledgement timeouts without buffering or write retries. A successful sign-in creates an eight-hour HTTP-only cookie session; refresh/reconnect restores it only while valid, and Sign out revokes it. Account snapshots contain all public groups (including offline members) and only the signed-in user's private rooms. The existing `NEXT_PUBLIC_DEMO_CHAT=true` route remains an explicitly labeled, isolated preview.

Backend checks: `npm run typecheck && npm test`. Frontend checks: `npm test && npm run lint && npm run build`. Authentication tests use real Argon2id hashes and WebSocket clients against in-memory SQLite; frontend hook tests cover gated commands, sign-out, transport loss, stale acknowledgements and generic errors.

See the [implementation ownership plan](docs/implementation-ownership.md), [core implementation checklist](docs/core-implementation-checklist.md), [requirements](docs/requirements.md), [architecture](docs/architecture.md) and [UI design](docs/ui-ux.md).

## AI emoji effect

Select the diamond beside a saved message: it sits to the right of received bubbles and to the left of sent bubbles. The server authorizes the selected message, asks Cloudflare Clef for an emoji once, saves it, and delivers the attachment to connected members who can read that message. The action disappears immediately while choosing and stays removed for everyone once a result is saved, including after refresh. Later requests reuse the first saved result without calling Clef. Previously saved multi-emoji messages retain all their attachments. Saved emojis return with message history after refresh, sign-in or server restart.

Saved emoji buttons replace the diamond in the same position beside the message bubble. Each attachment plays a brief firework across the conversation pane on its first appearance in the current chat session, with fresh random sizes, positions, travel, rotation and timing on every play. The overlay stays separate from message scrolling and does not block clicking or typing. Clicking a saved emoji replays locally without another AI call or broadcast. Switching rooms or receiving the same attachment again does not automatically replay it. Reduced motion shows a still emoji. Failures offer manual retry without generating a replacement.

For local development, the backend reads `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AUTH_TOKEN` from its private process environment. On GCE, pass the account ID and a numeric `CLOUDFLARE_TOKEN_SECRET_VERSION` resource reference instead; the backend fetches that version from Secret Manager at startup using the VM identity and keeps the token in memory. See the [deployment guide](docs/deployment.md) for IAM and rotation. Keep tokens out of browser variables, URLs and Git. Without available credentials, core chat still works and AI requests return `AI_UNAVAILABLE`.

The curated set of 240 emojis is bundled in `backend/src/emoji/catalog-data.ts` and uses default yellow and gender-neutral forms where available. Each selection sends the entire subset in one Clef Choice question, within its 255-option limit. Clef is instructed to choose 🍅 for unclear or unmatched messages. A structurally valid response with an unrecognized choice also becomes 🍅; malformed responses, timeouts and provider failures still show a retryable error. The implementation does not guarantee that every valid emoji matches the message meaning. See the [WebSocket protocol](docs/websocket-protocol.md) for request limits and authorization rules.
