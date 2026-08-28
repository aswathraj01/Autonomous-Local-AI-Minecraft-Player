/**
 * src/world/state.ts
 * Defines the WorldState type — the structured snapshot of the game
 * sent to the LLM for decision making.
 *
 * Only compact, relevant data is included — never raw Minecraft internals.
 */

// ─────────────────────────────────────────────
// Sub-types
// ─────────────────────────────────────────────

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  health: number;       // 0–20
  maxHealth: number;
  food: number;         // 0–20
  saturation: number;
  experience: number;
  level: number;
  position: Position;
  yaw: number;
  pitch: number;
  dimension: 'overworld' | 'nether' | 'end' | string;
  isOnGround: boolean;
  isInWater: boolean;
  isInLava: boolean;
  isOnFire: boolean;
}

export interface InventoryItem {
  name: string;
  count: number;
  slot: number;
  metadata?: number;
}

export interface Equipment {
  mainhand?: InventoryItem;
  offhand?: InventoryItem;
  head?: InventoryItem;
  chest?: InventoryItem;
  legs?: InventoryItem;
  feet?: InventoryItem;
}

export interface NearbyBlock {
  name: string;
  position: Position;
  distance: number;
}

export interface NearbyEntity {
  name: string;
  type: 'hostile' | 'passive' | 'neutral' | 'player' | 'projectile' | 'other';
  position: Position;
  distance: number;
  health?: number;
}

export interface ThreatInfo {
  entityName: string;
  distance: number;
  dangerLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface GoalState {
  mainGoal: string;
  currentObjective: string;
  currentPlan: string[];
  currentAction: string;
}

// ─────────────────────────────────────────────
// Main WorldState
// ─────────────────────────────────────────────

export interface WorldState {
  /** Timestamp of this snapshot (ms since epoch) */
  timestamp: number;

  /** Core player stats */
  player: PlayerState;

  /** All inventory items (non-empty slots) */
  inventory: InventoryItem[];

  /** Currently equipped items */
  equipment: Equipment;

  /** Nearby blocks within ~6 blocks, sorted by distance */
  nearbyBlocks: NearbyBlock[];

  /** Nearby entities within ~16 blocks, sorted by distance */
  nearbyEntities: NearbyEntity[];

  /** Active threats requiring attention */
  currentThreats: ThreatInfo[];

  /** In-game time (0–24000; day = 0–12000) */
  time: number;
  isDay: boolean;

  /** Weather */
  weather: 'clear' | 'rain' | 'thunder';

  /** Current goal / plan state */
  goals: GoalState;

  /** Short summary for LLM context */
  summary: string;
}

// ─────────────────────────────────────────────
// State builder helpers
// ─────────────────────────────────────────────

/** Creates a human-readable summary of the world state for the LLM */
export function buildStateSummary(state: WorldState): string {
  const { player, inventory, currentThreats, isDay, weather } = state;

  const healthPct = Math.round((player.health / player.maxHealth) * 100);
  const foodPct = Math.round((player.food / 20) * 100);

  const threats = currentThreats.length > 0
    ? `THREATS: ${currentThreats.map(t => `${t.entityName}(${t.dangerLevel})`).join(', ')}`
    : 'No immediate threats';

  const itemSummary = inventory
    .slice(0, 10)
    .map(i => `${i.name}×${i.count}`)
    .join(', ') || 'Empty';

  return [
    `Health:${player.health}/20 (${healthPct}%) Food:${player.food}/20 (${foodPct}%)`,
    `Position: x=${Math.round(player.position.x)} y=${Math.round(player.position.y)} z=${Math.round(player.position.z)} [${player.dimension}]`,
    `Time: ${isDay ? 'Day' : 'Night'} | Weather: ${weather}`,
    `Inventory: ${itemSummary}`,
    threats,
  ].join(' | ');
}

/** Creates a compact version of state for LLM (omitting low-value data) */
export function toCompactState(state: WorldState): Record<string, unknown> {
  return {
    player: {
      health: state.player.health,
      maxHealth: state.player.maxHealth,
      food: state.player.food,
      position: {
        x: Math.round(state.player.position.x),
        y: Math.round(state.player.position.y),
        z: Math.round(state.player.position.z),
      },
      dimension: state.player.dimension,
      isOnFire: state.player.isOnFire,
      isInWater: state.player.isInWater,
    },
    inventory: state.inventory.map(i => ({ name: i.name, count: i.count })),
    equipment: {
      mainhand: state.equipment.mainhand?.name ?? 'none',
      armor: [
        state.equipment.head?.name,
        state.equipment.chest?.name,
        state.equipment.legs?.name,
        state.equipment.feet?.name,
      ].filter(Boolean),
    },
    nearbyBlocks: state.nearbyBlocks.slice(0, 15).map(b => ({
      name: b.name,
      dist: Math.round(b.distance),
    })),
    nearbyEntities: state.nearbyEntities.slice(0, 10).map(e => ({
      name: e.name,
      type: e.type,
      dist: Math.round(e.distance),
    })),
    threats: state.currentThreats,
    time: state.isDay ? 'day' : 'night',
    weather: state.weather,
    goals: state.goals,
  };
}

/** Classifies an entity type from its name */
export function classifyEntityType(entityName: string): NearbyEntity['type'] {
  const hostiles = [
    'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch',
    'blaze', 'ghast', 'slime', 'zombie_pigman', 'piglin_brute',
    'warden', 'phantom', 'drowned', 'husk', 'stray', 'vindicator',
    'pillager', 'ravager', 'shulker', 'silverfish', 'cave_spider',
    'elder_guardian', 'guardian', 'hoglin', 'zoglin', 'magma_cube',
    'wither_skeleton', 'endermite', 'evoker', 'vex',
  ];
  const passives = [
    'cow', 'pig', 'sheep', 'chicken', 'rabbit', 'horse', 'donkey',
    'llama', 'cat', 'villager', 'wandering_trader', 'bat', 'bee',
    'parrot', 'turtle', 'axolotl', 'allay', 'frog', 'tadpole',
    'sniffer', 'camel',
  ];
  const neutrals = [
    'wolf', 'polar_bear', 'dolphin', 'iron_golem', 'snow_golem',
    'panda', 'piglin', 'zombified_piglin', 'enderman',
  ];

  const nameLower = entityName.toLowerCase();

  // Check hostiles first — most specific list
  if (hostiles.some(h => nameLower === h || nameLower.startsWith(h + '_') || nameLower.endsWith('_' + h))) return 'hostile';
  // Check neutrals before passives (piglin should be neutral not passive)
  if (neutrals.some(n => nameLower === n || nameLower.startsWith(n + '_') || nameLower.endsWith('_' + n))) return 'neutral';
  // Check passives — use exact or compound match (pig != piglin)
  if (passives.some(p => nameLower === p || nameLower.startsWith(p + '_'))) return 'passive';
  if (nameLower === 'player') return 'player';
  return 'other';
}

/** Classifies danger level of a threat based on entity type and distance */
export function classifyThreatDanger(
  entityType: string,
  distance: number,
): ThreatInfo['dangerLevel'] {
  const criticalMobs = ['creeper', 'warden', 'elder_guardian'];
  const highMobs = ['skeleton', 'blaze', 'ghast', 'witch'];

  const nameLower = entityType.toLowerCase();

  if (distance < 4) return 'critical';
  if (criticalMobs.some(m => nameLower.includes(m))) {
    return distance < 8 ? 'critical' : distance < 16 ? 'high' : 'medium';
  }
  if (highMobs.some(m => nameLower.includes(m))) {
    return distance < 8 ? 'high' : 'medium';
  }
  return distance < 6 ? 'high' : 'low';
}

/** Creates an empty/default world state */
export function createEmptyState(): WorldState {
  return {
    timestamp: Date.now(),
    player: {
      health: 20,
      maxHealth: 20,
      food: 20,
      saturation: 20,
      experience: 0,
      level: 0,
      position: { x: 0, y: 64, z: 0 },
      yaw: 0,
      pitch: 0,
      dimension: 'overworld',
      isOnGround: true,
      isInWater: false,
      isInLava: false,
      isOnFire: false,
    },
    inventory: [],
    equipment: {},
    nearbyBlocks: [],
    nearbyEntities: [],
    currentThreats: [],
    time: 6000,
    isDay: true,
    weather: 'clear',
    goals: {
      mainGoal: 'Complete Minecraft',
      currentObjective: 'Initializing...',
      currentPlan: [],
      currentAction: 'Starting up',
    },
    summary: 'Initializing...',
  };
}
