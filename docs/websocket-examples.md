# Talkmato Socket.IO event examples

These readable arrays document the account-login protocol in [websocket-protocol.md](websocket-protocol.md). They are not batches or raw WebSocket frames. Pass objects to Socket.IO `emit`; do not stringify them or use native `WebSocket.send`. All users, IDs and passwords below are synthetic examples.

## Register an account

```json
[
  {"direction":"client.emit","event":"auth.register","payload":{"name":"Alice","password":"example-only-password"}},
  {"direction":"ack","payload":{"ok":true,"data":{"snapshot":{"self":{"userId":"u-a","name":"Alice","online":true},"users":[{"userId":"u-a","name":"Alice","online":true}],"groups":[],"privateRooms":[]}}}}
]
```

The server stores a password hash only. It does not return/store the password in any DTO or browser storage.

## Sign in after reopening the browser

Every new Socket.IO connection starts unauthenticated. Alice signs in again, receives the same persistent identity and requests history afterward.

```json
[
  {"direction":"client.emit","event":"auth.login","payload":{"name":"Alice","password":"example-only-password"}},
  {"direction":"ack","payload":{"ok":true,"data":{"snapshot":{"self":{"userId":"u-a","name":"Alice","online":true},"users":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}],"groups":[{"roomId":"g-study","kind":"group","name":"Study","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}],"privateRooms":[{"roomId":"p-ab","kind":"private","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}]}}}},
  {"direction":"server.emit","event":"users.snapshot","payload":{"users":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}}
]
```

## Reject duplicate registration or invalid sign-in

```json
[
  {"direction":"client.emit","event":"auth.register","payload":{"name":"Alice","password":"different-example-password"}},
  {"direction":"ack","payload":{"ok":false,"error":{"code":"NAME_TAKEN","message":"Choose another name."}}},
  {"direction":"client.emit","event":"auth.login","payload":{"name":"Alice","password":"wrong-example-password"}},
  {"direction":"ack","payload":{"ok":false,"error":{"code":"INVALID_CREDENTIALS","message":"Name or password is incorrect."}}}
]
```

## Open a private room and send a saved message

```json
[
  {"direction":"client.emit","event":"private.open","payload":{"peerId":"u-b"}},
  {"direction":"ack","payload":{"ok":true,"data":{"room":{"roomId":"p-ab","kind":"private","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}}}},
  {"direction":"client.emit","event":"room.send","payload":{"roomId":"p-ab","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","text":"Hello Bob"}},
  {"direction":"ack","payload":{"ok":true,"data":{"message":{"seq":101,"messageId":"m-101","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","roomId":"p-ab","senderId":"u-a","senderName":"Alice","text":"Hello Bob","sentAt":"2026-11-04T09:00:00Z","emojis":[]},"replayed":false}}},
  {"direction":"server.emit","event":"message.created","payload":{"seq":101,"messageId":"m-101","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","roomId":"p-ab","senderId":"u-a","senderName":"Alice","text":"Hello Bob","sentAt":"2026-11-04T09:00:00Z","emojis":[]},"recipients":["u-a","u-b"]}
]
```

## Create and join a group

```json
[
  {"direction":"client.emit","event":"group.create","payload":{"name":"Study"}},
  {"direction":"ack","payload":{"ok":true,"data":{"group":{"roomId":"g-study","kind":"group","name":"Study","members":[{"userId":"u-a","name":"Alice","online":true}]}}}},
  {"direction":"client.emit","event":"group.join","payload":{"roomId":"g-study"}},
  {"direction":"ack","payload":{"ok":true,"data":{"group":{"roomId":"g-study","kind":"group","name":"Study","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}}}}
]
```

The server writes Bob’s first-join visibility boundary during `group.join`. Bob cannot request or react to earlier group messages.

## Load history and retry an unknown send

```json
[
  {"direction":"client.emit","event":"room.history","payload":{"roomId":"p-ab","limit":50}},
  {"direction":"ack","payload":{"ok":true,"data":{"roomId":"p-ab","messages":[{"seq":101,"messageId":"m-101","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","roomId":"p-ab","senderId":"u-a","senderName":"Alice","text":"Hello Bob","sentAt":"2026-11-04T09:00:00Z","emojis":[]}],"nextBeforeSeq":null,"highWatermarkSeq":101}}},
  {"direction":"client.emit","event":"room.send","payload":{"roomId":"p-ab","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","text":"Hello Bob"}},
  {"direction":"ack","payload":{"ok":true,"data":{"message":{"seq":101,"messageId":"m-101","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","roomId":"p-ab","senderId":"u-a","senderName":"Alice","text":"Hello Bob","sentAt":"2026-11-04T09:00:00Z","emojis":[]},"replayed":true}}}
]
```

## Typing and AI emoji effect

Both are implemented after R1–R11. Typing is transient and room-scoped; AI checks message visibility before analysis.

```json
[
  {"direction":"client.emit","event":"typing.set","payload":{"roomId":"p-ab","isTyping":true}},
  {"direction":"server.emit","event":"typing.updated","payload":{"roomId":"p-ab","userId":"u-a","isTyping":true,"expiresInMs":3000},"recipients":["u-b"]},
  {"direction":"client.emit","event":"message.emojiSuggest","payload":{"roomId":"p-ab","messageId":"m-101"}},
  {"direction":"server.emit","event":"message.emojiAdded","payload":{"roomId":"p-ab","messageId":"m-101","attachment":{"emojiId":"emoji-101","emoji":"🎉","createdAt":"2026-11-07T00:00:00.000Z"}},"recipients":["u-a","u-b"]},
  {"direction":"ack","payload":{"ok":true,"data":{"emoji":"🎉","attachment":{"emojiId":"emoji-101","emoji":"🎉","createdAt":"2026-11-07T00:00:00.000Z"}}}}
]
```

The attachment is saved before its event and acknowledgement. Only eligible message readers receive the event; group membership alone does not grant access to pre-join messages. The acknowledgement goes to the requester. Subsequent requests return the first saved attachment without another provider call or event. History preserves saved emojis, including legacy multi-emoji messages. Clients hide the AI action while choosing and after any saved result arrives, merge by `emojiId`, animate first appearance once per chat session, and offer local replay. 🍅 is used for unknown/unmatched meaning or an unrecognized provider choice; malformed data and provider failures still allow retry.
