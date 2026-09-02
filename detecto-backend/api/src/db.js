import pg from 'pg';

import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl });

export function withClient(fn) {
  return pool.connect().then(async (client) => {
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  });
}
