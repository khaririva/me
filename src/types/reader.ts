export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderFont = 'serif' | 'sans';
export type ReadingMode = 'original' | 'translated' | 'bilingual';
export type SidebarTab = 'library' | 'toc' | 'bookmarks' | 'vocab';

export interface TranslationPair {
  orig: string;
  trans: string;
}

export interface ChapterTranslation {
  href: string;
  pairs: TranslationPair[];
  updatedAt: number;
}

export interface LibraryBookRecord {
  id: string;
  title: string;
  author: string;
  isSample?: boolean;
  addedAt: number;
  lastOpenedAt: number;
  progressPct: number;
  lastCfi?: string;
  data: ArrayBuffer;
}

export interface LibraryBookMeta {
  id: string;
  title: string;
  author: string;
  isSample?: boolean;
  addedAt: number;
  lastOpenedAt: number;
  progressPct: number;
  lastCfi?: string;
}

export interface BookmarkItem {
  id: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string;
  cfi: string;
  createdAt: string;
}

export interface VocabItem {
  id: string;
  word: string;
  meaning: string;
  bookTitle: string;
  savedAt: string;
}

export interface TocNode {
  id?: string;
  href: string;
  label: string;
  subitems?: TocNode[];
}

export interface BatchJobState {
  running: boolean;
  paused: boolean;
  cancelled: boolean;
  total: number;
  completed: number;
  statusText: string;
  error: boolean;
}

export interface ToastMessage {
  id: string;
  text: string;
  type: 'info' | 'success' | 'error';
}
