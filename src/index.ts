/**
 * src/index.ts
 * Application entry point.
 *
 * Starts the Minecraft client, waits for bot spawn,
 * then launches the autonomous agent.
 *
 * Usage:
 *   npm run dev     — development (ts-node)
 *   npm start       — production (compiled JS)
 */

import config from './config';
import { MinecraftClient } from './minecraft/client';
import { AutonomousAgent } from './agent/agent';
import { logger, logEvent } from './utils/logger';
import type { Bot } from 'mineflayer';

// ─────────────────────────────────────────────
// Banner
// ─────────────────────────────────────────────

function printBanner(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     Autonomous Local AI Minecraft Player          ║');
  console.log('║                                                   ║');
  console.log('║  Main objective: Complete Minecraft               ║');
  console.log('║  No user instructions required.                  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Server:  ${config.minecraft.host}:${config.minecraft.port}`);
  console.log(`  Version: ${config.minecraft.version || 'auto'}`);
  console.log(`  Bot:     ${config.minecraft.username}`);
  console.log(`  Auth:    ${config.minecraft.auth}`);
  console.log(`  LLM:     ${config.llm.provider}/${config.llm.model}`);
  console.log(`  Debug:   ${config.agent.debugMode}`);
  console.log('');
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  printBanner();

  let agent: AutonomousAgent | null = null;

  // ── Create Minecraft client with event handlers ──
  const client = new MinecraftClient(
    config.minecraft,
    config.reconnect,
    {
      onSpawn: async (bot: Bot) => {
        logger.info('[Main] Bot spawned. Starting autonomous agent...');

        // Create and initialize agent
        agent = new AutonomousAgent(bot);

        try {
          await agent.initialize();
          agent.start();
          logger.info('[Main] AI is now autonomous. Main objective: Complete Minecraft.');
          logger.info('[Main] Press Ctrl+C to stop.');
        } catch (err) {
          logger.error(`[Main] Agent initialization failed: ${err}`);
        }
      },

      onDeath: async (bot: Bot) => {
        // Agent handles death internally via bot events
        logger.info('[Main] Bot died — agent handling recovery');
      },

      onChat: (_bot: Bot, username: string, message: string) => {
        // Handle operator commands via chat
        handleChatCommand(username, message, agent);
      },

      onKicked: (_bot: Bot, reason: string) => {
        logger.warn(`[Main] Kicked: ${reason}`);
        if (agent) {
          agent.pause();
        }
      },

      onError: (_bot: Bot, err: Error) => {
        logger.error(`[Main] Bot error: ${err.message}`);
      },

      onDisconnected: (_bot: Bot) => {
        if (agent) {
          agent.pause();
          // Agent will be restarted when bot reconnects (onSpawn fires again)
          agent.stop();
          agent = null;
        }
      },

      onHealthUpdate: (_bot: Bot) => {
        // Agent's decision loop handles health reactively
      },
    },
  );

  // ── Connect ──
  logger.info(`Connecting to Minecraft...`);
  client.connect();

  // ── Status reporter (every 30s) ──
  const statusInterval = setInterval(() => {
    if (agent) {
      const status = agent.getStatus();
      const clientStats = client.getStats();

      logger.info(`[Status] ${JSON.stringify({
        uptime: status.uptime,
        goal: status.currentGoal,
        action: status.lastAction,
        health: status.playerHealth,
        food: status.playerFood,
        decisions: status.totalDecisions,
        success_rate: status.successRate,
        deaths: clientStats.deaths,
        llm: status.llmAvailable ? status.llmModel : 'heuristic',
      })}`);
    } else if (client.isConnected()) {
      logger.info('[Status] Bot connected but agent not running');
    } else {
      logger.info('[Status] Not connected');
    }
  }, 30000);

  // ── Graceful shutdown ──
  const shutdown = async (signal: string) => {
    logger.info(`\n[Main] Received ${signal}. Shutting down gracefully...`);

    clearInterval(statusInterval);

    if (agent) {
      agent.stop();
    }

    client.disconnect();

    logEvent('Agent shut down');
    logger.info('[Main] Goodbye.');

    // Give logger time to flush
    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle unhandled rejections — log but don't crash
  process.on('unhandledRejection', (reason) => {
    logger.error(`[Main] Unhandled rejection: ${reason}`);
  });

  process.on('uncaughtException', (err) => {
    logger.error(`[Main] Uncaught exception: ${err.message}`);
    // Don't crash — the agent should survive individual errors
  });
}

// ─────────────────────────────────────────────
// Chat command handler (optional operator control)
// ─────────────────────────────────────────────

function handleChatCommand(
  username: string,
  message: string,
  agent: AutonomousAgent | null,
): void {
  if (!message.startsWith('!ai ')) return;
  if (!agent) {
    logger.info(`[Chat] Command from ${username} but agent not running`);
    return;
  }

  const cmd = message.slice(4).trim().toLowerCase();
  logger.info(`[Chat] Command from ${username}: ${cmd}`);

  switch (cmd) {
    case 'status': {
      const s = agent.getStatus();
      logger.info(`[Status] ${JSON.stringify(s, null, 2)}`);
      break;
    }
    case 'pause':
      agent.pause();
      break;
    case 'resume':
      agent.resume();
      break;
    case 'goal': {
      const goals = agent.getGoals();
      logger.info(`[Goals]\n${goals.getSummary()}`);
      break;
    }
    case 'memory': {
      const mem = agent.getMemory();
      const context = mem.buildMemoryContext();
      logger.info(`[Memory] Episodes: ${context.recentEpisodes.length}`);
      logger.info(`[Memory] Facts: ${context.relevantFacts.length}`);
      logger.info(`[Memory] Locations: ${context.knownLocations.length}`);
      break;
    }
    default:
      logger.info(`[Chat] Unknown command: ${cmd}. Available: status, pause, resume, goal, memory`);
  }
}

// ─────────────────────────────────────────────
// Entry
// ─────────────────────────────────────────────

main().catch(err => {
  logger.error(`[Main] Fatal error: ${err}`);
  process.exit(1);
});
