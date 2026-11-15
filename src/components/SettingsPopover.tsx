import React from 'react';
import { BookA, Coffee, Moon, SlidersHorizontal, Sun, X } from 'lucide-react';
import type { ReaderFont, ReaderTheme, ReadingMode } from '../types/reader';

interface SettingsPopoverProps {
  open: boolean;
  onClose: () => void;
  readingMode: ReadingMode;
  onChangeReadingMode: (mode: ReadingMode) => void;
  theme: ReaderTheme;
  onChangeTheme: (theme: ReaderTheme) => void;
  fontFamily: ReaderFont;
  onChangeFontFamily: (font: ReaderFont) => void;
  fontSize: number;
  onChangeFontSize: (size: number) => void;
  lineHeight: number;
  onChangeLineHeight: (lh: number) => void;
  targetLang: string;
  onChangeTargetLang: (lang: string) => void;
  onTranslateFullBook: () => void;
}

export const TARGET_LANGUAGES = [
  { value: 'Bahasa Indonesia', label: 'Bahasa Indonesia' },
  { value: 'English', label: 'Inggris (English)' },
  { value: 'Japanese (日本語)', label: 'Jepang (日本語)' },
  { value: 'Korean (한국어)', label: 'Korea (한국어)' },
  { value: 'Arabic (العربية)', label: 'Arab (العربية)' },
];

export const SettingsPopover: React.FC<SettingsPopoverProps> = ({
  open,
  onClose,
  readingMode,
  onChangeReadingMode,
  theme,
  onChangeTheme,
  fontFamily,
  onChangeFontFamily,
  fontSize,
  onChangeFontSize,
  lineHeight,
  onChangeLineHeight,
  targetLang,
  onChangeTargetLang,
  onTranslateFullBook,
}) => {
  if (!open) return null;

  return (
    <div
      className="mac-surface fixed right-3 top-16 z-40 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border p-4 shadow-2xl sm:right-6"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2.5">
        <span className="flex items-center gap-2 text-sm font-bold">
          <SlidersHorizontal className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          Tampilan & Mode Baca
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup Pengaturan"
          className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-slate-500/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {/* Mode Tampilan Teks */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">
            Mode Tampilan Teks Buku
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { id: 'original', label: 'Asli' },
                { id: 'translated', label: 'Terjemahan' },
                { id: 'bilingual', label: 'Bilingual' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeReadingMode(opt.id)}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold whitespace-nowrap transition ${
                  readingMode === opt.id
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-[var(--border-color)] hover:bg-slate-500/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-[var(--text-secondary)]">
            Saat mode Terjemahan atau Bilingual aktif, bab baru diterjemahkan otomatis ketika halaman dibuka.
          </p>
        </div>

        {/* Tema Warna */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Tema Warna</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onChangeTheme('light')}
              className={`flex items-center justify-center gap-1.5 rounded-xl border bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 transition whitespace-nowrap ${
                theme === 'light' ? 'border-blue-600 ring-2 ring-blue-500/60' : 'border-slate-300'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
              Terang
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme('sepia')}
              className={`flex items-center justify-center gap-1.5 rounded-xl border bg-[#fbf6ec] px-2.5 py-2 text-xs font-semibold text-[#3b2f23] transition whitespace-nowrap ${
                theme === 'sepia' ? 'border-amber-600 ring-2 ring-amber-500/60' : 'border-[#dfd2bc]'
              }`}
            >
              <Coffee className="h-3.5 w-3.5" />
              Sepia
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme('dark')}
              className={`flex items-center justify-center gap-1.5 rounded-xl border bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-100 transition whitespace-nowrap ${
                theme === 'dark' ? 'border-blue-500 ring-2 ring-blue-500/60' : 'border-slate-700'
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              Gelap
            </button>
          </div>
        </div>

        {/* Jenis Huruf */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Jenis Huruf</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeFontFamily('serif')}
              className={`font-serif-reader rounded-xl border px-3 py-2 text-xs font-semibold transition whitespace-nowrap ${
                fontFamily === 'serif'
                  ? 'border-blue-600 ring-2 ring-blue-500/50'
                  : 'border-[var(--border-color)] hover:bg-slate-500/10'
              }`}
            >
              Serif (Klasik)
            </button>
            <button
              type="button"
              onClick={() => onChangeFontFamily('sans')}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition whitespace-nowrap ${
                fontFamily === 'sans'
                  ? 'border-blue-600 ring-2 ring-blue-500/50'
                  : 'border-[var(--border-color)] hover:bg-slate-500/10'
              }`}
            >
              Sans-Serif (Modern)
            </button>
          </div>
        </div>

        {/* Ukuran Huruf */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--text-secondary)]">Ukuran Huruf</span>
            <span className="font-mono-mac font-bold tabular-nums text-blue-600 dark:text-blue-400">
              {fontSize}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeFontSize(Math.max(70, fontSize - 10))}
              className="flex-1 rounded-xl border border-[var(--border-color)] py-1.5 text-sm font-bold transition hover:bg-slate-500/10"
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => onChangeFontSize(100)}
              className="rounded-xl border border-[var(--border-color)] px-3 py-1.5 text-xs font-medium transition hover:bg-slate-500/10"
            >
              Normal
            </button>
            <button
              type="button"
              onClick={() => onChangeFontSize(Math.min(180, fontSize + 10))}
              className="flex-1 rounded-xl border border-[var(--border-color)] py-1.5 text-sm font-bold transition hover:bg-slate-500/10"
            >
              A+
            </button>
          </div>
        </div>

        {/* Spasi Baris */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--text-secondary)]">Spasi Baris</span>
            <span className="font-mono-mac font-bold tabular-nums text-blue-600 dark:text-blue-400">
              {lineHeight.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="1.3"
            max="2.3"
            step="0.05"
            value={lineHeight}
            onChange={(e) => onChangeLineHeight(parseFloat(e.target.value))}
            className="w-full cursor-pointer accent-blue-600"
          />
        </div>

        {/* Bahasa Target & Terjemahan Penuh */}
        <div className="space-y-2 border-t border-[var(--border-color)] pt-3">
          <div className="space-y-1 lg:hidden">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">
              Bahasa Target Terjemahan
            </label>
            <select
              value={targetLang}
              onChange={(e) => onChangeTargetLang(e.target.value)}
              className="mac-surface w-full rounded-xl border px-2.5 py-2 text-xs font-semibold"
            >
              {TARGET_LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              onTranslateFullBook();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-amber-700"
          >
            <BookA className="h-4 w-4" />
            Terjemahkan Seluruh Buku
          </button>
        </div>
      </div>
    </div>
  );
};
