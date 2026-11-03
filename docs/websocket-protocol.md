# Talkmato Socket.IO event protocol

Current proposed event contract for reconnect with persistent identity, memberships and history. It supersedes the memory-only/fresh-registration contract. Use `socket.io-client` and Node Socket.IO, WebSocket-only transport, path `/socket.io/`, default namespace `/`. See [architecture](architecture.md), [data model](data-model.md), [examples](websocket-examples.md) and [UI flows](ui-ux.md).

## Connection, authentication and retries

Proposed settings (configuration intent, not runnable project code):

```ts
// Backend: one process; persist app data separately from Socket.IO's adapter.
const io = new Server(httpServer, {
  path: '/socket.io',
  transports: ['websocket'],
  maxHttpBufferSize: 64 * 1024,
  allowRequest: (req, accept) => accept(null, req.headers.origin === frontendOrigin),
});
// Library connectionStateRecovery stays off: DB-backed resume is the authority.

const socket = ioClient(backendBaseUrl, {
  path: '/socket.io',
  transports: ['websocket'],
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
// Install listeners before connect. Do not enable generic command retries.
```

Every `connect`, including after auto reconnect, begins unauthenticated: use `session.resume` with the saved token, or register a new identity when no valid credential exists. Freeze app writes/history until authentication succeeds; Socket.IO `connected` alone is not sufficient. Rebind handlers once, not on every reconnect. Use HTTPS/WSS on public deployments and keep tokens out of logs/URLs.

Browser localStorage holds the opaque resume token for the same origin; server stores its hash and expiry. Proposed expiry is 30 inactive days, renewed on successful resume. No password or cross-device/lost-token recovery is implied. One active socket per user: `SESSION_IN_USE` does not take over or erase the existing identity. The client may retry only resume after a short delay while old transport cleanup is pending, then show Retry; it must not re-register or replay writes. Invalid/expired credentials stop resume attempts, clear protected UI/credential and return to entry.

Transport reconnect and command retry are different. Block `emit` of app writes while disconnected or unauthenticated to prevent Socket.IO offline buffering. Never automatically replay group creation, reactions or sends. Keep unknown send records in tab memory; an explicit send retry reuses the same `clientMessageId`. Dispose old-connection callbacks so stale results cannot update an unauthenticated/new session.

## Commands and acknowledgements

Use one named event, one object payload and an acknowledgement callback. Reject missing/nonfunction callbacks without mutation. Reject extra fields, wrong types and spoofed identity/membership. Proposed ack timeout is 5 seconds; timeout means unknown outcome, not rejection. Pass objects to `emit`, not stringified envelopes or handmade packets. Socket.IO manages acknowledgement IDs and transport frames; `clientMessageId` is a durable idempotency key, not a replacement response-envelope protocol.

Success is `{ok: true, data: ...}`; failure is `{ok: false, error: {code, message}}`. A durable mutation commits before acknowledgement and before corresponding live broadcast. Acknowledgement is not recipient delivery or read confirmation. Handle rollback/storage failure without a false success. Missing network acknowledgement never rolls back an already committed message.

| Client event | Payload | Success data | Rules |
| --- | --- | --- | --- |
| `user.register` | `{name: string}` | `{resumeToken: string, snapshot: SessionSnapshot}` | Create unique persistent user/session, bind socket and join stored channels. Return token only to owner. Offline names are still reserved. |
| `session.resume` | `{resumeToken: string}` | `{snapshot: SessionSnapshot}` | Validate hashed credential/expiry, enforce active-socket rule, restore same user ID and stored memberships. Rebuild channels; no new group join boundary. |
| `private.open` | `{peerId: string}` | `{room: PrivateRoom}` | Find unique persisted pair; require online peer only for initial room creation; existing room remains accessible offline. |
| `group.create` | `{name: string}` | `{group: Group}` | Transactionally create persistent group with creator only. No member picker. |
| `group.join` | `{roomId: string}` | `{group: Group}` | First join records visibility boundary; repeated join/resume preserves it. Requester can add only self. |
| `room.send` | `{roomId: string, clientMessageId: string, text: string}` | `{message: Message, replayed: boolean}` | Authenticate, authorize, commit once by `(senderId, clientMessageId)`, then live-emit to connected members. Offline members get it later through history. |
| `room.history` | `{roomId: string, beforeSeq?: number, limit?: number}` | HistoryPage | Authenticated paginated read; default 50, maximum 100; exclusive positive integer cursor; private participants only and group join-sequence filter. |
| `reaction.set` | `{roomId: string, messageId: string, emoji: "tomato", enabled: boolean}` | `{roomId, messageId, reaction: ReactionSummary}` | Persist desired self-reaction state after checking target visibility and membership; duplicate desired state is a no-op. |
| `typing.set` | `{roomId: string, isTyping: boolean}` | `{}` | Authenticated member only; transient, no persisted draft; throttle active updates to proposed once per second. |

Only register/resume are permitted on unauthenticated sockets. Calling either again on an already authenticated socket returns `ALREADY_REGISTERED`. Unknown app events with a callback return `UNKNOWN_TYPE`; reserved transport events stay library-owned.

`room.send` uses a browser-generated UUID for `clientMessageId`. Identical retry returns the committed Message with `replayed: true` and no duplicate broadcast; a new insert returns false. Reusing the same sender/key with different room/text returns `CLIENT_MESSAGE_ID_CONFLICT`. After resume the client may reconcile by this key in history or manually retry with that same key. No automatic write retries or text-based matching.

## Server events and audience

| Event | Payload | Recipients |
| --- | --- | --- |
| `users.snapshot` | `{users: User[]}` | Authenticated online clients; list includes self and connected users only |
| `groups.snapshot` | `{groups: Group[]}` | Authenticated online clients; all groups with online/offline member details |
| `private.opened` | `{room: PrivateRoom}` | Online private participants only; private list is also restored from snapshot on resume |
| `message.created` | Message | Connected members eligible for that message; include sender using `io.to(channel)` |
| `reaction.updated` | `{roomId, messageId, reaction: ReactionSummary}` | Connected members permitted to read that target; exclude pre-join message metadata from new group members |
| `typing.updated` | `{roomId, userId, isTyping, expiresInMs}` | Other connected current members only |

There is no `room.closed` on peer disconnect: persisted rooms/memberships remain valid. Clear that user's runtime presence/typing and broadcast updated users/groups snapshots; no durable deletion. Group member lists keep the offline person. On successful registration/resume acknowledge the snapshot before its resulting directory events. Active-socket cleanup checks ownership so a stale close cannot delete a new binding.

Typing true expires after proposed 3000 ms; false has expiry 0. Clear indicators on local/peer disconnect, room switch, send, empty draft and timeout. Never persist/replay typing. Reaction state is persistent and versioned per message; badge count derives from unique user IDs, and clicking again proposes removal. Newly joined users cannot react to messages outside their history visibility.

## DTOs and history merge

| Type | Required fields |
| --- | --- |
| User | `userId: string`, `name: string`, `online: boolean` |
| PrivateRoom | `roomId`, `kind: "private"`, `members: User[2]` |
| Group | `roomId`, `kind: "group"`, `name`, `members: User[]` |
| ReactionSummary | `emoji: "tomato"`, `userIds: string[]`, `version: number` |
| Message | `seq: number`, `messageId`, `clientMessageId`, `roomId`, `senderId`, `senderName`, `text`, `sentAt`, `reaction: ReactionSummary` |
| SessionSnapshot | `self: User`, `users: User[]`, `groups: Group[]`, `privateRooms: PrivateRoom[]` |
| HistoryPage | `roomId`, `messages: Message[]`, `nextBeforeSeq: number or null`, `highWatermarkSeq: number` |

IDs and text fields are strings; `sentAt` is UTC ISO 8601. Arrays use empty arrays, not omission. Server assigns message ID/seq/time/sender. Do not expose token hashes, Socket objects, socket IDs, private room lists or history to unrelated users. Initial empty reaction is `{emoji: "tomato", userIds: [], version: 0}`.

`room.history` reads a consistent query snapshot, returns accessible messages ordered ascending by seq, and supplies a cursor for an older page only if more exist. Joining first sets the boundary after the current maximum committed seq; returning members retain it. Refetch the newest page after resume and use Load older for the rest. Preserve active-room choice only if authorized.

Buffer/merge live messages during history loading by message ID and seq; never append duplicate history/live events. For overlapping reaction events/pages use the higher reaction version. An empty page has `nextBeforeSeq: null` and high watermark 0 if there are no visible messages. This is database-backed history loading, not a guarantee that Socket.IO automatically replays every missed packet.

## Validation, errors and evidence

Proposed names: trim/NFC normalize, reject Unicode `Cc`, count code points; user names 1–32, group names 1–64. Canonical user names use locale-independent lowercase. Text is preserved, 1–4000 code points and not whitespace-only. Validate IDs/cursors/limits and all payloads at runtime despite TypeScript. The 64 KiB `maxHttpBufferSize` guards incoming Engine.IO messages, not one-JSON-per-frame parsing; paginated history is an outgoing acknowledgement.

| Code | Meaning |
| --- | --- |
| `INVALID_PAYLOAD` / `UNKNOWN_TYPE` | Invalid fields/arguments or unknown application event |
| `NOT_REGISTERED` / `ALREADY_REGISTERED` | Socket identity state does not permit the operation |
| `NAME_TAKEN` | Name belongs to an existing identity, including offline users |
| `SESSION_INVALID` / `SESSION_EXPIRED` | Resume credential invalid/revoked or expired; disclose no private data |
| `SESSION_IN_USE` | Same user already has an active socket; retry resume after old transport cleanup, no takeover |
| `USER_OFFLINE` / `SELF_CHAT_NOT_ALLOWED` | Invalid initial private-room peer |
| `ROOM_NOT_FOUND` / `WRONG_ROOM_TYPE` / `NOT_MEMBER` | Missing/inaccessible room, wrong kind or membership failure |
| `MESSAGE_NOT_AVAILABLE` | Missing or historically inaccessible reaction target |
| `CLIENT_MESSAGE_ID_CONFLICT` | Deduplication key reused with different content |
| `STORAGE_UNAVAILABLE` / `INTERNAL_ERROR` | Storage failure or unexpected error; no success acknowledgement; no sensitive details |

Prioritize private-room and history visibility before exposing room/type/message metadata. AI remains provisional with no selected voice/model event contract. Test resume after transport loss/refresh/process restart, offline-member history, first-join exclusion, invalid tokens, stale-socket cleanup, duplicate sends after lost acknowledgement, transactional failure, history/live merge, reaction version races and typing expiry. No implementation tests have run because this is still design documentation.
