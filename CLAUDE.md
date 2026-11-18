# Notes for Claude

This repo is a GitHub learning lab. The main project is `pixel-parley/`, a Node.js + browser
pixel-art app where Claude-powered agents hold roundtable conversations.

- Install: `cd pixel-parley && npm ci` (the cloud environment's setup script already does this).
- Test: `npm test` (Node's built-in runner; no network or API key needed).
- Run without a key: `npm run demo`, then open http://localhost:3000.
- `npm run subscription` powers agents with the local Claude Code CLI (`server/claude-code.js`)
  instead of an API key; it strips API keys from the child environment so the logged-in plan is used.
- Live mode reads `PIXEL_PARLEY_API_KEY`, then `ANTHROPIC_API_KEY`. In cloud sessions use
  `PIXEL_PARLEY_API_KEY`: `ANTHROPIC_API_KEY` belongs to Claude Code itself.
- Personas, sprites and props live in `pixel-parley/shared/figures.js`; sprite parts in
  `pixel-parley/public/js/sprites.js`; props in `pixel-parley/public/js/artifacts.js`.
- Claude API usage (streaming, effort, refusal fallbacks) is in `pixel-parley/server/llm.js`.
