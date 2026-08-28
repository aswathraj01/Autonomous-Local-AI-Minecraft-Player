/**
 * src/agent/agent.ts
 * The main autonomous agent loop.
 *
 * Implements the core decision cycle:
 *   OBSERVE → UPDATE STATE → CHECK MEMORY → EVALUATE GOALS →
 *   CREATE/MODIFY PLAN → SELECT ACTION → EXECUTE → EVALUATE RESULT →
 *   STORE EXPERIENCE → REPEAT
 *
 * Phase 1: Loop runs, uses heuristic decisions + optional LLM.
 * Phase 3: Full LLM integration.
 * Phase 4: Autonomous goal management.
 */

import type { Bot } from 'mineflayer';
import { PerceptionSystem } from '../minecraft/perception';
import { ActionExecutor } from '../minecraft/actions';
import { GoalManager } from './goals';
import { HeuristicDecisionEngine } from './decision';
import { MemoryManager } from '../memory/memory';
import { createLLMProvider } from '../ai/llm';
import type { LLMProvider } from '../ai/llm';
import type { WorldState } from '../world/state';
import type { Action } from '../ai/schemas';
import { logger, logEvent } from '../utils/logger';
import config from '../config';

// Maximum times we'll retry the exact same failed action type before switching
const MAX_SAME_ACTION_FAILURES = 3;
// Maximum recent events to keep in memory
const MAX_RECENT_EVENTS = 50;

export class AutonomousAgent {
  private bot: Bot;
  private perception: PerceptionSystem;
  private executor: ActionExecutor;
  private goals: GoalManager;
  private heuristic: HeuristicDecisionEngine;
  private memory: MemoryManager;
  private llm: LLMProvider | null = null;

  // Loop state
  private running = false;
  private paused = false;
  private decisionLoop: NodeJS.Timeout | null = null;

  // Decision state
  private currentWorldState: WorldState | null = null;
  private recentEvents: string[] = [];
  private lastActionResult: string | null = null;
  private lastActionType: string | null = null;
  private sameActionFailures = 0;
  private totalDecisions = 0;
  private totalActions = 0;
  private successfulActions = 0;
  private failedActions = 0;

  // Startup time
  private startTime = Date.now();

  constructor(bot: Bot) {
    this.bot = bot;
    this.perception = new PerceptionSystem(bot);
    this.executor = new ActionExecutor(bot, this.perception);
    this.goals = new GoalManager();
    this.heuristic = new HeuristicDecisionEngine(this.goals, this.perception);
    this.memory = new MemoryManager(config.memory);

    this.setupBotEventListeners();
  }

  // ─────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────

  async initialize(): Promise<void> {
    logger.info('[Agent] Initializing autonomous agent...');
    logger.info('[Agent] Main objective: Complete Minecraft');
    logger.info('[Agent] No user instructions required during normal operation.');
    logger.info('');

    // Initialize LLM provider
    await this.initializeLLM();

    // Log personality
    const p = config.personality;
    logger.info(`[Agent] Personality: curiosity=${p.curiosity} caution=${p.caution} exploration=${p.exploration}`);
    logger.info(`[Agent] Decision interval: ${config.agent.decisionIntervalMs / 1000}s`);
    logger.info('[Agent] ✅ Agent initialized. AI is now autonomous.');
    logger.info('');

    logEvent('Agent initialized');
  }

  private async initializeLLM(): Promise<void> {
    try {
      const provider = createLLMProvider(config.llm);
      const available = await provider.isAvailable();

      if (available) {
        this.llm = provider;
        logger.info(`[Agent] ✅ LLM: ${provider.name} / ${provider.model}`);
      } else {
        logger.warn(`[Agent] ⚠️  LLM (${config.llm.provider}/${config.llm.model}) unavailable.`);
        logger.warn('[Agent] Running in heuristic-only mode. Start Ollama to enable AI decisions.');
        logger.warn('[Agent] Run: ollama serve  (then: ollama pull qwen3:8b)');
      }
    } catch (err) {
      logger.warn(`[Agent] LLM initialization failed: ${err}`);
      logger.warn('[Agent] Running in heuristic-only mode.');
    }
  }

  // ─────────────────────────────────────────────
  // Main loop
  // ─────────────────────────────────────────────

  start(): void {
    if (this.running) {
      logger.warn('[Agent] Already running');
      return;
    }

    this.running = true;
    this.paused = false;

    logger.info(`[Agent] Starting decision loop (interval: ${config.agent.decisionIntervalMs}ms)`);
    this.scheduleNextDecision();
  }

  stop(): void {
    this.running = false;
    if (this.decisionLoop) {
      clearTimeout(this.decisionLoop);
      this.decisionLoop = null;
    }
    logger.info('[Agent] Decision loop stopped');
    this.memory.close();
  }

  pause(): void {
    this.paused = true;
    logger.info('[Agent] Paused');
  }

  resume(): void {
    this.paused = false;
    logger.info('[Agent] Resumed');
    if (this.running) {
      this.scheduleNextDecision();
    }
  }

  private scheduleNextDecision(): void {
    if (!this.running) return;

    this.decisionLoop = setTimeout(async () => {
      if (!this.paused && this.running) {
        await this.runDecisionCycle();
      }
      if (this.running) {
        this.scheduleNextDecision();
      }
    }, config.agent.decisionIntervalMs);
  }

  // ─────────────────────────────────────────────
  // Decision cycle
  // ─────────────────────────────────────────────

  private async runDecisionCycle(): Promise<void> {
    try {
      this.totalDecisions++;
      logger.debug(`[Agent] === Decision cycle #${this.totalDecisions} ===`);

      // ── Step 1: OBSERVE — Extract world state ──
      const state = this.perception.extractWorldState();
      this.currentWorldState = state;

      // Update goal state in perception
      const currentGoal = this.goals.getCurrentGoal();
      this.perception.setGoalState({
        mainGoal: 'Complete Minecraft',
        currentObjective: currentGoal?.name ?? 'Unknown',
        currentPlan: [],
        currentAction: this.lastActionType ?? 'None',
      });

      // ── Step 2: EVALUATE GOALS — Check survival vs objectives ──
      const healthPct = state.player.health / state.player.maxHealth;
      const foodPct = state.player.food / 20;
      const hasThreats = state.currentThreats.some(t =>
        t.dangerLevel === 'high' || t.dangerLevel === 'critical',
      );

      // Update goal based on situation
      const evaluatedGoalId = this.goals.evaluateCurrentGoal(healthPct, foodPct, hasThreats);
      this.goals.setCurrentGoal(evaluatedGoalId);

      // ── Step 3: LOG STATE ──
      if (config.agent.debugMode) {
        logger.info(`[State] ${this.perception.getStatusLine()}`);
        if (state.currentThreats.length > 0) {
          logger.warn(`[Threats] ${state.currentThreats.map(t => `${t.entityName}(${t.dangerLevel})`).join(', ')}`);
        }
      }

      // ── Step 4: SELECT ACTION (LLM or heuristic) ──
      let action: Action;
      let decisionGoal: string;
      let decisionAssessment: string;
      let fromLLM = false;

      if (this.llm) {
        // Try LLM decision
        const memContext = this.memory.buildMemoryContext();
        const llmResult = await this.llm.decide(
          state,
          memContext,
          this.recentEvents.slice(-8),
          this.lastActionResult,
          [],
        );

        if (llmResult.success && llmResult.decision) {
          const d = llmResult.decision;
          action = d.next_action;
          decisionGoal = d.goal;
          decisionAssessment = d.assessment;
          fromLLM = true;

          // Update goal if LLM specified a different one
          if (d.goal && d.goal !== this.goals.getCurrentGoal()?.name) {
            logger.debug(`[Agent] LLM goal: "${d.goal}"`);
          }

          // Save memory if requested
          if (d.memory?.save && d.memory.content) {
            this.handleMemorySave(d.memory, state);
          }

          if (config.agent.debugMode) {
            logger.info(`[AI] Goal: ${d.goal}`);
            logger.info(`[AI] Assessment: ${d.assessment}`);
            logger.info(`[AI] Plan: ${d.plan.slice(0, 3).join(' → ')}`);
            logger.info(`[AI] Action: ${JSON.stringify(d.next_action)}`);
          }
        } else {
          // LLM failed — fall back to heuristic
          logger.warn(`[Agent] LLM failed (${llmResult.error}). Using heuristic.`);
          const hDecision = this.heuristic.decide(state);
          action = hDecision.action;
          decisionGoal = hDecision.goal;
          decisionAssessment = hDecision.assessment;
        }
      } else {
        // No LLM — use heuristic
        const hDecision = this.heuristic.decide(state);
        action = hDecision.action;
        decisionGoal = hDecision.goal;
        decisionAssessment = hDecision.assessment;

        if (config.agent.debugMode) {
          logger.info(`[Heuristic] Goal: ${decisionGoal}`);
          logger.info(`[Heuristic] Assessment: ${decisionAssessment}`);
          logger.info(`[Heuristic] Action: ${JSON.stringify(action)}`);
        }
      }

      // ── Step 5: Check for repeated failures ──
      if (this.lastActionType === action.type && !fromLLM) {
        this.sameActionFailures++;
        if (this.sameActionFailures >= MAX_SAME_ACTION_FAILURES) {
          logger.warn(`[Agent] Same action type "${action.type}" failed ${this.sameActionFailures}x. Forcing explore.`);
          this.addEvent(`Stuck on ${action.type} — forcing explore`);
          action = { type: 'explore', direction: 'random', distance: 30 };
          this.sameActionFailures = 0;
        }
      } else {
        this.sameActionFailures = 0;
      }

      // Log the decision
      const decisionId = this.memory.logDecision({
        timestamp: Date.now(),
        goal: decisionGoal,
        assessment: decisionAssessment,
        actionType: action.type,
        actionDetail: JSON.stringify(action),
      });

      // ── Step 6: EXECUTE ACTION ──
      this.totalActions++;
      const result = await this.executor.execute(action);
      this.lastActionType = action.type;

      if (result.success) {
        this.successfulActions++;
        this.lastActionResult = `SUCCESS: ${result.message}`;
        this.addEvent(`${action.type}: ${result.message}`);
        logger.debug(`[Agent] ✅ Action succeeded: ${result.message}`);
      } else {
        this.failedActions++;
        this.lastActionResult = `FAILED: ${result.message}`;
        this.addEvent(`${action.type} FAILED: ${result.message}`);
        logger.warn(`[Agent] ❌ Action failed: ${result.message}`);

        // Record failure in memory
        this.memory.saveEpisode({
          timestamp: Date.now(),
          event: `${action.type} action failed`,
          outcome: result.message,
          lesson: result.retryable ? 'Action failed but can retry' : 'Action not feasible — need alternative',
          position: JSON.stringify(state.player.position),
        });

        // Record goal failure if retried too many times
        if (!result.retryable) {
          const currentGoalObj = this.goals.getCurrentGoal();
          if (currentGoalObj) {
            this.goals.recordFailure(currentGoalObj.id, result.message);
          }
        }
      }

      // Update decision result in memory
      this.memory.updateDecisionResult(decisionId, this.lastActionResult, result.success);

    } catch (err) {
      logger.error(`[Agent] Unhandled error in decision cycle: ${err}`);
      this.addEvent(`Decision cycle error: ${err}`);
    }
  }

  // ─────────────────────────────────────────────
  // Memory save handling
  // ─────────────────────────────────────────────

  private handleMemorySave(
    memRequest: { save: boolean; type?: string; content?: string; location?: any; locationName?: string },
    state: WorldState,
  ): void {
    if (!memRequest.content) return;

    switch (memRequest.type) {
      case 'episode':
        this.memory.saveEpisode({
          timestamp: Date.now(),
          event: memRequest.content,
          outcome: this.lastActionResult ?? 'unknown',
          position: JSON.stringify(state.player.position),
        });
        logger.debug(`[Memory] Saved episode: ${memRequest.content}`);
        break;

      case 'semantic':
        this.memory.saveFact(memRequest.content, 'agent_learned', 0.7);
        logger.debug(`[Memory] Saved fact: ${memRequest.content}`);
        break;

      case 'location':
        if (memRequest.location) {
          this.memory.saveLocation({
            name: memRequest.locationName ?? `Location_${Date.now()}`,
            x: memRequest.location.x,
            y: memRequest.location.y,
            z: memRequest.location.z,
            dimension: state.player.dimension,
            importance: 5,
          });
          logger.debug(`[Memory] Saved location: ${memRequest.locationName}`);
        }
        break;
    }
  }

  // ─────────────────────────────────────────────
  // Bot event listeners (for reactive behavior)
  // ─────────────────────────────────────────────

  private setupBotEventListeners(): void {
    this.bot.on('death', () => {
      this.addEvent('💀 Died — respawning');
      this.lastActionResult = 'Died — lost items and respawned';

      // Save death episode
      const state = this.currentWorldState;
      this.memory.saveEpisode({
        timestamp: Date.now(),
        event: 'Player death',
        outcome: 'Died and respawned. Items potentially lost.',
        lesson: 'Need to be more careful — check health before engaging threats.',
        position: state ? JSON.stringify(state.player.position) : undefined,
      });

      // Reset LLM conversation after death (fresh context)
      this.llm?.resetHistory();
    });

    this.bot.on('health', () => {
      const hp = this.bot.health ?? 20;
      if (hp <= 6 && hp > 0) {
        logger.warn(`[Agent] ⚠️  Health critical: ${hp}/20`);
        // Don't trigger a new decision cycle here — the scheduled one will handle it
        // But log the event
        this.addEvent(`Health low: ${hp}/20`);
      }
    });

    this.bot.on('entitySpawn', (entity) => {
      const name = entity.name ?? entity.type ?? 'unknown';
      if (name !== 'item' && name !== 'xp_orb') {
        this.addEvent(`Entity spawned: ${name}`);
      }
    });
  }

  // ─────────────────────────────────────────────
  // Event log
  // ─────────────────────────────────────────────

  private addEvent(message: string): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const entry = `[${timestamp}] ${message}`;
    this.recentEvents.push(entry);
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.shift();
    }
  }

  // ─────────────────────────────────────────────
  // Status / stats
  // ─────────────────────────────────────────────

  getStatus(): Record<string, unknown> {
    const uptimeMs = Date.now() - this.startTime;
    const hours = Math.floor(uptimeMs / 3600000);
    const minutes = Math.floor((uptimeMs % 3600000) / 60000);

    const state = this.currentWorldState;
    const currentGoal = this.goals.getCurrentGoal();

    return {
      running: this.running,
      paused: this.paused,
      llmAvailable: this.llm !== null,
      llmModel: this.llm?.model ?? 'none',
      uptime: `${hours}h ${minutes}m`,
      totalDecisions: this.totalDecisions,
      totalActions: this.totalActions,
      successfulActions: this.successfulActions,
      failedActions: this.failedActions,
      successRate: this.totalActions > 0
        ? `${Math.round((this.successfulActions / this.totalActions) * 100)}%`
        : 'N/A',
      currentGoal: currentGoal?.name ?? 'None',
      lastAction: this.lastActionType,
      lastResult: this.lastActionResult,
      playerHealth: state?.player.health ?? 'unknown',
      playerFood: state?.player.food ?? 'unknown',
      playerPosition: state?.player.position ?? 'unknown',
      recentEvents: this.recentEvents.slice(-10),
    };
  }

  getMemory(): MemoryManager {
    return this.memory;
  }

  getGoals(): GoalManager {
    return this.goals;
  }

  isRunning(): boolean {
    return this.running;
  }
}
