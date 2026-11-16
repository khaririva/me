import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const rootDir = process.cwd();
const assetsDir = path.join(rootDir, 'assets');
const publicDir = path.join(rootDir, 'public');
const buildDir = path.join(rootDir, 'build');
const sourceSvgPath = path.join(publicDir, 'icon.svg');

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <defs>
    <linearGradient id="pl-logo-bg" x1="40" y1="24" x2="472" y2="488" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0F172A" />
      <stop offset="55%" stop-color="#1E3A8A" />
      <stop offset="100%" stop-color="#1D4ED8" />
    </linearGradient>
    <radialGradient id="pl-logo-glow" cx="50%" cy="46%" r="44%">
      <stop offset="0%" stop-color="#60A5FA" stop-opacity="0.32" />
      <stop offset="100%" stop-color="#1E3A8A" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="pl-logo-gold" x1="296" y1="136" x2="380" y2="250" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FBBF24" />
      <stop offset="100%" stop-color="#F59E0B" />
    </linearGradient>
  </defs>
  <rect x="20" y="20" width="472" height="472" rx="112" fill="url(#pl-logo-bg)" />
  <rect x="20" y="20" width="472" height="472" rx="112" fill="url(#pl-logo-glow)" />
  <path
    d="M108 338C108 349.046 116.954 358 128 358H222C236 358 248 364 256 374C264 364 276 358 290 358H384C395.046 358 404 349.046 404 338V348C404 361.255 393.255 372 380 372H292C277.5 372 264.5 379 256 388C247.5 379 234.5 372 220 372H132C118.745 372 108 361.255 108 348V338Z"
    fill="#60A5FA"
    fill-opacity="0.85"
  />
  <path
    d="M118 164C118 150.745 128.745 140 142 140H224C241.673 140 256 154.327 256 172V362C247.5 352 235.5 346 222 346H142C128.745 346 118 335.255 118 322V164Z"
    fill="#FFFFFF"
  />
  <path
    d="M394 164C394 150.745 383.255 140 370 140H288C270.327 140 256 154.327 256 172V362C264.5 352 276.5 346 290 346H370C383.255 346 394 335.255 394 322V164Z"
    fill="#E2E8F0"
  />
  <rect x="253" y="162" width="6" height="198" rx="3" fill="#94A3B8" fill-opacity="0.55" />
  <rect x="144" y="186" width="84" height="10" rx="5" fill="#1E3A8A" fill-opacity="0.24" />
  <rect x="144" y="214" width="70" height="10" rx="5" fill="#1E3A8A" fill-opacity="0.18" />
  <rect x="144" y="242" width="80" height="10" rx="5" fill="#1E3A8A" fill-opacity="0.18" />
  <rect x="144" y="270" width="56" height="10" rx="5" fill="#1E3A8A" fill-opacity="0.14" />
  <path d="M336 140H364V210L350 198L336 210V140Z" fill="url(#pl-logo-gold)" />
  <path
    d="M320 228C322.2 252.8 331.2 261.8 356 264C331.2 266.2 322.2 275.2 320 300C317.8 275.2 308.8 266.2 284 264C308.8 261.8 317.8 252.8 320 228Z"
    fill="url(#pl-logo-gold)"
  />
  <circle cx="358" cy="296" r="7" fill="#FBBF24" />
</svg>`;

function getBaseSvg() {
  if (fs.existsSync(sourceSvgPath)) {
    return fs.readFileSync(sourceSvgPath, 'utf8');
  }
  return FALLBACK_SVG;
}

function withSize(svgText, size, { fullBleed = false } = {}) {
  let sized = svgText.replace(
    /<svg\b([^>]*)>/i,
    (_match, attrs) =>
      `<svg${attrs.replace(/\s+(width|height)=["'][^"']*["']/gi, '')} width="${size}" height="${size}">`
  );

  if (fullBleed) {
    // Expand rounded squircle rects to sharp-corner full-bleed square (0..512)
    sized = sized.replace(
      /<rect\s+x="20"\s+y="20"\s+width="472"\s+height="472"\s+rx="112"/gi,
      '<rect x="0" y="0" width="512" height="512" rx="0"'
    );
  }

  return sized;
}

async function renderPng(svgText, size, outputPath, options = {}) {
  const { fullBleed = false, opaque = false } = options;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const preparedSvg = withSize(svgText, size, { fullBleed });

  let pipeline = sharp(Buffer.from(preparedSvg), { density: 300 }).resize(size, size, {
    fit: 'contain',
    background: opaque ? { r: 15, g: 23, b: 42, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 },
  });

  if (opaque) {
    // Strip alpha channel completely so macOS & Android/iOS icon generators get solid sharp-corner PNGs
    pipeline = pipeline.flatten({ background: '#0F172A' }).removeAlpha();
  }

  await pipeline.png({ compressionLevel: 9 }).toFile(outputPath);

  const meta = await sharp(outputPath).metadata();
  console.log(
    `Generated ${path.relative(rootDir, outputPath)} (${meta.width}x${meta.height}px, alpha=${Boolean(
      meta.hasAlpha
    )})`
  );
}

async function main() {
  const baseSvg = getBaseSvg();

  // 1. Master 1024x1024 full-bleed opaque PNG (no corner transparency) for Electron macOS & @capacitor/assets (Android/iOS)
  await renderPng(baseSvg, 1024, path.join(assetsDir, 'icon.png'), {
    fullBleed: true,
    opaque: true,
  });

  // 2. Public & Electron build icon variants
  await renderPng(baseSvg, 512, path.join(publicDir, 'icon-512.png'));
  await renderPng(baseSvg, 1024, path.join(publicDir, 'icon.png'), {
    fullBleed: true,
    opaque: true,
  });
  await renderPng(baseSvg, 1024, path.join(buildDir, 'icon.png'), {
    fullBleed: true,
    opaque: true,
  });

  // 3. PWA & Apple Touch icons kept in sync
  await renderPng(baseSvg, 512, path.join(publicDir, 'pwa-512x512.png'));
  await renderPng(baseSvg, 192, path.join(publicDir, 'pwa-192x192.png'));
  await renderPng(baseSvg, 512, path.join(publicDir, 'pwa-maskable-512x512.png'), {
    fullBleed: true,
    opaque: true,
  });
  await renderPng(baseSvg, 180, path.join(publicDir, 'apple-touch-icon.png'), {
    fullBleed: true,
    opaque: true,
  });
}

main().catch((err) => {
  console.error('Gagal membuat aset ikon PustakaLoka:', err);
  process.exit(1);
});
