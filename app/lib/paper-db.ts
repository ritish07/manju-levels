import { env } from 'cloudflare:workers';
import {
  PAPER_OPEN_TIME_INDEX,
  PAPER_POSITIONS_SCHEMA,
  PAPER_SIGNALS_SCHEMA,
  PAPER_STATUS_INDEX,
} from '@/db/schema';

let initialized = false;

export function paperDb() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error('PAPER_DATABASE_NOT_CONFIGURED');
  return db;
}

export async function ensurePaperDb() {
  const db = paperDb();
  if (!initialized) {
    await db.batch([
      db.prepare(PAPER_POSITIONS_SCHEMA),
      db.prepare(PAPER_SIGNALS_SCHEMA),
      db.prepare(PAPER_STATUS_INDEX),
      db.prepare(PAPER_OPEN_TIME_INDEX),
    ]);
    initialized = true;
  }
  return db;
}
