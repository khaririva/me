import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { QRCodeSVG } from 'qrcode.react';
import {
  Camera,
  Check,
  Copy,
  ImageUp,
  Laptop,
  Link2,
  LogOut,
  Pencil,
  PlusCircle,
  QrCode,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import {
  generateSyncPassphrase,
  isValidPassphrase,
  normalizePassphrase,
} from '../services/syncService';
import type { SyncConnectionStatus, SyncDeviceInfo } from '../types/reader';

interface SyncChainSectionProps {
  passphrase: string;
  chainHash: string | null;
  syncStatus: SyncConnectionStatus;
  syncError: string | null;
  devices: SyncDeviceInfo[];
  localDeviceId: string;
  localDeviceName: string;
  onJoinOrCreateChain: (passphrase: string) => void;
  onLeaveChain: () => void;
  onRenameDevice: (name: string) => void | Promise<void>;
  onRemoveDevice: (deviceId: string) => void | Promise<void>;
}

function formatRelativeSyncTime(timestamp: number, nowMs: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'Baru saja';
  const diffSec = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  if (diffSec < 60) return 'Baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} hari lalu`;
}

function extractPassphraseFromQr(rawText: string): string {
  const trimmed = rawText.trim();
  const stripped = trimmed.replace(/^pustakaloka-sync:(?:\/\/chain\/)?/i, '');
  return normalizePassphrase(stripped);
}

export const SyncChainSection: React.FC<SyncChainSectionProps> = ({
  passphrase,
  chainHash,
  syncStatus,
  syncError,
  devices,
  localDeviceId,
  localDeviceName,
  onJoinOrCreateChain,
  onLeaveChain,
  onRenameDevice,
  onRemoveDevice,
}) => {
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [editingDeviceName, setEditingDeviceName] = useState(false);
  const [deviceNameInput, setDeviceNameInput] = useState(localDeviceName);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [scanningCamera, setScanningCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const qrFileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCameraScanner = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanningCamera(false);
  }, []);

  useEffect(() => {
    setDeviceNameInput(localDeviceName);
  }, [localDeviceName]);

  useEffect(() => {
    if (!passphrase) return;
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, [passphrase]);

  useEffect(() => {
    return () => {
      stopCameraScanner();
    };
  }, [stopCameraScanner]);

  const handleDecodedQr = useCallback(
    (rawData: string) => {
      const parsed = extractPassphraseFromQr(rawData);
      if (!isValidPassphrase(parsed)) {
        setJoinError('QR Code bukan Kode Frasa PustakaLoka Sync Chain yang valid.');
        return;
      }
      stopCameraScanner();
      setJoinError(null);
      setJoinInput(parsed);
      onJoinOrCreateChain(parsed);
    },
    [onJoinOrCreateChain, stopCameraScanner]
  );

  const startCameraScanner = async () => {
    setCameraError(null);
    setJoinError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Kamera tidak tersedia di peramban ini. Gunakan input kode frasa atau unggah gambar QR.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setScanningCamera(true);

      requestAnimationFrame(() => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        void video.play().catch(() => {});

        const scanFrame = () => {
          if (!streamRef.current || !videoRef.current) return;
          const v = videoRef.current;
          if (v.readyState >= v.HAVE_ENOUGH_DATA && v.videoWidth > 0 && v.videoHeight > 0) {
            const canvas = canvasRef.current || document.createElement('canvas');
            canvasRef.current = canvas;
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imgData.data, imgData.width, imgData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (code?.data) {
                handleDecodedQr(code.data);
                return;
              }
            }
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        };

        rafRef.current = requestAnimationFrame(scanFrame);
      });
    } catch {
      stopCameraScanner();
      setCameraError('Izin kamera ditolak atau tidak tersedia. Masukkan kode frasa manual atau pilih gambar QR.');
    }
  };

  const handleQrImageUpload = async (file: File) => {
    setJoinError(null);
    setCameraError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setJoinError('Gagal memproses gambar QR.');
        return;
      }
      ctx.drawImage(bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imgData.data, imgData.width, imgData.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (!code?.data) {
        setJoinError('Tidak ditemukan QR Code pada gambar yang dipilih.');
        return;
      }
      handleDecodedQr(code.data);
    } catch {
      setJoinError('Gagal membaca gambar QR Code.');
    }
  };

  const handleStartNewChain = () => {
    const newPhrase = generateSyncPassphrase(8);
    onJoinOrCreateChain(newPhrase);
  };

  const handleSubmitJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = extractPassphraseFromQr(joinInput);
    if (!isValidPassphrase(normalized)) {
      setJoinError('Masukkan minimal 6–8 kata kode frasa Sync Chain yang valid.');
      return;
    }
    setJoinError(null);
    stopCameraScanner();
    onJoinOrCreateChain(normalized);
  };

  const handleCopyPhrase = async () => {
    if (!passphrase) return;
    try {
      await navigator.clipboard.writeText(passphrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const statusMeta = (() => {
    if (syncStatus === 'synced') {
      return {
        dotClass: 'bg-emerald-500',
        label: 'Tersinkron otomatis',
        textClass: 'text-emerald-600 dark:text-emerald-400',
      };
    }
    if (syncStatus === 'syncing') {
      return {
        dotClass: 'bg-emerald-500 animate-pulse',
        label: 'Menyinkronkan...',
        textClass: 'text-emerald-600 dark:text-emerald-400',
      };
    }
    if (syncStatus === 'connecting') {
      return {
        dotClass: 'bg-amber-500 animate-pulse',
        label: 'Menghubungkan...',
        textClass: 'text-amber-600 dark:text-amber-400',
      };
    }
    if (syncStatus === 'error') {
      return {
        dotClass: 'bg-rose-500',
        label: 'Gangguan koneksi sinkron',
        textClass: 'text-rose-600 dark:text-rose-400',
      };
    }
    return {
      dotClass: 'bg-slate-400',
      label: 'Belum terhubung',
      textClass: 'text-[var(--text-secondary)]',
    };
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-color)] bg-slate-500/5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="min-w-0">
            <p className="text-xs font-bold">Sinkronisasi Perangkat (Sync Chain)</p>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Posisi baca, penanda paragraf, dan terjemahan AI tersinkron otomatis tanpa akun.
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${statusMeta.textClass}`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusMeta.dotClass}`} />
          <span>{statusMeta.label}</span>
        </div>
      </div>

      {passphrase ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-[var(--border-color)] bg-slate-500/5 p-4 sm:flex-row sm:items-start">
            <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs">
              <QRCodeSVG value={passphrase} size={152} level="M" />
            </div>

            <div className="min-w-0 flex-1 space-y-2.5 text-center sm:text-left">
              <div>
                <p className="text-xs font-bold">Kode Frasa Sync Chain (8 Kata)</p>
                <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                  Pindai QR Code atau salin kode frasa di bawah pada perangkat lain (MacBook / Android).
                </p>
              </div>

              <div className="mac-surface rounded-xl border p-2.5 text-left">
                <p className="font-mono-mac break-all text-xs font-semibold leading-relaxed select-all">
                  {passphrase}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <button
                  type="button"
                  onClick={handleCopyPhrase}
                  className="mac-surface inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-500/10"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Salin Kode Frasa</span>
                    </>
                  )}
                </button>
              </div>

              {chainHash && (
                <p className="font-mono-mac truncate text-[10px] text-[var(--text-secondary)]">
                  ID Ruang (SHA-256): {chainHash.slice(0, 16)}…{chainHash.slice(-8)}
                </p>
              )}
            </div>
          </div>

          {syncError && syncStatus === 'error' && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-600 dark:text-rose-400">
              {syncError}
            </div>
          )}

          {/* Connected Devices List + Custom Device Name */}
          <div className="space-y-2.5 rounded-2xl border border-[var(--border-color)] bg-slate-500/5 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold">
                Daftar Perangkat Terhubung ({Math.max(1, devices.length)})
              </p>
              {!editingDeviceName && (
                <button
                  type="button"
                  onClick={() => {
                    setDeviceNameInput(localDeviceName);
                    setEditingDeviceName(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  <Pencil className="h-3 w-3" />
                  <span>Ubah Nama Perangkat Ini</span>
                </button>
              )}
            </div>

            {editingDeviceName && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void onRenameDevice(deviceNameInput);
                  setEditingDeviceName(false);
                }}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-2"
              >
                <input
                  type="text"
                  value={deviceNameInput}
                  onChange={(e) => setDeviceNameInput(e.target.value)}
                  maxLength={64}
                  placeholder="Contoh: MacBook Pro / Pixel 8"
                  className="mac-surface min-h-[34px] min-w-0 flex-1 rounded-lg border px-2.5 py-1 text-xs focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="min-h-[34px] rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700"
                >
                  Simpan
                </button>
                <button
                  type="button"
                  onClick={() => setEditingDeviceName(false)}
                  className="mac-surface min-h-[34px] rounded-lg border px-2.5 py-1 text-xs font-semibold transition hover:bg-slate-500/10"
                >
                  Batal
                </button>
              </form>
            )}

            <div className="space-y-1.5">
              {(devices.length > 0
                ? devices
                : [
                    {
                      deviceId: localDeviceId,
                      name: localDeviceName,
                      platform: 'desktop' as const,
                      lastActive: nowTick,
                    },
                  ]
              ).map((dev) => {
                const isThisDevice = dev.deviceId === localDeviceId;
                const isRemoving = removingDeviceId === dev.deviceId;
                return (
                  <div
                    key={dev.deviceId}
                    className={`mac-surface flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
                      isThisDevice ? 'border-emerald-500/40 bg-emerald-500/5' : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-500/10 text-[var(--text-primary)]">
                        {dev.platform === 'mobile' ? (
                          <Smartphone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <Laptop className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-xs font-bold">{dev.name}</span>
                          {isThisDevice && (
                            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                              Perangkat Ini
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--text-secondary)]">
                          Sinkron terakhir: {formatRelativeSyncTime(dev.lastActive, nowTick)}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isRemoving}
                      onClick={async () => {
                        setRemovingDeviceId(dev.deviceId);
                        try {
                          await onRemoveDevice(dev.deviceId);
                        } finally {
                          setRemovingDeviceId(null);
                        }
                      }}
                      className="inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-lg border border-rose-500/30 px-2.5 py-1 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-400"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Hapus Perangkat</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-color)] pt-3">
            <p className="text-[11px] text-[var(--text-secondary)]">
              Tersimpan permanen di perangkat ini sampai Anda keluar.
            </p>
            <button
              type="button"
              onClick={onLeaveChain}
              className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-400"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Keluar dari Sync Chain</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              onClick={handleStartNewChain}
              className="flex min-h-[54px] items-center gap-3 rounded-xl bg-blue-600 px-3.5 py-2.5 text-left text-white shadow-xs transition hover:bg-blue-700 active:scale-[0.99]"
            >
              <PlusCircle className="h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-bold">Mulai Sync Chain Baru</div>
                <div className="text-[11px] text-blue-100">Buat 8 kata unik &amp; QR Code</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setJoinOpen((v) => !v)}
              className={`mac-surface flex min-h-[54px] items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition hover:bg-slate-500/10 ${
                joinOpen ? 'border-blue-500 ring-1 ring-blue-500/30' : ''
              }`}
            >
              <Link2 className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
              <div className="min-w-0">
                <div className="text-xs font-bold">Gabung ke Sync Chain</div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  Masukkan frasa atau pindai QR
                </div>
              </div>
            </button>
          </div>

          {joinOpen && (
            <form
              onSubmit={handleSubmitJoin}
              className="space-y-3 rounded-2xl border border-[var(--border-color)] bg-slate-500/5 p-3.5"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="sync-chain-passphrase-input"
                  className="text-xs font-semibold"
                >
                  Kode Frasa 8 Kata
                </label>
                <textarea
                  id="sync-chain-passphrase-input"
                  rows={2}
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  placeholder="Contoh: elang-samudra-bintang-kopi-hutan-senja-awan-lentera"
                  className="mac-surface font-mono-mac w-full rounded-xl border px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (scanningCamera) {
                      stopCameraScanner();
                    } else {
                      void startCameraScanner();
                    }
                  }}
                  className="mac-surface inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-500/10"
                >
                  {scanningCamera ? (
                    <>
                      <X className="h-3.5 w-3.5 text-rose-500" />
                      <span>Tutup Kamera</span>
                    </>
                  ) : (
                    <>
                      <Camera className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Pindai QR Code</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => qrFileInputRef.current?.click()}
                  className="mac-surface inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-500/10"
                >
                  <ImageUp className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                  <span>Dari Gambar QR</span>
                </button>

                <input
                  ref={qrFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleQrImageUpload(file);
                    e.target.value = '';
                  }}
                />
              </div>

              {scanningCamera && (
                <div className="relative overflow-hidden rounded-xl border border-blue-500/40 bg-black">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="max-h-56 w-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/60 py-1.5 text-[11px] font-medium text-white">
                    <QrCode className="h-3.5 w-3.5" />
                    <span>Arahkan kamera ke QR Code perangkat lain…</span>
                  </div>
                </div>
              )}

              {cameraError && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">{cameraError}</p>
              )}
              {joinError && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">{joinError}</p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="min-h-[38px] rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                >
                  Hubungkan Perangkat
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
