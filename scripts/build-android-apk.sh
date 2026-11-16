#!/usr/bin/env bash
set -euo pipefail

echo "=== PustakaLoka Android APK Builder ==="

# 1. Generate master icon & sync Capacitor native icons + build web assets
npm run icons
npm run build
if [ ! -d "android" ]; then
  npx cap add android
fi
npx capacitor-assets generate --android || true
npx cap sync android

# 2. Verify JDK & Android SDK availability for APK compilation
if ! command -v java >/dev/null 2>&1; then
  echo ""
  echo "ERROR: Java JDK (disarankan JDK 17) tidak ditemukan di lingkungan ini."
  echo "Proyek native Android (/android) sudah siap & tersinkron dengan dist/."
  echo "Jalankan skrip ini di komputer lokal dengan JDK 17 + Android SDK / Android Studio."
  exit 1
fi

SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK_DIR" ] && [ ! -f "android/local.properties" ]; then
  echo ""
  echo "ERROR: ANDROID_HOME / ANDROID_SDK_ROOT tidak ditemukan."
  echo "Proyek native Android (/android) sudah tersinkron. Buka folder 'android/' di Android Studio untuk build APK."
  exit 1
fi

chmod +x android/gradlew
(cd android && ./gradlew assembleDebug)

APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
  echo ""
  echo "Berhasil membuat APK Android:"
  ls -lh "$APK_PATH"
fi
