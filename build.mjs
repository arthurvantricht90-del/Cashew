import * as esbuild from 'esbuild';
import fs from 'fs';
const textWorker = {
  name: 'text-worker',
  setup(b) {
    b.onResolve({ filter: /pdf\.worker\.min\.mjs$/ }, a => ({ path: new URL(import.meta.resolve(a.path)).pathname, namespace: 'txt' }));
    b.onLoad({ filter: /.*/, namespace: 'txt' }, a => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }));
  },
};
const r = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', minify: true, write: false,
  target: ['chrome100', 'firefox100', 'safari15'], plugins: [textWorker], legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/style.css', 'utf8');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f6f6f4">
<title>Cashew</title>
<style>${css}</style></head>
<body><div id="app"></div><script>${js}</script></body></html>`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
