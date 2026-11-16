#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "  PustakaLoka — Pembuat File .dmg untuk Mac Lokal"
echo "=================================================="

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: Pembuatan file .dmg macOS memerlukan komputer Mac (macOS dengan hdiutil)."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js tidak ditemukan. Pasang Node.js 20+ terlebih dahulu."
  exit 1
fi

echo "[1/4] Memasang dependensi proyek..."
npm install

echo "[2/4] Memasang Electron & electron-builder sementara..."
npm install --no-save electron electron-builder

echo "[3/4] Membuat ikon 1024x1024 & membangun aplikasi web produksi (Vite)..."
npm run icons
npm run build

echo "[4/4] Mengemas file .dmg universal (Apple Silicon + Intel)..."
npx electron-builder --mac dmg --config electron-builder.json

echo ""
echo "Selesai! File .dmg tersedia di folder ./release/"
ls -lh release/*.dmg
