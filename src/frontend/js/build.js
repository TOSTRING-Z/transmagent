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

// Demo 模式独立窗口的入口
const buildDemoOptions = {
  entryPoints: [path.join(__dirname, 'demo', 'main.ts')],
  outfile: path.join(__dirname, 'renderer-demo.js'),
  bundle: true,
  minify: false,
  sourcemap: true,
  platform: 'browser',
  target: ['es2020'],
  format: 'iife',
};

async function build(options, label) {
  if (watchMode) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log(`👀 Watching ${label}...`);
  } else {
    await esbuild.build(options);
    console.log(`✅ Build successful: ${label}`);
  }
}

Promise.all([
  build(buildRendererOptions, 'renderer.js'),
  build(buildSubagentOptions, 'subagent.js'),
  build(buildDemoOptions, 'renderer-demo.js'),
]).catch(() => process.exit(1));