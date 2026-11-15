import React from 'react';
import { Download, Laptop, Share, X } from 'lucide-react';

interface PWAInstallModalProps {
  open: boolean;
  onClose: () => void;
  isInstallable: boolean;
  isSafariMac: boolean;
  isIOS: boolean;
  onInstallClick: () => void;
}

export const PWAInstallModal: React.FC<PWAInstallModalProps> = ({
  open,
  onClose,
  isInstallable,
  isSafariMac,
  isIOS,
  onInstallClick,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="mac-surface w-full max-w-md rounded-2xl border p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Laptop className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold leading-snug">Pasang di Dock MacBook</h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Jalankan sebagai aplikasi desktop terpisah tanpa bilah browser
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-slate-500/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4 text-sm leading-relaxed">
          {isInstallable ? (
            <div className="space-y-3">
              <p className="text-[var(--text-secondary)]">
                Browser Anda mendukung pemasangan langsung sebagai aplikasi desktop MacBook dengan dukungan pustaka luring.
              </p>
              <button
                type="button"
                onClick={() => {
                  onInstallClick();
                  onClose();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                <Download className="h-4 w-4" />
                Pasang PustakaMac Sekarang
              </button>
            </div>
          ) : isSafariMac ? (
            <div className="space-y-2.5 rounded-xl border border-[var(--border-color)] p-4">
              <p className="font-semibold">Safari di macOS</p>
              <ol className="list-decimal space-y-1.5 pl-4 text-xs text-[var(--text-secondary)]">
                <li>
                  Buka menu <strong>File</strong> di bilah menu atas MacBook, lalu pilih{' '}
                  <strong>Add to Dock…</strong> (Tambahkan ke Dock).
                </li>
                <li>
                  Atau klik ikon <Share className="mx-0.5 inline h-3.5 w-3.5" /> <strong>Share</strong> di
                  kanan bilah alamat Safari lalu pilih <strong>Add to Dock</strong>.
                </li>
                <li>Klik <strong>Add</strong> untuk memunculkan ikon PustakaMac di Dock dan Launchpad.</li>
              </ol>
            </div>
          ) : isIOS ? (
            <div className="space-y-2.5 rounded-xl border border-[var(--border-color)] p-4">
              <p className="font-semibold">Safari di iPhone / iPad</p>
              <ol className="list-decimal space-y-1.5 pl-4 text-xs text-[var(--text-secondary)]">
                <li>Ketuk tombol <strong>Share</strong> di toolbar Safari.</li>
                <li>Gulir ke bawah dan pilih <strong>Add to Home Screen</strong>.</li>
              </ol>
            </div>
          ) : (
            <div className="space-y-2.5 rounded-xl border border-[var(--border-color)] p-4">
              <p className="font-semibold">Chrome, Edge, atau Safari di MacBook</p>
              <ul className="list-disc space-y-1.5 pl-4 text-xs text-[var(--text-secondary)]">
                <li>
                  <strong>Google Chrome / Arc / Edge:</strong> Klik ikon pemasangan di kanan bilah alamat atau buka menu{' '}
                  <strong>Cast, save, and share → Install PustakaMac</strong>.
                </li>
                <li>
                  <strong>Safari macOS:</strong> Buka menu <strong>File → Add to Dock</strong> untuk menyematkan aplikasi langsung di Dock MacBook.
                </li>
              </ul>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-xs font-semibold transition hover:bg-slate-500/10 whitespace-nowrap shrink-0"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
