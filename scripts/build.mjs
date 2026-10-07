import { build } from 'esbuild';
await build({ entryPoints: ['src/lambda.mjs'], outfile: 'dist/index.mjs', bundle: true, platform: 'node', target: 'node24', format: 'esm', minify: true });
console.log('Built dist/index.mjs');
