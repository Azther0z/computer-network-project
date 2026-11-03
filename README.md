# Talkmato

A tomato-themed browser chat application for the Computer Networks term project.

*Small talks, fresh connections.*

## Overview

- Choose a unique name and see who is online.
- Send private messages in separate chat rooms.
- Create groups, view members, and choose which groups to join.
- Group messages are visible only to members.
- Sign in to restore the same identity, group memberships and saved chat history.
- Planned extras: tomato reactions, typing indicators, AI and cloud deployment.

## Stack

| Part | Technology |
| --- | --- |
| Frontend | Next.js (React) + TypeScript |
| Backend | Node.js + TypeScript + Socket.IO |
| Communication | Socket.IO events over WebSocket, with JSON payloads |
| Runtime | One backend process; live connections and typing in memory |
| Saved data | Persistent users, memberships, messages and reactions; SQLite proposed |

Browsers connect directly to the backend. History survives reconnect and refresh; restart durability requires persistent database storage.

## Project structure

Planned layout; `frontend/` and `backend/` are not created yet.

```text
frontend/                 # Next.js (React) UI
  app/                    # Pages, layout and styles
  components/             # Sign-in, sidebar and chat room
  hooks/useChat.ts        # Socket.IO connection and UI state
  types/chat.ts           # Event and message types
backend/                  # Node.js + Socket.IO
  src/
    server.ts             # Server startup and configuration
    chat-handlers.ts      # Events, validation and routing
    chat-state.ts         # Chat rules and runtime presence
    storage.ts            # Persistent sessions, rooms and message queries
    schema.sql            # Database tables and constraints
    types.ts              # Backend data and event types
  test/chat.test.ts       # Chat behavior tests
docs/                     # Requirements, design and Figma SVGs
README.md
AGENTS.md
```

**Status:** Design stage; the application is not implemented yet. AI details and cloud hosting are not selected.

See the [implementation ownership plan](docs/implementation-ownership.md), [requirements](docs/requirements.md), [architecture](docs/architecture.md) and [UI design](docs/ui-ux.md).
