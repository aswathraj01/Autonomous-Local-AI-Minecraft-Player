/**
 * src/minecraft/actions.ts
 * Action executor + validator.
 *
 * The LLM outputs a structured Action object.
 * This module:
 *   1. Validates the action is feasible
 *   2. Executes it via mineflayer
 *   3. Returns a result string
 *
 * Phase 1: navigate, look_at, jump, sprint, sneak, chat, wait, explore implemented.
 * Phase 2: mine, craft, eat, equip, attack, place, sleep, use_item implemented.
 */

import type { Bot } from 'mineflayer';
import type { Action } from '../ai/schemas';
import { logger, logEvent } from '../utils/logger';
import type { PerceptionSystem } from './perception';

export interface ActionResult {
  success: boolean;
  message: string;
  /** Should the agent retry this action? */
  retryable: boolean;
}

// ─────────────────────────────────────────────
// Action executor
// ─────────────────────────────────────────────

export class ActionExecutor {
  private bot: Bot;
  private perception: PerceptionSystem;
  private navigationSystem: NavigationStub;

  constructor(bot: Bot, perception: PerceptionSystem) {
    this.bot = bot;
    this.perception = perception;
    this.navigationSystem = new NavigationStub(bot);
  }

  async execute(action: Action): Promise<ActionResult> {
    logger.info(`[Action] Executing: ${action.type}${(action as any).reason ? ` — ${(action as any).reason}` : ''}`);
    logEvent(`Action: ${action.type}`);

    // Validate before executing
    const validation = this.validate(action);
    if (!validation.valid) {
      logger.warn(`[Action] Validation failed: ${validation.reason}`);
      return {
        success: false,
        message: `Action rejected: ${validation.reason}`,
        retryable: false,
      };
    }

    try {
      switch (action.type) {
        case 'navigate':
          return await this.navigationSystem.navigateTo(action.target);

        case 'look_at':
          return await this.doLookAt(action.target);

        case 'jump':
          return this.doJump();

        case 'sprint':
          return this.doSprint(action.enabled ?? true);

        case 'sneak':
          return this.doSneak(action.enabled ?? true);

        case 'chat':
          return await this.doChat(action.message);

        case 'wait':
          return await this.doWait(action.durationMs ?? 3000);

        case 'explore':
          return await this.doExplore(action.direction ?? 'random', action.distance ?? 50);

        // ── Phase 2 actions (stubs for now) ──

        case 'mine':
          return await this.doMine(action.blockName, action.maxDistance ?? 5);

        case 'eat':
          return await this.doEat(action.itemName);

        case 'equip':
          return await this.doEquip(action.itemName, action.destination ?? 'hand');

        case 'craft':
          return await this.doCraft(action.itemName, action.count ?? 1);

        case 'attack':
          return await this.doAttack(action.entityName);

        case 'place':
          return await this.doPlace(action.itemName, action.target);

        case 'drop':
          return await this.doDrop(action.itemName, action.count);

        case 'use_item':
          return await this.doUseItem(action.itemName);

        case 'sleep':
          return await this.doSleep();

        case 'open_container':
          return await this.doOpenContainer(action.target);

        default:
          return {
            success: false,
            message: `Unknown action type: ${(action as any).type}`,
            retryable: false,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Action] Execution error for ${action.type}: ${message}`);
      return {
        success: false,
        message: `Action failed with error: ${message}`,
        retryable: true,
      };
    }
  }

  // ─────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────

  private validate(action: Action): { valid: boolean; reason?: string } {
    const health = this.bot.health ?? 20;
    const food = this.bot.food ?? 20;

    // Critical survival checks
    if (health < 4 && action.type !== 'eat' && action.type !== 'navigate' && action.type !== 'wait') {
      return { valid: false, reason: 'Health is critically low — must eat or escape first' };
    }

    switch (action.type) {
      case 'eat': {
        if (food >= 18) {
          return { valid: false, reason: 'Food is already full (18+)' };
        }
        if (action.itemName && !this.perception.hasItem(action.itemName)) {
          return { valid: false, reason: `No ${action.itemName} in inventory` };
        }
        break;
      }

      case 'equip': {
        if (!this.perception.hasItem(action.itemName)) {
          return { valid: false, reason: `No ${action.itemName} in inventory` };
        }
        break;
      }

      case 'drop': {
        if (!this.perception.hasItem(action.itemName)) {
          return { valid: false, reason: `No ${action.itemName} in inventory to drop` };
        }
        break;
      }

      case 'mine': {
        if (!action.blockName || action.blockName.trim() === '') {
          return { valid: false, reason: 'Block name is required for mine action' };
        }
        break;
      }

      case 'craft': {
        if (!action.itemName || action.itemName.trim() === '') {
          return { valid: false, reason: 'Item name is required for craft action' };
        }
        break;
      }

      case 'navigate': {
        const { x, y, z } = action.target;
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          return { valid: false, reason: 'Navigate target coordinates must be valid numbers' };
        }
        // Prevent obviously invalid Y values
        if (y < -64 || y > 320) {
          return { valid: false, reason: `Navigate Y=${y} is outside valid world bounds (-64 to 320)` };
        }
        break;
      }

      case 'chat': {
        if (!action.message || action.message.trim() === '') {
          return { valid: false, reason: 'Chat message cannot be empty' };
        }
        break;
      }
    }

    return { valid: true };
  }

  // ─────────────────────────────────────────────
  // Phase 1 action implementations
  // ─────────────────────────────────────────────

  private async doLookAt(target: { x: number; y: number; z: number }): Promise<ActionResult> {
    await this.bot.lookAt({ x: target.x, y: target.y, z: target.z } as any);
    return { success: true, message: `Looked at ${target.x},${target.y},${target.z}`, retryable: false };
  }

  private doJump(): ActionResult {
    this.bot.setControlState('jump', true);
    setTimeout(() => this.bot.setControlState('jump', false), 500);
    return { success: true, message: 'Jumped', retryable: false };
  }

  private doSprint(enabled: boolean): ActionResult {
    this.bot.setControlState('sprint', enabled);
    return { success: true, message: `Sprinting: ${enabled}`, retryable: false };
  }

  private doSneak(enabled: boolean): ActionResult {
    this.bot.setControlState('sneak', enabled);
    return { success: true, message: `Sneaking: ${enabled}`, retryable: false };
  }

  private async doChat(message: string): Promise<ActionResult> {
    this.bot.chat(message);
    logEvent(`Chat: "${message}"`);
    return { success: true, message: `Sent chat: "${message}"`, retryable: false };
  }

  private async doWait(durationMs: number): Promise<ActionResult> {
    await sleep(durationMs);
    return { success: true, message: `Waited ${durationMs}ms`, retryable: false };
  }

  private async doExplore(direction: string, distance: number): Promise<ActionResult> {
    const pos = this.bot.entity?.position;
    if (!pos) return { success: false, message: 'Position unknown', retryable: true };

    let dx = 0, dz = 0;
    switch (direction) {
      case 'north': dz = -distance; break;
      case 'south': dz = distance; break;
      case 'east': dx = distance; break;
      case 'west': dx = -distance; break;
      case 'random':
      default: {
        const angle = Math.random() * Math.PI * 2;
        dx = Math.round(Math.cos(angle) * distance);
        dz = Math.round(Math.sin(angle) * distance);
      }
    }

    const target = { x: Math.round(pos.x + dx), y: Math.round(pos.y), z: Math.round(pos.z + dz) };
    logEvent(`Exploring ${direction} to ${target.x},${target.y},${target.z}`);
    return await this.navigationSystem.navigateTo(target);
  }

  // ─────────────────────────────────────────────
  // Phase 2 action stubs
  // ─────────────────────────────────────────────

  private async doMine(blockName: string, maxDistance: number): Promise<ActionResult> {
    // TODO Phase 2: Find nearest block of this type and mine it
    // Requires mineflayer-pathfinder and bot.dig()
    try {
      const block = this.bot.findBlock({
        matching: (b) => b.name === blockName,
        maxDistance,
      });

      if (!block) {
        return { success: false, message: `No ${blockName} found within ${maxDistance} blocks`, retryable: false };
      }

      await this.bot.dig(block);
      logEvent(`Mined ${blockName}`);
      return { success: true, message: `Mined ${blockName} at ${block.position}`, retryable: false };
    } catch (err) {
      return { success: false, message: `Mining ${blockName} failed: ${err}`, retryable: true };
    }
  }

  private async doEat(itemName?: string): Promise<ActionResult> {
    // TODO Phase 2: Full inventory search + best food selection
    try {
      const foods = ['cooked_beef', 'cooked_chicken', 'cooked_porkchop', 'bread', 'apple',
        'carrot', 'potato', 'baked_potato', 'cooked_salmon', 'cooked_mutton',
        'melon_slice', 'cookie', 'dried_kelp', 'raw_beef', 'raw_chicken'];

      const targetFood = itemName
        ? this.bot.inventory.items().find(i => i && i.name === itemName)
        : this.bot.inventory.items().find(i => i && foods.includes(i.name));

      if (!targetFood) {
        return { success: false, message: 'No food found in inventory', retryable: false };
      }

      await this.bot.equip(targetFood, 'hand');
      await this.bot.consume();
      logEvent(`Ate ${targetFood.name}`);
      return { success: true, message: `Ate ${targetFood.name}`, retryable: false };
    } catch (err) {
      return { success: false, message: `Eating failed: ${err}`, retryable: true };
    }
  }

  private async doEquip(itemName: string, destination: string): Promise<ActionResult> {
    try {
      const item = this.bot.inventory.items().find(i => i && i.name === itemName);
      if (!item) return { success: false, message: `${itemName} not in inventory`, retryable: false };

      const dest = destination as 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet';
      await this.bot.equip(item, dest);
      logEvent(`Equipped ${itemName}`);
      return { success: true, message: `Equipped ${itemName} to ${destination}`, retryable: false };
    } catch (err) {
      return { success: false, message: `Equip failed: ${err}`, retryable: true };
    }
  }

  private async doCraft(itemName: string, count: number): Promise<ActionResult> {
    // TODO Phase 2: Full recipe lookup + crafting table detection
    try {
      const recipes = this.bot.recipesFor(
        this.bot.registry?.itemsByName?.[itemName]?.id ?? -1,
        null,
        1,
        null,
      );

      if (!recipes || recipes.length === 0) {
        return { success: false, message: `No recipe found for ${itemName}`, retryable: false };
      }

      await this.bot.craft(recipes[0]!, count, undefined);
      logEvent(`Crafted ${count}x ${itemName}`);
      return { success: true, message: `Crafted ${count}x ${itemName}`, retryable: false };
    } catch (err) {
      return { success: false, message: `Crafting ${itemName} failed: ${err}`, retryable: true };
    }
  }

  private async doAttack(entityName: string): Promise<ActionResult> {
    // TODO Phase 2: Full combat system with approach + shield + retreat logic
    try {
      const entity = Object.values(this.bot.entities).find(
        e => e && (e.name ?? e.username ?? '').toLowerCase().includes(entityName.toLowerCase()),
      );

      if (!entity) {
        return { success: false, message: `No entity "${entityName}" found nearby`, retryable: false };
      }

      await this.bot.attack(entity);
      logEvent(`Attacked ${entityName}`);
      return { success: true, message: `Attacked ${entityName}`, retryable: true };
    } catch (err) {
      return { success: false, message: `Attack failed: ${err}`, retryable: true };
    }
  }

  private async doPlace(itemName: string, target: { x: number; y: number; z: number }): Promise<ActionResult> {
    // TODO Phase 2: Proper face detection + placement
    try {
      const item = this.bot.inventory.items().find(i => i && i.name === itemName);
      if (!item) return { success: false, message: `${itemName} not in inventory`, retryable: false };

      await this.bot.equip(item, 'hand');
      const refBlock = this.bot.blockAt({ x: target.x, y: target.y - 1, z: target.z } as any);
      if (!refBlock) return { success: false, message: 'No reference block for placement', retryable: false };

      await this.bot.placeBlock(refBlock, { x: 0, y: 1, z: 0 } as any);
      logEvent(`Placed ${itemName}`);
      return { success: true, message: `Placed ${itemName} at ${target.x},${target.y},${target.z}`, retryable: false };
    } catch (err) {
      return { success: false, message: `Place failed: ${err}`, retryable: true };
    }
  }

  private async doDrop(itemName: string, count?: number): Promise<ActionResult> {
    try {
      const items = this.bot.inventory.items().filter(i => i && i.name === itemName);
      if (items.length === 0) return { success: false, message: `${itemName} not in inventory`, retryable: false };

      const item = items[0]!;
      const dropCount = count ?? item.count;
      await this.bot.toss(item.type, null, dropCount);
      logEvent(`Dropped ${dropCount}x ${itemName}`);
      return { success: true, message: `Dropped ${dropCount}x ${itemName}`, retryable: false };
    } catch (err) {
      return { success: false, message: `Drop failed: ${err}`, retryable: true };
    }
  }

  private async doUseItem(itemName?: string): Promise<ActionResult> {
    try {
      if (itemName) {
        const item = this.bot.inventory.items().find(i => i && i.name === itemName);
        if (!item) return { success: false, message: `${itemName} not in inventory`, retryable: false };
        await this.bot.equip(item, 'hand');
      }
      this.bot.activateItem();
      return { success: true, message: `Used item${itemName ? ` (${itemName})` : ''}`, retryable: false };
    } catch (err) {
      return { success: false, message: `Use item failed: ${err}`, retryable: true };
    }
  }

  private async doSleep(): Promise<ActionResult> {
    // TODO Phase 2: Find nearest bed block and sleep in it
    try {
      const bed = this.bot.findBlock({
        matching: (b) => b.name.includes('_bed'),
        maxDistance: 10,
      });
      if (!bed) return { success: false, message: 'No bed found nearby (within 10 blocks)', retryable: false };

      await this.bot.sleep(bed);
      logEvent('Slept in bed');
      return { success: true, message: 'Slept in bed', retryable: false };
    } catch (err) {
      return { success: false, message: `Sleep failed: ${err}`, retryable: true };
    }
  }

  private async doOpenContainer(target: { x: number; y: number; z: number }): Promise<ActionResult> {
    try {
      const block = this.bot.blockAt({ x: target.x, y: target.y, z: target.z } as any);
      if (!block) return { success: false, message: 'No block at target position', retryable: false };

      await this.bot.openContainer(block);
      return { success: true, message: `Opened container at ${target.x},${target.y},${target.z}`, retryable: false };
    } catch (err) {
      return { success: false, message: `Open container failed: ${err}`, retryable: true };
    }
  }
}

// ─────────────────────────────────────────────
// Navigation stub (Phase 1 — basic; Phase 2 uses pathfinder)
// ─────────────────────────────────────────────

class NavigationStub {
  private bot: Bot;

  constructor(bot: Bot) {
    this.bot = bot;
  }

  async navigateTo(target: { x: number; y: number; z: number }): Promise<ActionResult> {
    // Phase 1: Basic movement toward target using direct control
    // Phase 2: Replace with mineflayer-pathfinder for full A* navigation
    try {
      const STEP_INTERVAL = 100; // ms
      const MAX_STEPS = 300;     // ~30 seconds max
      const CLOSE_ENOUGH = 2;    // blocks

      logger.debug(`[Nav] Navigating to ${target.x},${target.y},${target.z}`);

      // Check if pathfinder plugin is loaded (Phase 2)
      const pathfinder = (this.bot as any).pathfinder;
      if (pathfinder && pathfinder.goto) {
        try {
          const { goals } = require('mineflayer-pathfinder');
          const goal = new goals.GoalNear(target.x, target.y, target.z, CLOSE_ENOUGH);
          await pathfinder.goto(goal);
          logEvent(`Navigated to ${Math.round(target.x)},${Math.round(target.y)},${Math.round(target.z)}`);
          return { success: true, message: `Navigated to target`, retryable: false };
        } catch (err) {
          logger.warn(`[Nav] Pathfinder navigation failed: ${err}. Falling back to basic movement.`);
        }
      }

      // Basic movement: look toward target and walk
      for (let step = 0; step < MAX_STEPS; step++) {
        const pos = this.bot.entity?.position;
        if (!pos) break;

        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < CLOSE_ENOUGH) {
          this.bot.setControlState('forward', false);
          this.bot.setControlState('sprint', false);
          return { success: true, message: `Reached target (${Math.round(dist)} blocks)`, retryable: false };
        }

        // Look toward target
        const yaw = Math.atan2(-dx, -dz);
        await this.bot.look(yaw, 0, true);

        this.bot.setControlState('forward', true);
        this.bot.setControlState('sprint', dist > 5);

        // Auto-jump for obstacles
        if (step % 10 === 0) {
          this.bot.setControlState('jump', true);
          setTimeout(() => this.bot.setControlState('jump', false), 300);
        }

        await sleep(STEP_INTERVAL);
      }

      this.bot.setControlState('forward', false);
      this.bot.setControlState('sprint', false);

      const finalPos = this.bot.entity?.position;
      if (finalPos) {
        const dx = target.x - finalPos.x;
        const dz = target.z - finalPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < CLOSE_ENOUGH * 3) {
          return { success: true, message: `Approximately reached target (${Math.round(dist)} blocks away)`, retryable: false };
        }
        return { success: false, message: `Navigation timeout — ${Math.round(dist)} blocks from target`, retryable: true };
      }

      return { success: false, message: 'Navigation failed — position unknown', retryable: true };
    } catch (err) {
      this.bot.setControlState('forward', false);
      this.bot.setControlState('sprint', false);
      return { success: false, message: `Navigation error: ${err}`, retryable: true };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
