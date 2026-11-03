# Talkmato Socket.IO event examples

These captures follow the [current reconnect/history protocol](websocket-protocol.md) and [data model](data-model.md). Each array is readable documentation, not a batch or raw transport frame. `client.emit`/`server.emit` identify named events; `ack` is the callback result for that command. `recipients` is explanatory metadata, never a client field. Scenarios are independent unless explicitly described as a retry.

All tokens, users and UUIDs below are synthetic examples. Pass objects to Socket.IO; do not stringify these arrays or use native WebSocket.send. Persistence and resume remain design work, not implemented evidence.

## Register a new identity

B is already online; A is a new unused identity. The token below is an illustrative placeholder, never a real credential. Persist the user/session before acknowledgement and return the raw token only to A.

```json
[
  {"direction":"client.emit","event":"user.register","payload":{"name":"Alice"}},
  {"direction":"ack","payload":{"ok":true,"data":{"resumeToken":"EXAMPLE_ONLY_OPAQUE_TOKEN","snapshot":{"self":{"userId":"u-a","name":"Alice","online":true},"users":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}],"groups":[],"privateRooms":[]}}}},
  {"direction":"server.emit","event":"users.snapshot","payload":{"users":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]},"recipients":["u-a","u-b"]}
]
```

## Resume after a dropped connection

A supplies its saved token and recovers the same u-a identity, persisted private room and Study membership. The backend rejoins authorized delivery channels before acknowledging. No new group.join occurs. Update group-member presence as well as the online list.

```json
[
  {"direction":"client.emit","event":"session.resume","payload":{"resumeToken":"EXAMPLE_ONLY_OPAQUE_TOKEN"}},
  {"direction":"ack","payload":{"ok":true,"data":{"snapshot":{"self":{"userId":"u-a","name":"Alice","online":true},"users":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}],"groups":[{"roomId":"g-study","kind":"group","name":"Study","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}],"privateRooms":[{"roomId":"p-ab","kind":"private","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}]}}}},
  {"direction":"server.emit","event":"users.snapshot","payload":{"users":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]},"recipients":["u-a","u-b"]},
  {"direction":"server.emit","event":"groups.snapshot","payload":{"groups":[{"roomId":"g-study","kind":"group","name":"Study","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}]},"recipients":["u-a","u-b"]}
]
```

## Open a private room

A opens B from the online list. Find/create the persisted pair room. Only on initial creation emit private.opened; later opens return the same room, even if B is offline.

```json
[
  {"direction":"client.emit","event":"private.open","payload":{"peerId":"u-b"}},
  {"direction":"ack","payload":{"ok":true,"data":{"room":{"roomId":"p-ab","kind":"private","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}}}},
  {"direction":"server.emit","event":"private.opened","payload":{"room":{"roomId":"p-ab","kind":"private","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}},"recipients":["u-a","u-b"]}
]
```

## Create a group

A creates Study. Only A is a member; metadata is public to all authenticated online users.

```json
[
  {"direction":"client.emit","event":"group.create","payload":{"name":"Study"}},
  {"direction":"ack","payload":{"ok":true,"data":{"group":{"roomId":"g-study","kind":"group","name":"Study","members":[{"userId":"u-a","name":"Alice","online":true}]}}}},
  {"direction":"server.emit","event":"groups.snapshot","payload":{"groups":[{"roomId":"g-study","kind":"group","name":"Study","members":[{"userId":"u-a","name":"Alice","online":true}]}]},"recipients":["u-a","u-b"]}
]
```

## Join a group for the first time

B self-joins. Persist its visibleFromSeq boundary at join time. B cannot query pre-join messages; reconnect later preserves this boundary instead of creating another one.

```json
[
  {"direction":"client.emit","event":"group.join","payload":{"roomId":"g-study"}},
  {"direction":"ack","payload":{"ok":true,"data":{"group":{"roomId":"g-study","kind":"group","name":"Study","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}}}},
  {"direction":"server.emit","event":"groups.snapshot","payload":{"groups":[{"roomId":"g-study","kind":"group","name":"Study","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":true}]}]},"recipients":["u-a","u-b"]}
]
```

## Send privately and save

A uses one stable clientMessageId for this logical send. Commit before acknowledgement and live delivery. If B is offline, the message is still saved, only A receives the live event, and B reads it on resume.

```json
[
  {"direction":"client.emit","event":"room.send","payload":{"roomId":"p-ab","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","text":"Hello Bob"}},
  {"direction":"ack","payload":{"ok":true,"data":{"message":{"seq":101,"messageId":"m-101","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","roomId":"p-ab","senderId":"u-a","senderName":"Alice","text":"Hello Bob","sentAt":"2026-11-03T09:00:00Z","reaction":{"emoji":"tomato","userIds":[],"version":0}},"replayed":false}}},
  {"direction":"server.emit","event":"message.created","payload":{"seq":101,"messageId":"m-101","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","roomId":"p-ab","senderId":"u-a","senderName":"Alice","text":"Hello Bob","sentAt":"2026-11-03T09:00:00Z","reaction":{"emoji":"tomato","userIds":[],"version":0}},"recipients":["u-a","u-b"]}
]
```

## Send to a joined group

B sends a post-join message in Study. Only connected eligible members receive the live event; persisted members who are offline retrieve it from history later.

```json
[
  {"direction":"client.emit","event":"room.send","payload":{"roomId":"g-study","clientMessageId":"ac647ae8-ea29-4130-9fb7-29167f727340","text":"Ready to study?"}},
  {"direction":"ack","payload":{"ok":true,"data":{"message":{"seq":102,"messageId":"m-102","clientMessageId":"ac647ae8-ea29-4130-9fb7-29167f727340","roomId":"g-study","senderId":"u-b","senderName":"Bob","text":"Ready to study?","sentAt":"2026-11-03T09:01:00Z","reaction":{"emoji":"tomato","userIds":[],"version":0}},"replayed":false}}},
  {"direction":"server.emit","event":"message.created","payload":{"seq":102,"messageId":"m-102","clientMessageId":"ac647ae8-ea29-4130-9fb7-29167f727340","roomId":"g-study","senderId":"u-b","senderName":"Bob","text":"Ready to study?","sentAt":"2026-11-03T09:01:00Z","reaction":{"emoji":"tomato","userIds":[],"version":0}},"recipients":["u-a","u-b"]}
]
```

## Reject a nonmember

Independent scenario: B has not joined Study. No insert, acknowledgement success or live event is permitted.

```json
[
  {"direction":"client.emit","event":"room.send","payload":{"roomId":"g-study","clientMessageId":"08638c4e-cabf-4026-a7eb-19a6342546f5","text":"Can I send?"}},
  {"direction":"ack","payload":{"ok":false,"error":{"code":"NOT_MEMBER","message":"Join the group before sending messages."}}}
]
```

## Reject an existing name

A different browser without Alice's token cannot register her existing name, even while Alice is offline. It cannot obtain her history by knowing her name.

```json
[
  {"direction":"client.emit","event":"user.register","payload":{"name":"Alice"}},
  {"direction":"ack","payload":{"ok":false,"error":{"code":"NAME_TAKEN","message":"This name belongs to an existing identity. Use its saved session or choose another name."}}}
]
```

## Peer disconnect changes presence only

B disconnects. Socket.IO leaves its live channels, but p-ab, Study membership, messages, reactions and session remain stored. There is no room.closed event. Group details continue showing Bob as offline.

```json
[
  {"direction":"server.emit","event":"users.snapshot","payload":{"users":[{"userId":"u-a","name":"Alice","online":true}]},"recipients":["u-a"]},
  {"direction":"server.emit","event":"groups.snapshot","payload":{"groups":[{"roomId":"g-study","kind":"group","name":"Study","members":[{"userId":"u-a","name":"Alice","online":true},{"userId":"u-b","name":"Bob","online":false}]}]},"recipients":["u-a"]}
]
```

## Load saved history

Authenticated A requests its persisted private history. Pages are ascending by seq. An older-page request supplies exclusive beforeSeq; null means no more accessible older messages. Group history additionally enforces visibleFromSeq.

```json
[
  {"direction":"client.emit","event":"room.history","payload":{"roomId":"p-ab","limit":50}},
  {"direction":"ack","payload":{"ok":true,"data":{"roomId":"p-ab","messages":[{"seq":101,"messageId":"m-101","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","roomId":"p-ab","senderId":"u-a","senderName":"Alice","text":"Hello Bob","sentAt":"2026-11-03T09:00:00Z","reaction":{"emoji":"tomato","userIds":[],"version":0}}],"nextBeforeSeq":null,"highWatermarkSeq":101}}}
]
```

## Retry an unknown send without a duplicate

Independent retry after lost acknowledgement: A resumes and explicitly retries the identical original key/room/text. Return the previously committed Message with replayed true; do not insert or broadcast it again.

```json
[
  {"direction":"client.emit","event":"room.send","payload":{"roomId":"p-ab","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","text":"Hello Bob"}},
  {"direction":"ack","payload":{"ok":true,"data":{"message":{"seq":101,"messageId":"m-101","clientMessageId":"3c6ecf68-96d3-4ac1-9588-23e3bb105e12","roomId":"p-ab","senderId":"u-a","senderName":"Alice","text":"Hello Bob","sentAt":"2026-11-03T09:00:00Z","reaction":{"emoji":"tomato","userIds":[],"version":0}},"replayed":true}}}
]
```

## Persist a tomato reaction

B reacts to visible persisted m-101. Commit the unique reaction and its message version together. The badge returns through history on reconnect. Repeat enabled=true is a no-op, not a count increment.

```json
[
  {"direction":"client.emit","event":"reaction.set","payload":{"roomId":"p-ab","messageId":"m-101","emoji":"tomato","enabled":true}},
  {"direction":"ack","payload":{"ok":true,"data":{"roomId":"p-ab","messageId":"m-101","reaction":{"emoji":"tomato","userIds":["u-b"],"version":1}}}},
  {"direction":"server.emit","event":"reaction.updated","payload":{"roomId":"p-ab","messageId":"m-101","reaction":{"emoji":"tomato","userIds":["u-b"],"version":1}},"recipients":["u-a","u-b"]}
]
```

## Typing stays transient

A types; only B receives the status. It expires after the proposed 3000 ms and is never restored from history or persisted in the database.

```json
[
  {"direction":"client.emit","event":"typing.set","payload":{"roomId":"p-ab","isTyping":true}},
  {"direction":"ack","payload":{"ok":true,"data":{}}},
  {"direction":"server.emit","event":"typing.updated","payload":{"roomId":"p-ab","userId":"u-a","isTyping":true,"expiresInMs":3000},"recipients":["u-b"]}
]
```

## Reject invalid resume

An invalid credential never returns protected snapshot/history. Stop resume attempts for that credential and return to entry. SESSION_IN_USE is different: keep the valid credential and allow retry after old transport cleanup.

```json
[
  {"direction":"client.emit","event":"session.resume","payload":{"resumeToken":"EXAMPLE_ONLY_INVALID_TOKEN"}},
  {"direction":"ack","payload":{"ok":false,"error":{"code":"SESSION_INVALID","message":"This session could not be restored."}}}
]
```
