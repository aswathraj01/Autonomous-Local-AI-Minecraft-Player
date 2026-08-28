/**
 * src/ai/llm.ts
 * LLMProvider abstract interface.
 * All LLM interactions go through this — swap providers via config.
 */

import type { LLMDecision } from './schemas';
import type { WorldState } from '../world/state';
import type { MemoryContext } from '../memory/memory';

// ─────────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────────

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  success: boolean;
  decision?: LLMDecision;
  rawText?: string;
  error?: string;
  latencyMs?: number;
}

export interface LLMProvider {
  /** Provider name for logging */
  readonly name: string;
  /** Model being used */
  readonly model: string;

  /** Check if the provider is available/reachable */
  isAvailable(): Promise<boolean>;

  /**
   * Make a decision given the current world state and memory context.
   * Returns a validated LLMDecision or an error.
   */
  decide(
    state: WorldState,
    memory: MemoryContext,
    recentEvents: string[],
    lastActionResult: string | null,
    conversationHistory: LLMMessage[],
  ): Promise<LLMResponse>;

  /** Reset conversation history */
  resetHistory(): void;
}

// ─────────────────────────────────────────────
// Factory function
// ─────────────────────────────────────────────

import type { LLMConfig } from '../config';
import { OllamaProvider } from './ollama';

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'ollama':
      return new OllamaProvider(config);
    case 'openai':
      // TODO Phase 3 — optional cloud provider
      throw new Error('OpenAI provider not yet implemented. Set LLM_PROVIDER=ollama.');
    case 'local':
      // TODO Phase 3 — local GGUF direct integration
      throw new Error('Local provider not yet implemented. Set LLM_PROVIDER=ollama.');
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
