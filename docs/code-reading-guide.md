# Talkmato code reading and presentation guide

Talkmato has one browser application and one chat server. The browser loads its interface from Next.js and connects directly to Socket.IO. SQLite stores the accounts and conversations. The application uses one backend process.

Read this guide beside the source. Each section explains a flow, the reason for its design, and the tests that support it. The [requirements](requirements.md) define R1–R11. The [architecture](architecture.md) explains the network layers and deployment layout.

## Start with the program entry points

[The browser page](../frontend/src/app/page.tsx) renders `ChatApp`. [ChatApp](../frontend/src/components/feature/chat/chat-app.tsx) places `ChatWorkspace` inside `AuthGate`. This gives the conversation interface access to the signed-in account.

[AuthGate](../frontend/src/components/feature/auth/auth-gate.tsx) mounts `useAccountAuth` once. That hook owns the live connection, the account snapshot, and the guarded `request` function. A snapshot is the server's current public account and room data. A guarded request refuses to send an application command while the account is unavailable.

[The server entry point](../backend/src/server.ts) opens storage, creates the HTTP and Socket.IO servers, and connects the feature handlers. Start here to explain how the backend modules work together. Next.js does not forward chat commands.

## Explain the three kinds of identity

A socket ID identifies one live transport connection. An account ID identifies a saved user. A session ID identifies a temporary login record on the server. These values have different lifetimes and purposes.

The socket changes after reconnection. The account and its history remain in SQLite. The browser receives the session ID only through an HTTP-only cookie, which browser JavaScript cannot read.

[Internal records](../backend/src/lib/types.ts) include database information such as password hashes. Public data objects contain only the fields that the browser needs. [The public room mapper](../backend/src/lib/public-room.ts) applies the same member rules to account snapshots and room responses. It keeps offline members, hides deleted group accounts, and retains a deleted private peer as `<Unknown>`.

## Trace registration, login, and session restoration

[AccountForm](../frontend/src/components/feature/auth/account-form.tsx) reads the credentials and performs input checks. It clears the password fields after submission. [useAccountAuth](../frontend/src/components/feature/auth/use-account-auth.ts) sends either `auth.register` or `auth.login` and waits for an acknowledgement. An acknowledgement is the server's response to one Socket.IO command.

[The credential reader](../backend/src/features/auth/credentials.ts) repeats input validation on the server. Browser checks cannot authorize a request. The server normalizes names, checks their length, and requires an acceptable password length.

[AuthPresence](../backend/src/features/auth/auth-handlers.ts) gives registration, login, logout, and account deletion separate methods. Registration stores an Argon2id password hash. Login verifies that hash. Unknown names still perform password verification and return the same public error as a wrong password.

The server permits one active socket per account. The active-socket check and assignment occur without an `await` between them. This prevents two concurrent logins from both claiming the account in the single backend process. The per-socket request lock also prevents overlapping authentication commands on one connection.

After authentication, the browser calls `POST /session`. [SessionHttp](../backend/src/features/auth/session-http.ts) checks the configured origin and the authenticated live socket. It stores an eight-hour session and sets its cookie. On a later connection, the server reads the cookie and restores only a valid, unexpired session.

The client uses `connectionGenerationRef` to identify the current connection lifetime. A late acknowledgement from an older lifetime cannot restore identity or complete a protected command. Disconnect clears live identity and typing state. It retains saved accounts, membership, and messages.

Read [the authentication tests](../backend/test/auth-handlers.test.ts), [session HTTP tests](../backend/test/session-http.test.ts), and [client lifecycle tests](../frontend/src/components/feature/auth/use-account-auth.test.tsx). These cover duplicate names, concurrent logins, disconnects during password work, session cookies, and stale acknowledgements.

## Trace opening a private room and joining a group

[ChatSidebar](../frontend/src/components/feature/chat/chat-sidebar.tsx) passes a selected person or room to the workspace. [useConversation](../frontend/src/components/feature/chat/use-conversation.ts) sends `private.open`, `group.create`, or `group.join`. It stores the returned public room data and selects the conversation.

[Room handlers](../backend/src/features/rooms/room-handlers.ts) obtain the actor from `requireActor`. The actor is the authenticated account bound to the socket. A client-supplied name or sender ID never grants access.

The first private-room open requires an online peer. An existing private room remains usable when that peer is offline. Storage uses a sorted pair of account IDs to find one room for the same two participants.

A new group contains only its creator. Other users join themselves. Public group details include offline members, but message history and sending require stored membership. A Socket.IO room is a delivery subscription. It does not replace the membership check in storage.

## Explain the first-join history rule

[Storage.joinGroup](../backend/src/database/storage.ts) records `visibleFromSeq` during the first join transaction. A transaction commits several database operations together or rolls them back together. The visibility sequence is one greater than the largest message sequence already saved.

Message sequences are global across the database. A repeated join keeps the original visibility sequence. Group history and AI access exclude messages below that sequence. Private-room participants can read their room's saved messages.

[The storage tests](../backend/test/storage.test.ts) prove that a first join hides earlier messages and that another join keeps the same limit. [The room-handler tests](../backend/test/room-handlers.test.ts) prove that handlers use the authenticated actor. These are useful demonstrations for R7, R10, and R11.

## Trace one message from the composer to SQLite

[ChatWorkspace](../frontend/src/components/feature/chat/chat-workspace.tsx) reads the draft and creates a `clientMessageId`. It stops the local typing indication and asks `useConversation` to send the message. [The command map](../frontend/src/lib/chat-protocol.ts) defines each event's payload and result type. TypeScript selects the matching entry from the event name. The server still validates runtime data because types do not authorize network requests.

The `room.send` handler checks the authenticated actor, validates the payload, and calls `Storage.sendMessage`. Storage checks membership and looks for an earlier message with the same sender and client message ID. It saves a new message before any successful delivery or acknowledgement.

For a new message, the handler emits `message.created` and acknowledges the saved result. For an identical retry, it returns the existing result without another insert or broadcast. Reusing an ID with different text or a different room returns `CLIENT_MESSAGE_ID_CONFLICT`.

The browser can receive the same message through history, a live event, and an acknowledgement. [The merge helpers](../frontend/src/lib/conversation-state.ts) merge by message ID and sort by server sequence. They do not compare message text. Two intentional messages with the same words remain two messages.

If an acknowledgement times out, the browser does not know whether storage saved the message. It offers a manual retry with the original ID and text. It does not replay the write automatically. [Workspace regression tests](../frontend/src/components/feature/chat/chat-workspace.test.tsx) cover that retry and a late history response after a room switch.

## Separate saved state from temporary state

SQLite owns accounts, server sessions, rooms, memberships, messages, and emoji attachments. [Storage](../backend/src/database/storage.ts) owns the single database connection, parameterized queries, and transaction helpers. [Row converters](../backend/src/database/rows.ts) translate SQLite column names into internal TypeScript records. They do not authorize requests or return browser data.

The server keeps connected sockets and typing entries in memory. The browser keeps drafts, selected rooms, open dialogs, and firework replay state in memory. These temporary values do not change who can read saved history. This distinction explains why closing a browser changes presence without deleting conversations.

The SQLite file needs persistent storage to survive a release. The release process and backup procedure are in [deployment](deployment.md). The refactor does not change that process or the database schema.

## Explain typing without sending draft text

[useRoomTyping](../frontend/src/components/feature/chat/use-room-typing.ts) sends only a room ID and an active flag. It refreshes active typing every second and throttles active updates to 500 milliseconds. It clears the previous room on a room switch and clears typing when the draft becomes empty or a message is sent.

[TypingPresence](../backend/src/features/typing/typing-handlers.ts) checks stored membership before accepting an update. It sends the status to other sockets in that room. An active entry expires after three seconds unless it receives another update. No draft text enters the payload or SQLite.

The authentication and workspace tests cover room isolation, explicit clearing, and room switches. Use those tests to explain why a timer is needed even when the client normally sends a stop update. A connection can disappear before it sends that update.

## Trace the AI-selected emoji and local replay

[MessageEmojiEffect](../frontend/src/components/feature/chat/emoji/message-emoji-effect.tsx) requests an effect for one saved message. It sends only the room and message IDs. [EmojiEffects](../backend/src/features/emoji/handlers.ts) checks membership and message visibility before reading the saved text or contacting the provider.

A saved result returns immediately without another provider call. A new selection reserves the account and message, applies the cooldown and global concurrency limit, and sends the selected text to `ClefSelector`. Logout and disconnect cancel pending work. The handler checks the socket identity and message visibility again after the provider returns.

[ClefSelector](../backend/src/features/emoji/clef.ts) sends the curated choices in one bounded HTTP request. [The response parser](../backend/src/features/emoji/clef-response.ts) checks the response structure and probability scores. A valid but unrecognized choice becomes the fixed tomato fallback. Malformed data, timeouts, and provider failures remain errors that the user can retry manually.

Storage commits the first attachment before acknowledgement or live delivery. Delivery checks each recipient's saved visibility, including the group join sequence. Existing messages with several saved attachments keep them. [Emoji storage and delivery tests](../backend/test/emoji-delivery.test.ts) cover saved results, duplicate requests, and excluded readers.

The animation runs in the browser. [EmojiFirework](../frontend/src/components/feature/chat/emoji/emoji-firework.tsx) samples particle positions once per play. The browser remembers seen attachment IDs for the current chat session. Clicking a saved emoji replays locally without another server command or AI request.

[AI credential loading](../backend/src/ai-credentials.ts) remains on the backend. On GCE, it uses the VM identity to read a pinned secret version into memory. Tokens never belong in browser data, images, or build arguments. The [credential tests](../backend/test/ai-credentials.test.ts) use synthetic responses and cover failure without exposing upstream details.

## Prepare the explanation with evidence

Start each demonstration with a user action, then follow the named handler into storage and back to the view. Explain each authorization check before explaining its delivery subscription. Show the test that protects the rule you describe.

For R1, the assignment still requires two different physical client computers. Automated tests and two browser tabs do not prove that requirement. Use the [implementation checklist](core-implementation-checklist.md) to prepare the physical demonstration and the presentation evidence. Passing local checks proves the tested behaviors, not completion of the course demonstration.
