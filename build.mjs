import * as esbuild from 'esbuild';
import { rmSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ['src/main.js'],
  outfile: 'dist/app.js',
  bundle: true,
  format: 'esm',
  target: 'es2020',
  sourcemap: true,
  minify: !watch,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(opts);
}
