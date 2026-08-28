/**
 * src/config.ts
 * Typed configuration loader. Reads from environment variables (via dotenv).
 * All server addresses, credentials, and tuning parameters are driven from here.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env file if it exists
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('[Config] No .env file found. Using environment variables or defaults.');
  console.warn('[Config] Copy .env.example to .env and fill in your values.');
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`[Config] Required environment variable "${key}" is not set. Check your .env file.`);
  }
  return value;
}

function getEnvFloat(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const val = parseFloat(raw);
  if (isNaN(val)) {
    console.warn(`[Config] Invalid float for ${key}: "${raw}". Using default ${defaultValue}.`);
    return defaultValue;
  }
  return val;
}

function getEnvInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const val = parseInt(raw, 10);
  if (isNaN(val)) {
    console.warn(`[Config] Invalid int for ${key}: "${raw}". Using default ${defaultValue}.`);
    return defaultValue;
  }
  return val;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  return raw.toLowerCase() === 'true' || raw === '1';
}

// ─────────────────────────────────────────────
// Minecraft config
// ─────────────────────────────────────────────
export interface MinecraftConfig {
  host: string;
  port: number;
  /** Version string like "1.21.1". Empty string = auto-negotiate. */
  version: string;
  username: string;
  auth: 'offline' | 'microsoft';
}

export const minecraftConfig: MinecraftConfig = {
  host: getEnv('MC_HOST', 'localhost'),
  port: getEnvInt('MC_PORT', 25565),
  version: getEnv('MC_VERSION', '1.21.1'),
  username: getEnv('MC_USERNAME', 'AIPlayer'),
  auth: (getEnv('MC_AUTH', 'offline') as 'offline' | 'microsoft'),
};

// ─────────────────────────────────────────────
// LLM config
// ─────────────────────────────────────────────
export interface LLMConfig {
  provider: 'ollama' | 'openai' | 'local';
  model: string;
  ollamaUrl: string;
  openaiApiKey?: string;
}

export const llmConfig: LLMConfig = {
  provider: (getEnv('LLM_PROVIDER', 'ollama') as 'ollama' | 'openai' | 'local'),
  model: getEnv('LLM_MODEL', 'qwen3:8b'),
  ollamaUrl: getEnv('OLLAMA_URL', 'http://localhost:11434'),
  openaiApiKey: process.env['OPENAI_API_KEY'],
};

// ─────────────────────────────────────────────
// Agent behaviour
// ─────────────────────────────────────────────
export interface AgentConfig {
  decisionIntervalMs: number;
  visionEnabled: boolean;
  debugMode: boolean;
}

export const agentConfig: AgentConfig = {
  decisionIntervalMs: getEnvInt('DECISION_INTERVAL_MS', 15000),
  visionEnabled: getEnvBool('VISION_ENABLED', false),
  debugMode: getEnvBool('DEBUG_MODE', true),
};

// ─────────────────────────────────────────────
// Personality traits
// ─────────────────────────────────────────────
export interface PersonalityConfig {
  curiosity: number;
  caution: number;
  riskTolerance: number;
  exploration: number;
  building: number;
  combatAggression: number;
  resourceConservation: number;
}

export const personalityConfig: PersonalityConfig = {
  curiosity: getEnvFloat('PERSONALITY_CURIOSITY', 0.7),
  caution: getEnvFloat('PERSONALITY_CAUTION', 0.6),
  riskTolerance: getEnvFloat('PERSONALITY_RISK_TOLERANCE', 0.4),
  exploration: getEnvFloat('PERSONALITY_EXPLORATION', 0.7),
  building: getEnvFloat('PERSONALITY_BUILDING', 0.5),
  combatAggression: getEnvFloat('PERSONALITY_COMBAT_AGGRESSION', 0.4),
  resourceConservation: getEnvFloat('PERSONALITY_RESOURCE_CONSERVATION', 0.6),
};

// ─────────────────────────────────────────────
// Memory & storage
// ─────────────────────────────────────────────
export interface MemoryConfig {
  dataDir: string;
  saveIntervalMs: number;
  maxEpisodes: number;
}

export const memoryConfig: MemoryConfig = {
  dataDir: path.resolve(process.cwd(), getEnv('DATA_DIR', './data')),
  saveIntervalMs: getEnvInt('MEMORY_SAVE_INTERVAL_MS', 60000),
  maxEpisodes: getEnvInt('MAX_EPISODES', 1000),
};

// ─────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────
export interface DashboardConfig {
  enabled: boolean;
  port: number;
}

export const dashboardConfig: DashboardConfig = {
  enabled: getEnvBool('DASHBOARD_ENABLED', false),
  port: getEnvInt('DASHBOARD_PORT', 3000),
};

// ─────────────────────────────────────────────
// Reconnect
// ─────────────────────────────────────────────
export interface ReconnectConfig {
  enabled: boolean;
  delayMs: number;
  maxAttempts: number;
}

export const reconnectConfig: ReconnectConfig = {
  enabled: getEnvBool('RECONNECT_ENABLED', true),
  delayMs: getEnvInt('RECONNECT_DELAY_MS', 5000),
  maxAttempts: getEnvInt('RECONNECT_MAX_ATTEMPTS', 20),
};

// ─────────────────────────────────────────────
// Aggregate export
// ─────────────────────────────────────────────
export const config = {
  minecraft: minecraftConfig,
  llm: llmConfig,
  agent: agentConfig,
  personality: personalityConfig,
  memory: memoryConfig,
  dashboard: dashboardConfig,
  reconnect: reconnectConfig,
};

export default config;
