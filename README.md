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
infra/                    # GCP resources and the one-time identity/state bootstrap
deploy/                   # Release packaging, activation, and delivery checks
.github/workflows/        # Pull-request checks and reviewed production delivery
README.md
AGENTS.md
```

**Status:** The live conversation UI, accounts, persistent history, room-scoped typing, and Saint's Clef emoji effect are implemented locally. AI credentials remain server-side and are optional for core chat. Google Cloud delivery is prepared through [Terraform and GitHub Actions](docs/deployment.md). The user reports that its project, network, subnet, and firewall rules exist. GitHub/GCP bootstrap, VM creation, and public application deployment remain pending. The two-physical-computer demonstration remains pending.

## Authentication integration

Run the backend and frontend separately with `npm install` and `npm run dev` in each directory. Development uses Node 24.19.0. The default backend is `http://localhost:8080`, with frontend origin `http://localhost:3000`; see the `.env.example` files for configuration.

`AuthGate` mounts one `useAccountAuth` hook. A client wrapper can supply a render callback receiving `snapshot`, `socket`, `request`, and `logout` for the conversation UI. `request(event, payload)` refuses disconnected/unauthenticated calls and uses acknowledgement timeouts without buffering or write retries. A successful sign-in creates an eight-hour HTTP-only cookie session; refresh/reconnect restores it only while valid, and Sign out revokes it. Account snapshots contain all public groups (including offline members) and only the signed-in user's private rooms. The existing `NEXT_PUBLIC_DEMO_CHAT=true` route remains an explicitly labeled, isolated preview.

Backend checks: `npm run typecheck && npm test`. Frontend checks: `npm test && npm run lint && npm run build`. Authentication tests use real Argon2id hashes and WebSocket clients against in-memory SQLite; frontend hook tests cover gated commands, sign-out, transport loss, stale acknowledgements and generic errors.

See the [implementation ownership plan](docs/implementation-ownership.md), [core implementation checklist](docs/core-implementation-checklist.md), [requirements](docs/requirements.md), [architecture](docs/architecture.md) and [UI design](docs/ui-ux.md).

## AI emoji effect

Select **AI effect** on a saved message. The server authorizes the selected message, asks Cloudflare Clef for an emoji, and returns it to that browser for a brief local effect. Reduced motion shows a still emoji. Failures offer manual retry without generating a replacement.

See [Saint's setup and evaluation](docs/saint-ai.md) for private credential prompts, catalog policy, request limits, known model errors, and local simulation instructions. The implementation does not guarantee that every valid emoji matches the message meaning.
