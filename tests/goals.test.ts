/**
 * tests/goals.test.ts
 * Tests for the hierarchical goal system.
 */

import { GoalManager, createDefaultGoalTree } from '../src/agent/goals';

describe('Goal System', () => {
  let manager: GoalManager;

  beforeEach(() => {
    manager = new GoalManager();
  });

  test('creates default goal tree with root goal', () => {
    const root = manager.getRootGoal();
    expect(root.id).toBe('root');
    expect(root.name).toBe('Complete Minecraft');
    expect(root.children.length).toBeGreaterThan(0);
  });

  test('can find goals by id', () => {
    expect(manager.getGoal('survive')).not.toBeNull();
    expect(manager.getGoal('nether')).not.toBeNull();
    expect(manager.getGoal('dragon')).not.toBeNull();
    expect(manager.getGoal('nonexistent')).toBeNull();
  });

  test('has initial active goals', () => {
    const active = manager.getAllActiveGoals();
    expect(active.length).toBeGreaterThan(0);
    const activeIds = active.map(g => g.id);
    expect(activeIds).toContain('survive');
  });

  test('can set current goal', () => {
    expect(manager.setCurrentGoal('nether')).toBe(true);
    expect(manager.getCurrentGoal()?.id).toBe('nether');
  });

  test('returns false for non-existent goal', () => {
    expect(manager.setCurrentGoal('does_not_exist')).toBe(false);
  });

  test('tracks failures and marks goal as failed after max retries', () => {
    const goal = manager.getGoal('survive.food');
    expect(goal).not.toBeNull();

    // Exceed max retries
    for (let i = 0; i < (goal?.maxRetries ?? 5) + 1; i++) {
      manager.recordFailure('survive.food', 'test failure');
    }

    expect(manager.getGoal('survive.food')?.status).toBe('failed');
  });

  test('can add dynamic goals', () => {
    const added = manager.addDynamicGoal(
      'base',
      'base.custom_farm',
      'Build wheat farm',
      'Plant wheat seeds near water',
      'normal',
    );
    expect(added).toBe(true);
    expect(manager.getGoal('base.custom_farm')).not.toBeNull();
  });

  test('evaluates critical health as survival priority', () => {
    const goalId = manager.evaluateCurrentGoal(0.1, 0.8, false);
    expect(goalId).toBe('survive.health');
  });

  test('evaluates low food as food priority', () => {
    const goalId = manager.evaluateCurrentGoal(1.0, 0.2, false);
    expect(goalId).toBe('survive.food');
  });

  test('toCompact returns serializable object', () => {
    const compact = manager.toCompact();
    expect(typeof compact).toBe('object');
    expect(compact).toHaveProperty('mainGoal');
    expect(compact).toHaveProperty('currentObjective');
    expect(compact).toHaveProperty('activeGoals');
    expect(typeof JSON.stringify(compact)).toBe('string');
  });

  test('goal tree contains all Minecraft progression stages', () => {
    const required = ['root', 'survive', 'base', 'equipment', 'nether', 'endgame', 'dragon'];
    for (const id of required) {
      expect(manager.getGoal(id)).not.toBeNull();
    }
  });
});
