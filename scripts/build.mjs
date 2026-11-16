import { build } from 'esbuild';
await build({ entryPoints: ['src/handler.mjs'], outfile: 'dist/index.mjs', bundle: true, platform: 'node', target: 'es2022', format: 'esm', minify: true });
console.log('Built dist/index.mjs');
