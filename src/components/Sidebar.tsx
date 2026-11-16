import React from 'react';
import { BookMarked, BookOpen, Keyboard, Trash2, Upload, X } from 'lucide-react';
import type { BookmarkItem, LibraryBookMeta, SidebarTab, TocNode, VocabItem } from '../types/reader';

interface SidebarProps {
  openDesktop: boolean;
  openMobile: boolean;
  onCloseMobile: () => void;
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;
  libraryBooks: LibraryBookMeta[];
  currentBookId: string;
  onSelectLibraryBook: (bookId: string) => void;
  onDeleteLibraryBook: (bookId: string) => void;
  onTriggerUpload: () => void;
  onLoadSampleBook: () => void;
  toc: TocNode[];
  onSelectTocHref: (href: string) => void;
  bookmarks: BookmarkItem[];
  onSelectBookmark: (cfi: string) => void;
  onDeleteBookmark: (id: string) => void;
  vocabList: VocabItem[];
  onDeleteVocab: (id: string) => void;
  onOpenShortcuts: () => void;
  isElectron?: boolean;
  isFullscreen?: boolean;
  headerVisible?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  openDesktop,
  openMobile,
  onCloseMobile,
  activeTab,
  onChangeTab,
  libraryBooks,
  currentBookId,
  onSelectLibraryBook,
  onDeleteLibraryBook,
  onTriggerUpload,
  onLoadSampleBook,
  toc,
  onSelectTocHref,
  bookmarks,
  onSelectBookmark,
  onDeleteBookmark,
  vocabList,
  onDeleteVocab,
  onOpenShortcuts,
  isElectron,
  isFullscreen = false,
  headerVisible = true,
}) => {
  const currentBookBookmarks = bookmarks.filter((b) => b.bookId === currentBookId);

  const renderTocItems = (items: TocNode[], depth = 0): React.ReactNode => {
    return items.map((item, idx) => (
      <React.Fragment key={`${item.href}-${idx}`}>
        <li>
          <button
            type="button"
            onClick={() => {
              onSelectTocHref(item.href);
              onCloseMobile();
            }}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            className="flex w-full items-center gap-2 rounded-xl py-2 pr-3 text-left text-xs transition hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 sm:text-sm"
          >
            <span className="truncate">{item.label.trim()}</span>
          </button>
        </li>
        {item.subitems && item.subitems.length > 0 && renderTocItems(item.subitems, depth + 1)}
      </React.Fragment>
    ));
  };

  return (
    <>
      {openMobile && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-xs lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`mac-sidebar fixed inset-y-0 left-0 z-50 flex w-[18.5rem] max-w-[85vw] shrink-0 flex-col border-r backdrop-blur-xl transition-transform duration-200 lg:static lg:z-30 ${
          isElectron && !isFullscreen ? 'pt-9' : ''
        } ${
          headerVisible
            ? 'lg:pt-14'
            : isElectron && !isFullscreen
            ? 'lg:pt-9'
            : 'lg:pt-0'
        } ${
          openMobile ? 'translate-x-0' : '-translate-x-full'
        } ${openDesktop ? 'lg:flex lg:translate-x-0' : 'lg:hidden'}`}
      >
        {/* Tab Switcher */}
        <div className="flex items-center justify-between gap-1.5 border-b border-[var(--border-color)] p-2.5">
          <div className="grid w-full min-w-0 grid-cols-4 gap-1 rounded-xl bg-slate-500/10 p-1 text-[11px] font-semibold">
            {(
              [
                { id: 'library', label: 'Buku' },
                { id: 'toc', label: 'Bab' },
                { id: 'bookmarks', label: 'Penanda' },
                { id: 'vocab', label: 'Kamus' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeTab(tab.id)}
                className={`min-w-0 truncate rounded-lg px-1 py-1.5 text-center leading-tight whitespace-nowrap transition ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Tutup Sidebar"
            className="shrink-0 rounded-lg p-1.5 hover:bg-slate-500/10 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Panel Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === 'library' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-[var(--text-secondary)] tabular-nums">
                  Book List ({libraryBooks.length})
                </span>
                <button
                  type="button"
                  onClick={onTriggerUpload}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Tambah
                </button>
              </div>

              {libraryBooks.length === 0 ? (
                <div className="space-y-3 rounded-xl border border-dashed border-[var(--border-color)] p-4 text-center text-xs text-[var(--text-secondary)]">
                  <p>Belum ada file EPUB tersimpan. Seret file .epub ke jendela atau klik Tambah.</p>
                  <button
                    type="button"
                    onClick={() => {
                      onLoadSampleBook();
                      onCloseMobile();
                    }}
                    className="mac-surface inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-slate-500/10"
                  >
                    <BookMarked className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    Muat Buku Contoh
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {libraryBooks.map((book) => {
                    const isActive = book.id === currentBookId;
                    return (
                      <div
                        key={book.id}
                        className={`mac-surface group flex items-start justify-between gap-2 rounded-xl border p-2.5 transition ${
                          isActive
                            ? 'border-blue-500/70 ring-1 ring-blue-500/30'
                            : 'hover:border-blue-500/40'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectLibraryBook(book.id);
                            onCloseMobile();
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <BookOpen
                              className={`h-3.5 w-3.5 shrink-0 ${
                                isActive ? 'text-blue-600 dark:text-blue-400' : 'text-[var(--text-secondary)]'
                              }`}
                            />
                            <span className="truncate text-xs font-bold">{book.title}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
                            <span className="truncate">{book.author}</span>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0">{book.progressPct}%</span>
                          </div>
                        </button>
                        {!book.isSample && (
                          <button
                            type="button"
                            onClick={() => onDeleteLibraryBook(book.id)}
                            title="Hapus dari Pustaka"
                            className="rounded-lg p-1 text-rose-500 opacity-70 transition hover:bg-rose-500/10 hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'toc' && (
            <div className="space-y-1">
              <div className="px-2 pb-2 text-xs font-semibold text-[var(--text-secondary)]">
                Daftar Bab
              </div>
              {toc.length === 0 ? (
                <p className="p-3 text-xs italic text-[var(--text-secondary)]">
                  Daftar isi tidak tersedia dalam buku ini.
                </p>
              ) : (
                <ul className="space-y-0.5">{renderTocItems(toc)}</ul>
              )}
            </div>
          )}

          {activeTab === 'bookmarks' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-1 text-xs font-semibold text-[var(--text-secondary)]">
                <span>Halaman Ditandai</span>
                <span className="font-mono-mac tabular-nums">{currentBookBookmarks.length}</span>
              </div>

              {currentBookBookmarks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-center text-xs text-[var(--text-secondary)]">
                  Belum ada halaman ditandai. Tekan ⌘D atau ikon penanda.
                </div>
              ) : (
                <div className="space-y-2">
                  {currentBookBookmarks.map((bm) => (
                    <div
                      key={bm.id}
                      className="mac-surface flex items-start justify-between gap-2 rounded-xl border p-3 transition hover:border-blue-500/50"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectBookmark(bm.cfi);
                          onCloseMobile();
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-xs font-semibold text-blue-600 dark:text-blue-400">
                          {bm.chapterTitle}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
                          {bm.createdAt}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteBookmark(bm.id)}
                        title="Hapus Penanda"
                        className="rounded-lg p-1.5 text-rose-500 opacity-70 transition hover:bg-rose-500/10 hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'vocab' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-1 text-xs font-semibold text-[var(--text-secondary)]">
                <span>Kamus Pribadi</span>
                <span className="font-mono-mac tabular-nums">{vocabList.length}</span>
              </div>

              {vocabList.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-center text-xs text-[var(--text-secondary)]">
                  Sorot kata asing saat membaca lalu pilih Simpan Kosakata.
                </div>
              ) : (
                <div className="space-y-2">
                  {vocabList.map((v) => (
                    <div key={v.id} className="mac-surface space-y-1 rounded-xl border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="break-words text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          {v.word}
                        </span>
                        <button
                          type="button"
                          onClick={() => onDeleteVocab(v.id)}
                          title="Hapus Kosakata"
                          className="shrink-0 rounded-lg p-1 text-rose-500 hover:bg-rose-500/10"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-xs leading-snug opacity-90">{v.meaning}</p>
                      <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-[var(--text-secondary)] tabular-nums">
                        <span className="truncate">{v.bookTitle}</span>
                        <span className="shrink-0">{v.savedAt}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Minimal Sidebar Footer */}
        <div className="border-t border-[var(--border-color)] p-2.5 text-xs">
          <button
            type="button"
            onClick={onOpenShortcuts}
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[var(--text-secondary)] transition hover:bg-slate-500/10 hover:text-[var(--text-primary)]"
          >
            <span className="flex items-center gap-2 font-medium">
              <Keyboard className="h-3.5 w-3.5" />
              Pintasan Keyboard
            </span>
            <kbd className="font-mono-mac text-[11px]">⌘/</kbd>
          </button>
        </div>
      </aside>
    </>
  );
};
