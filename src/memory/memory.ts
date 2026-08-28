/**
 * src/memory/memory.ts
 * Memory coordinator — creates and exposes all memory subsystems.
 * Phase 1: SQLite tables created, basic read/write implemented.
 * Phase 5: LLM will query memory to inform decisions.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import type { MemoryConfig } from '../config';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface Episode {
  id?: number;
  timestamp: number;
  event: string;
  outcome: string;
  lesson?: string;
  position?: string; // JSON string of {x,y,z}
}

export interface SemanticFact {
  id?: number;
  fact: string;
  confidence: number; // 0.0–1.0
  category: string;   // e.g., 'crafting', 'combat', 'navigation', 'survival'
  createdAt: number;
}

export interface KnownLocation {
  id?: number;
  name: string;
  x: number;
  y: number;
  z: number;
  dimension: string;
  description?: string;
  importance: number; // 0–10
  createdAt: number;
}

export interface MemoryContext {
  recentEpisodes: string[];
  relevantFacts: string[];
  knownLocations: KnownLocation[];
}

// ─────────────────────────────────────────────
// Memory manager
// ─────────────────────────────────────────────

export class MemoryManager {
  private db: Database.Database;
  private config: MemoryConfig;

  constructor(cfg: MemoryConfig) {
    this.config = cfg;

    // Ensure data directory exists
    const memoryDir = path.join(cfg.dataDir, 'memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    const dbPath = path.join(memoryDir, 'agent.db');
    this.db = new Database(dbPath);
    logger.info(`[Memory] Database: ${dbPath}`);

    this.initSchema();
    this.seedDefaultFacts();
  }

  // ─────────────────────────────────────────────
  // Schema initialization
  // ─────────────────────────────────────────────

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;

      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        event TEXT NOT NULL,
        outcome TEXT NOT NULL,
        lesson TEXT,
        position TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS semantic_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact TEXT NOT NULL UNIQUE,
        confidence REAL NOT NULL DEFAULT 0.8,
        category TEXT NOT NULL DEFAULT 'general',
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS known_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        dimension TEXT NOT NULL DEFAULT 'overworld',
        description TEXT,
        importance INTEGER NOT NULL DEFAULT 5,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        goal TEXT NOT NULL,
        assessment TEXT,
        action_type TEXT NOT NULL,
        action_detail TEXT,
        result TEXT,
        success INTEGER DEFAULT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_timestamp ON episodes(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_facts_category ON semantic_facts(category);
    `);

    logger.debug('[Memory] Schema initialized');
  }

  // ─────────────────────────────────────────────
  // Seed default Minecraft facts
  // ─────────────────────────────────────────────

  private seedDefaultFacts(): void {
    const facts: Omit<SemanticFact, 'id' | 'createdAt'>[] = [
      // Survival
      { fact: 'Food below 6 causes health drain. Prioritize eating when hungry.', confidence: 1.0, category: 'survival' },
      { fact: 'Hostile mobs spawn in darkness (light level < 7). Torches prevent spawning.', confidence: 1.0, category: 'survival' },
      { fact: 'Creepers are silent until close and deal massive explosion damage. Keep distance.', confidence: 1.0, category: 'combat' },
      { fact: 'Sleeping in a bed skips the night and sets your respawn point.', confidence: 1.0, category: 'survival' },
      { fact: 'Lava deals 8 damage per second. Avoid it unless you have fire resistance.', confidence: 1.0, category: 'survival' },
      // Resources
      { fact: 'Iron ore is found between Y=15 and Y=60. Most common around Y=16.', confidence: 0.9, category: 'resources' },
      { fact: 'Diamond ore is found at Y=-54 to Y=16. Most common at Y=-58.', confidence: 0.9, category: 'resources' },
      { fact: 'Obsidian is formed when water touches lava source blocks.', confidence: 1.0, category: 'resources' },
      { fact: 'Crafting a pickaxe requires 3 material + 2 sticks.', confidence: 1.0, category: 'crafting' },
      { fact: 'Coal and charcoal can be used as furnace fuel.', confidence: 1.0, category: 'crafting' },
      { fact: 'Wood can be converted to planks (4 per log). Planks make sticks (4 per 2 planks).', confidence: 1.0, category: 'crafting' },
      // Progression
      { fact: 'Nether requires an obsidian portal (min 2x3 inner) activated with flint_and_steel.', confidence: 1.0, category: 'progression' },
      { fact: 'Blaze rods come from Blazes in Nether Fortresses. Needed for brewing.', confidence: 1.0, category: 'progression' },
      { fact: 'Ender Pearls come from Endermen or can be traded with Piglins.', confidence: 0.9, category: 'progression' },
      { fact: 'Eye of Ender = Ender Pearl + Blaze Powder. Used to locate and activate End portal.', confidence: 1.0, category: 'progression' },
      { fact: 'The End Portal is inside a Stronghold, usually found by throwing Eyes of Ender.', confidence: 1.0, category: 'progression' },
      // Combat
      { fact: 'Shields block most melee and ranged attacks when right-clicked.', confidence: 1.0, category: 'combat' },
      { fact: 'Charging a bow fully deals more damage. Arrows can be retrieved after shots.', confidence: 1.0, category: 'combat' },
      { fact: 'Zombies and skeletons burn in sunlight. Night danger decreases at dawn.', confidence: 1.0, category: 'combat' },
      // Navigation
      { fact: 'Coordinates: X is East/West, Y is height (64 is sea level), Z is North/South.', confidence: 1.0, category: 'navigation' },
      { fact: 'F3 screen shows coordinates, biome, and light level in vanilla Minecraft.', confidence: 1.0, category: 'navigation' },
    ];

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO semantic_facts (fact, confidence, category)
      VALUES (@fact, @confidence, @category)
    `);

    const insertMany = this.db.transaction((items: typeof facts) => {
      for (const item of items) {
        stmt.run(item);
      }
    });

    insertMany(facts);
    logger.debug('[Memory] Default facts seeded');
  }

  // ─────────────────────────────────────────────
  // Episodes (episodic memory)
  // ─────────────────────────────────────────────

  saveEpisode(episode: Omit<Episode, 'id'>): void {
    try {
      this.db.prepare(`
        INSERT INTO episodes (timestamp, event, outcome, lesson, position)
        VALUES (@timestamp, @event, @outcome, @lesson, @position)
      `).run({
        timestamp: episode.timestamp,
        event: episode.event,
        outcome: episode.outcome,
        lesson: episode.lesson ?? null,
        position: episode.position ?? null,
      });

      // Prune old episodes if over limit
      const count = (this.db.prepare('SELECT COUNT(*) as c FROM episodes').get() as any).c as number;
      if (count > this.config.maxEpisodes) {
        this.db.prepare(`
          DELETE FROM episodes WHERE id IN (
            SELECT id FROM episodes ORDER BY timestamp ASC LIMIT ?
          )
        `).run(count - this.config.maxEpisodes);
      }
    } catch (err) {
      logger.error(`[Memory] Failed to save episode: ${err}`);
    }
  }

  getRecentEpisodes(limit = 10): Episode[] {
    return this.db.prepare(`
      SELECT * FROM episodes ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as Episode[];
  }

  // ─────────────────────────────────────────────
  // Semantic facts
  // ─────────────────────────────────────────────

  saveFact(fact: string, category: string, confidence = 0.8): void {
    try {
      this.db.prepare(`
        INSERT INTO semantic_facts (fact, confidence, category)
        VALUES (@fact, @confidence, @category)
        ON CONFLICT(fact) DO UPDATE SET
          confidence = MAX(confidence, @confidence),
          updated_at = strftime('%s', 'now') * 1000
      `).run({ fact, confidence, category });
    } catch (err) {
      logger.error(`[Memory] Failed to save fact: ${err}`);
    }
  }

  getFactsByCategory(category: string, limit = 10): SemanticFact[] {
    return this.db.prepare(`
      SELECT * FROM semantic_facts
      WHERE category = ?
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `).all(category, limit) as SemanticFact[];
  }

  getAllFacts(limit = 30): SemanticFact[] {
    return this.db.prepare(`
      SELECT * FROM semantic_facts
      ORDER BY confidence DESC
      LIMIT ?
    `).all(limit) as SemanticFact[];
  }

  // ─────────────────────────────────────────────
  // Known locations
  // ─────────────────────────────────────────────

  saveLocation(loc: Omit<KnownLocation, 'id' | 'createdAt'>): void {
    try {
      this.db.prepare(`
        INSERT INTO known_locations (name, x, y, z, dimension, description, importance)
        VALUES (@name, @x, @y, @z, @dimension, @description, @importance)
        ON CONFLICT(name) DO UPDATE SET
          x = @x, y = @y, z = @z,
          dimension = @dimension,
          description = COALESCE(@description, description),
          importance = MAX(importance, @importance)
      `).run({
        name: loc.name,
        x: loc.x,
        y: loc.y,
        z: loc.z,
        dimension: loc.dimension,
        description: loc.description ?? null,
        importance: loc.importance,
      });
    } catch (err) {
      logger.error(`[Memory] Failed to save location: ${err}`);
    }
  }

  getLocation(name: string): KnownLocation | null {
    return (this.db.prepare('SELECT * FROM known_locations WHERE name = ?').get(name) as KnownLocation) ?? null;
  }

  getAllLocations(): KnownLocation[] {
    return this.db.prepare(`
      SELECT * FROM known_locations ORDER BY importance DESC, created_at DESC
    `).all() as KnownLocation[];
  }

  // ─────────────────────────────────────────────
  // Decisions log
  // ─────────────────────────────────────────────

  logDecision(entry: {
    timestamp: number;
    goal: string;
    assessment?: string;
    actionType: string;
    actionDetail?: string;
  }): number {
    try {
      const result = this.db.prepare(`
        INSERT INTO decisions (timestamp, goal, assessment, action_type, action_detail)
        VALUES (@timestamp, @goal, @assessment, @action_type, @action_detail)
      `).run({
        timestamp: entry.timestamp,
        goal: entry.goal,
        assessment: entry.assessment ?? null,
        action_type: entry.actionType,
        action_detail: entry.actionDetail ?? null,
      });
      return result.lastInsertRowid as number;
    } catch (err) {
      logger.error(`[Memory] Failed to log decision: ${err}`);
      return -1;
    }
  }

  updateDecisionResult(id: number, result: string, success: boolean): void {
    try {
      this.db.prepare(`
        UPDATE decisions SET result = ?, success = ? WHERE id = ?
      `).run(result, success ? 1 : 0, id);
    } catch (err) {
      logger.error(`[Memory] Failed to update decision result: ${err}`);
    }
  }

  // ─────────────────────────────────────────────
  // Build memory context for LLM
  // ─────────────────────────────────────────────

  buildMemoryContext(): MemoryContext {
    const recentEpisodes = this.getRecentEpisodes(5).map(e =>
      `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.event} → ${e.outcome}${e.lesson ? ` (lesson: ${e.lesson})` : ''}`,
    );

    const facts = this.getAllFacts(15).map(f => f.fact);

    const locations = this.getAllLocations();

    return {
      recentEpisodes,
      relevantFacts: facts,
      knownLocations: locations,
    };
  }

  // ─────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────

  close(): void {
    this.db.close();
    logger.debug('[Memory] Database closed');
  }
}
