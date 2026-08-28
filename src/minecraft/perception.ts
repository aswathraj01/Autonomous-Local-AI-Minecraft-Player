/**
 * src/minecraft/perception.ts
 * Extracts a structured WorldState from the mineflayer bot.
 * This is the bridge between raw Minecraft data and the agent's understanding.
 */

import type { Bot } from 'mineflayer';
import type {
  WorldState,
  PlayerState,
  InventoryItem,
  Equipment,
  NearbyBlock,
  NearbyEntity,
  ThreatInfo,
} from '../world/state';
import {
  classifyEntityType,
  classifyThreatDanger,
  buildStateSummary,
  createEmptyState,
} from '../world/state';
import { logger } from '../utils/logger';
import type { GoalState } from '../world/state';

// How many blocks around the player to scan for nearby blocks
const BLOCK_SCAN_RADIUS = 6;
// Maximum distance for nearby entities
const ENTITY_SCAN_RADIUS = 20;
// Blocks considered "interesting" enough to report
const INTERESTING_BLOCKS = new Set([
  // Resources
  'coal_ore', 'deepslate_coal_ore',
  'iron_ore', 'deepslate_iron_ore',
  'gold_ore', 'deepslate_gold_ore',
  'diamond_ore', 'deepslate_diamond_ore',
  'emerald_ore', 'deepslate_emerald_ore',
  'lapis_ore', 'deepslate_lapis_ore',
  'redstone_ore', 'deepslate_redstone_ore',
  'copper_ore', 'deepslate_copper_ore',
  // Wood & nature
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'cherry_log', 'mangrove_log',
  // Useful blocks
  'crafting_table', 'furnace', 'chest', 'smoker', 'blast_furnace',
  'bed', 'bookshelf', 'enchanting_table', 'anvil',
  // Nether
  'nether_portal', 'nether_fortress', 'bastion_remnant',
  'ancient_debris', 'nether_gold_ore',
  // Structures
  'chest', 'spawner',
  // Hazards
  'lava', 'fire', 'magma_block',
  // Food sources nearby
  'wheat', 'carrot', 'potato', 'beetroot', 'sugar_cane',
]);

export class PerceptionSystem {
  private bot: Bot;
  private lastGoalState: GoalState = {
    mainGoal: 'Complete Minecraft',
    currentObjective: 'Initializing',
    currentPlan: [],
    currentAction: 'Starting up',
  };

  constructor(bot: Bot) {
    this.bot = bot;
  }

  /** Update the goal state that gets included in world state */
  setGoalState(goals: GoalState): void {
    this.lastGoalState = goals;
  }

  /** Extract the full world state from the current bot state */
  extractWorldState(): WorldState {
    try {
      const player = this.extractPlayerState();
      const inventory = this.extractInventory();
      const equipment = this.extractEquipment();
      const nearbyBlocks = this.extractNearbyBlocks();
      const nearbyEntities = this.extractNearbyEntities();
      const currentThreats = this.extractThreats(nearbyEntities);
      const { time, isDay } = this.extractTime();
      const weather = this.extractWeather();

      const state: WorldState = {
        timestamp: Date.now(),
        player,
        inventory,
        equipment,
        nearbyBlocks,
        nearbyEntities,
        currentThreats,
        time,
        isDay,
        weather,
        goals: this.lastGoalState,
        summary: '',
      };

      state.summary = buildStateSummary(state);
      return state;

    } catch (err) {
      logger.error(`[Perception] Error extracting world state: ${err}`);
      return createEmptyState();
    }
  }

  // ─────────────────────────────────────────────
  // Player state
  // ─────────────────────────────────────────────

  private extractPlayerState(): PlayerState {
    const bot = this.bot;
    const entity = bot.entity;

    let dimension: string = 'overworld';
    try {
      // mineflayer exposes this via game or world
      const gameMode = (bot as any).game;
      const dim = (bot as any).game?.dimension ?? (bot.world as any)?.dimension;
      if (typeof dim === 'string') dimension = dim.replace('minecraft:', '');
    } catch { /* ignore */ }

    return {
      health: bot.health ?? 20,
      maxHealth: 20,
      food: bot.food ?? 20,
      saturation: bot.foodSaturation ?? 20,
      experience: bot.experience?.points ?? 0,
      level: bot.experience?.level ?? 0,
      position: {
        x: entity?.position?.x ?? 0,
        y: entity?.position?.y ?? 64,
        z: entity?.position?.z ?? 0,
      },
      yaw: entity?.yaw ?? 0,
      pitch: entity?.pitch ?? 0,
      dimension,
      isOnGround: entity?.onGround ?? true,
      isInWater: (entity as any)?.isInWater ?? false,
      isInLava: (entity as any)?.isInLava ?? false,
      isOnFire: (entity as any)?.onFire ?? false,
    };
  }

  // ─────────────────────────────────────────────
  // Inventory
  // ─────────────────────────────────────────────

  private extractInventory(): InventoryItem[] {
    const items: InventoryItem[] = [];
    try {
      for (const item of this.bot.inventory.items()) {
        if (item) {
          items.push({
            name: item.name,
            count: item.count,
            slot: item.slot,
          });
        }
      }
    } catch (err) {
      logger.debug(`[Perception] Error reading inventory: ${err}`);
    }
    return items;
  }

  // ─────────────────────────────────────────────
  // Equipment
  // ─────────────────────────────────────────────

  private extractEquipment(): Equipment {
    const bot = this.bot;
    const toItem = (item: any): InventoryItem | undefined => {
      if (!item) return undefined;
      return { name: item.name, count: item.count, slot: item.slot ?? -1 };
    };

    try {
      return {
        mainhand: toItem(bot.heldItem),
        offhand: toItem(bot.inventory.slots[45]),
        head: toItem(bot.inventory.slots[5]),
        chest: toItem(bot.inventory.slots[6]),
        legs: toItem(bot.inventory.slots[7]),
        feet: toItem(bot.inventory.slots[8]),
      };
    } catch {
      return {};
    }
  }

  // ─────────────────────────────────────────────
  // Nearby blocks
  // ─────────────────────────────────────────────

  private extractNearbyBlocks(): NearbyBlock[] {
    const blocks: NearbyBlock[] = [];
    const pos = this.bot.entity?.position;
    if (!pos) return blocks;

    try {
      const r = BLOCK_SCAN_RADIUS;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            const bx = Math.floor(pos.x) + dx;
            const by = Math.floor(pos.y) + dy;
            const bz = Math.floor(pos.z) + dz;

            const block = this.bot.blockAt({ x: bx, y: by, z: bz } as any);
            if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
              if (INTERESTING_BLOCKS.has(block.name)) {
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                blocks.push({
                  name: block.name,
                  position: { x: bx, y: by, z: bz },
                  distance,
                });
              }
            }
          }
        }
      }

      // Sort by distance, keep closest 20
      blocks.sort((a, b) => a.distance - b.distance);
      return blocks.slice(0, 20);
    } catch (err) {
      logger.debug(`[Perception] Error scanning blocks: ${err}`);
      return blocks;
    }
  }

  // ─────────────────────────────────────────────
  // Nearby entities
  // ─────────────────────────────────────────────

  private extractNearbyEntities(): NearbyEntity[] {
    const entities: NearbyEntity[] = [];
    const myPos = this.bot.entity?.position;
    if (!myPos) return entities;

    try {
      for (const entity of Object.values(this.bot.entities)) {
        if (!entity || entity === this.bot.entity) continue;

        const entPos = entity.position;
        if (!entPos) continue;

        const dx = entPos.x - myPos.x;
        const dy = entPos.y - myPos.y;
        const dz = entPos.z - myPos.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance > ENTITY_SCAN_RADIUS) continue;

        const name = entity.name ?? entity.username ?? entity.type ?? 'unknown';
        const type = classifyEntityType(name);

        entities.push({
          name,
          type,
          position: { x: entPos.x, y: entPos.y, z: entPos.z },
          distance,
          health: (entity as any).health,
        });
      }

      entities.sort((a, b) => a.distance - b.distance);
      return entities.slice(0, 20);
    } catch (err) {
      logger.debug(`[Perception] Error scanning entities: ${err}`);
      return entities;
    }
  }

  // ─────────────────────────────────────────────
  // Threat detection
  // ─────────────────────────────────────────────

  private extractThreats(entities: NearbyEntity[]): ThreatInfo[] {
    return entities
      .filter(e => e.type === 'hostile')
      .map(e => ({
        entityName: e.name,
        distance: e.distance,
        dangerLevel: classifyThreatDanger(e.name, e.distance),
      }))
      .sort((a, b) => {
        const levels = { critical: 4, high: 3, medium: 2, low: 1 };
        return levels[b.dangerLevel] - levels[a.dangerLevel];
      });
  }

  // ─────────────────────────────────────────────
  // Time & weather
  // ─────────────────────────────────────────────

  private extractTime(): { time: number; isDay: boolean } {
    try {
      const time = this.bot.time?.timeOfDay ?? 6000;
      const isDay = time < 13000 || time > 23000;
      return { time, isDay };
    } catch {
      return { time: 6000, isDay: true };
    }
  }

  private extractWeather(): WorldState['weather'] {
    try {
      if ((this.bot as any).thunderState > 0) return 'thunder';
      if ((this.bot as any).rainState > 0) return 'rain';
      return 'clear';
    } catch {
      return 'clear';
    }
  }

  // ─────────────────────────────────────────────
  // Helper: check if player has an item
  // ─────────────────────────────────────────────

  hasItem(itemName: string): boolean {
    return this.bot.inventory.items().some(i => i && i.name === itemName);
  }

  getItemCount(itemName: string): number {
    return this.bot.inventory.items()
      .filter(i => i && i.name === itemName)
      .reduce((sum, i) => sum + (i?.count ?? 0), 0);
  }

  /** Get a quick text status for console display */
  getStatusLine(): string {
    const pos = this.bot.entity?.position;
    const hp = this.bot.health ?? '?';
    const food = this.bot.food ?? '?';
    const posStr = pos
      ? `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`
      : '?,?,?';
    return `Health:${hp}/20 Food:${food}/20 Pos:${posStr}`;
  }
}
