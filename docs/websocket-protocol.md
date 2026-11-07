# Talkmato Socket.IO event protocol

This is the account-login protocol for Talkmato. Use `socket.io-client` and Node Socket.IO with WebSocket-only transport, path `/socket.io/`, default namespace `/`. See [architecture](architecture.md), [data model](data-model.md), [examples](websocket-examples.md) and [implementation ownership](implementation-ownership.md).

## Connection and authentication

Every Socket.IO `connect` checks for Talkmato’s unexpired eight-hour HTTP-only session cookie. It then emits `auth.session` with a snapshot when restoration succeeds, or an empty payload when it does not; only in the latter case are `auth.register` and `auth.login` required. A connected transport alone is not account identity.

The client enables bounded transport reconnect but freezes history/writes while unauthenticated. It must not save a plaintext password or opaque session ID in localStorage, or automatically replay login credentials. After an expired/absent session, show sign-in-required UI. Do not enable generic command retries or Socket.IO buffering for application writes.

Use HTTPS/WSS in public deployment. Never log or expose passwords in URLs, DTOs, source code or browser storage. The server stores a password hash only. One active socket is allowed per account; a second authenticated login returns `SESSION_IN_USE` and does not take over the existing connection.

## Commands and acknowledgements

Each command uses one event, one object payload and an acknowledgement callback. Success is `{ok: true, data: ...}`. Failure is `{ok: false, error: {code, message}}`. Reject invalid payloads before mutation. Durable changes commit before acknowledgement or live broadcast.

| Client event | Payload | Success data | Rules |
| --- | --- | --- | --- |
| `auth.register` | `{name: string, password: string}` | `{snapshot: AccountSnapshot}` | Validate input, atomically reserve name, hash/store password, authenticate current socket and join authorized delivery channels. |
| `auth.login` | `{name: string, password: string}` | `{snapshot: AccountSnapshot}` | Verify password hash, enforce single active socket, authenticate socket and join authorized delivery channels. Invalid credentials reveal no account-existence detail. |
| `auth.logout` | `{}` | `{}` | Remove authentication/live presence from current socket only; durable data remains. |
| `auth.deleteAccount` | `{password: string}` | `{}` | Irreversibly delete the authenticated account after password confirmation; revoke sessions and anonymize its old messages as `Unknown`. |
| `private.open` | `{peerId: string}` | `{room: PrivateRoom}` | Find/create persisted pair; an initial peer must be online; existing rooms remain usable with an offline peer. |
| `group.create` | `{name: string}` | `{group: Group}` | Create persistent group with creator only. |
| `group.join` | `{roomId: string}` | `{group: Group}` | Requester adds only self; first join writes history boundary; repeat keeps it. |
| `room.send` | `{roomId: string, clientMessageId: string, text: string}` | `{message: Message, replayed: boolean}` | Check actor/membership, commit once, then emit to connected eligible members. |
| `room.history` | `{roomId: string, beforeSeq?: number, limit?: number}` | `HistoryPage` | Check persisted membership and group first-join boundary; default 50, maximum 100. |
| `typing.set` | `{roomId: string, isTyping: boolean}` | `{}` | Member-only transient status; no draft text; throttle active updates. Implement after R1–R11. |
| `message.emojiSuggest` | `{roomId: string, messageId: string}` | `{emoji: string}` | Read authorized persisted message text; use one Clef Choice question with at most 255 curated default-form emojis; validate response; requester only. |

`auth.register` and `auth.login` return `ALREADY_AUTHENTICATED` if the socket already has an account. Every other application command on an unauthenticated socket returns `NOT_AUTHENTICATED` without revealing room data. `auth.logout` on an unauthenticated socket returns `NOT_AUTHENTICATED`.

`auth.deleteAccount` requires the current account password. It clears live presence and all server sessions, removes the account from public group-member lists, and releases the name for a new account. It does not remove durable messages: their sender DTO becomes `<Unknown>`, so a later account with the same name is never associated with historical content. A remaining private-chat peer also sees `<Unknown>` as that room’s title.

`room.send` uses a browser-generated UUID for `clientMessageId`. An identical manual retry returns the committed message with `replayed: true`; a different room/text with that same key returns `CLIENT_MESSAGE_ID_CONFLICT`. Do not automatically retry sends, joins, group creation, typing or AI requests.

## Server events and audience

| Event | Payload | Recipients |
| --- | --- | --- |
| `users.snapshot` | `{users: User[]}` | Authenticated online clients; includes self and only connected users. |
| `auth.session` | `{snapshot?: AccountSnapshot}` | The newly connected socket, after its cookie-session check completes. |
| `groups.snapshot` | `{groups: Group[]}` | Authenticated online clients; all groups with online/offline member detail. |
| `private.opened` | `{room: PrivateRoom}` | Online private participants only, when initially created. |
| `private.updated` | `{room: PrivateRoom}` | Remaining online private participant after a peer deletes their account; peer name becomes `<Unknown>`. |
| `message.created` | `Message` | Connected members eligible to read that message, including sender. |
| `typing.updated` | `{roomId, userId, isTyping, expiresInMs}` | Other connected current room members only. |

There is no `room.closed` on disconnect. Clear runtime presence/typing and emit updated directories; do not delete account, membership or history. After successful register/login, acknowledge the account snapshot before resulting directory events.

Typing true expires after 3000 ms. Clear it on local/peer disconnect, sign-out, room switch, empty draft, send, explicit false or expiry. Never save/replay it.

The first AI emoji effect returns only to its requesting client. Do not broadcast or persist it as a message/reaction. Provider failure or malformed/non-allow-listed output returns a safe error with no AI result.

AI requests accept exactly `roomId` and `messageId`, without client-supplied text or identity. Apply the same persisted membership and first-join visibility rules as history. Missing and pre-join messages both return `MESSAGE_NOT_AVAILABLE`. After the provider returns, recheck the socket identity and message visibility before acknowledging success. Logout and disconnect cancel pending provider work.

One account has at most one AI request in flight and a ten-second start cooldown. The single backend permits two concurrent AI requests. These limits are transient process state, not a billing cap. The provider operation has an eight-second total deadline, below the browser's ten-second acknowledgement timeout. No provider request is automatically retried. See the [AI setup](../README.md#ai-emoji-effect).

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
| `AI_RATE_LIMITED` | Account cooldown, account request already in flight, or global AI concurrency limit. |
| `STORAGE_UNAVAILABLE` / `INTERNAL_ERROR` | No durable success; do not expose implementation detail. |

Prioritize authorization before exposing room/type/message metadata. Test invalid credentials, duplicate-name registration, stale socket cleanup, private/group isolation, first-join history exclusion, duplicate sends, typing expiry and AI message visibility.
