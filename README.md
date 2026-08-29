# Autonomous Local AI Minecraft Player

A fully autonomous AI Minecraft player that connects to your server as a normal player and independently plays the game — **no commands required during normal operation**.

The AI brain runs entirely locally using [Ollama](https://ollama.com/). The recommended model is **qwen3:8b** (fits in 5GB VRAM, ~50 tokens/sec on an RTX 3070 Ti).

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Ollama installed ([ollama.com](https://ollama.com/))
- A Minecraft Java Edition server (offline/cracked mode supported)

### 2. Install

```bash
git clone https://github.com/aswathraj01/Autonomous-Local-AI-Minecraft-Player
cd Autonomous-Local-AI-Minecraft-Player
npm install
```


### 3. Configure

```bash
copy .env.example .env
```

Edit `.env`:

```env
MC_HOST=localhost
MC_PORT=25565
MC_VERSION=26.2          # Your server version (26.2, 26.1, 1.21.x, etc.)
MC_USERNAME=AIPlayer
MC_AUTH=offline           # Use offline for cracked/local servers

LLM_PROVIDER=ollama
LLM_MODEL=qwen3:8b
OLLAMA_URL=http://localhost:11434
```

### 4. Set up the LLM

```bash
# Start Ollama (if not already running)
ollama serve

# Download the recommended model (one-time, ~5GB)
ollama pull qwen3:8b
```

### 5. Run

```bash
npm run dev
```

You should see:

```
╔══════════════════════════════════════════════════╗
║     Autonomous Local AI Minecraft Player          ║
║  Main objective: Complete Minecraft               ║
║  No user instructions required.                  ║
╚══════════════════════════════════════════════════╝

Connecting to Minecraft...
[Client] ✅ Spawned in world!
[Agent] ✅ Agent initialized. AI is now autonomous.
[Main] AI is now autonomous. Main objective: Complete Minecraft.
```

The bot then plays independently.

---

## Architecture

```
LOCAL AI BRAIN (Ollama / qwen3:8b)
        │  structured JSON decisions
        ▼
AUTONOMOUS AGENT (TypeScript)
  • Hierarchical goal system (Complete Minecraft → survive → gather → progress)
  • Decision loop: observe → decide → act → reflect → repeat
  • Short-term + episodic + semantic + world memory (SQLite)
  • Self-evaluation + failure recovery
        │  typed action calls
        ▼
MINECRAFT INTERFACE (mineflayer 4.38.0)
  • mineflayer-pathfinder for navigation
  • Perception: state, entities, blocks, threats
  • Action executor + validator
  • Auto-reconnect with exponential backoff
        │  TCP/protocol
        ▼
Minecraft Server (1.21.x, offline mode)
```

**Key design principles:**
- LLM makes **high-level decisions** — never controls individual ticks
- Every LLM response is **Zod-validated** before any action executes
- Agent **never crashes** from a bad LLM response or action failure
- **Auto-reconnects** after disconnect, **resumes** after death

---

## Goal System

The AI pursues a hierarchical goal tree autonomously:

```
Complete Minecraft
├── Survive (always active)
│   ├── Maintain food
│   ├── Recover health  ← Priority 1
│   └── Handle threats
├── Establish Base
│   ├── Build shelter
│   ├── Create storage
│   └── Set up crafting area
├── Acquire Equipment
│   ├── Wood tools
│   ├── Stone tools
│   ├── Iron equipment
│   └── Diamond equipment
├── Enter the Nether
│   ├── Obtain obsidian
│   ├── Build Nether portal
│   └── Explore Nether
├── Reach the End
│   ├── Obtain Ender Pearls
│   ├── Craft Eyes of Ender
│   └── Locate Stronghold
└── Defeat Ender Dragon
```

Goals are **flexible** — the AI reorders, abandons, creates, and retries goals based on the situation. No rigid script.

---

## Optional Operator Commands

While the bot runs, you can send chat commands from in-game or console:

```
!ai status    — print current status
!ai pause     — pause the decision loop
!ai resume    — resume the decision loop
!ai goal      — show current goal tree
!ai memory    — show memory summary
```

These are optional — the AI runs fine without any commands.

---

## Configuration

All settings are in `.env`. Key options:

| Variable | Default | Description |
|---|---|---|
| `MC_HOST` | `localhost` | Server hostname |
| `MC_PORT` | `25565` | Server port |
| `MC_VERSION` | `1.21.1` | Minecraft version (must match server) |
| `MC_USERNAME` | `AIPlayer` | Bot username |
| `MC_AUTH` | `offline` | `offline` or `microsoft` |
| `LLM_MODEL` | `qwen3:8b` | Ollama model |
| `DECISION_INTERVAL_MS` | `15000` | How often the AI makes decisions (ms) |
| `DEBUG_MODE` | `true` | Show decision reasoning in console |
| `PERSONALITY_CURIOSITY` | `0.7` | 0.0–1.0 personality traits |
| `RECONNECT_ENABLED` | `true` | Auto-reconnect on disconnect |

See `.env.example` for the full list.

---

## Development Phases

| Phase | Status | Description |
|---|---|---|
| 1 | ✅ **Complete** | Connection, state reading, basic actions, heuristic decisions, LLM integration, memory schema, tests |
| 2 | 🔜 TODO | Full pathfinding, mining, crafting, combat, inventory management |
| 3 | 🔜 TODO | Full LLM-driven decisions for every action |
| 4 | 🔜 TODO | Autonomous goal creation and management |
| 5 | 🔜 TODO | Memory queried in every decision loop |
| 6 | 🔜 TODO | Long-term planning with dependency resolution |
| 7 | 🔜 TODO | Self-reflection and strategy adaptation |
| 8 | 🔜 TODO | Real-time web dashboard |
| 9 | 🔜 TODO | Stress testing and loop detection |

---

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

Tests cover: config loading, world state builder, Zod schema validation (all action types), and the goal system.

---

## Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Config loader
├── agent/
│   ├── agent.ts          # Main autonomous loop
│   ├── goals.ts          # Hierarchical goal system
│   ├── decision.ts       # Heuristic decision engine
│   ├── planner.ts        # Plan management (Phase 6)
│   └── reflection.ts     # Self-evaluation (Phase 7)
├── minecraft/
│   ├── client.ts         # Bot + auto-reconnect
│   ├── perception.ts     # World state extraction
│   ├── actions.ts        # Action executor + validator
│   ├── navigation.ts     # Pathfinding (Phase 2)
│   ├── combat.ts         # Combat system (Phase 2)
│   └── inventory.ts      # Inventory mgmt (Phase 2)
├── ai/
│   ├── llm.ts            # LLMProvider interface
│   ├── ollama.ts         # Ollama implementation
│   ├── prompts.ts        # All prompt templates
│   └── schemas.ts        # Zod validation schemas
├── memory/
│   └── memory.ts         # SQLite memory (episodic + semantic + locations)
├── world/
│   └── state.ts          # WorldState type + builder
└── utils/
    └── logger.ts         # Winston logger
```

---

## License

ISC
