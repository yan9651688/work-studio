import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { index: 'src/index.ts', 'db-cli': 'src/db/cli.ts' },
  format: ['esm'],
  target: 'node24',
  splitting: false,
  clean: true,
  noExternal: ['@studio/shared'],
});
