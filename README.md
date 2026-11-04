# Talkmato

A tomato-themed browser chat application for the Computer Networks term project.

*Small talks, fresh connections.*

## Overview

- Create an account with a unique name and sign in to see who is online.
- Send private messages in separate chat rooms.
- Create groups, view members, and choose which groups to join.
- Group messages are visible only to members.
- Sign in to restore the same identity, group memberships and saved chat history.
- Planned extras: room-scoped typing indicators and an AI-selected emoji firework; cloud deployment remains optional.

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
  src/components/         # Browser Socket.IO connection status
backend/                  # Node.js + Socket.IO + SQLite
  src/
    server.ts             # Server startup and configuration
    storage.ts            # Persistent accounts, rooms and message queries
    schema.sql            # Database tables and constraints
    types.ts              # Backend data and event types
  test/storage.test.ts    # Storage behavior tests
  data/                   # Ignored local SQLite database files
docs/                     # Requirements, design and Figma SVGs
README.md
AGENTS.md
```

**Status:** Project skeleton and tested SQLite storage foundation are implemented. Account authentication, Socket.IO room handlers, chat UI, typing and AI remain to be implemented. Cloud hosting is not selected.

See the [implementation ownership plan](docs/implementation-ownership.md), [core implementation checklist](docs/core-implementation-checklist.md), [requirements](docs/requirements.md), [architecture](docs/architecture.md) and [UI design](docs/ui-ux.md).
