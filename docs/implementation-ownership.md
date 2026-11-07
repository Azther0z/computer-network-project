# Core implementation ownership plan

This is the team’s implementation plan for the mandatory chat application. It gives Guitar and Poom clear ownership while ensuring that both write backend code. Saint owns the AI emoji-effect special feature after R1–R11 are complete. Cloud deployment and other optional features remain out of scope until then.

Follow the ordered [core implementation checklist](core-implementation-checklist.md) for the prerequisite work before special features.

## Current design decision: full accounts

The team chose full account registration and sign-in rather than the earlier browser-held resume-token approach. A successful login also creates a short server session so routine refreshes do not require re-entering credentials.

- A first-time user registers a unique name and password.
- The backend stores a password hash, never a plaintext password.
- A returning user signs in with the same name and password to access the same rooms and saved history.
- A new Socket.IO connection restores an unexpired eight-hour HTTP-only cookie session when available; otherwise it must complete `auth.register` or `auth.login` before chat commands.
- Browser closure/disconnect clears only live connection, presence and typing state. It does not delete the account, rooms, memberships or messages.
- The initial scope has no email, password reset, social login, cross-device session persistence or recovery flow. A session lasts eight hours and Sign out revokes it.

The architecture, data model, protocol, examples and UI flow use this same account-login baseline. Do not implement `session.resume` or a browser-held resume token. The selected session mechanism is a server-stored ID in an HTTP-only cookie, never a browser-JavaScript token.

## Shared rules

Both developers own the system contract together.

1. Read `docs/requirements.md`, this document, and the architecture/protocol/data-model documents before coding.
2. Keep architecture, data model, protocol, examples and UI flow synchronized when changing account/authentication behavior. The current events are `auth.register`/`auth.login`/`auth.logout`.
3. Keep one Node.js/Socket.IO backend process. Browsers connect directly with `socket.io-client` using WebSocket-only transport; Next.js does not relay chat.
4. Treat the authenticated user bound to a socket as the authority. Never trust client-provided sender IDs, user IDs, membership claims or room permissions.
5. Save every durable mutation before acknowledging it or broadcasting it.
6. Store only Argon2id password hashes through a vetted backend library. Do not log, return, put in URLs, or commit passwords.
7. Block chat commands from unauthenticated or disconnected sockets. Do not automatically retry writes.
8. Every feature needs a test or repeatable manual demonstration and a requirement ID when applicable.

## Guitar — accounts, authentication and presence

Guitar owns the question: **who is this socket connected as, and who is currently online?**

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

## Poom — rooms, memberships and messages

Poom owns the question: **what may the authenticated user see and do in a chat room?**

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
  - Obtain sender identity from Guitar’s authenticated socket binding.
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

Primary: R5–R11. Poom’s handlers rely on Guitar’s authentication guard; authentication never grants room access by itself.

## Saint — AI emoji firework

Saint owns the AI special feature: a user selects a message, then Cloudflare Clef chooses from a curated subset of 240 emojis and displays it as a local firework effect. The subset fits one Choice question with at most 255 options. Choices use default yellow and gender-neutral forms where available. See the [AI setup](../README.md#ai-emoji-effect).

This feature is implemented only after the R1–R11 core chat flow passes. It is not a replacement for normal message delivery, room membership checks or persistent history.

### Chosen feature flow

1. A user selects an existing message and chooses **AI emoji effect**.
2. The browser asks the backend to analyze that one selected message.
3. The backend verifies the requester may read that message using persisted room membership and the group join-history boundary.
4. The backend sends only the selected message text and the curated subset's fixed choice descriptions in one request to the AI provider. It must not send unrelated room history, passwords, credentials, resume/session data or user-private metadata. Match the message tone or intent. For neutral messages, choose a subject-related emoji.
5. The AI returns one emoji from the allow-list. The backend validates the response against that allow-list before returning it.
6. The requesting client displays that emoji as a short, local firework animation over the selected message. The initial scope does not persist or broadcast the animation as a reaction; it is a visual result for the requester.

If the AI provider fails, times out or returns an invalid emoji, show a recoverable error and do not invent an AI result. Keep a documented deterministic fallback only if the team explicitly chooses one; do not present that fallback as an AI decision.

### Backend ownership

- Keep the curated subset within Clef's 255-option limit and enforce default variants through candidate construction and final validation. Do not trust prompt instructions to enforce this policy.
- Define an authenticated request such as `message.emojiSuggest` with `{roomId, messageId}`; the browser must not submit another user’s identity or arbitrary room text as authority.
- Reuse Poom’s persisted authorization/history-visibility query before analyzing the selected message.
- Add an AI service module that sends only the allowed message text and emoji list to the selected provider/model.
- Require a constrained, machine-readable response containing exactly one allowed emoji; validate it server-side.
- Return a success/failure acknowledgement without exposing provider credentials, prompts containing sensitive values or raw provider errors.
- Add tests for nonmember/pre-join rejection, malformed AI output, provider failure and allow-list validation.

### Frontend ownership

- Add an accessible **AI emoji effect** action to each message the current user is allowed to view.
- Show loading state while the AI chooses the emoji and an error/retry state when it fails.
- Render the returned allowed emoji as a short firework animation anchored to that message.
- Respect reduced-motion preferences: use a still emoji or non-animated result when the user requests reduced motion.
- Do not make the animation look like a saved normal reaction in the first version.

### Done when

1. An authorized user selects a visible message and receives one allowed emoji selected by the AI.
2. The emoji is displayed as a short firework effect for that requester.
3. A nonmember and a user who cannot see a pre-join group message cannot invoke the feature on it.
4. Invalid AI output and provider failures show a safe error without leaking data.
5. The presentation records the provider/model, prompt design, code evidence and AI prompts as required by the template.

### Requirement contribution

This is the required AI special feature for Part 3. It needs instructor/demo evidence but is not an R1–R11 requirement.

## Shared special feature — typing indicator

Typing indicators are the other selected special feature. Guitar owns the transient backend/presence behavior; Poom owns the conversation UI. Implement it after the core chat is working.

```text
Alex begins typing in Room A
→ client emits typing.set for Room A
→ server verifies Alex is a current member of Room A
→ server emits “Alex is typing…” only to the other connected Room A members
→ status clears on send, empty draft, room switch, disconnect, explicit stop, or expiry
```

- Never persist typing state in SQLite or include draft text.
- Never expose a typing state outside the relevant private/group room.
- Throttle active updates and expire a missed stop signal after a short timeout.
- Ensure a nonmember cannot set or receive typing for the room.

The account creation/sign-in work is part of Guitar’s core ownership. It may be presented as an additional feature, but the team should confirm with the instructor whether it earns a special-feature point because unique identity overlaps R3.

## Required shared integration milestones

| Milestone | Guitar delivers | Poom delivers | Joint proof |
| --- | --- | --- | --- |
| Project skeleton | Socket.IO connection and account schema | Room/message schema and chat-screen shell | Browser reaches one backend process |
| Account baseline | Register, login, authenticated socket, online list | UI can receive an authenticated current user | Alice and Bob sign in and see each other |
| Private chat | Guarded socket identity and presence | Private room, send, history and UI | Alice sends Bob a private message; Charlie cannot see it |
| Group chat | Group-directory presence/member snapshots | Create, preview, join, group send/history and UI | Bob self-joins Alice’s group; Charlie remains excluded |
| Persistence/demo | Sign-out/disconnect/sign-in behavior | Persisted room/history authorization | Restart/reopen/sign-in preserves authorized data |
| AI feature | Authenticated caller identity | Reusable message-visibility query | Saint returns an allowed AI-selected emoji and shows its effect |

## Build order

1. Work together to reconcile the documentation and create `frontend/`, `backend/`, shared types, Socket.IO setup and SQLite connection.
2. Guitar implements account registration/login and the online-user list. Poom builds the chat layout with temporary sample data and begins room schema/query code.
3. Integrate the first vertical slice: two authenticated users open a private room and exchange persisted messages.
4. Poom adds groups, self-join and group history boundaries. Guitar completes presence/disconnect/sign-out behavior and the group-directory events needed by the UI.
5. Test with three users and two physical computers. Capture code and runtime evidence for R1–R11.
6. After the core requirements pass, Guitar/Poom add room-scoped typing, and Saint adds the AI emoji firework. Guitar and Poom expose the authenticated identity and persisted message-visibility checks Saint needs. Optional deployment comes afterward.

## Demonstration checklist

- Two physical computers use one shared backend address.
- Duplicate registration fails; wrong-password login fails.
- Online directory includes the viewing client and excludes disconnected users.
- Private messages remain private with a third client connected.
- A group starts with creator only; another user self-joins.
- Group nonmembers cannot read or send.
- A new group member cannot read pre-join history.
- Close browser/sign out, sign in again, and recover the account’s authorized rooms/history.
- An authorized user receives an AI-selected emoji effect for a selected visible message; blocked users cannot analyze inaccessible messages.
- Typing status appears only to other eligible members of the active room and disappears reliably.
- Code and presentation evidence identifies R1–R11.
