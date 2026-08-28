/**
 * src/ai/prompts.ts
 * All prompt templates for LLM interactions.
 * Prompts are kept here to make them easy to iterate on without
 * touching agent logic.
 */

import type { WorldState } from '../world/state';
import { toCompactState } from '../world/state';
import type { PersonalityConfig } from '../config';
import type { MemoryContext } from '../memory/memory';

// ─────────────────────────────────────────────
// System prompt (sent once at session start)
// ─────────────────────────────────────────────

export function buildSystemPrompt(personality: PersonalityConfig): string {
  return `You are an autonomous Minecraft player AI. Your ultimate objective is to complete Minecraft by surviving, gathering resources, progressing through the technology tree, entering the Nether, obtaining Blaze Rods and Ender Pearls, locating the Stronghold, activating the End Portal, and defeating the Ender Dragon.

You operate independently. No human will give you commands during normal operation.

PERSONALITY TRAITS (0.0–1.0):
- Curiosity: ${personality.curiosity} — tendency to explore and investigate
- Caution: ${personality.caution} — preference for safe approaches
- Risk tolerance: ${personality.riskTolerance} — willingness to take risks
- Exploration: ${personality.exploration} — drive to discover new areas
- Building: ${personality.building} — motivation to build and organize
- Combat aggression: ${personality.combatAggression} — tendency to engage vs. retreat
- Resource conservation: ${personality.resourceConservation} — care about wasting items

DECISION RULES:
1. SURVIVAL ALWAYS COMES FIRST. If health < 6 or food < 4, prioritize immediate survival.
2. Avoid actions that will almost certainly cause death.
3. Do not repeat the same failed action more than 2 times in a row.
4. Night is dangerous — seek shelter or sleep if you have a bed.
5. Reason about resource dependencies before starting complex tasks.
6. Your plan should be flexible — adapt as the world state changes.

OUTPUT FORMAT:
You MUST respond with valid JSON matching this exact structure:
{
  "goal": "string — current active goal",
  "assessment": "string — brief situational analysis",
  "plan": ["step 1", "step 2", ...],
  "next_action": {
    "type": "one of the valid action types",
    ... action-specific fields ...
  },
  "memory": {
    "save": true/false,
    "type": "episode|semantic|location",
    "content": "what to remember",
    "location": {"x": 0, "y": 0, "z": 0},
    "locationName": "Base / Village / etc"
  },
  "reflection": "optional self-evaluation"
}

VALID ACTION TYPES:
- navigate: {"type":"navigate","target":{"x":0,"y":64,"z":0}}
- mine: {"type":"mine","blockName":"oak_log"}
- craft: {"type":"craft","itemName":"crafting_table"}
- eat: {"type":"eat","itemName":"bread"}
- equip: {"type":"equip","itemName":"iron_sword","destination":"hand"}
- attack: {"type":"attack","entityName":"zombie"}
- explore: {"type":"explore","direction":"north","distance":50}
- chat: {"type":"chat","message":"Hello!"}
- jump: {"type":"jump"}
- sprint: {"type":"sprint","enabled":true}
- sneak: {"type":"sneak","enabled":true}
- sleep: {"type":"sleep"}
- place: {"type":"place","itemName":"torch","target":{"x":0,"y":64,"z":0}}
- drop: {"type":"drop","itemName":"dirt","count":64}
- use_item: {"type":"use_item","itemName":"flint_and_steel"}
- wait: {"type":"wait","durationMs":3000}

CRITICAL: Output ONLY the JSON object. No markdown fences, no explanation text. Pure JSON.`;
}

// ─────────────────────────────────────────────
// Decision prompt (sent each decision cycle)
// ─────────────────────────────────────────────

export function buildDecisionPrompt(
  state: WorldState,
  memory: MemoryContext,
  recentEvents: string[],
  lastActionResult: string | null,
): string {
  const compactState = toCompactState(state);

  const memorySections: string[] = [];

  if (memory.recentEpisodes.length > 0) {
    memorySections.push(
      `RECENT EXPERIENCES:\n${memory.recentEpisodes.slice(0, 5).map(e => `- ${e}`).join('\n')}`,
    );
  }

  if (memory.relevantFacts.length > 0) {
    memorySections.push(
      `KNOWN FACTS:\n${memory.relevantFacts.slice(0, 8).map(f => `- ${f}`).join('\n')}`,
    );
  }

  if (memory.knownLocations.length > 0) {
    memorySections.push(
      `KNOWN LOCATIONS:\n${memory.knownLocations.slice(0, 5).map(l => `- ${l.name}: x=${l.x} y=${l.y} z=${l.z}`).join('\n')}`,
    );
  }

  const memoryText = memorySections.length > 0
    ? memorySections.join('\n\n')
    : 'No memory yet.';

  const eventsText = recentEvents.length > 0
    ? `RECENT EVENTS:\n${recentEvents.slice(-8).map(e => `- ${e}`).join('\n')}`
    : 'No recent events.';

  const lastResultText = lastActionResult
    ? `LAST ACTION RESULT: ${lastActionResult}`
    : 'No previous action.';

  return `WORLD STATE:
${JSON.stringify(compactState, null, 2)}

${eventsText}

${lastResultText}

${memoryText}

Based on the above, decide your next action. Output only valid JSON.`;
}

// ─────────────────────────────────────────────
// Reflection prompt (used selectively after important events)
// ─────────────────────────────────────────────

export function buildReflectionPrompt(
  event: string,
  outcome: string,
  previousGoal: string,
  currentState: WorldState,
): string {
  const pos = currentState.player.position;
  return `REFLECTION REQUEST

Event: ${event}
Outcome: ${outcome}
Previous goal: ${previousGoal}
Current position: x=${Math.round(pos.x)} y=${Math.round(pos.y)} z=${Math.round(pos.z)}
Current health: ${currentState.player.health}/20
Current food: ${currentState.player.food}/20

Briefly reflect on:
1. What happened and why?
2. What did you learn?
3. Should you change your plan?
4. Is there anything worth remembering?

Output JSON:
{
  "what_happened": "...",
  "lesson_learned": "...",
  "plan_change": "...",
  "memory_to_save": "... or null"
}`;
}

// ─────────────────────────────────────────────
// Recovery prompt (used after death)
// ─────────────────────────────────────────────

export function buildDeathRecoveryPrompt(
  deathCause: string,
  deathPosition: { x: number; y: number; z: number },
  respawnPosition: { x: number; y: number; z: number },
  lostItems: string[],
): string {
  const lostText = lostItems.length > 0
    ? lostItems.join(', ')
    : 'Unknown (inventory data unavailable)';

  return `DEATH AND RESPAWN

You died. Cause: ${deathCause}
Death position: x=${Math.round(deathPosition.x)} y=${Math.round(deathPosition.y)} z=${Math.round(deathPosition.z)}
Respawn position: x=${Math.round(respawnPosition.x)} y=${Math.round(respawnPosition.y)} z=${Math.round(respawnPosition.z)}
Lost items: ${lostText}

Create a recovery plan. Output JSON:
{
  "cause_analysis": "why did this happen?",
  "lesson": "what to do differently next time?",
  "recovery_priority": "what is most urgent right now?",
  "recovery_plan": ["step 1", "step 2", ...],
  "next_action": { ... }
}`;
}
