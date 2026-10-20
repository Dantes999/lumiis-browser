# AGENTS.md

Working rules for anyone — human or AI — changing this repository.

Read this before the first change. If the code contradicts this file, the code
is right and this file is out of date; say so instead of silently following
either.

## Language

- **Code, comments, tests, commit messages and documentation: English.**
- Conversations with the owner: German.
- Identifiers describe behaviour (`resolveAttack`, `snapshot`), never history
  (`newVersion`, `oldCode`, `fix2`).

## The ten rules

1. **The server is authoritative.** The client sends intents only and never
   states facts about the world. Every incoming frame goes through
   `parseClientMessage`; anything else closes the connection.
2. **One rule exists once.** If server and client both need it, it lives in
   `packages/shared` and is imported by both. Never copy a formula.
3. **Time is measured in ticks.** The world advances in whole ticks at
   `TICK_RATE`. No game rule may depend on wall-clock milliseconds.
4. **Every change ships with a test** named after the behaviour it protects,
   e.g. `closes the connection on an unknown message`.
5. **Files stay small.** Around 300 lines is the ceiling. If a file grows past
   it, split it before adding more.
6. **No dependency without the owner's explicit agreement.** The stack is
   deliberately thin.
7. **Nothing unexplained.** A new module or concept is explained in a few
   sentences before it is added. If the owner cannot follow it, it does not go in.
8. **Keep it runnable.** After every commit, `npm run build && npm start` works
   and the client connects.
9. **Mobile is not an afterthought.** Touch targets, safe areas, no hover-only
   interactions. Test with narrow viewports.
10. **No secrets in the repository.** `data/` is ignored; credentials never
    appear in code, logs or commits.

## Architecture in five lines

- `packages/shared` holds constants, protocol types and the validator.
- `packages/server` owns `World` (state), `FixedStepLoop` (time) and the
  WebSocket gateway (transport). These never call each other directly; the
  entry point wires them.
- `packages/client` owns rendering and input. `view` is the single mutable
  state object the UI reads.
- Snapshots are the only way the client learns about the world.
- The built client is served by the game server, so there is one port in
  production.

## Commands

```bash
npm run build      # shared -> client -> server
npm start          # serve the build on :3000
npm run dev        # watch mode, client with hot reload on :5173
npm test           # Vitest
npm run typecheck  # tsc for every package
```

## Definition of done

- [ ] Test written first, then the change, then the suite green.
- [ ] `npm run typecheck` clean.
- [ ] Tried in the browser (desktop and a narrow viewport).
- [ ] Translated to player-visible behaviour: what can the owner do now that was
      impossible before?
- [ ] No leftover debug output, no "will be done later" stubs presented as
      finished.
- [ ] Still runnable from a fresh `npm install`.
