import React from 'react';
import { BookmarkPlus, Copy, Languages, X } from 'lucide-react';

interface TranslationDrawerProps {
  open: boolean;
  targetLang: string;
  sourceText: string;
  resultText: string;
  loading: boolean;
  errorText: string | null;
  onClose: () => void;
  onCopy: () => void;
  onSaveVocab: () => void;
}

function renderFormattedParagraphs(raw: string): React.ReactNode {
  const blocks = raw.split(/\n{2,}/);
  return blocks.map((block, bIdx) => {
    const lines = block.split('\n');
    return (
      <p key={bIdx} className="mb-3 last:mb-0 leading-relaxed">
        {lines.map((line, lIdx) => {
          const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
          return (
            <React.Fragment key={lIdx}>
              {parts.map((part, pIdx) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return (
                    <strong key={pIdx} className="font-semibold text-blue-600 dark:text-blue-400">
                      {part.slice(2, -2)}
                    </strong>
                  );
                }
                if (part.startsWith('*') && part.endsWith('*')) {
                  return (
                    <em key={pIdx} className="italic">
                      {part.slice(1, -1)}
                    </em>
                  );
                }
                return <React.Fragment key={pIdx}>{part}</React.Fragment>;
              })}
              {lIdx < lines.length - 1 && <br />}
            </React.Fragment>
          );
        })}
      </p>
    );
  });
}

export const TranslationDrawer: React.FC<TranslationDrawerProps> = ({
  open,
  targetLang,
  sourceText,
  resultText,
  loading,
  errorText,
  onClose,
  onCopy,
  onSaveVocab,
}) => {
  if (!open) return null;

  return (
    <section className="mac-surface fixed inset-x-0 bottom-0 z-40 flex max-h-[78dvh] flex-col rounded-t-3xl border-t pb-[env(safe-area-inset-bottom)] shadow-2xl lg:static lg:inset-auto lg:max-h-none lg:w-[25rem] xl:w-[28rem] lg:rounded-none lg:border-l lg:border-t-0 lg:pb-0 lg:shadow-none">
      <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-300 dark:bg-slate-700 lg:hidden" />
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600/12 text-blue-600 dark:text-blue-400">
            <Languages className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold leading-tight">Terjemahan Kontekstual AI</h2>
            <p className="truncate text-xs text-[var(--text-secondary)]">Target: {targetLang}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onCopy}
            disabled={!resultText || loading}
            title="Salin Terjemahan"
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg p-2 text-[var(--text-secondary)] transition hover:bg-slate-500/10 disabled:opacity-40"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Tutup Panel"
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg p-2 text-[var(--text-secondary)] transition hover:bg-slate-500/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        <div className="space-y-2 rounded-xl border border-[var(--border-color)] bg-slate-500/5 p-3.5">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
            <span>Teks Asli</span>
            <button
              type="button"
              onClick={onSaveVocab}
              disabled={!sourceText}
              className="flex items-center gap-1 text-emerald-600 transition hover:underline dark:text-emerald-400 whitespace-nowrap"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Simpan Kosakata
            </button>
          </div>
          <p className="max-h-36 overflow-y-auto text-xs leading-relaxed italic text-[var(--text-primary)] opacity-90">
            {sourceText.length > 450 ? `${sourceText.slice(0, 450)}...` : sourceText}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)]">
            <span>Hasil Terjemahan & Analisis</span>
          </div>

          {loading ? (
            <div className="space-y-3 rounded-xl border border-[var(--border-color)] p-6 text-center">
              <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <p className="text-xs font-medium text-[var(--text-secondary)]">
                Menerjemahkan dengan memperhatikan konteks bacaan...
              </p>
            </div>
          ) : errorText ? (
            <div className="space-y-1 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-xs text-rose-600 dark:text-rose-400">
              <p className="font-bold">Gagal menerjemahkan</p>
              <p>{errorText}</p>
            </div>
          ) : (
            <div className="mac-surface rounded-xl border p-4 text-sm leading-relaxed">
              {resultText ? (
                renderFormattedParagraphs(resultText)
              ) : (
                <p className="text-xs text-[var(--text-secondary)]">
                  Sorot teks di dalam buku atau klik Halaman Ini untuk menerjemahkan.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
