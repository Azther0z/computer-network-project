# Talkmato Socket.IO event protocol

This is the account-login protocol for Talkmato. Use `socket.io-client` and Node Socket.IO with WebSocket-only transport, path `/socket.io/`, default namespace `/`. See [architecture](architecture.md), [data model](data-model.md), [examples](websocket-examples.md) and [implementation ownership](implementation-ownership.md).

## Connection and authentication

Every Socket.IO `connect` begins unauthenticated, including transport reconnect after a network loss. Only `auth.register` and `auth.login` are permitted before authentication succeeds. A connected transport alone is not account identity.

The client enables bounded transport reconnect but freezes history/writes while unauthenticated. It must not save a plaintext password in localStorage or automatically replay login credentials. After reconnect, show sign-in-required UI. Do not enable generic command retries or Socket.IO buffering for application writes.

Use HTTPS/WSS in public deployment. Never log or expose passwords in URLs, DTOs, source code or browser storage. The server stores a password hash only. One active socket is allowed per account; a second authenticated login returns `SESSION_IN_USE` and does not take over the existing connection.

## Commands and acknowledgements

Each command uses one event, one object payload and an acknowledgement callback. Success is `{ok: true, data: ...}`. Failure is `{ok: false, error: {code, message}}`. Reject invalid payloads before mutation. Durable changes commit before acknowledgement or live broadcast.

| Client event | Payload | Success data | Rules |
| --- | --- | --- | --- |
| `auth.register` | `{name: string, password: string}` | `{snapshot: AccountSnapshot}` | Validate input, atomically reserve name, hash/store password, authenticate current socket and join authorized delivery channels. |
| `auth.login` | `{name: string, password: string}` | `{snapshot: AccountSnapshot}` | Verify password hash, enforce single active socket, authenticate socket and join authorized delivery channels. Invalid credentials reveal no account-existence detail. |
| `auth.logout` | `{}` | `{}` | Remove authentication/live presence from current socket only; durable data remains. |
| `private.open` | `{peerId: string}` | `{room: PrivateRoom}` | Find/create persisted pair; an initial peer must be online; existing rooms remain usable with an offline peer. |
| `group.create` | `{name: string}` | `{group: Group}` | Create persistent group with creator only. |
| `group.join` | `{roomId: string}` | `{group: Group}` | Requester adds only self; first join writes history boundary; repeat keeps it. |
| `room.send` | `{roomId: string, clientMessageId: string, text: string}` | `{message: Message, replayed: boolean}` | Check actor/membership, commit once, then emit to connected eligible members. |
| `room.history` | `{roomId: string, beforeSeq?: number, limit?: number}` | `HistoryPage` | Check persisted membership and group first-join boundary; default 50, maximum 100. |
| `typing.set` | `{roomId: string, isTyping: boolean}` | `{}` | Member-only transient status; no draft text; throttle active updates. Implement after R1–R11. |
| `message.emojiSuggest` | `{roomId: string, messageId: string}` | `{emoji: string}` | Verify the requester can read selected message; ask AI for one allow-listed emoji; validate response. Implement after R1–R11. |

`auth.register` and `auth.login` return `ALREADY_AUTHENTICATED` if the socket already has an account. Every other application command on an unauthenticated socket returns `NOT_AUTHENTICATED` without revealing room data. `auth.logout` on an unauthenticated socket returns `NOT_AUTHENTICATED`.

`room.send` uses a browser-generated UUID for `clientMessageId`. An identical manual retry returns the committed message with `replayed: true`; a different room/text with that same key returns `CLIENT_MESSAGE_ID_CONFLICT`. Do not automatically retry sends, joins, group creation, typing or AI requests.

## Server events and audience

| Event | Payload | Recipients |
| --- | --- | --- |
| `users.snapshot` | `{users: User[]}` | Authenticated online clients; includes self and only connected users. |
| `groups.snapshot` | `{groups: Group[]}` | Authenticated online clients; all groups with online/offline member detail. |
| `private.opened` | `{room: PrivateRoom}` | Online private participants only, when initially created. |
| `message.created` | `Message` | Connected members eligible to read that message, including sender. |
| `typing.updated` | `{roomId, userId, isTyping, expiresInMs}` | Other connected current room members only. |

There is no `room.closed` on disconnect. Clear runtime presence/typing and emit updated directories; do not delete account, membership or history. After successful register/login, acknowledge the account snapshot before resulting directory events.

Typing true expires after 3000 ms. Clear it on local/peer disconnect, sign-out, room switch, empty draft, send, explicit false or expiry. Never save/replay it.

The first AI emoji effect returns only to its requesting client. Do not broadcast or persist it as a message/reaction. Provider failure or malformed/non-allow-listed output returns a safe error with no AI result.

## Validation and errors

- Names: trim/NFC normalize, reject Unicode `Cc`, 1–32 code points; canonical form is locale-independent lowercase.
- Passwords: 8–128 characters. Never return or log their contents.
- Group names: 1–64 code points.
- Message text: 1–4000 code points and not whitespace-only.
- Validate all payloads at runtime despite TypeScript.

| Code | Meaning |
| --- | --- |
| `INVALID_PAYLOAD` | Invalid fields or wrong event arguments. |
| `NOT_AUTHENTICATED` / `ALREADY_AUTHENTICATED` | Socket authentication state does not permit command. |
| `NAME_TAKEN` | Name belongs to an existing account, including offline accounts. |
| `INVALID_CREDENTIALS` | Name/password combination is invalid; do not disclose which field failed. |
| `SESSION_IN_USE` | Account already has an active socket; no takeover occurs. |
| `USER_OFFLINE` / `SELF_CHAT_NOT_ALLOWED` | Invalid initial private-room peer. |
| `ROOM_NOT_FOUND` / `WRONG_ROOM_TYPE` / `NOT_MEMBER` | Missing/inaccessible room, wrong kind or membership failure. |
| `MESSAGE_NOT_AVAILABLE` | Missing or historically inaccessible selected AI message. |
| `CLIENT_MESSAGE_ID_CONFLICT` | Deduplication key reused with different content. |
| `AI_UNAVAILABLE` / `AI_INVALID_RESPONSE` | Provider failure or invalid allow-list result. |
| `STORAGE_UNAVAILABLE` / `INTERNAL_ERROR` | No durable success; do not expose implementation detail. |

Prioritize authorization before exposing room/type/message metadata. Test invalid credentials, duplicate-name registration, stale socket cleanup, private/group isolation, first-join history exclusion, duplicate sends, typing expiry and AI message visibility.
