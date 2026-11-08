# Talkmato

A tomato-themed browser chat application for the Computer Networks term project.

*Small talks, fresh connections.*

Talkmato supports saved accounts, private conversations, self-joined groups, room-scoped typing, and AI-selected emoji fireworks. Next.js serves the interface. Browsers connect directly to one Node.js/Socket.IO process over WebSocket. SQLite stores accounts and conversations.

## Run locally

Use Node **24.19.0**, as specified in `.nvmrc`. Install the locked dependencies from the repository root:

```sh
npm --prefix backend ci
npm --prefix frontend ci
```

Start the applications in separate terminals:

```sh
npm --prefix backend run dev
```

```sh
npm --prefix frontend run dev
```

Open [localhost:3000](http://localhost:3000). The backend defaults to `http://localhost:8080` and permits the frontend origin `http://localhost:3000`.

The backend reads configuration from its process environment. [backend/.env.example](backend/.env.example) lists the variables. A relative `DATABASE_PATH` resolves from the backend working directory. The default database is the ignored `backend/data/talkmato.dev.sqlite` file.

[frontend/.env.example](frontend/.env.example) lists browser configuration. Set `NEXT_PUBLIC_BACKEND_URL` in `frontend/.env.local` when the backend address changes. Two computers need the same reachable backend address. `localhost` refers to each computer itself. The retained `NEXT_PUBLIC_DEMO_CHAT` variable does not select a route in the current page.

For local AI access, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AUTH_TOKEN` privately in the backend environment. Core chat works without them. AI requests then return `AI_UNAVAILABLE`. Public delivery uses a pinned Secret Manager reference instead of a token in an environment file. See [deployment](docs/deployment.md).

## Development checks

```sh
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

Use focused branches and Conventional Commit subjects such as `fix(chat): preserve reconnect state`. A pull request states the resulting behavior and the checks that support it. Use synthetic accounts and messages in examples.

| Responsibility | Assigned owner |
| --- | --- |
| Architecture design, UI design | Pim |
| Accounts, authentication, presence, typing backend | Guitar |
| Rooms, memberships, messages, conversation UI, typing UI | Poom |
| AI emoji selection and firework | Saint |

These are assigned responsibilities, not a record of code authorship.

## Read the project

| Reference | Purpose |
| --- | --- |
| [Requirements](docs/requirements.md) | Course requirements and selected project scope |
| [Architecture](docs/architecture.md) | Components, network protocols, and source entry points |
| [Data model](docs/data-model.md) | Saved records, authorization, and history visibility |
| [Socket.IO protocol](docs/websocket-protocol.md) | Commands, responses, events, limits, and examples |
| [UI and interaction](docs/ui-ux.md) | Brand source, account lifecycle, and conversation behavior |
| [Deployment](docs/deployment.md) | Cloud Build, Compose, configuration, and recovery |
| [Source record](docs/sources/README.md) | Original PDFs, derivatives, and integrity information |
