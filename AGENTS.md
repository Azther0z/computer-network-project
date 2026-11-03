# AGENTS.md

## Agent Contract

Keep this file current with actionable, non-obvious repository rules. Do not duplicate the README, requirements, or ordinary tooling instructions.

## Source handling

The user requires exactly two PDFs in this repository, with unchanged original bytes and filenames. Do not add PDF exports or replace either source.

The ingestion manifests include human/agent visual-review status. A parser rerun resets that status. Inspect every regenerated page and reconcile the Markdown before marking the review complete.

## Chat implementation boundaries

Browsers use socket.io-client directly with one Node.js/Socket.IO backend process; Next.js does not relay chat. Both ends use WebSocket-only transport and the default Socket.IO adapter. Durable storage does not justify multiple workers without shared routing design.

Reconnect with saved history supersedes the old fresh-registration/memory-only lifecycle. Disconnect clears only live socket/presence/typing. Preserve identities, sessions, room memberships, messages and reactions. Read docs/architecture.md, docs/websocket-protocol.md and docs/data-model.md before implementing. SQLite on persistent storage is proposed; cloud provider/driver remain unselected.

Enable bounded automatic transport reconnect, then authenticate every new connection with session.resume before app commands. The browser keeps an opaque resume credential; server stores its hash. A name alone cannot resume identity or retrieve history. Do not log/expose tokens or use HTTP/WS publicly for credentials. Still block disconnected emits and automatic write retries; use persistent clientMessageId deduplication for manual unknown-send retries.

Save durable mutations before acknowledgement. History, reactions and AI input must enforce persisted membership and group join-sequence visibility. Socket.IO channels are delivery caches, not authorization. Separate internal records from public DTOs. docs/websocket-examples.md arrays are readable emit/ack captures, not batches or WebSocket frames.

## Talkmato visual source

Preserve the user-supplied SVGs in docs/wireframes/ as the current UI/brand reference. docs/ui-ux.md defines the selected reconnect/history flow and reconciles static copy. Tomato reactions and typing are selected feature directions; AI Voice Chat remains provisional. Do not restore the removed generated chat-ui.html or supersede Figma with it. Public group member details must include offline members while the online directory lists only connected users.
