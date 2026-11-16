import React from 'react';
import {
  AlignJustify,
  AlignLeft,
  ArrowDownUp,
  BookA,
  BookOpen,
  Coffee,
  Moon,
  SlidersHorizontal,
  Sun,
  X,
} from 'lucide-react';
import type {
  ReaderContentWidth,
  ReaderFlow,
  ReaderFont,
  ReaderTextAlign,
  ReaderTheme,
  ReadingMode,
} from '../types/reader';

interface SettingsPopoverProps {
  open: boolean;
  onClose: () => void;
  readingMode: ReadingMode;
  onChangeReadingMode: (mode: ReadingMode) => void;
  readerFlow: ReaderFlow;
  onChangeReaderFlow: (flow: ReaderFlow) => void;
  theme: ReaderTheme;
  onChangeTheme: (theme: ReaderTheme) => void;
  fontFamily: ReaderFont;
  onChangeFontFamily: (font: ReaderFont) => void;
  fontSize: number;
  onChangeFontSize: (size: number) => void;
  lineHeight: number;
  onChangeLineHeight: (lh: number) => void;
  paragraphSpacing: number;
  onChangeParagraphSpacing: (px: number) => void;
  contentWidth: ReaderContentWidth;
  onChangeContentWidth: (width: ReaderContentWidth) => void;
  textAlign: ReaderTextAlign;
  onChangeTextAlign: (align: ReaderTextAlign) => void;
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
  readerFlow,
  onChangeReaderFlow,
  theme,
  onChangeTheme,
  fontFamily,
  onChangeFontFamily,
  fontSize,
  onChangeFontSize,
  lineHeight,
  onChangeLineHeight,
  paragraphSpacing,
  onChangeParagraphSpacing,
  contentWidth,
  onChangeContentWidth,
  textAlign,
  onChangeTextAlign,
  targetLang,
  onChangeTargetLang,
  onTranslateFullBook,
}) => {
  if (!open) return null;

  return (
    <div
      className="mac-surface fixed right-3 top-16 z-40 max-h-[calc(100dvh-5rem)] w-[21rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border p-4 shadow-2xl sm:right-6 sm:top-[4.25rem]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2.5">
        <span className="flex items-center gap-2 text-sm font-bold">
          <SlidersHorizontal className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          Tipografi &amp; Mode Baca
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup Pengaturan Tampilan"
          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-1 text-[var(--text-secondary)] hover:bg-slate-500/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {/* Tata Letak Baca: Halaman vs Scroll */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">
            Tata Letak Baca
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeReaderFlow('paginated')}
              className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition whitespace-nowrap ${
                readerFlow === 'paginated'
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-[var(--border-color)] hover:bg-slate-500/10'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Halaman</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeReaderFlow('scroll')}
              className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition whitespace-nowrap ${
                readerFlow === 'scroll'
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-[var(--border-color)] hover:bg-slate-500/10'
              }`}
            >
              <ArrowDownUp className="h-3.5 w-3.5" />
              <span>Scroll Vertikal</span>
            </button>
          </div>
        </div>

        {/* Mode Teks */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">
            Mode Teks Buku
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
                className={`min-h-[40px] rounded-xl border px-1.5 py-2 text-xs font-semibold whitespace-nowrap transition ${
                  readingMode === opt.id
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-[var(--border-color)] hover:bg-slate-500/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tema Warna */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Tema Warna</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onChangeTheme('light')}
              className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 transition whitespace-nowrap ${
                theme === 'light' ? 'border-blue-600 ring-2 ring-blue-500/60' : 'border-slate-300'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
              Terang
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme('sepia')}
              className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border bg-[#fbf6ec] px-2.5 py-2 text-xs font-semibold text-[#3b2f23] transition whitespace-nowrap ${
                theme === 'sepia' ? 'border-amber-600 ring-2 ring-amber-500/60' : 'border-[#dfd2bc]'
              }`}
            >
              <Coffee className="h-3.5 w-3.5" />
              Sepia
            </button>
            <button
              type="button"
              onClick={() => onChangeTheme('dark')}
              className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-100 transition whitespace-nowrap ${
                theme === 'dark' ? 'border-blue-500 ring-2 ring-blue-500/60' : 'border-slate-700'
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              Gelap
            </button>
          </div>
        </div>

        {/* Jenis Huruf & Perataan Teks */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">Jenis Huruf</label>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => onChangeFontFamily('serif')}
                className={`font-serif-reader min-h-[38px] rounded-xl border px-2 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
                  fontFamily === 'serif'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-[var(--border-color)] hover:bg-slate-500/10'
                }`}
              >
                Serif
              </button>
              <button
                type="button"
                onClick={() => onChangeFontFamily('sans')}
                className={`min-h-[38px] rounded-xl border px-2 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
                  fontFamily === 'sans'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-[var(--border-color)] hover:bg-slate-500/10'
                }`}
              >
                Sans
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">
              Perataan Teks
            </label>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => onChangeTextAlign('left')}
                title="Rata Kiri"
                aria-label="Rata Kiri"
                className={`flex min-h-[38px] items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
                  textAlign === 'left'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-[var(--border-color)] hover:bg-slate-500/10'
                }`}
              >
                <AlignLeft className="h-3.5 w-3.5" />
                <span>Kiri</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeTextAlign('justify')}
                title="Rata Kanan-Kiri (Justify)"
                aria-label="Rata Kanan-Kiri"
                className={`flex min-h-[38px] items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
                  textAlign === 'justify'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-[var(--border-color)] hover:bg-slate-500/10'
                }`}
              >
                <AlignJustify className="h-3.5 w-3.5" />
                <span>Justify</span>
              </button>
            </div>
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
              onClick={() => onChangeFontSize(Math.max(70, fontSize - 5))}
              aria-label="Perkecil Huruf"
              className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-[var(--border-color)] text-xs font-bold transition hover:bg-slate-500/10"
            >
              A-
            </button>
            <input
              type="range"
              min="70"
              max="180"
              step="5"
              value={fontSize}
              onChange={(e) => onChangeFontSize(parseInt(e.target.value, 10))}
              aria-label="Ukuran Huruf"
              className="flex-1 cursor-pointer accent-blue-600"
            />
            <button
              type="button"
              onClick={() => onChangeFontSize(Math.min(180, fontSize + 5))}
              aria-label="Perbesar Huruf"
              className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-[var(--border-color)] text-xs font-bold transition hover:bg-slate-500/10"
            >
              A+
            </button>
          </div>
        </div>

        {/* Spasi Antar Baris */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--text-secondary)]">Spasi Antar Baris</span>
            <span className="font-mono-mac font-bold tabular-nums text-blue-600 dark:text-blue-400">
              {lineHeight.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="1.4"
            max="2.2"
            step="0.05"
            value={lineHeight}
            onChange={(e) => onChangeLineHeight(parseFloat(e.target.value))}
            aria-label="Spasi Antar Baris"
            className="w-full cursor-pointer accent-blue-600"
          />
        </div>

        {/* Spasi Antar Paragraf */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--text-secondary)]">
              Spasi Antar Paragraf
            </span>
            <span className="font-mono-mac font-bold tabular-nums text-blue-600 dark:text-blue-400">
              {paragraphSpacing}px
            </span>
          </div>
          <input
            type="range"
            min="8"
            max="32"
            step="2"
            value={paragraphSpacing}
            onChange={(e) => onChangeParagraphSpacing(parseInt(e.target.value, 10))}
            aria-label="Spasi Antar Paragraf"
            className="w-full cursor-pointer accent-blue-600"
          />
        </div>

        {/* Lebar Kolom Baca */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">
            Lebar Kolom Baca
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { id: 'narrow', label: 'Sempit' },
                { id: 'medium', label: 'Sedang' },
                { id: 'wide', label: 'Lebar' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeContentWidth(opt.id)}
                className={`min-h-[38px] rounded-xl border px-2 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                  contentWidth === opt.id
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-[var(--border-color)] hover:bg-slate-500/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bahasa Target & Terjemahan Seluruh Buku */}
        <div className="space-y-2 border-t border-[var(--border-color)] pt-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">
              Bahasa Target Terjemahan
            </label>
            <select
              value={targetLang}
              onChange={(e) => onChangeTargetLang(e.target.value)}
              className="mac-surface min-h-[40px] w-full rounded-xl border px-2.5 py-2 text-xs font-semibold"
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
            className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-amber-700"
          >
            <BookA className="h-4 w-4" />
            Terjemahkan Seluruh Buku
          </button>
        </div>
      </div>
    </div>
  );
};
