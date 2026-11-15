import React from 'react';
import { Keyboard, X } from 'lucide-react';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: '⌘ O', label: 'Unggah / Buka file EPUB dari Finder' },
  { keys: '⌘ \\', label: 'Tampilkan atau sembunyikan sidebar pustaka' },
  { keys: '⌘ T', label: 'Terjemahkan halaman atau bab aktif' },
  { keys: '⌘ D', label: 'Tandai posisi halaman saat ini' },
  { keys: '⌘ F', label: 'Aktifkan atau keluar dari Mode Fokus Baca' },
  { keys: '← / →', label: 'Pindah ke halaman sebelumnya atau berikutnya' },
  { keys: 'Esc', label: 'Tutup panel atau keluar dari Mode Fokus' },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, onClose }) => {
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
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] pb-3">
          <div className="flex items-center gap-2.5">
            <Keyboard className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h3 className="text-base font-bold">Pintasan Papan Ketik MacBook</h3>
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

        <div className="mt-4 divide-y divide-[var(--border-color)]">
          {SHORTCUTS.map((item) => (
            <div key={item.keys} className="flex items-center justify-between gap-4 py-2.5 text-xs sm:text-sm">
              <span className="text-[var(--text-secondary)]">{item.label}</span>
              <kbd className="font-mono-mac shrink-0 rounded-lg border border-[var(--border-color)] px-2.5 py-1 text-xs font-semibold tabular-nums">
                {item.keys}
              </kbd>
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-xs font-semibold transition hover:bg-slate-500/10 whitespace-nowrap shrink-0"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
};
