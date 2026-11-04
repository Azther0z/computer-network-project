# AGENTS.md

## Agent Contract

Keep this file current with actionable, non-obvious repository rules. Do not duplicate the README, requirements, or ordinary tooling instructions.

## Source handling

The user requires exactly two PDFs in this repository, with unchanged original bytes and filenames. Do not add PDF exports or replace either source.

The ingestion manifests include human/agent visual-review status. A parser rerun resets that status. Inspect every regenerated page and reconcile the Markdown before marking the review complete.

## Chat implementation boundaries

Browsers use socket.io-client directly with one Node.js/Socket.IO backend process; Next.js does not relay chat. Both ends use WebSocket-only transport and the default Socket.IO adapter. Durable storage does not justify multiple workers without shared routing design.

Full account registration/sign-in with saved history supersedes the earlier resume-token design. Disconnect clears only live socket/presence/typing; it does not delete accounts, room memberships or messages. Read docs/implementation-ownership.md and docs/core-implementation-checklist.md before implementation. Development uses Node 24.19.0 with built-in node:sqlite/DatabaseSync and an ignored local SQLite file; cloud provider remains unselected.

Enable bounded automatic transport reconnect, then require `auth.login` or `auth.register` on every new connection before app commands. A name alone never authenticates an existing account or retrieves history. Store an Argon2id password hash only; never log passwords, expose credentials in URLs, or persist raw passwords. Still block disconnected emits and automatic write retries; use persistent clientMessageId deduplication for manual unknown-send retries.

Save durable mutations before acknowledgement. History, reactions and AI input must enforce persisted membership and group join-sequence visibility. Socket.IO channels are delivery caches, not authorization. Separate internal records from public DTOs. docs/websocket-examples.md arrays are readable emit/ack captures, not batches or WebSocket frames.

## Talkmato visual source

Preserve the user-supplied SVGs in docs/wireframes/ as the current UI/brand reference. docs/implementation-ownership.md supersedes its outdated authentication and special-feature selections: room-scoped typing and Saint’s AI-selected emoji firework are selected; AI Voice Chat and tomato reactions are not. Do not restore the removed generated chat-ui.html or supersede Figma with it. Public group member details must include offline members while the online directory lists only connected users.
