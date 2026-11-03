# Requirements and evidence map

This is a derived checklist, not a replacement for the [assignment](sources/Computer_Network_Term_Project___Socket_Programming-1047532-17880926607939.pdf) or [presentation template](sources/Computer_Network_Term_Project___Socket_Programming___Implementation_Explanation-1047532-17880926752070.pdf).
The acceptance evidence below is proposed. No requirement is implemented or demonstrated yet.

## Grading gates

The full score is 12.5 points. Part 1 is worth 1.5 points, Part 2 is worth 7 points, and Part 3 is worth 4 points.
Part 1 must be fully complete before Part 2 is graded. Part 2 must be fully complete before Part 3 is graded.
At least one project feature must use AI. Cloud deployment is optional and counts as one special point.

## Assignment requirements

The assignment defines R1–R11 on page 2. Page 1 also requires separate files for the client and server processes.
Each requirement below is a paraphrase. Use the original PDFs for exact wording.

| ID | Points | Required behavior | Proposed acceptance evidence | Template page |
| --- | --- | --- | --- | --- |
| R1 | 1.0 | Present the architecture, with two clients on different physical computers. The server can share one or use a third computer. Explain what protocols are used, why, and how. | Architecture diagram, protocol explanation, and live demonstration on two physical computers | 3–4 |
| R2 | 0.5 | Use socket programming for chat messages between each client and the server. | Show the send/receive code and trace a message through it | 5 |
| R3 | 0.5 | Give each client a unique name. | Connect clients and demonstrate uniqueness, including a duplicate-name attempt | 7 |
| R4 | 0.5 | Show every connected client name, including the viewing client. | Compare the lists across clients after connections and disconnections | 8 |
| R5 | 0.5 | Give each private conversation and group conversation its own room. | Open separate private and group rooms and show separate conversations | 9 |
| R6 | 0.5 | Give each room a text input and a view of sent and incoming messages. | Send and receive text in each room type | 10 |
| R7 | 1.0 | Allow direct messages to any listed client. Only the sender and receiver see them. | Use a third connected client to demonstrate that private messages stay within the pair | 11 |
| R8 | 1.0 | Allow clients to create groups whose only initial member is the creator. | Create a group and show its initial member list | 12 |
| R9 | 1.0 | Show all existing groups and their members, regardless of creator. | Compare group lists from clients that created different groups | 13 |
| R10 | 1.0 | Let clients join groups themselves. Creators do not automatically add others. | Create a group, then join it explicitly from another client | 14 |
| R11 | 1.0 | Let members send group text. Only that group's members see it. | Demonstrate delivery to members and exclusion of a connected nonmember | 15 |

## Special features and presentation

Part 3 allows four special features at one point each. The template reserves its first special-feature slide for AI.
The assignment gives speech-to-text, summarization, sentiment analysis, and a chatbot as examples. These examples are not selected features.
The planned Part 3 slots are AI (details provisional), cloud deployment (provider pending), tomato message reactions and room-scoped typing indicators. The Talkmato Figma exports depict AI Voice Chat, but that specific AI behavior is not selected. See [UI design](ui-ux.md) for the current source screens and design boundaries. These are planned features, not completed implementation or guaranteed grading decisions.

| Template pages | Evidence to prepare |
| --- | --- |
| 1 | Replace the group and member placeholders in the final presentation |
| 2, 6 | Preserve the grading-gate explanations |
| 3–4 | Architecture diagram and the what/why/how explanation for network protocols |
| 5 | Socket-message code snapshot and generative-AI prompt if used |
| 7–15 | Code snapshots for R3–R11. Each slide labels the left snapshot mandatory and includes prompt fields |
| 16 | Explain the requirement for at least one AI feature |
| 17 | AI-feature description, AI model and reference, code snapshot, and prompts if used |
| 18–20 | Descriptions, code snapshots, and prompts for the remaining special features |

The assignment also requires a live demonstration and explanations of relevant concepts and code when the instructor asks.
The final presentation is not created yet. Keep the supplied PDF template unchanged and prepare the team's presentation separately.

## Open questions for team or instructor

The supplied PDFs do not state a deadline, submission channel, or presentation duration.
They do not select a language, user interface, message format, AI model, or service provider.
The project selects Next.js with TypeScript and Node.js with TypeScript and Socket.IO; see the [architecture](architecture.md) and [proposed event protocol](websocket-protocol.md). These are project decisions, not source requirements.
The PDFs list Socket.IO and WebSocket learning resources while requiring socket programming for chat messages. The project interprets direct browser-to-Node Socket.IO chat over WebSocket-only transport as satisfying R2; demonstrate the send/receive code and actual transport. Any additional instructor restrictions would take precedence.
Persistence and session resume are selected project enhancements, not additional assignment requirements. See the [reconnect and history design](architecture.md#selected-lifecycle-and-storage-baseline). Do not treat passwords, explicit group-leaving behavior or end-to-end encryption as assignment requirements without further evidence.
