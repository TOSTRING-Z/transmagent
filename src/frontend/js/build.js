const esbuild = require('esbuild');
const path = require('path');

const watchMode = process.argv.includes('--watch');

const buildRendererOptions = {
  entryPoints: [path.join(__dirname, 'main', 'renderer.ts')],
  outfile: path.join(__dirname, 'renderer.js'),
  bundle: true,
  minify: false, // Set to true for production
  sourcemap: true,
  platform: 'browser',
  target: ['es2020'],
  format: 'iife',
};

const buildSubagentOptions = {
  entryPoints: [path.join(__dirname, 'main', 'subagent.ts')],
  outfile: path.join(__dirname, 'subagent.js'),
  bundle: true,
  minify: false, // Set to true for production
  sourcemap: true,
  platform: 'browser',
  target: ['es2020'],
  format: 'iife',
};

async function build(options) {
  if (watchMode) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('👀 Watching for changes...');
  } else {
    await esbuild.build(options);
    console.log('✅ Build successful! renderer.js generated.');
  }
}

build(buildRendererOptions).catch(() => process.exit(1));
build(buildSubagentOptions).catch(() => process.exit(1));