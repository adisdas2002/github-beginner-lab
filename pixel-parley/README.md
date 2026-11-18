# Pixel Parley

A retro, 16-bit-console-style roundtable where **2 to 6 AI agents talk to each other**. Each agent is
powered by the Claude model you pick. It can join **as itself** (Claude Opus, Sonnet, Haiku…) or
portray a **historical or mythical figure**, drawn as a pixel-art sprite carrying a signature prop.

- Set an agenda, or leave it empty for an open-ended discussion.
- Pick the number of turns, the turn order, the reply length and the thinking effort.
- Watch it play out on a pixel stage with a typewriter dialog box and portraits.
- Step in as the moderator at any time.
- Read the full log, download it as Markdown or JSON, and generate a recap.
- Every conversation is saved automatically. Open, replay or continue it later.

## Quick start

You need [Node.js](https://nodejs.org) 20.12 or newer.

```bash
cd pixel-parley
npm install
npm run demo        # try it without an API key (canned lines, no API calls)
```

Open <http://localhost:3000>.

To use real Claude models, add an [Anthropic API key](https://console.anthropic.com/):

```bash
cp .env.example .env    # then put your key in .env
npm start
```

The server reads `PIXEL_PARLEY_API_KEY` first, then `ANTHROPIC_API_KEY`. With neither set, it
starts in demo mode, and the page shows a **DEMO MODE** badge.

## How to play

1. **Setup tab:** choose a quick scenario or build your own cast.
   - For each agent choose **Who** (Claude as itself, one of the preset figures, or a custom
     figure with your own name, notes and prop) and the **Model** that powers it.
   - Write an **Agenda**, or leave it empty for an open-ended conversation.
   - Set **Turns** (total speaking turns), **Turn order**, **Reply length**, **Thinking effort**,
     what the figures **know** (only their own era, or history since), and the **Recap model**.
2. Press **START**. Each speaker "thinks" (thought bubble), then speaks, with a spotlight, a
   talking portrait and typewriter text.
3. Controls: **PAUSE/RESUME**, **NEXT TURN** (one turn at a time while paused), **STOP**, and
   **+4 TURNS** to keep a finished conversation going. **Space** skips the typing or advances;
   **P** pauses.
4. **Interject** with the moderator box ("Caesar, answer Gandhi directly."). Notes are inserted
   before the next turn, and naming someone usually makes them answer next.
5. **LOG** shows the transcript with copy and download. **RECAP** writes a structured summary
   (headline, key moments, where everyone stood, agreements, clashes, best lines, open
   questions). **SAVED** lists past conversations to open, replay or delete.

Hover over (or tap) anyone on stage to see who they are, what model voices them, and why they
carry their prop.

### Turn order

- **Natural** (default): whoever was just addressed by name answers next. Otherwise the person
  who has waited longest speaks, and nobody is left out for more than a round.
- **Round robin:** seating order.
- **Random:** anyone except the previous speaker.

## The figures

| Figure | Era | Prop | Why |
| --- | --- | --- | --- |
| Mahatma Gandhi | 1869–1948, India | Charkha (spinning wheel) | He spun khadi cloth daily; the wheel stood for self-reliance and the boycott of foreign cloth. |
| The Buddha | c. 5th century BCE, India | Lotus flower | It rises clean from muddy water: the classic image of awakening amid the world. |
| Jesus of Nazareth | c. 4 BCE – c. 30 CE, Judea | Shepherd's crook | "I am the good shepherd": the image of care for every lost sheep. |
| Adolf Hitler | 1889–1945, Germany | Campaign map | The war of conquest he launched in 1939, which cost tens of millions of lives. |
| Donald Trump | born 1946, USA | Smartphone | His late-night posts became a defining tool of modern political communication. |
| Martin Luther King Jr. | 1929–1968, USA | Speech microphone | "I Have a Dream", March on Washington, 1963: his voice moved a nation. |
| Malcolm X | 1925–1965, USA | Dictionary | In prison he copied the dictionary page by page to educate himself. |
| Krishna | Mahabharata & Bhagavad Gita | Bansuri (bamboo flute) | The flute of Vrindavan whose music called every heart: the call of the divine. |
| Albert Einstein | 1879–1955, Germany/USA | Chalkboard: E=mc² | Mass-energy equivalence, from his 1905 "miracle year". |
| Confucius | 551–479 BCE, China | Bamboo-slip book | Early Chinese texts, like the Analects his disciples compiled, were written on bound bamboo slips. |
| Niccolò Machiavelli | 1469–1527, Florence | Fox mask | "A prince must be a fox to recognize traps and a lion to frighten wolves." (The Prince) |
| Leonardo da Vinci | 1452–1519, Italy | Paintbrush and palette | The hand behind the Mona Lisa and The Last Supper. |
| Nicolaus Copernicus | 1473–1543, Poland | Heliocentric orrery | A model of his sun-centered system from De revolutionibus (1543). |
| Julius Caesar | 100–44 BCE, Rome | Gladius (short sword) | The Roman legionary sword that carried his conquest of Gaul. |

Claude agents appear as little robots colored by model family, with a floating sparkle. Custom
figures get a sprite generated from their name and the prop you choose.

Each preset has a detailed persona prompt: background, convictions, manner of speaking, and the
limit of what they could know. Religious and mythic figures are portrayed with reverence and
fidelity to their texts. **Every portrayal is AI-generated, not real quotes.** Personas also carry
content limits:
- no slurs or dehumanizing language
- no glorifying or denying atrocities
- no invented facts about living people

The Hitler persona exists for historical education, so others at the table can question and refute
him, and it is instructed never to produce propaganda. If a model declines a turn anyway, that
speaker stays silent and the conversation continues.

### Adding a figure

Add an entry to `FIGURES` in [`shared/figures.js`](shared/figures.js):
- **Identity:** id, name, nameplate text, era, persona and knowledge limit.
- **Look:** a palette plus named sprite parts, from the part library in
  [`public/js/sprites.js`](public/js/sprites.js).
- **Artifact:** any prop from [`public/js/artifacts.js`](public/js/artifacts.js), or draw a new one.

`npm test` checks that every figure is complete and renders.

## Models and cost

The model list comes from your API key via the Models API, which also tells the app which
**thinking effort** levels each model accepts. The default is **Claude Opus 5.5**, and you can mix
models freely, for example Haiku 5.5 for cheap, fast agents.

Prices shown are dollars per million input/output tokens. The **≈ $** meter under the stage is a
rough estimate from the token usage the API reports.

- Turns are streamed, and requests use automatic prompt caching, so a growing conversation
  re-reads its history from cache.
- Reply length is controlled by the prompt; **Thinking effort** trades depth for speed.
- For models that support it, requests opt into Anthropic's server-side **refusal fallback**. If a
  safety classifier declines, the API retries on its recommended fallback model, and the dialog
  shows "answered by … (safety fallback)".

## Saved conversations

Saved to `logs/<id>.json` after every turn (that folder is git-ignored). Set
`PIXEL_PARLEY_LOG_DIR` to store them elsewhere.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PIXEL_PARLEY_API_KEY` | (none) | Anthropic API key for this app (checked first) |
| `ANTHROPIC_API_KEY` | (none) | Standard Anthropic key, used if the one above is unset |
| `PORT` | `3000` | Server port |
| `HOST` | `127.0.0.1` | Interface to listen on; use `0.0.0.0` to reach it from other devices |
| `PIXEL_PARLEY_LOG_DIR` | `logs/` | Where conversations are saved |
| `DEMO_MODE` | (unset) | `1` forces demo mode even with a key |

The server has no login. Keep it on your own machine or network: anyone who can reach it can
spend your API credits.

## Running in Claude Code cloud sessions

The repo's cloud environment runs `npm ci` in `pixel-parley/` when a session starts, so
`npm test` and `npm run demo` work straight away.

The Anthropic API host can't hold a user key as a network secret. To run live conversations in a
cloud session, add `PIXEL_PARLEY_API_KEY` as an environment variable in the environment's
settings, then start a new session.

Don't name it `ANTHROPIC_API_KEY`: Claude Code reads that variable for its own connection.

## Development

```bash
npm test            # unit + HTTP tests (no network, no API key needed)
npm run dev         # restart the server when files change
```

How it's put together:

| Path | What it does |
| --- | --- |
| `server/index.js` | Express app: static files, `POST /api/turn` and `/api/recap` (server-sent events), sessions |
| `server/llm.js` | Claude via `@anthropic-ai/sdk`: streaming, effort, fallbacks, error mapping |
| `server/prompts.js` | Persona system prompts, per-agent message history, recap prompt, reply clean-up |
| `server/demo.js` | Offline demo provider |
| `shared/` | Figures, models, cast naming and turn order, used by both server and browser |
| `public/js/stage.js` | The 320×180 pixel stage: hall, torches, hourglass, spotlight, bubbles |
| `public/js/sprites.js` | Layered pixel-art sprite builder with auto-outline |
| `public/js/artifacts.js` | Animated props |
| `public/js/conversation.js` | Turn-by-turn runner: pause, step, stop, extend, moderator, replay, autosave |

Fonts: Press Start 2P and VT323 (SIL Open Font License), installed from npm via Fontsource.
