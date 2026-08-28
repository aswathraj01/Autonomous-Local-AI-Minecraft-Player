/**
 * src/minecraft/client.ts
 * Mineflayer bot creation and lifecycle management.
 * Handles: connection, reconnection, event routing, death detection.
 */

import mineflayer from 'mineflayer';
import type { Bot, BotOptions } from 'mineflayer';
import type { MinecraftConfig, ReconnectConfig } from '../config';
import { logger, logEvent } from '../utils/logger';

export type BotEventHandler = {
  onSpawn?: (bot: Bot) => void;
  onDeath?: (bot: Bot) => void;
  onChat?: (bot: Bot, username: string, message: string) => void;
  onKicked?: (bot: Bot, reason: string) => void;
  onError?: (bot: Bot, err: Error) => void;
  onDisconnected?: (bot: Bot) => void;
  onHealthUpdate?: (bot: Bot) => void;
  onEntitySpawn?: (bot: Bot, entityName: string) => void;
};

export class MinecraftClient {
  private config: MinecraftConfig;
  private reconnectConfig: ReconnectConfig;
  private handlers: BotEventHandler;
  private bot: Bot | null = null;
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private shouldRun = true;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Stats
  private deaths = 0;
  private connectTime: Date | null = null;
  private disconnects = 0;

  constructor(
    config: MinecraftConfig,
    reconnectConfig: ReconnectConfig,
    handlers: BotEventHandler,
  ) {
    this.config = config;
    this.reconnectConfig = reconnectConfig;
    this.handlers = handlers;
  }

  // ─────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────

  connect(): void {
    if (this.bot) {
      logger.warn('[Client] Already connected. Disconnect first.');
      return;
    }

    logger.info(`[Client] Connecting to ${this.config.host}:${this.config.port} as "${this.config.username}"...`);

    const version = this.config.version?.trim();

    if (version) {
      // Validate version is known to minecraft-data
      const validation = this.validateVersion(version);
      if (validation.fullySupported) {
        logger.info(`[Client] Minecraft version: ${version} (protocol ${validation.protocolVersion}) | Auth: ${this.config.auth}`);
      } else if (validation.known) {
        // Version is in the version list but data files aren't bundled yet
        logger.warn(`[Client] ⚠️  Version "${version}" is recognised (protocol ${validation.protocolVersion}) but not yet fully supported by minecraft-data.`);
        if (validation.nearestSupported) {
          logger.warn(`[Client] Nearest fully-supported version: ${validation.nearestSupported}`);
          logger.warn(`[Client] Attempting connection with "${version}" anyway — this may work if the protocol change is small.`);
          logger.warn(`[Client] If the bot fails to connect, set MC_VERSION=${validation.nearestSupported} in .env as a fallback.`);
        }
      } else {
        logger.warn(`[Client] Version "${version}" not recognised at all. Attempting connection — server may auto-negotiate.`);
        logger.warn(`[Client] If connection fails, try leaving MC_VERSION blank for auto-detect.`);
      }
    } else {
      logger.info(`[Client] Minecraft version: auto-negotiate | Auth: ${this.config.auth}`);
    }


    const options: BotOptions = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      auth: this.config.auth as any,
    };

    // Only set version if explicitly configured (non-empty)
    if (version) {
      options.version = version;
    }

    try {
      this.bot = mineflayer.createBot(options);
      this.attachEventHandlers(this.bot);
    } catch (err) {
      logger.error(`[Client] Failed to create bot: ${err}`);
      this.scheduleReconnect();
    }
  }

  /** Validate that a version string is known to minecraft-data */
  private validateVersion(version: string): {
    known: boolean;
    fullySupported: boolean;
    protocolVersion?: number;
    nearestSupported?: string;
  } {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const minecraftData = require('minecraft-data');

      // Check if it's in the versions list at all
      const versionEntry = (minecraftData.versions?.pc ?? []).find(
        (v: { minecraftVersion: string }) => v.minecraftVersion === version,
      );

      if (!versionEntry) {
        return { known: false, fullySupported: false };
      }

      // Check if it's in the fully supported (has data files) list
      const supported: string[] = minecraftData.supportedVersions?.pc ?? [];
      const fullySupported = supported.includes(version);

      if (!fullySupported) {
        // Find nearest supported version
        const nearestSupported = supported[supported.length - 1] ?? undefined;
        return {
          known: true,
          fullySupported: false,
          protocolVersion: versionEntry.version,
          nearestSupported,
        };
      }

      return { known: true, fullySupported: true, protocolVersion: versionEntry.version };
    } catch {
      return { known: false, fullySupported: false };
    }
  }


  // ─────────────────────────────────────────────
  // Event handling
  // ─────────────────────────────────────────────

  private attachEventHandlers(bot: Bot): void {
    bot.once('spawn', () => {
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.connectTime = new Date();

      logger.info(`[Client] ✅ Spawned in world!`);
      logger.info(`[Client] Position: ${JSON.stringify(bot.entity?.position)}`);
      logEvent('Spawned in world');

      this.handlers.onSpawn?.(bot);
    });

    bot.on('death', () => {
      this.deaths++;
      const pos = bot.entity?.position;
      const posStr = pos ? `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}` : 'unknown';
      logger.warn(`[Client] 💀 Bot died (death #${this.deaths}) at ${posStr}`);
      logEvent(`Died at ${posStr} (death #${this.deaths})`);
      this.handlers.onDeath?.(bot);
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return; // Ignore own messages
      logger.info(`[Chat] <${username}> ${message}`);
      logEvent(`Chat from ${username}: ${message}`);
      this.handlers.onChat?.(bot, username, message);
    });

    bot.on('health', () => {
      this.handlers.onHealthUpdate?.(bot);
    });

    bot.on('entitySpawn', (entity) => {
      const name = entity.name ?? entity.type ?? 'unknown';
      if (name !== 'item' && name !== 'xp_orb' && name !== 'arrow') {
        logger.debug(`[Client] Entity spawned: ${name}`);
        this.handlers.onEntitySpawn?.(bot, name);
      }
    });

    bot.on('kicked', (reason) => {
      logger.warn(`[Client] Kicked from server: ${reason}`);
      logEvent(`Kicked: ${reason}`);
      this.handlers.onKicked?.(bot, reason);
      this.bot = null;
      this.scheduleReconnect();
    });

    bot.on('error', (err) => {
      // Log but don't crash — let disconnect handler take over
      if (err.message?.includes('ECONNREFUSED')) {
        logger.error(`[Client] Connection refused — is the server running?`);
      } else if (err.message?.includes('ETIMEDOUT')) {
        logger.error(`[Client] Connection timed out`);
      } else {
        logger.error(`[Client] Error: ${err.message}`);
      }
      this.handlers.onError?.(bot, err);
    });

    bot.on('end', (reason) => {
      if (!this.shouldRun) {
        logger.info('[Client] Disconnected (intentional shutdown)');
        return;
      }

      this.disconnects++;
      logger.warn(`[Client] Disconnected (reason: ${reason || 'unknown'}, disconnect #${this.disconnects})`);
      logEvent(`Disconnected: ${reason || 'unknown'}`);
      this.handlers.onDisconnected?.(bot);
      this.bot = null;
      this.scheduleReconnect();
    });

    // Log important game events
    bot.on('time', () => {
      // Time updates fire frequently — don't log
    });

    // Log dimension changes
    (bot as any).on?.('respawn', () => {
      logger.info(`[Client] Respawned`);
      logEvent('Respawned');
    });
  }

  // ─────────────────────────────────────────────
  // Reconnection
  // ─────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (!this.reconnectConfig.enabled || !this.shouldRun) return;
    if (this.isReconnecting) return;

    if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      logger.error(`[Client] Max reconnect attempts (${this.reconnectConfig.maxAttempts}) reached. Stopping.`);
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // Exponential backoff: delay * attempt (capped at 30s)
    const delay = Math.min(this.reconnectConfig.delayMs * this.reconnectAttempts, 30000);

    logger.info(`[Client] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.reconnectConfig.maxAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.isReconnecting = false;
      if (this.shouldRun) {
        this.connect();
      }
    }, delay);
  }

  // ─────────────────────────────────────────────
  // Control
  // ─────────────────────────────────────────────

  disconnect(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.bot) {
      this.bot.quit('Agent shutting down');
      this.bot = null;
    }
    logger.info('[Client] Disconnected intentionally');
  }

  getBot(): Bot | null {
    return this.bot;
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  // ─────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────

  getStats() {
    const uptimeMs = this.connectTime
      ? Date.now() - this.connectTime.getTime()
      : 0;
    const hours = Math.floor(uptimeMs / 3600000);
    const minutes = Math.floor((uptimeMs % 3600000) / 60000);

    return {
      connected: this.isConnected(),
      deaths: this.deaths,
      disconnects: this.disconnects,
      reconnectAttempts: this.reconnectAttempts,
      playTime: `${hours}h ${minutes}m`,
      connectTime: this.connectTime?.toISOString() ?? null,
    };
  }
}
