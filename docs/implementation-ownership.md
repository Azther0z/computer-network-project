# Core implementation ownership plan

This is the team’s implementation plan for the mandatory chat application. It gives two developers clear ownership while ensuring that both write backend code. It excludes the AI feature, cloud deployment, tomato reactions and typing indicators until R1–R11 are complete.

## Current design decision: full accounts

The team chose full account registration and sign-in rather than the earlier browser-held resume-token approach.

- A first-time user registers a unique name and password.
- The backend stores a password hash, never a plaintext password.
- A returning user signs in with the same name and password to access the same rooms and saved history.
- Every new Socket.IO connection begins unauthenticated. It must complete `auth.register` or `auth.login` before it can use any chat command.
- Browser closure/disconnect clears only live connection, presence and typing state. It does not delete the account, rooms, memberships or messages.
- The initial scope has no email, password reset, social login, cross-device session persistence or recovery flow.

This supersedes the authentication lifecycle in the existing `docs/architecture.md`, `docs/data-model.md`, `docs/websocket-protocol.md`, `docs/websocket-examples.md` and `docs/ui-ux.md`. Before implementation begins, both developers must reconcile those documents with this decision. Do not implement both `session.resume` and password login unless the team deliberately later adds a session mechanism.

## Shared rules

Both developers own the system contract together.

1. Read `docs/requirements.md`, this document, and the architecture/protocol/data-model documents before coding.
2. Update the architecture, data model, protocol, examples and UI flow together before changing application code. Replace `user.register`/`session.resume` authentication semantics with `auth.register`/`auth.login`.
3. Keep one Node.js/Socket.IO backend process. Browsers connect directly with `socket.io-client` using WebSocket-only transport; Next.js does not relay chat.
4. Treat the authenticated user bound to a socket as the authority. Never trust client-provided sender IDs, user IDs, membership claims or room permissions.
5. Save every durable mutation before acknowledging it or broadcasting it.
6. Store only password hashes; use a vetted password-hashing library. Do not log, return, put in URLs, or commit passwords.
7. Block chat commands from unauthenticated or disconnected sockets. Do not automatically retry writes.
8. Every feature needs a test or repeatable manual demonstration and a requirement ID when applicable.

## Person A — accounts, authentication and presence

Person A owns the question: **who is this socket connected as, and who is currently online?**

### Backend ownership

- Create the user-account schema: opaque `userId`, display name, canonical unique name, password hash and creation time.
- Implement `auth.register`.
  - Validate name and password input.
  - Atomically reserve the canonical name and save the password hash.
  - Bind the new account to the current socket only after the successful write.
- Implement `auth.login`.
  - Locate the account by canonical name.
  - Verify its password hash.
  - Bind that account to the current socket only after verification.
  - Return generic invalid-credential errors that do not reveal whether a name exists.
- Implement authentication guards shared by all protected handlers.
- Maintain `activeSocketByUserId`, live presence and disconnect cleanup.
- Broadcast `users.snapshot` to authenticated clients; it contains connected users only and includes the viewer.
- Define the team decision for concurrent sign-in: either one active socket per user with an explicit error, or multiple supported sockets. Implement and test the chosen rule.
- Implement `auth.logout` if the UI exposes Sign out. It clears only the current socket’s authenticated binding and live presence when no other active socket remains.

### Frontend ownership

- Create a Register form: name, password and password confirmation.
- Create a Sign in form: name and password.
- Display validation and generic invalid-credential errors.
- Keep chat UI inaccessible until registration/login acknowledgement succeeds.
- Build the online-user directory and connected/offline/sign-in-required states.
- On reconnect after a dropped connection, show sign-in-required state; do not silently recover identity with `session.resume`.
- Provide Sign out if the matching backend command exists.

### Done when

1. Alice and Bob can register from separate browsers.
2. A duplicate Alice registration fails.
3. Alice and Bob can sign in later with their own passwords.
4. An incorrect password cannot access Alice’s rooms/history.
5. Both users see themselves and the other connected user in the online directory.
6. Closing Bob’s browser makes Bob offline without deleting Bob’s account/data.

### Requirement contribution

Primary: R3 (unique client name) and R4 (online client list). This work also supplies the authentication boundary used by every other requirement.

## Person B — rooms, memberships and messages

Person B owns the question: **what may the authenticated user see and do in a chat room?**

### Backend ownership

- Create room, membership and message schema/query code.
- Implement `private.open`.
  - Create/find one persistent room for the two authenticated participants.
  - Permit only those two participants to read/send its messages.
- Implement `group.create`.
  - Create a persistent group whose only initial member is the creator.
- Implement public group-directory queries/events.
  - Every authenticated user sees all groups and all members, including offline members.
- Implement `group.join`.
  - The requester adds only themself.
  - Store the first-join visibility boundary.
  - A repeated join must not move that boundary.
- Implement `room.send`.
  - Obtain sender identity from Person A’s authenticated socket binding.
  - Check persisted membership before saving.
  - Save the message before acknowledgement/broadcast.
  - Deduplicate a manual retry by `(senderId, clientMessageId)`.
- Implement `room.history`.
  - Check persistent membership before returning data.
  - In group rooms, return only messages at or after that member’s first-join boundary.
  - Return paginated history in ascending server sequence order.

### Frontend ownership

- Build private conversation selection and private-room view.
- Build a Create Group modal.
- Build the all-groups directory and member-detail view.
- Build a preview for users who have not joined: members visible, chat history/composer unavailable, Join available.
- Build a joined-group conversation view.
- Build the shared message list, loading/empty/error states and text composer.
- Load history on room selection and send messages only after a successful authenticated state.

### Done when

1. Alice opens a private conversation with Bob and messages are visible only to Alice and Bob.
2. Charlie cannot view or send in that private room.
3. Alice creates a group and is initially its only member.
4. Bob sees the group and member list, explicitly joins it, then can message.
5. Charlie cannot read or send group messages before joining.
6. Bob cannot retrieve group messages committed before Bob joined.
7. Saved, authorized messages load after Bob signs out/in again.

### Requirement contribution

Primary: R5–R11. Person B’s handlers rely on Person A’s authentication guard; authentication never grants room access by itself.

## Required shared integration milestones

| Milestone | Person A delivers | Person B delivers | Joint proof |
| --- | --- | --- | --- |
| Project skeleton | Socket.IO connection and account schema | Room/message schema and chat-screen shell | Browser reaches one backend process |
| Account baseline | Register, login, authenticated socket, online list | UI can receive an authenticated current user | Alice and Bob sign in and see each other |
| Private chat | Guarded socket identity and presence | Private room, send, history and UI | Alice sends Bob a private message; Charlie cannot see it |
| Group chat | Group-directory presence/member snapshots | Create, preview, join, group send/history and UI | Bob self-joins Alice’s group; Charlie remains excluded |
| Persistence/demo | Sign-out/disconnect/sign-in behavior | Persisted room/history authorization | Restart/reopen/sign-in preserves authorized data |

## Build order

1. Work together to reconcile the documentation and create `frontend/`, `backend/`, shared types, Socket.IO setup and SQLite connection.
2. Person A implements account registration/login and the online-user list. Person B builds the chat layout with temporary sample data and begins room schema/query code.
3. Integrate the first vertical slice: two authenticated users open a private room and exchange persisted messages.
4. Person B adds groups, self-join and group history boundaries. Person A completes presence/disconnect/sign-out behavior and the group-directory events needed by the UI.
5. Test with three users and two physical computers. Capture code and runtime evidence for R1–R11.
6. Only after the core requirements pass, add the AI special feature, reactions/typing and optional deployment.

## Demonstration checklist

- Two physical computers use one shared backend address.
- Duplicate registration fails; wrong-password login fails.
- Online directory includes the viewing client and excludes disconnected users.
- Private messages remain private with a third client connected.
- A group starts with creator only; another user self-joins.
- Group nonmembers cannot read or send.
- A new group member cannot read pre-join history.
- Close browser/sign out, sign in again, and recover the account’s authorized rooms/history.
- Code and presentation evidence identifies R1–R11.
