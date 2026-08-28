/**
 * src/agent/goals.ts
 * Hierarchical goal system.
 *
 * Goals form a tree: Main Goal → Current Objective → Sub-goals.
 * The LLM selects and modifies goals. The system tracks progress,
 * failure counts, and completion state.
 *
 * Phase 1: Goal structure defined, basic evaluation logic.
 * Phase 4: LLM-driven autonomous goal selection.
 */

import { logger } from '../utils/logger';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type GoalStatus = 'active' | 'completed' | 'failed' | 'paused' | 'abandoned';
export type GoalPriority = 'critical' | 'high' | 'normal' | 'low';

export interface Goal {
  id: string;
  name: string;
  description: string;
  priority: GoalPriority;
  status: GoalStatus;
  parentId?: string;
  children: Goal[];
  createdAt: number;
  completedAt?: number;
  failureCount: number;
  maxRetries: number;
  notes: string[];
}

// ─────────────────────────────────────────────
// Default goal tree — the main Minecraft objective
// ─────────────────────────────────────────────

export function createDefaultGoalTree(): Goal {
  const now = Date.now();

  const makeGoal = (
    id: string,
    name: string,
    description: string,
    priority: GoalPriority = 'normal',
    children: Goal[] = [],
  ): Goal => ({
    id,
    name,
    description,
    priority,
    status: 'paused',
    children,
    createdAt: now,
    failureCount: 0,
    maxRetries: 5,
    notes: [],
  });

  return {
    ...makeGoal(
      'root',
      'Complete Minecraft',
      'Defeat the Ender Dragon and continue surviving and exploring after victory.',
      'normal',
      [
        {
          ...makeGoal('survive', 'Survive', 'Maintain health, food, and safety at all times.', 'critical', [
            makeGoal('survive.food', 'Maintain food', 'Keep food above 14/20. Find and cook food regularly.', 'high'),
            makeGoal('survive.health', 'Recover health', 'When health is low, retreat, eat, and heal.', 'critical'),
            makeGoal('survive.threats', 'Avoid/handle threats', 'Detect and respond to hostile mobs and environmental hazards.', 'high'),
          ]),
          status: 'active', // Survival is always active
        },
        makeGoal('base', 'Establish base', 'Find/build a safe location with shelter, storage, and crafting area.', 'high', [
          makeGoal('base.shelter', 'Build shelter', 'Create a safe enclosed space before first night.', 'high'),
          makeGoal('base.storage', 'Create storage', 'Build chests to organize resources.', 'normal'),
          makeGoal('base.crafting', 'Set up crafting area', 'Place crafting table and furnace.', 'high'),
          makeGoal('base.bed', 'Place bed', 'Obtain and place a bed to set spawn point.', 'high'),
          makeGoal('base.farm', 'Start a farm', 'Plant crops for sustainable food supply.', 'normal'),
        ]),
        makeGoal('equipment', 'Acquire equipment', 'Progress through tool tiers to reach diamond equipment.', 'high', [
          makeGoal('equipment.wood', 'Wood tools', 'Craft wooden pickaxe, axe, and sword.', 'high'),
          makeGoal('equipment.stone', 'Stone tools', 'Upgrade to stone tools.', 'high'),
          makeGoal('equipment.iron', 'Iron equipment', 'Smelt iron and craft iron tools, armor, and shield.', 'high'),
          makeGoal('equipment.diamond', 'Diamond equipment', 'Mine diamonds and craft diamond tools and armor.', 'normal'),
        ]),
        makeGoal('nether', 'Enter the Nether', 'Build a Nether portal and survive the Nether dimension.', 'normal', [
          makeGoal('nether.obsidian', 'Obtain obsidian', 'Get at least 10 obsidian blocks.', 'normal'),
          makeGoal('nether.portal', 'Build Nether portal', 'Construct and activate the Nether portal.', 'normal'),
          makeGoal('nether.explore', 'Explore the Nether', 'Find a Nether Fortress.', 'normal'),
          makeGoal('nether.blaze', 'Obtain Blaze Rods', 'Kill Blazes in a Nether Fortress to get Blaze Rods.', 'normal'),
        ]),
        makeGoal('endgame', 'Reach the End', 'Obtain Eyes of Ender and locate the Stronghold.', 'low', [
          makeGoal('endgame.pearls', 'Obtain Ender Pearls', 'Get at least 12 Ender Pearls from Endermen or trading.', 'normal'),
          makeGoal('endgame.eyes', 'Craft Eyes of Ender', 'Combine Ender Pearls + Blaze Powder.', 'normal'),
          makeGoal('endgame.stronghold', 'Locate Stronghold', 'Use Eyes of Ender to find the Stronghold.', 'normal'),
          makeGoal('endgame.portal', 'Activate End Portal', 'Place Eyes of Ender in all portal frames.', 'normal'),
        ]),
        makeGoal('dragon', 'Defeat Ender Dragon', 'Enter the End dimension and defeat the Ender Dragon.', 'low', [
          makeGoal('dragon.crystals', 'Destroy End Crystals', 'Locate and destroy all End Crystals on obsidian pillars.', 'normal'),
          makeGoal('dragon.fight', 'Fight the Dragon', 'Attack the Ender Dragon when it descends.', 'normal'),
          makeGoal('dragon.victory', 'Victory', 'Collect the dragon egg and exit through the portal.', 'low'),
        ]),
        makeGoal('postgame', 'Post-game exploration', 'Continue exploring, building, and surviving after defeating the dragon.', 'low'),
      ],
    ),
    status: 'active',
  };
}

// ─────────────────────────────────────────────
// Goal manager
// ─────────────────────────────────────────────

export class GoalManager {
  private root: Goal;
  private currentGoalId: string;

  constructor() {
    this.root = createDefaultGoalTree();
    this.currentGoalId = 'survive'; // Start with survival
    this.setGoalStatus('survive', 'active');
    this.setGoalStatus('survive.food', 'active');
    this.setGoalStatus('equipment', 'active');
    this.setGoalStatus('equipment.wood', 'active');
    this.setGoalStatus('base', 'active');
    this.setGoalStatus('base.shelter', 'active');
    logger.info('[Goals] Goal tree initialized');
  }

  // ─────────────────────────────────────────────
  // Tree traversal
  // ─────────────────────────────────────────────

  private findGoal(id: string, node: Goal = this.root): Goal | null {
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = this.findGoal(id, child);
      if (found) return found;
    }
    return null;
  }

  getGoal(id: string): Goal | null {
    return this.findGoal(id);
  }

  getRootGoal(): Goal {
    return this.root;
  }

  getCurrentGoal(): Goal | null {
    return this.findGoal(this.currentGoalId);
  }

  // ─────────────────────────────────────────────
  // Goal mutation
  // ─────────────────────────────────────────────

  setGoalStatus(id: string, status: GoalStatus): boolean {
    const goal = this.findGoal(id);
    if (!goal) {
      logger.warn(`[Goals] Goal not found: ${id}`);
      return false;
    }
    goal.status = status;
    if (status === 'completed') goal.completedAt = Date.now();
    logger.debug(`[Goals] ${id} → ${status}`);
    return true;
  }

  setCurrentGoal(id: string): boolean {
    const goal = this.findGoal(id);
    if (!goal) {
      logger.warn(`[Goals] Cannot set current goal — not found: ${id}`);
      return false;
    }
    this.currentGoalId = id;
    goal.status = 'active';
    logger.info(`[Goals] Current goal: "${goal.name}"`);
    return true;
  }

  recordFailure(id: string, note?: string): void {
    const goal = this.findGoal(id);
    if (!goal) return;
    goal.failureCount++;
    if (note) goal.notes.push(`[FAIL] ${note}`);

    if (goal.failureCount >= goal.maxRetries) {
      logger.warn(`[Goals] Goal "${goal.name}" failed ${goal.failureCount} times — marking failed`);
      goal.status = 'failed';
    }
  }

  addNote(id: string, note: string): void {
    const goal = this.findGoal(id);
    if (goal) goal.notes.push(note);
  }

  /** Add a dynamic sub-goal created by the LLM */
  addDynamicGoal(
    parentId: string,
    id: string,
    name: string,
    description: string,
    priority: GoalPriority = 'normal',
  ): boolean {
    const parent = this.findGoal(parentId);
    if (!parent) {
      logger.warn(`[Goals] Parent goal not found: ${parentId}`);
      return false;
    }

    // Don't add if already exists
    if (this.findGoal(id)) {
      logger.debug(`[Goals] Goal ${id} already exists, skipping`);
      return false;
    }

    const newGoal: Goal = {
      id,
      name,
      description,
      priority,
      status: 'active',
      parentId,
      children: [],
      createdAt: Date.now(),
      failureCount: 0,
      maxRetries: 3,
      notes: [],
    };

    parent.children.push(newGoal);
    logger.info(`[Goals] Added dynamic goal: "${name}" under "${parent.name}"`);
    return true;
  }

  // ─────────────────────────────────────────────
  // Evaluation
  // ─────────────────────────────────────────────

  /**
   * Get the highest-priority active goal based on current situation.
   * Phase 4: This is replaced by LLM selection.
   * Phase 1: Simple heuristic selection.
   */
  evaluateCurrentGoal(healthPct: number, foodPct: number, hasThreats: boolean): string {
    // Critical survival override
    if (healthPct < 0.3 || hasThreats) {
      return 'survive.health';
    }
    if (foodPct < 0.25) {
      return 'survive.food';
    }

    // Otherwise return the current goal
    return this.currentGoalId;
  }

  // ─────────────────────────────────────────────
  // Summary for LLM / display
  // ─────────────────────────────────────────────

  getSummary(): string {
    const current = this.getCurrentGoal();
    if (!current) return 'No active goal';

    const activeGoals = this.getAllActiveGoals()
      .map(g => `  - ${g.name}`)
      .join('\n');

    return [
      `Main goal: ${this.root.name}`,
      `Current objective: ${current.name} — ${current.description}`,
      `Active goals:\n${activeGoals}`,
    ].join('\n');
  }

  getAllActiveGoals(node: Goal = this.root): Goal[] {
    const active: Goal[] = [];
    if (node.status === 'active') active.push(node);
    for (const child of node.children) {
      active.push(...this.getAllActiveGoals(child));
    }
    return active;
  }

  getCompletedGoals(): Goal[] {
    const completed: Goal[] = [];
    const visit = (node: Goal) => {
      if (node.status === 'completed') completed.push(node);
      node.children.forEach(visit);
    };
    visit(this.root);
    return completed;
  }

  /** Get a compact JSON representation for LLM context */
  toCompact(): Record<string, unknown> {
    const current = this.getCurrentGoal();
    const active = this.getAllActiveGoals().map(g => g.name);
    const completed = this.getCompletedGoals().map(g => g.name);

    return {
      mainGoal: this.root.name,
      currentObjective: current?.name ?? 'unknown',
      currentDescription: current?.description ?? '',
      activeGoals: active,
      completedGoals: completed,
      currentFailures: current?.failureCount ?? 0,
    };
  }
}
