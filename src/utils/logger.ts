/**
 * src/utils/logger.ts
 * Winston logger used throughout the project.
 * Supports colored console output + file logging.
 */

import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const logsDir = path.resolve(process.cwd(), 'data', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const { combine, timestamp, colorize, printf, errors } = winston.format;

const consoleFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level}] ${message}${metaStr}`;
});

const fileFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level.toUpperCase()}] ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env['DEBUG_MODE'] === 'true' ? 'debug' : 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'HH:mm:ss' }),
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'HH:mm:ss' }),
        consoleFormat,
      ),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'agent.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        fileFormat,
      ),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        fileFormat,
      ),
    }),
  ],
});

/** Structured event log for the dashboard (Phase 8) */
export const eventLogger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp({ format: 'HH:mm:ss' }),
    printf(({ message, timestamp: ts }) => `[${ts}] ${message}`),
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'events.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});

export function logEvent(message: string): void {
  eventLogger.info(message);
  logger.info(`[EVENT] ${message}`);
}
