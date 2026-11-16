export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderFont = 'serif' | 'sans';
export type ReadingMode = 'original' | 'translated' | 'bilingual';
export type ReaderFlow = 'paginated' | 'scroll';
export type ReaderContentWidth = 'narrow' | 'medium' | 'wide';
export type ReaderTextAlign = 'left' | 'justify';
export type SidebarTab = 'library' | 'toc' | 'bookmarks' | 'vocab';

export interface TranslationPair {
  orig: string;
  trans: string;
}

export type TranslationStage = 'draft' | 'polished';

export interface ChapterTranslation {
  href: string;
  pairs: TranslationPair[];
  stage?: TranslationStage;
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
