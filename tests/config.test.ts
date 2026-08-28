/**
 * tests/config.test.ts
 * Tests for the configuration loader.
 */

// Set required env vars before importing config
process.env['MC_HOST'] = 'localhost';
process.env['MC_PORT'] = '25565';
process.env['MC_VERSION'] = '1.21.1';
process.env['MC_USERNAME'] = 'TestBot';
process.env['MC_AUTH'] = 'offline';
process.env['LLM_PROVIDER'] = 'ollama';
process.env['LLM_MODEL'] = 'qwen3:8b';
process.env['OLLAMA_URL'] = 'http://localhost:11434';

import { minecraftConfig, llmConfig, agentConfig, personalityConfig } from '../src/config';

describe('Config', () => {
  test('minecraft config loads correctly', () => {
    expect(minecraftConfig.host).toBe('localhost');
    expect(minecraftConfig.port).toBe(25565);
    expect(minecraftConfig.username).toBe('TestBot');
    expect(minecraftConfig.auth).toBe('offline');
    expect(minecraftConfig.version).toBe('1.21.1');
  });

  test('llm config loads correctly', () => {
    expect(llmConfig.provider).toBe('ollama');
    expect(llmConfig.model).toBe('qwen3:8b');
    expect(llmConfig.ollamaUrl).toBe('http://localhost:11434');
  });

  test('agent config has valid defaults', () => {
    expect(agentConfig.decisionIntervalMs).toBeGreaterThan(0);
    expect(typeof agentConfig.debugMode).toBe('boolean');
    expect(typeof agentConfig.visionEnabled).toBe('boolean');
  });

  test('personality config values are 0-1', () => {
    for (const [key, value] of Object.entries(personalityConfig)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  test('port is a valid number', () => {
    expect(Number.isInteger(minecraftConfig.port)).toBe(true);
    expect(minecraftConfig.port).toBeGreaterThan(0);
    expect(minecraftConfig.port).toBeLessThan(65536);
  });
});
