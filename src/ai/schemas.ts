/**
 * src/ai/schemas.ts
 * Zod schemas for validating all LLM outputs before execution.
 * The LLM NEVER executes arbitrary code — it emits structured JSON
 * that is validated here before anything happens.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────
// Position schema
// ─────────────────────────────────────────────

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

// ─────────────────────────────────────────────
// Individual action schemas
// ─────────────────────────────────────────────

export const NavigateActionSchema = z.object({
  type: z.literal('navigate'),
  target: PositionSchema,
  reason: z.string().optional(),
});

export const LookAtActionSchema = z.object({
  type: z.literal('look_at'),
  target: PositionSchema,
  reason: z.string().optional(),
});

export const MineActionSchema = z.object({
  type: z.literal('mine'),
  blockName: z.string(),
  maxDistance: z.number().min(1).max(10).optional().default(5),
  reason: z.string().optional(),
});

export const PlaceActionSchema = z.object({
  type: z.literal('place'),
  itemName: z.string(),
  target: PositionSchema,
  reason: z.string().optional(),
});

export const AttackActionSchema = z.object({
  type: z.literal('attack'),
  entityName: z.string(),
  reason: z.string().optional(),
});

export const EatActionSchema = z.object({
  type: z.literal('eat'),
  itemName: z.string().optional(), // If omitted, auto-select best food
  reason: z.string().optional(),
});

export const CraftActionSchema = z.object({
  type: z.literal('craft'),
  itemName: z.string(),
  count: z.number().min(1).max(64).optional().default(1),
  reason: z.string().optional(),
});

export const EquipActionSchema = z.object({
  type: z.literal('equip'),
  itemName: z.string(),
  destination: z.enum(['hand', 'off-hand', 'head', 'torso', 'legs', 'feet']).optional().default('hand'),
  reason: z.string().optional(),
});

export const DropActionSchema = z.object({
  type: z.literal('drop'),
  itemName: z.string(),
  count: z.number().min(1).max(64).optional(),
  reason: z.string().optional(),
});

export const ChatActionSchema = z.object({
  type: z.literal('chat'),
  message: z.string().max(256),
  reason: z.string().optional(),
});

export const JumpActionSchema = z.object({
  type: z.literal('jump'),
  reason: z.string().optional(),
});

export const SprintActionSchema = z.object({
  type: z.literal('sprint'),
  enabled: z.boolean().optional().default(true),
  reason: z.string().optional(),
});

export const SneakActionSchema = z.object({
  type: z.literal('sneak'),
  enabled: z.boolean().optional().default(true),
  reason: z.string().optional(),
});

export const SleepActionSchema = z.object({
  type: z.literal('sleep'),
  reason: z.string().optional(),
});

export const OpenContainerActionSchema = z.object({
  type: z.literal('open_container'),
  target: PositionSchema,
  reason: z.string().optional(),
});

export const UseItemActionSchema = z.object({
  type: z.literal('use_item'),
  itemName: z.string().optional(),
  reason: z.string().optional(),
});

export const WaitActionSchema = z.object({
  type: z.literal('wait'),
  durationMs: z.number().min(500).max(30000).optional().default(3000),
  reason: z.string().optional(),
});

export const ExploreActionSchema = z.object({
  type: z.literal('explore'),
  direction: z.enum(['north', 'south', 'east', 'west', 'random']).optional().default('random'),
  distance: z.number().min(10).max(200).optional().default(50),
  reason: z.string().optional(),
});

// ─────────────────────────────────────────────
// Union of all valid actions
// ─────────────────────────────────────────────

export const ActionSchema = z.discriminatedUnion('type', [
  NavigateActionSchema,
  LookAtActionSchema,
  MineActionSchema,
  PlaceActionSchema,
  AttackActionSchema,
  EatActionSchema,
  CraftActionSchema,
  EquipActionSchema,
  DropActionSchema,
  ChatActionSchema,
  JumpActionSchema,
  SprintActionSchema,
  SneakActionSchema,
  SleepActionSchema,
  OpenContainerActionSchema,
  UseItemActionSchema,
  WaitActionSchema,
  ExploreActionSchema,
]);

export type Action = z.infer<typeof ActionSchema>;

// ─────────────────────────────────────────────
// LLM decision response schema
// ─────────────────────────────────────────────

export const MemorySaveSchema = z.object({
  save: z.boolean(),
  type: z.enum(['episode', 'semantic', 'location']).optional(),
  content: z.string().optional(),
  location: PositionSchema.optional(),
  locationName: z.string().optional(),
});

export const LLMDecisionSchema = z.object({
  /** The current active goal */
  goal: z.string().max(200),

  /** Brief assessment of the current situation */
  assessment: z.string().max(500),

  /** Ordered plan for achieving the goal */
  plan: z.array(z.string().max(200)).max(10),

  /** The single next action to execute */
  next_action: ActionSchema,

  /** Whether to update memory */
  memory: MemorySaveSchema.optional(),

  /** Optional self-evaluation */
  reflection: z.string().max(500).optional(),
});

export type LLMDecision = z.infer<typeof LLMDecisionSchema>;

// ─────────────────────────────────────────────
// Validation helper
// ─────────────────────────────────────────────

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function validateLLMDecision(raw: unknown): ValidationResult<LLMDecision> {
  const result = LLMDecisionSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
  return { success: false, error: `Schema validation failed: ${issues}` };
}

export function validateAction(raw: unknown): ValidationResult<Action> {
  const result = ActionSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
  return { success: false, error: `Action validation failed: ${issues}` };
}
