# Core implementation checklist

Complete this checklist in order before starting the AI emoji effect, typing indicator, animations or deployment. It converts the course requirements and the team’s account-login decision into the minimum build sequence.

## 0. Confirm the design baseline

The architecture, protocol, data model, event examples and UI flow now use account registration/sign-in. Confirm the baseline together before coding, and keep every document synchronized when it changes.

Agree on:

- Authentication events: `auth.register`, `auth.login` and `auth.logout`.
- No resume-token feature or browser-held password/session ID; use only the selected eight-hour HTTP-only cookie session.
- A new Socket.IO connection requires registration or sign-in before chat commands.
- Whether one account can sign in from one or multiple browsers at a time.
- Password and message validation rules: passwords are 8–128 characters and the backend stores Argon2id hashes only.
- Shared TypeScript DTOs and acknowledgement/error shapes.

## 1. Create separate frontend and backend applications

The assignment requires separate client and server processes.

```text
frontend/     Next.js + TypeScript
backend/      Node.js + TypeScript + Socket.IO
```

Required setup:

- The Next.js page loads in a browser.
- The Node/Socket.IO backend starts separately.
- The browser connects directly to Socket.IO with WebSocket-only transport.
- Next.js does not relay chat messages.
- The frontend origin and backend address are configured.
- One browser can connect to the backend before any chat feature is implemented.

This is the technical foundation for R1 and R2.

## 2. Create the SQLite schema

Define SQLite tables and constraints before implementing chat handlers.

| Table | Minimum purpose and fields |
| --- | --- |
| `users` | `userId`, unique/canonical name, password hash and creation time |
| `rooms` | `roomId`, kind (`private` or `group`), group name and private-pair identifier |
| `memberships` | `roomId`, `userId`, join time and `visibleFromSeq` |
| `messages` | message ID, global sequence number, room ID, sender ID, text, sent time and client message ID |

Required constraints:

- Canonical user names are unique.
- A pair of users has one private room.
- A user has one membership per room.
- Each message has a stable server sequence number.
- `(senderId, clientMessageId)` is unique, preventing duplicate manual retries.
- A first-time group join saves `visibleFromSeq`, preventing access to earlier group messages.

Do not add an AI-effect table or typing table yet. Typing is transient, and the initial AI firework is local and temporary.

## 3. Build accounts, authentication and presence — Guitar

### Backend

1. Implement `auth.register`.
   - Validate name and password.
   - Check name uniqueness.
   - Hash the password.
   - Save the account in SQLite.
   - Authenticate the current Socket.IO connection after the write succeeds.
2. Implement `auth.login`.
   - Find account by name.
   - Verify password hash.
   - Authenticate the current Socket.IO connection.
   - Return allowed room/group information.
3. Add an authentication guard to every later chat event.
4. Track authenticated connected users and broadcast `users.snapshot`.
5. On disconnect, make the user offline without deleting saved data.

### Frontend

1. Build register and sign-in forms.
2. Show duplicate-name and invalid-credential errors.
3. Keep chat UI inaccessible until authentication succeeds.
4. Render an online-user list that includes the viewer.

This completes the foundation for R3 and R4.

## 4. Build private chat — Poom

Implement the smallest complete chat flow first:

1. User selects an online person.
2. Browser emits `private.open`.
3. Backend finds or creates the pair’s private room.
4. Backend records the two room memberships.
5. Browser opens the room and requests `room.history`.
6. User sends text with `room.send`.
7. Backend checks membership, saves the message, acknowledges it, then broadcasts only to the two participants.
8. Frontend displays sent and incoming messages.

Test with three users:

```text
Alice and Bob can see their private conversation.
Charlie cannot read or send in Alice and Bob’s room.
```

This covers R5, R6 and R7.

## 5. Build groups — Poom

Implement group behavior in this order:

1. `group.create`: creator becomes the sole first member.
2. Group directory: every authenticated user sees all groups and member lists; offline members remain visible as offline.
3. `group.join`: a requester adds only themself and receives a permanent first-join visibility boundary.
4. Group chat: only members can load/send group messages; nonmembers see group metadata but no history or enabled composer.
5. Group history: first-time members cannot read messages from before their join boundary.

This covers R8, R9, R10 and R11.

## 6. Test sign-in again and message durability

Test this workflow:

```text
Bob closes the browser
→ Bob becomes offline
→ Bob’s account, rooms and messages stay in SQLite
→ Bob later signs in with name/password
→ Bob can access authorized rooms and history
```

Also verify:

- Unauthenticated sockets cannot request rooms or history.
- Sign out clears live access only.
- Durable messages save before success acknowledgement.
- Unknown sends are not automatically retried.
- A manual retry reuses the same `clientMessageId`.

## 7. Test the assignment on real machines

Before special features, demonstrate:

- Two different physical computers use one shared backend address.
- Unique-name behavior.
- Online-user list.
- Private-room privacy.
- Group creation, listing, self-join and member-only messaging.
- Database-backed message history after signing in again.
- R1 protocol explanation: HTTP, WebSocket, Socket.IO, TCP and IP.
- R2 Socket.IO send/receive code.

## 8. Gather presentation evidence

For each R1–R11:

- Save relevant code screenshots.
- Capture browser evidence or a repeatable demo.
- Record which requirement the feature proves.
- Fill the supplied presentation template only after the feature works.

## Only after this checklist passes

1. Guitar and Poom add the room-scoped typing indicator.
2. Saint adds the AI emoji firework.
3. Team considers a fourth special feature.
4. Team considers optional cloud deployment.
