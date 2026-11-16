import React, { useMemo, useState } from 'react';
import { BookMarked, BookOpen, Search, Trash2, Upload, X } from 'lucide-react';
import { AppLogo } from './AppLogo';
import type { LibraryBookMeta } from '../types/reader';

interface BookListModalProps {
  open: boolean;
  onClose: () => void;
  books: LibraryBookMeta[];
  currentBookId: string;
  onSelectBook: (bookId: string) => void;
  onDeleteBook: (bookId: string) => void;
  onTriggerUpload: () => void;
  onLoadSampleBook: () => void;
}

export const BookListModal: React.FC<BookListModalProps> = ({
  open,
  onClose,
  books,
  currentBookId,
  onSelectBook,
  onDeleteBook,
  onTriggerUpload,
  onLoadSampleBook,
}) => {
  const [query, setQuery] = useState('');

  const filteredBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    );
  }, [books, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="mac-surface flex max-h-[82vh] w-full max-w-2xl flex-col rounded-2xl border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo className="h-9 w-9 shrink-0 rounded-xl shadow-xs" />
            <div className="min-w-0">
              <h3 className="text-base font-bold leading-tight">Book List</h3>
              <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                {books.length} buku tersimpan di perangkat
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose();
                onTriggerUpload();
              }}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5" />
              Tambah EPUB
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup Book List"
              className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-slate-500/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="border-b border-[var(--border-color)] px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari judul buku atau penulis..."
              className="mac-surface w-full rounded-xl border py-2 pl-9 pr-3 text-xs sm:text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 space-y-2 overflow-y-auto p-5">
          {filteredBooks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-color)] p-8 text-center">
              <AppLogo className="mx-auto mb-3 h-12 w-12 rounded-2xl shadow-sm" />
              <p className="text-sm font-semibold">
                {books.length === 0
                  ? 'Belum ada buku di PustakaLoka'
                  : 'Tidak ada buku yang cocok dengan pencarian'}
              </p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Unggah file .epub dari perangkat Anda atau muat buku contoh bawaan.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onTriggerUpload();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Unggah EPUB
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onLoadSampleBook();
                    onClose();
                  }}
                  className="mac-surface inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold hover:bg-slate-500/10"
                >
                  <BookMarked className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Muat Buku Contoh
                </button>
              </div>
            </div>
          ) : (
            filteredBooks.map((book) => {
              const isActive = book.id === currentBookId;
              const lastOpened = new Date(book.lastOpenedAt).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });

              return (
                <div
                  key={book.id}
                  className={`mac-surface flex items-center justify-between gap-4 rounded-xl border p-3.5 transition ${
                    isActive
                      ? 'border-blue-500/70 ring-1 ring-blue-500/25'
                      : 'hover:border-blue-500/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectBook(book.id);
                      onClose();
                    }}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <div
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-500/10 text-[var(--text-secondary)]'
                      }`}
                    >
                      <BookOpen className="h-4 w-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold">{book.title}</span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
                        <span className="truncate">{book.author}</span>
                        <span aria-hidden="true">·</span>
                        <span>{book.progressPct}% selesai</span>
                        <span aria-hidden="true">·</span>
                        <span>{lastOpened}</span>
                        {isActive && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              Sedang dibaca
                            </span>
                          </>
                        )}
                      </div>

                      <div className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-slate-500/15">
                        <div
                          className="h-full rounded-full bg-blue-600 transition-all"
                          style={{ width: `${book.progressPct}%` }}
                        />
                      </div>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectBook(book.id);
                          onClose();
                        }}
                        className="rounded-xl border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-500/10 whitespace-nowrap"
                      >
                        Baca
                      </button>
                    )}
                    {!book.isSample && (
                      <button
                        type="button"
                        onClick={() => onDeleteBook(book.id)}
                        title="Hapus dari Book List"
                        className="rounded-lg p-2 text-rose-500 opacity-75 transition hover:bg-rose-500/10 hover:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
