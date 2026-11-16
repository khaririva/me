import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist-html');

async function buildSingleHtml() {
  fs.rmSync(outDir, { recursive: true, force: true });

  await build({
    root: rootDir,
    configFile: false,
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      rolldownOptions: {
        output: {
          codeSplitting: false,
        },
      },
    },
  });

  const indexPath = path.join(outDir, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf-8');

  // Inline all local <link rel="stylesheet" href="..."> tags
  html = html.replace(
    /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
    (match, href) => {
      const assetPath = path.resolve(outDir, href.replace(/^\.?\//, ''));
      if (!fs.existsSync(assetPath)) return match;
      const css = fs.readFileSync(assetPath, 'utf-8').replace(/<\/style/gi, '<\\/style');
      return `<style>${css}</style>`;
    }
  );

  // Inline all local <script type="module" ... src="..."></script> tags
  html = html.replace(
    /<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
    (match, src) => {
      const assetPath = path.resolve(outDir, src.replace(/^\.?\//, ''));
      if (!fs.existsSync(assetPath)) return match;
      const js = fs.readFileSync(assetPath, 'utf-8').replace(/<\/script/gi, '<\\/script');
      return `<script type="module">${js}</script>`;
    }
  );

  // Remove modulepreload and root-relative icon links for standalone file:// opening
  html = html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/gi, '');

  const singleHtmlPath = path.join(outDir, 'PustakaLoka.html');
  fs.writeFileSync(singleHtmlPath, html, 'utf-8');
  fs.writeFileSync(indexPath, html, 'utf-8');

  const assetsDir = path.join(outDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    fs.rmSync(assetsDir, { recursive: true, force: true });
  }

  const sizeKb = (fs.statSync(singleHtmlPath).size / 1024).toFixed(1);
  console.log(`Built standalone HTML: dist-html/PustakaLoka.html (${sizeKb} KB)`);
}

buildSingleHtml().catch((err) => {
  console.error(err);
  process.exit(1);
});
