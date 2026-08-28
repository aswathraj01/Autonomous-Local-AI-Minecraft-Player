/**
 * src/ai/ollama.ts
 * OllamaProvider — uses the locally installed Ollama instance.
 * Handles connection failures, malformed JSON, and retries gracefully.
 */

import { Ollama } from 'ollama';
import type { LLMConfig, PersonalityConfig } from '../config';
import type { LLMMessage, LLMProvider, LLMResponse } from './llm';
import type { WorldState } from '../world/state';
import type { MemoryContext } from '../memory/memory';
import { validateLLMDecision } from './schemas';
import { buildSystemPrompt, buildDecisionPrompt } from './prompts';
import { logger } from '../utils/logger';
import config from '../config';

// Maximum retries if LLM returns invalid JSON
const MAX_RETRIES = 2;
// Maximum conversation history messages to keep (system + N turns)
const MAX_HISTORY_MESSAGES = 10;

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly model: string;

  private client: Ollama;
  private systemPrompt: string;
  private conversationHistory: LLMMessage[] = [];
  private personality: PersonalityConfig;

  constructor(cfg: LLMConfig) {
    this.model = cfg.model;
    this.personality = config.personality;
    this.client = new Ollama({ host: cfg.ollamaUrl });
    this.systemPrompt = buildSystemPrompt(this.personality);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const models = await this.client.list();
      const found = models.models.some(m => m.name.includes(this.model.split(':')[0]!));
      if (!found) {
        logger.warn(`[Ollama] Model "${this.model}" not found. Run: ollama pull ${this.model}`);
        logger.warn(`[Ollama] Available models: ${models.models.map(m => m.name).join(', ') || 'none'}`);
      }
      return true; // server is reachable even if model is missing
    } catch (err) {
      logger.warn(`[Ollama] Server not reachable at ${config.llm.ollamaUrl}. Start Ollama first.`);
      return false;
    }
  }

  async decide(
    state: WorldState,
    memory: MemoryContext,
    recentEvents: string[],
    lastActionResult: string | null,
    _externalHistory: LLMMessage[],
  ): Promise<LLMResponse> {
    const startMs = Date.now();
    const userPrompt = buildDecisionPrompt(state, memory, recentEvents, lastActionResult);

    // Build messages for this request
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: this.systemPrompt },
      ...this.conversationHistory.slice(-MAX_HISTORY_MESSAGES),
      { role: 'user', content: userPrompt },
    ];

    let lastError = '';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        logger.debug(`[Ollama] Sending decision request (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);

        const response = await this.client.chat({
          model: this.model,
          messages: messages as any,
          stream: false,
          options: {
            temperature: 0.6,
            top_p: 0.9,
            num_predict: 1024,
          },
          format: 'json',
        });

        const rawText = response.message.content.trim();
        logger.debug(`[Ollama] Raw response (${rawText.length} chars): ${rawText.slice(0, 200)}...`);

        // Parse JSON
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          lastError = `JSON parse error: ${rawText.slice(0, 100)}`;
          logger.warn(`[Ollama] Attempt ${attempt + 1}: Invalid JSON response`);
          // On retry, add a correction message
          if (attempt < MAX_RETRIES) {
            messages.push({ role: 'assistant', content: rawText });
            messages.push({
              role: 'user',
              content: 'Your previous response was not valid JSON. Please respond with ONLY a valid JSON object matching the required schema.',
            });
          }
          continue;
        }

        // Validate against schema
        const validation = validateLLMDecision(parsed);
        if (!validation.success || !validation.data) {
          lastError = validation.error ?? 'Unknown validation error';
          logger.warn(`[Ollama] Attempt ${attempt + 1}: Schema validation failed: ${lastError}`);
          if (attempt < MAX_RETRIES) {
            messages.push({ role: 'assistant', content: rawText });
            messages.push({
              role: 'user',
              content: `Your response failed schema validation: ${lastError}\n\nPlease try again with valid JSON.`,
            });
          }
          continue;
        }

        // Success — update conversation history
        this.conversationHistory.push({ role: 'user', content: userPrompt });
        this.conversationHistory.push({ role: 'assistant', content: rawText });
        // Trim history to avoid context overflow
        if (this.conversationHistory.length > MAX_HISTORY_MESSAGES * 2) {
          this.conversationHistory = this.conversationHistory.slice(-MAX_HISTORY_MESSAGES * 2);
        }

        const latencyMs = Date.now() - startMs;
        logger.debug(`[Ollama] Decision received in ${latencyMs}ms: goal="${validation.data.goal}"`);

        return {
          success: true,
          decision: validation.data,
          rawText,
          latencyMs,
        };

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = message;
        logger.warn(`[Ollama] Attempt ${attempt + 1} error: ${message}`);

        if (attempt < MAX_RETRIES) {
          await sleep(1000 * (attempt + 1)); // Backoff
        }
      }
    }

    return {
      success: false,
      error: `All ${MAX_RETRIES + 1} attempts failed. Last error: ${lastError}`,
      latencyMs: Date.now() - startMs,
    };
  }

  resetHistory(): void {
    this.conversationHistory = [];
    logger.debug('[Ollama] Conversation history reset');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
