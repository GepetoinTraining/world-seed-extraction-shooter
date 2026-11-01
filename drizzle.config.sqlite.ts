import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/schema.sqlite.ts',
  out: './drizzle/sqlite',
  dialect: 'turso',
  dbCredentials: { url: process.env.WS_DATABASE_URL ?? 'file:data/test-claude.db' }
});
