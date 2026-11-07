# Talkmato frontend

Next.js and React browser client. Run the Node.js backend separately; browsers connect directly to it through Socket.IO.

## Development

Use Node.js 24.19.0. From this directory:

```sh
npm install
npm run dev
```

Open http://localhost:3000. The backend defaults to http://localhost:8080. See `.env.example` for frontend configuration and the [project README](../README.md) for backend and AI setup.

## Source structure

```text
src/
  app/                        Pages, root layout and global styles
  components/
    feature/
      auth/                   Account forms, session/socket hook and auth gate
      chat/                   Chat app and conversation workspace
        emoji/                Saved emoji effects and fireworks
    ui/                       Shared brand component
  lib/                        Account/chat types, emoji helpers and demo data
```

Tests and CSS modules stay beside their related components. Feature-specific hooks stay in the same feature folder. Shared helpers and demo data belong in `lib/`.

`AuthGate` mounts `useAccountAuth` once and passes the authenticated socket, snapshot and guarded request callback to the chat UI. The retained standalone `connection-status.tsx` is a legacy diagnostic component; do not mount it alongside `AuthGate`, because it opens its own connection.

## Checks

```sh
npm test
npm run lint
npm run build
```
