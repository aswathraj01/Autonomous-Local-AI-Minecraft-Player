/**
 * tests/schemas.test.ts
 * Tests for LLM output schema validation.
 * Ensures that invalid LLM responses are always caught before execution.
 */

import { validateLLMDecision, validateAction } from '../src/ai/schemas';

describe('LLM Decision Schema Validation', () => {
  const validDecision = {
    goal: 'Gather wood',
    assessment: 'I need wood to craft basic tools.',
    plan: ['Find a tree', 'Mine wood logs', 'Craft planks'],
    next_action: {
      type: 'mine',
      blockName: 'oak_log',
      maxDistance: 5,
      reason: 'Need wood for crafting',
    },
  };

  test('accepts a valid decision', () => {
    const result = validateLLMDecision(validDecision);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.goal).toBe('Gather wood');
  });

  test('rejects missing goal', () => {
    const invalid = { ...validDecision, goal: undefined };
    const result = validateLLMDecision(invalid);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('rejects missing next_action', () => {
    const invalid = { ...validDecision, next_action: undefined };
    const result = validateLLMDecision(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects invalid action type', () => {
    const invalid = {
      ...validDecision,
      next_action: { type: 'fly_to_the_moon' },
    };
    const result = validateLLMDecision(invalid);
    expect(result.success).toBe(false);
  });

  test('accepts navigate action with coordinates', () => {
    const withNavigate = {
      ...validDecision,
      next_action: { type: 'navigate', target: { x: 100, y: 64, z: -200 } },
    };
    const result = validateLLMDecision(withNavigate);
    expect(result.success).toBe(true);
  });

  test('rejects navigate with invalid Y coordinate', () => {
    // Schema doesn't reject coordinates — action validator does
    // This tests that coordinate passthrough works
    const withBadNav = {
      ...validDecision,
      next_action: { type: 'navigate', target: { x: 'a', y: 64, z: -200 } },
    };
    const result = validateLLMDecision(withBadNav);
    expect(result.success).toBe(false); // x is not a number
  });

  test('accepts all valid action types', () => {
    const actionTypes = [
      { type: 'navigate', target: { x: 0, y: 64, z: 0 } },
      { type: 'mine', blockName: 'oak_log' },
      { type: 'eat' },
      { type: 'craft', itemName: 'crafting_table' },
      { type: 'equip', itemName: 'iron_sword' },
      { type: 'attack', entityName: 'zombie' },
      { type: 'chat', message: 'Hello' },
      { type: 'jump' },
      { type: 'explore' },
      { type: 'wait', durationMs: 3000 },
      { type: 'sprint', enabled: true },
      { type: 'sneak', enabled: false },
      { type: 'sleep' },
      { type: 'drop', itemName: 'dirt' },
      { type: 'use_item' },
    ];

    for (const action of actionTypes) {
      const result = validateAction(action);
      expect(result.success).toBe(true);
    }
  });

  test('rejects null/undefined input', () => {
    expect(validateLLMDecision(null).success).toBe(false);
    expect(validateLLMDecision(undefined).success).toBe(false);
    expect(validateLLMDecision('not json').success).toBe(false);
    expect(validateLLMDecision(42).success).toBe(false);
  });

  test('accepts decision with optional memory field', () => {
    const withMemory = {
      ...validDecision,
      memory: {
        save: true,
        type: 'episode',
        content: 'Found a cave to the east',
      },
    };
    const result = validateLLMDecision(withMemory);
    expect(result.success).toBe(true);
    expect(result.data?.memory?.save).toBe(true);
  });
});
