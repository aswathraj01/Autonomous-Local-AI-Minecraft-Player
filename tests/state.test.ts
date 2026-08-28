/**
 * tests/state.test.ts
 * Tests for world state builder and helpers.
 */

import {
  createEmptyState,
  buildStateSummary,
  toCompactState,
  classifyEntityType,
  classifyThreatDanger,
} from '../src/world/state';

describe('WorldState', () => {
  test('createEmptyState returns valid structure', () => {
    const state = createEmptyState();
    expect(state.player.health).toBe(20);
    expect(state.player.food).toBe(20);
    expect(state.player.dimension).toBe('overworld');
    expect(Array.isArray(state.inventory)).toBe(true);
    expect(Array.isArray(state.nearbyBlocks)).toBe(true);
    expect(Array.isArray(state.nearbyEntities)).toBe(true);
    expect(Array.isArray(state.currentThreats)).toBe(true);
  });

  test('buildStateSummary returns a non-empty string', () => {
    const state = createEmptyState();
    const summary = buildStateSummary(state);
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain('Health');
    expect(summary).toContain('Food');
  });

  test('toCompactState has all required fields', () => {
    const state = createEmptyState();
    const compact = toCompactState(state);
    expect(compact).toHaveProperty('player');
    expect(compact).toHaveProperty('inventory');
    expect(compact).toHaveProperty('equipment');
    expect(compact).toHaveProperty('nearbyBlocks');
    expect(compact).toHaveProperty('nearbyEntities');
    expect(compact).toHaveProperty('threats');
    expect(compact).toHaveProperty('time');
    expect(compact).toHaveProperty('goals');
  });

  test('toCompactState rounds coordinates', () => {
    const state = createEmptyState();
    state.player.position = { x: 100.7, y: 64.2, z: -230.9 };
    const compact = toCompactState(state) as any;
    expect(compact.player.position.x).toBe(101);
    expect(compact.player.position.y).toBe(64);
    expect(compact.player.position.z).toBe(-231);
  });
});

describe('Entity Classification', () => {
  test('classifies hostile mobs correctly', () => {
    expect(classifyEntityType('zombie')).toBe('hostile');
    expect(classifyEntityType('skeleton')).toBe('hostile');
    expect(classifyEntityType('creeper')).toBe('hostile');
    expect(classifyEntityType('blaze')).toBe('hostile');
    expect(classifyEntityType('warden')).toBe('hostile');
  });

  test('classifies passive mobs correctly', () => {
    expect(classifyEntityType('cow')).toBe('passive');
    expect(classifyEntityType('pig')).toBe('passive');
    expect(classifyEntityType('chicken')).toBe('passive');
    expect(classifyEntityType('villager')).toBe('passive');
  });

  test('classifies neutral mobs correctly', () => {
    expect(classifyEntityType('wolf')).toBe('neutral');
    expect(classifyEntityType('piglin')).toBe('neutral');
  });

  test('classifies unknown entities as other', () => {
    expect(classifyEntityType('some_unknown_thing')).toBe('other');
  });
});

describe('Threat Classification', () => {
  test('critical threat at close range', () => {
    expect(classifyThreatDanger('creeper', 2)).toBe('critical');
    expect(classifyThreatDanger('zombie', 3)).toBe('critical');
  });

  test('danger increases with proximity', () => {
    const far = classifyThreatDanger('skeleton', 15);
    const close = classifyThreatDanger('skeleton', 5);
    const levels: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    expect(levels[close]!).toBeGreaterThanOrEqual(levels[far]!);
  });
});
