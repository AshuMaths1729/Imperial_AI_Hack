# Live lesson tutor (LiveKit + Synthesia)

A live, face-to-face AI tutor inside Athena's Live Lessons. The student talks; the tutor answers by
voice with a lip-synced Synthesia avatar, teaches from the track's animated slides and a shared
whiteboard, and remembers progress across lessons.

```
Browser (Next.js)                         FastAPI backend                      This agent worker (LiveKit Agents)
─────────────────                         ───────────────                      ──────────────────────────────────
/lecture/lesson ── POST /api/lesson/session ──▶ mints a LiveKit token that dispatches the agent
       │                                        with {track_id, lesson_id, tutor_id}       │
       │                                  GET /api/lesson/context/{lesson_id} ◀────────────┤
       └──────────── LiveKit Cloud room (audio, video, captions, board RPC) ◀──────────────┘
                                                       ElevenLabs STT → Claude Haiku → ElevenLabs TTS → Synthesia avatar
```

- **Tutors**: Kenji, Jenny and Mei, defined once in `backend/app/modules/lesson/seed.py` (avatar id,
  ElevenLabs voice id, personality). The agent reads its tutor, the learning track and the student's
  progress from the lesson context, so you only edit tutors there.
- **Where it shows up**: the Live Lesson page `/lecture/lesson` (LectureUnderstanding), and the
  **Ask a tutor about this** button in the Paper Simulator and Evidence Map screens, which turns the
  paper or map on screen into a learning track and opens the lesson lobby on it.

## 1. What you need

| Thing | How to get it |
|---|---|
| `uv` (Python) and Node 20+ | already needed for the rest of the repo |
| LiveKit Cloud project `ai-hackerthon` | ask Fuchun for `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, or copy them from the LiveKit Cloud dashboard → Settings → API keys |
| `SYNTHESIA_API_KEY` | a key from the team's Synthesia workspace (it must have Interactive Avatar access) |
| `ANTHROPIC_API_KEY` | the team key |
| `ELEVENLABS_API_KEY` | the team ElevenLabs key (the agent passes it to the LiveKit ElevenLabs plugin explicitly) |
| LiveKit CLI `lk` (optional) | `brew install livekit-cli`, only needed to deploy to LiveKit Cloud (step 5) |

You don't install a LiveKit server: the rooms run on LiveKit Cloud. The Python and JS LiveKit
libraries are installed by `uv sync` and `npm install`.

## 2. Configure `.env` (repo root, never committed)

Add these to the repo-root `.env` next to the other keys (see `.env.example`):

```bash
LIVEKIT_URL=wss://ai-hackerthon-vit8jtiw.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
SYNTHESIA_API_KEY=...
ANTHROPIC_API_KEY=...
ELEVENLABS_API_KEY=...
# Use your own name so calls from your browser reach YOUR agent, not a teammate's.
TUTOR_AGENT_NAME=tutor-yourname
```

The backend and the agent both read this one file; there is no separate `agent/.env`. `TUTOR_AGENT_NAME` must be the same for both:
the backend asks LiveKit for an agent with that name, and the agent registers under it.

## 3. Install and run

```bash
# once
uv sync                              # backend deps (repo root)
(cd agent && uv sync)                # agent deps
(cd frontend && npm install)

# every time: two terminals
./start.sh                           # backend :8000 + frontend :3000
cd agent && uv run agent.py dev
```

Wait for the agent to print `registered worker {"agent_name": "tutor-yourname", ...}`. Then
open http://localhost:3000/lecture/lesson, pick a tutor and a learning track, click **Join lesson**
and allow the microphone. The tutor joins in about 10–20 s.

- Ignore the `dev mode is deprecated` warning; it still works.
- `TUTOR_AVATAR=0` runs voice only (no Synthesia session), handy when you're only changing prompts.

## 4. Using it

- **Talk** normally. Background voices are filtered (LiveKit BVC), and only real speech
  (about a second, two or more words) interrupts the tutor.
- **Choose the tutor** in the lobby; each has their own face, voice and personality.
- **Board**, **Circle** and **I'm lost** in the control bar share the whiteboard, point at something
  on screen, or ask the tutor to slow down and re-explain.
- **Type** to the tutor in the control bar if you can't use a mic.
- **Leave** ends the Synthesia session, so it stops using credits; the tutor then writes the recap.

## 5. Deploy the agent to LiveKit Cloud (optional, not yet tried by the team)

Running locally (step 3) is enough for development and the demo. To keep one agent always on:

```bash
cd agent
lk cloud auth                                    # once, log in to the LiveKit project
lk agent dockerfile                              # generates Dockerfile + .dockerignore
lk agent create --secrets-file ../.env --ignore-empty-secrets
```

Give the deployed agent the shared name (`TUTOR_AGENT_NAME=scholartwin-tutor`) and point the
demo backend at that same name. Keep personal names for local development so you don't steal
the deployed agent's calls (or each other's).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Tutor is joining…" forever | No agent running under the backend's `TUTOR_AGENT_NAME`. Start the agent and check both use the same name. |
| Lesson lobby says it couldn't load tutors and tracks | Backend not running, or `NEXT_PUBLIC_API_URL` points at the wrong port. Reload once it's up. |
| Tutor hears you but never finishes a reply | Something is interrupting it (speakers feeding the mic, people talking). Use headphones. |
| Chrome won't use the mic | Use Safari, or allow the mic for localhost in Chrome's site settings. |
| `UNKNOWN_AVATAR` in the agent log | The avatar id isn't available to the Synthesia workspace. Only Synthesia's interactive (Express) avatars work, e.g. Kenji `7572faa9-…`, Jenny `8788bef1-…` and Mei `519674df-…` (a Studio avatar converted with `POST /api/interactive-avatars/avatars`). |
| Avatar video looks blurry | Don't render it bigger than 512 px; that's the stream's resolution. |

## Code map

| File | What it does |
|---|---|
| `agent/agent.py` | The worker: voice pipeline, Synthesia avatar, slides and whiteboard tools, lesson memory |
| `backend/app/modules/lesson/` | `/api/lesson/*`: tutors, learning tracks, materials, slide decks, `POST /api/lesson/session` (LiveKit token + agent dispatch), lesson context, progress and recap |
| `frontend/src/app/lecture/lesson/page.tsx` | `/lecture/lesson`: lobby, live call and recap |
| `frontend/src/tutor/shell/` | Lobby, call view, LiveKit session hook and the lesson API client |
| `frontend/src/tutor/AskTutorButton.tsx` | **Ask a tutor about this**: makes a track from the paper or evidence map on screen and opens the lobby on it |
| `frontend/public/tutors/` | Tutor portraits (frames from the live avatars) and ElevenLabs voice samples |

Tests: `cd agent && uv run pytest`, and `cd backend && uv run pytest tests/lesson`.
