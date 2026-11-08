# Requirements and selected scope

The [assignment PDF](sources/Computer_Network_Term_Project___Socket_Programming-1047532-17880926607939.pdf) defines the course requirements. The [implementation explanation template](sources/Computer_Network_Term_Project___Socket_Programming___Implementation_Explanation-1047532-17880926752070.pdf) defines the supplied slide structure. Both originals remain authoritative. The [source record](sources/README.md) links their page-oriented derivatives.

The full score is 12.5 points: architecture 1.5, fundamental implementation 7, and special features 4. Architecture must pass before fundamental implementation is graded. Fundamental implementation must pass before special features are graded. At least one special feature must use AI. Cloud deployment is optional and counts as one special point.

## Assignment requirements

The client and server processes must use separate files. R1–R11 appear on assignment page 2. These descriptions are paraphrases.

| ID | Points | Required behavior |
| --- | --- | --- |
| R1 | 1.0 | Two clients run on different physical computers. The server can share one computer or use a third. Explain the architecture and protocols: what, why, and how. |
| R2 | 0.5 | Chat messages between each client and the server use socket programming only. |
| R3 | 0.5 | Each client has a unique name. |
| R4 | 0.5 | Every client sees all currently connected client names, including its own. |
| R5 | 0.5 | Each private or group conversation has its own room. |
| R6 | 0.5 | Each room has a text input and a view of sent and incoming messages. |
| R7 | 1.0 | Clients can directly message any listed client. Only the pair sees the private messages. |
| R8 | 1.0 | A new group initially contains only its creator. |
| R9 | 1.0 | Every client sees all groups and their members, regardless of creator. |
| R10 | 1.0 | Clients join groups themselves. A creator does not add other clients automatically. |
| R11 | 1.0 | Group members can send text. Only that group's members see its messages. |

The assignment also requires an implementation explanation and a live demonstration. Two tabs or virtual machines on one physical computer do not satisfy R1.

## Project choices

Talkmato uses Next.js/TypeScript, Node.js/TypeScript, Socket.IO over WebSocket, and SQLite. The handout lists Socket.IO and WebSocket learning resources. It does not explicitly require raw TCP sockets. The project uses the direct browser-to-backend event path described in [architecture](architecture.md).

Persistent accounts with eight-hour cookie sessions, saved history, account deletion, room-scoped typing, and AI-selected emoji fireworks are project choices. The AI provider is Cloudflare `@cf/cloudflare/clef`, using one curated set of 240 choices per request. These choices do not add requirements to R1–R11.

AI Voice Chat and manual tomato reactions appear in original artwork but are not selected features. Current interactions are in [UI and interaction](ui-ux.md). The supplied PDFs do not specify a language, interface, AI provider, deadline, submission channel, or presentation duration.
