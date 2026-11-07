import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './shared/schema.pg.ts',
  out: './drizzle/pg',
  dialect: 'postgresql'
});
