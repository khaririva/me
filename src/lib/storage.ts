import type { ChapterTranslation, LibraryBookMeta, LibraryBookRecord } from '../types/reader';

const DB_NAME = 'PustakaMacDB';
const DB_VERSION = 2;
const TRANSLATION_STORE = 'book_translations';
const LIBRARY_STORE = 'epub_library';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(TRANSLATION_STORE)) {
        db.createObjectStore(TRANSLATION_STORE, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
        db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const BookTranslationDB = {
  makeKey(bookId: string, targetLang: string): string {
    return `${bookId}::${targetLang}`;
  },

  async getBookCache(bookId: string, targetLang: string): Promise<Record<string, ChapterTranslation>> {
    try {
      const db = await openDatabase();
      return await new Promise((resolve) => {
        const tx = db.transaction(TRANSLATION_STORE, 'readonly');
        const store = tx.objectStore(TRANSLATION_STORE);
        const req = store.get(this.makeKey(bookId, targetLang));
        req.onsuccess = () => resolve(req.result?.chapters || {});
        req.onerror = () => resolve({});
      });
    } catch {
      return {};
    }
  },

  async saveBookCache(
    bookId: string,
    targetLang: string,
    bookTitle: string,
    chapters: Record<string, ChapterTranslation>
  ): Promise<boolean> {
    try {
      const db = await openDatabase();
      return await new Promise((resolve) => {
        const tx = db.transaction(TRANSLATION_STORE, 'readwrite');
        const store = tx.objectStore(TRANSLATION_STORE);
        store.put({
          cacheKey: this.makeKey(bookId, targetLang),
          bookId,
          targetLang,
          bookTitle,
          updatedAt: Date.now(),
          chapters,
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  },
};

export const LibraryDB = {
  async listMeta(): Promise<LibraryBookMeta[]> {
    try {
      const db = await openDatabase();
      return await new Promise((resolve) => {
        const tx = db.transaction(LIBRARY_STORE, 'readonly');
        const store = tx.objectStore(LIBRARY_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const items = (req.result || []) as LibraryBookRecord[];
          const meta = items
            .map(({ data: _data, ...rest }) => rest)
            .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
          resolve(meta);
        };
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  },

  async getBook(id: string): Promise<LibraryBookRecord | null> {
    try {
      const db = await openDatabase();
      return await new Promise((resolve) => {
        const tx = db.transaction(LIBRARY_STORE, 'readonly');
        const store = tx.objectStore(LIBRARY_STORE);
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as LibraryBookRecord) || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  },

  async saveBook(record: LibraryBookRecord): Promise<boolean> {
    try {
      const db = await openDatabase();
      return await new Promise((resolve) => {
        const tx = db.transaction(LIBRARY_STORE, 'readwrite');
        const store = tx.objectStore(LIBRARY_STORE);
        store.put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  },

  async updateProgress(id: string, progressPct: number, lastCfi?: string): Promise<void> {
    try {
      const existing = await this.getBook(id);
      if (!existing) return;
      existing.progressPct = progressPct;
      if (lastCfi) existing.lastCfi = lastCfi;
      existing.lastOpenedAt = Date.now();
      await this.saveBook(existing);
    } catch {
      // ignore storage update errors
    }
  },

  async deleteBook(id: string): Promise<boolean> {
    try {
      const db = await openDatabase();
      return await new Promise((resolve) => {
        const tx = db.transaction(LIBRARY_STORE, 'readwrite');
        const store = tx.objectStore(LIBRARY_STORE);
        store.delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  },
};
