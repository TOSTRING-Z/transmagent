const esbuild = require('esbuild');
const path = require('path');

const watchMode = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: [path.join(__dirname, 'main', 'main.ts')],
  outfile: path.join(__dirname, 'renderer.js'),
  bundle: true,
  minify: false, // Set to true for production
  sourcemap: true,
  platform: 'browser',
  target: ['es2020'],
  format: 'iife',
};

async function build() {
  if (watchMode) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('👀 Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    console.log('✅ Build successful! renderer.js generated.');
  }
}

build().catch(() => process.exit(1));