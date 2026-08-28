/**
 * src/agent/planner.ts
 * Plan management — creates, revises, and tracks multi-step plans.
 * Phase 1: Stub.
 * Phase 6: Full LLM-driven long-term planning.
 */

import { logger } from '../utils/logger';

export interface Plan {
  goal: string;
  steps: string[];
  currentStepIndex: number;
  createdAt: number;
  revisedAt?: number;
}

export class Planner {
  private currentPlan: Plan | null = null;

  setPlan(goal: string, steps: string[]): void {
    this.currentPlan = {
      goal,
      steps,
      currentStepIndex: 0,
      createdAt: Date.now(),
    };
    logger.debug(`[Planner] New plan set for goal: "${goal}" (${steps.length} steps)`);
  }

  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }

  advanceStep(): boolean {
    if (!this.currentPlan) return false;
    this.currentPlan.currentStepIndex++;
    return this.currentPlan.currentStepIndex < this.currentPlan.steps.length;
  }

  getCurrentStep(): string | null {
    if (!this.currentPlan) return null;
    return this.currentPlan.steps[this.currentPlan.currentStepIndex] ?? null;
  }

  clearPlan(): void {
    this.currentPlan = null;
  }

  // TODO Phase 6: LLM-driven plan revision based on new world state
  // TODO Phase 6: Dependency resolution for complex goals
  // TODO Phase 6: Plan persistence across sessions
}
