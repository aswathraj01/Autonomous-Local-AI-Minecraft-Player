/**
 * src/agent/decision.ts
 * Decision engine — bridges world state, memory, and LLM to select actions.
 *
 * Phase 1: Basic heuristic fallback decisions when LLM is unavailable.
 * Phase 3: Full LLM-driven decisions.
 */

import type { WorldState } from '../world/state';
import type { Action } from '../ai/schemas';
import type { GoalManager } from './goals';
import type { PerceptionSystem } from '../minecraft/perception';
import { logger } from '../utils/logger';

export interface Decision {
  goal: string;
  assessment: string;
  plan: string[];
  action: Action;
  fromLLM: boolean;
}

// ─────────────────────────────────────────────
// Heuristic decision engine (fallback when LLM unavailable)
// ─────────────────────────────────────────────

export class HeuristicDecisionEngine {
  private goals: GoalManager;
  private perception: PerceptionSystem;

  constructor(goals: GoalManager, perception: PerceptionSystem) {
    this.goals = goals;
    this.perception = perception;
  }

  decide(state: WorldState): Decision {
    const { player, currentThreats, inventory, nearbyBlocks } = state;
    const healthPct = player.health / player.maxHealth;
    const foodPct = player.food / 20;
    const hasThreats = currentThreats.some(t => t.dangerLevel === 'high' || t.dangerLevel === 'critical');

    // ── Priority 1: Critical health ──
    if (player.health <= 4) {
      const hasFood = inventory.some(i => this.isFoodItem(i.name));
      if (hasFood) {
        return this.makeDecision(
          'Survive - recover health',
          `Health critically low (${player.health}/20). Must eat immediately.`,
          ['Eat food to restore health', 'Find shelter if threatened'],
          { type: 'eat' },
        );
      }
      // No food — retreat
      return this.makeDecision(
        'Survive - escape danger',
        `Health critically low (${player.health}/20). No food available. Retreating.`,
        ['Move away from danger', 'Find food as soon as possible'],
        { type: 'explore', direction: 'random', distance: 20 },
      );
    }

    // ── Priority 2: Flee from critical threats ──
    const criticalThreat = currentThreats.find(t => t.dangerLevel === 'critical');
    if (criticalThreat && player.health < 10) {
      return this.makeDecision(
        'Survive - flee threat',
        `Critical threat nearby: ${criticalThreat.entityName} (${criticalThreat.distance} blocks). Health low.`,
        ['Run away from threat', 'Recover health before re-engaging'],
        { type: 'explore', direction: 'random', distance: 30 },
      );
    }

    // ── Priority 3: Eat if hungry ──
    if (player.food <= 6) {
      const hasFood = inventory.some(i => this.isFoodItem(i.name));
      if (hasFood) {
        return this.makeDecision(
          'Survive - eat food',
          `Food low (${player.food}/20). Eating.`,
          ['Eat food to restore hunger'],
          { type: 'eat' },
        );
      }
    }

    // ── Priority 4: Mine nearby resources if visible ──
    const nearbyLog = nearbyBlocks.find(b => b.name.includes('_log'));
    if (nearbyLog && !this.hasEnoughWood(inventory) && player.food > 8) {
      return this.makeDecision(
        'Gather wood',
        `Found ${nearbyLog.name} nearby. Need wood for basic tools.`,
        ['Mine the wood log', 'Craft wooden tools'],
        { type: 'mine', blockName: nearbyLog.name, maxDistance: 6, reason: 'Need wood for crafting' },
      );
    }

    const nearbyCoal = nearbyBlocks.find(b => b.name.includes('coal_ore'));
    if (nearbyCoal && this.getItemCount(inventory, 'wooden_pickaxe') > 0) {
      return this.makeDecision(
        'Gather coal',
        `Found coal ore nearby. Coal needed for torches and smelting.`,
        ['Mine coal ore', 'Craft torches'],
        { type: 'mine', blockName: nearbyCoal.name, maxDistance: 6, reason: 'Coal for torches and smelting' },
      );
    }

    const nearbyIron = nearbyBlocks.find(b => b.name.includes('iron_ore'));
    if (nearbyIron && this.getItemCount(inventory, 'stone_pickaxe') > 0) {
      return this.makeDecision(
        'Gather iron ore',
        `Found iron ore nearby. Iron is essential for equipment progression.`,
        ['Mine iron ore', 'Smelt iron ingots', 'Craft iron tools'],
        { type: 'mine', blockName: nearbyIron.name, maxDistance: 6, reason: 'Iron for equipment' },
      );
    }

    // ── Priority 5: Craft basics if we have materials ──
    const hasLogs = this.getItemCount(inventory, 'oak_log') > 0 ||
      inventory.some(i => i.name.includes('_log'));
    const hasPlanks = inventory.some(i => i.name.includes('_planks'));
    const hasWoodenPickaxe = inventory.some(i => i.name === 'wooden_pickaxe');
    const hasSticks = inventory.some(i => i.name === 'stick');
    const hasCraftingTable = inventory.some(i => i.name === 'crafting_table');

    if (hasLogs && !hasPlanks) {
      return this.makeDecision(
        'Process wood into planks',
        'Have logs. Converting to planks.',
        ['Craft planks from logs'],
        { type: 'craft', itemName: 'oak_planks', count: 4, reason: 'Need planks for crafting' },
      );
    }

    if (hasPlanks && !hasSticks) {
      return this.makeDecision(
        'Craft sticks',
        'Have planks. Crafting sticks for tools.',
        ['Craft sticks from planks'],
        { type: 'craft', itemName: 'stick', count: 4, reason: 'Need sticks for tools' },
      );
    }

    if (hasPlanks && !hasCraftingTable) {
      return this.makeDecision(
        'Craft crafting table',
        'Have planks. Crafting a crafting table.',
        ['Craft crafting table to enable advanced recipes'],
        { type: 'craft', itemName: 'crafting_table', count: 1, reason: 'Need crafting table for tools' },
      );
    }

    if (hasPlanks && hasSticks && !hasWoodenPickaxe) {
      return this.makeDecision(
        'Craft wooden pickaxe',
        'Have materials. Crafting wooden pickaxe.',
        ['Craft wooden pickaxe to mine stone and coal'],
        { type: 'craft', itemName: 'wooden_pickaxe', count: 1, reason: 'Need pickaxe to mine' },
      );
    }

    // ── Default: Explore to find resources ──
    return this.makeDecision(
      this.goals.getCurrentGoal()?.name ?? 'Explore',
      'No immediate tasks — exploring to find resources and assess surroundings.',
      ['Explore the area', 'Look for resources', 'Assess the environment'],
      { type: 'explore', direction: 'random', distance: 30 },
    );
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  private makeDecision(goal: string, assessment: string, plan: string[], action: Action): Decision {
    return { goal, assessment, plan, action, fromLLM: false };
  }

  private isFoodItem(name: string): boolean {
    const foods = [
      'cooked_beef', 'cooked_chicken', 'cooked_porkchop', 'bread', 'apple',
      'carrot', 'potato', 'baked_potato', 'cooked_salmon', 'cooked_mutton',
      'melon_slice', 'cookie', 'dried_kelp', 'raw_beef', 'raw_chicken',
      'cooked_rabbit', 'mushroom_stew', 'rabbit_stew', 'pumpkin_pie',
      'golden_apple', 'chorus_fruit', 'honey_bottle',
    ];
    return foods.includes(name);
  }

  private hasEnoughWood(inventory: Array<{ name: string; count: number }>): boolean {
    const woodCount = inventory
      .filter(i => i.name.includes('_log') || i.name.includes('_planks'))
      .reduce((sum, i) => sum + i.count, 0);
    return woodCount >= 16; // Enough for basic crafting needs
  }

  private getItemCount(inventory: Array<{ name: string; count: number }>, itemName: string): number {
    return inventory.filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);
  }
}
