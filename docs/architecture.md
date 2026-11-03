# Talkmato system architecture

Talkmato uses Next.js/TypeScript and a Node.js/TypeScript Socket.IO backend. Browsers connect directly to the backend over WebSocket-only transport. One backend process manages active connections; durable storage holds identities, memberships, messages and tomato reactions.

## Selected lifecycle and storage baseline

The user selected reconnect with saved history on 2026-11-03, replacing the earlier fresh-registration/in-memory-only lifecycle. Reconnect restores the same user and room memberships; disconnect changes presence only. History and reactions are saved server-side, with the design targeting survival of browser refresh and backend restart.

SQLite on persistent storage is the proposed small-project default, not a selected cloud service. A single backend process and Socket.IO's default adapter remain sufficient. No Redis, message broker or multiple backend workers are introduced. Exact database driver, session expiry and paging limits remain proposals. No application is implemented yet. See [protocol](websocket-protocol.md), [data model](data-model.md), [UI flow](ui-ux.md), [examples](websocket-examples.md) and [requirements](requirements.md).

## Deployment boundaries

![Two physical browser clients connect directly to one Socket.IO backend with runtime memory and persistent storage](diagrams/system-architecture.svg)

[Vector diagram](diagrams/system-architecture.svg). Next.js serves the UI; Next.js API routes/server actions do not relay chat. One backend owns live sockets and typing state in memory. Database records survive a process restart only when the database file is on actual persistent storage. The dashed AI extension is outside mandatory message delivery; the exact AI behavior remains provisional.

Proposed LAN addresses are UI `http://192.168.1.20:3000` and backend base URL `http://192.168.1.20:8080`, Socket.IO path `/socket.io/`, namespace `/`. Clients use `socket.io-client`, not native `WebSocket`. The underlying URL resembles `ws://192.168.1.20:8080/socket.io/?EIO=4&transport=websocket`. Both clients use that same backend, not their own `localhost` backends.

Public cloud deployment requires HTTPS/WSS because resume tokens are credentials. An unencrypted LAN setup is development-only. Configure allowed browser Origin, host binding and firewall ports. CORS alone does not restrict WebSocket Origin; use Socket.IO `allowRequest`. Do not log tokens or message bodies. Cloud provider, hostname, database mount and TLS termination are not selected.

## R1 architecture and network protocols

R1 requires two clients on different physical computers, an architecture presentation and protocol what/why/how. The server may share client A's computer or run on a third computer. Cloud deployment remains optional in the assignment; it is a planned team feature, not completed evidence.

| Machine | Processes | Example |
| --- | --- | --- |
| Physical computer A | Browser A; optionally Next.js and the Node backend | Server IP `192.168.1.20`, UI port 3000, backend port 8080 |
| Physical computer B | Browser B | Same frontend and backend addresses as A |
| Optional third computer/cloud host | Can host server-side processes instead | Replace URLs for both clients; keep one shared backend |

Two tabs/profiles/VMs on one machine do not replace the two physical computers. Separate client/server source files remain required. SQLite is embedded storage accessed by the Node process, not a new browser-facing network service. A database alone does not make Socket.IO multi-instance routing work, so do not enable autoscaling or multiple workers.

| Protocol or layer | What | Why | How used |
| --- | --- | --- | --- |
| HTTP | Web request/response protocol; initial HTTP/1.1 Upgrade | Load UI and establish the chat transport | Next.js serves pages/assets. Separately, Node accepts the `/socket.io/` upgrade; messages and history queries then use Socket.IO over WebSocket, not polling. |
| Socket.IO / Engine.IO | Named events and acknowledgements above WebSocket | Simplifies events, room delivery and reconnect transport | Matching client/server libraries carry registration/resume, messages, history, reactions and typing. Socket.IO is not interchangeable with native WebSocket. |
| WebSocket | Persistent full-duplex channel | Immediate bidirectional communication without polling | Only transport enabled at both ends; one browser connection carries all its rooms. Events are not tied to individual frame boundaries. |
| TCP | Reliable ordered byte stream | Data and ordering within each connection | Carries each browser's WebSocket. It does not preserve application identity/history after a broken connection. |
| IPv4 | Host addressing and packet delivery | Connect distinct machines | Both clients target the server's reachable IP; ports distinguish services. Record actual Wi-Fi/Ethernet network. |
| TLS for public deployment | Encryption, integrity and certificate-based server authentication | Protect message traffic and resume credentials | HTTPS UI/backend URLs use WSS transport; local HTTP/WS examples are unencrypted and do not provide end-to-end encryption. |

JSON is the payload format, not a network protocol. Pass objects directly to `emit`. Next.js is the UI framework; Node.js is the backend runtime. SQLite persistence adds no network protocol to this embedded design. DNS is needed only if using hostnames.

References: [Socket.IO events](https://socket.io/docs/v4/emitting-events/), [delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/), [connection-state recovery](https://socket.io/docs/v4/connection-state-recovery/), [WebSocket RFC 6455](https://www.rfc-editor.org/rfc/rfc6455.html), [TCP RFC 9293](https://www.rfc-editor.org/rfc/rfc9293.html), [IPv4 RFC 791](https://www.rfc-editor.org/rfc/rfc791.html), [TLS RFC 8446](https://www.rfc-editor.org/rfc/rfc8446.html), [SQLite transactions](https://sqlite.org/transactional.html).

### Connection and message path

1. Both clients load Next.js. Each browser owns one Socket.IO client with WebSocket-only transport and bounded automatic transport reconnect.
2. After every Socket.IO `connect`, restore chat identity with `session.resume` using the saved resume token, or use `user.register` for a new identity. Transport connection alone is not authentication.
3. Server validates the token or atomically creates a user/session. It returns self, online users, public groups and authorized private rooms, and rejoins the socket to its persisted room memberships.
4. Client requests `room.history` for the selected room. It merges persisted messages with concurrent live events by message ID and sequence; duplicate display is forbidden.
5. A sends `room.send` with a stable client message ID. The server checks identity/membership, commits the message in storage, acknowledges it and emits `message.created` to connected members. Offline eligible members retrieve it through history on return.
6. If connection drops, the backend removes only live socket/presence/typing entries. Rooms, memberships, session records, messages and reactions remain. On backend restart sockets are new, but persisted records allow resume.

## Identity, history and authorization

Proposed simple identity: a server-generated opaque resume token stored in the browser's localStorage, with only its hash stored in the database. Same browser/origin can resume after refresh; possession of that token grants identity. A name alone never resumes a user or grants history. This is not a password account, cross-device login or lost-token recovery system. Use TLS publicly, render content as text and never expose tokens in URLs/logs/other-user DTOs.

Names remain unique across persisted identities, including offline users. A new registrant cannot claim an offline person's name to read that history. Lost/expired tokens require a new unused identity in this baseline; they do not delete existing data or make the old name available. Proposed token expiry is 30 days of inactivity, extended after valid resume. Enforce one active socket per identity; return `SESSION_IN_USE` for another active socket and allow resume retry after stale transport cleanup rather than stealing the session.

Group membership survives disconnect. Public group details list offline as well as online members; the online-user directory still lists connected users only, including self. Private pairs and groups are not deleted when participants go offline. An authenticated participant may send into an existing room while the peer is offline; commit first and deliver later through history, without claiming a read receipt.

Keep the earlier group visibility boundary: a first-time joiner sees only messages committed from its membership join sequence onward. A reconnecting existing member keeps that same boundary and can read messages sent during its absence. Private history is limited to its two persisted participants. Apply the same visibility checks to history, reactions and any eventual room-context AI.

Persist all membership/message/reaction mutations transactionally before acknowledgement. Socket.IO channels are delivery caches, not authorization. Use the default adapter plus stored membership to rejoin channels after successful resume. No custom outbound queue or global executor is necessary; database constraints and transactions must protect changes even when handlers await storage operations.

## Reconnect and history rules

| Topic | Behavior |
| --- | --- |
| Unexpected disconnect | Mark self offline, clear typing and active socket binding; keep stored identity, rooms, memberships and messages. |
| Auto reconnect | Bounded transport retries, then resume identity and reload room history; never re-register merely because transport reconnected. |
| Retry button | Restart connection/resume after automatic attempts are exhausted; keep current conversation read-only while offline. |
| Resume rejected | Show expired/invalid/in-use state. Invalid/expired credentials return to entry without exposing old history; in-use permits retry after old transport cleanup. |
| Refresh | Read token from localStorage, connect, resume and load authorized history. Drafts need not survive refresh. |
| Backend restart | Lose live sockets/typing; retain records only if durable database storage survives. Resume restores presence and rooms. |
| Group creation/join | Creator only initially; other users join themselves; no creator permission to auto-add others. |
| Send outcome unknown | Do not auto-replay writes. A manual retry uses the same client message ID, with server-side deduplication. |
| History loading | Proposed newest 50 messages, Load older pagination; preserve first-join boundary and order by server sequence. |
| Explicit leave/delete/logout | Not selected in this iteration; disconnect must not act as an implicit leave or data deletion. |

Socket.IO connection-state recovery can help short gaps, but is not durable history and may fail. This baseline deliberately keeps that optional library feature off and performs application-level resume/history on every connection. Automatic transport reconnect is on; automatic command retries and disconnected buffering of app writes remain off/guarded.

## Components and deployment impact

Keep the simple README layout, adding `storage.ts` for persistence queries/transactions and `schema.sql` for tables. Do not commit generated database files. Runtime memory holds sockets, presence and typing; persistent storage holds users, hashed sessions, rooms, memberships, messages, deduplication keys and reactions. AI remains a separate future module.

A SQLite file on an ephemeral container filesystem does not satisfy saved history across restart/redeploy. Use a persistent mounted disk and one backend instance, or revisit a managed database when the cloud provider is selected. For example, [Render persistent disks](https://render.com/docs/disks) attach to paid services; this is a deployment constraint, not approval to buy a plan.

For R1 show the diagram, protocols, actual backend URL, two physical clients and shared process. For R2 show emit/listen, handlers and WebSocket transport. Also test message saving, offline send/catch-up, browser refresh, process restart with the same database, invalid-token rejection, pre-join history exclusion, duplicate-send prevention, reactions and typing isolation. These are planned checks, not completed implementation evidence.
