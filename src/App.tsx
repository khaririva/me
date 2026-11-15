import React, { useCallback, useEffect, useRef, useState } from 'react';
import ePub, { type Book, type Rendition } from 'epubjs';
import {
  BookA,
  BookOpen,
  Bookmark,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  Languages,
  Laptop,
  Maximize2,
  Minimize2,
  PanelLeft,
  Pause,
  Play,
  Sparkles,
  Type as TypeIcon,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { PWAInstallModal } from './components/PWAInstallModal';
import { SettingsPopover, TARGET_LANGUAGES } from './components/SettingsPopover';
import { ShortcutsModal } from './components/ShortcutsModal';
import { Sidebar } from './components/Sidebar';
import { TranslationDrawer } from './components/TranslationDrawer';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import { translateContextualApi, translateParagraphsApi, translateVocabApi } from './lib/api';
import { SAMPLE_BOOK_ID, createSampleEpubBuffer } from './lib/sampleEpub';
import { BookTranslationDB, LibraryDB } from './lib/storage';
import type {
  BatchJobState,
  BookmarkItem,
  ChapterTranslation,
  LibraryBookMeta,
  ReaderFont,
  ReaderTheme,
  ReadingMode,
  SidebarTab,
  ToastMessage,
  TocNode,
  VocabItem,
} from './types/reader';

interface RenditionLocation {
  start?: {
    cfi: string;
    href: string;
    percentage?: number;
    displayed?: {
      page: number;
      total: number;
    };
  };
}

interface SpineSection {
  href: string;
  load: (loader: unknown) => Promise<Document>;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default function App() {
  // Preferences & UI State
  const [theme, setTheme] = useState<ReaderTheme>(
    () => (localStorage.getItem('reader_theme') as ReaderTheme) || 'light'
  );
  const [fontFamily, setFontFamily] = useState<ReaderFont>(
    () => (localStorage.getItem('reader_font') as ReaderFont) || 'serif'
  );
  const [fontSize, setFontSize] = useState<number>(() =>
    parseInt(localStorage.getItem('reader_font_size') || '100', 10)
  );
  const [lineHeight, setLineHeight] = useState<number>(() =>
    parseFloat(localStorage.getItem('reader_line_height') || '1.75')
  );
  const [targetLang, setTargetLang] = useState<string>(
    () => localStorage.getItem('reader_target_lang') || 'Bahasa Indonesia'
  );
  const [readingMode, setReadingMode] = useState<ReadingMode>(
    () => (localStorage.getItem('reader_reading_mode') as ReadingMode) || 'original'
  );

  // Layout & Modals
  const [sidebarDesktopOpen, setSidebarDesktopOpen] = useState(true);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('toc');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Book & Reader State
  const [libraryBooks, setLibraryBooks] = useState<LibraryBookMeta[]>([]);
  const [currentBookId, setCurrentBookId] = useState<string>(SAMPLE_BOOK_ID);
  const [currentBookTitle, setCurrentBookTitle] = useState<string>('The Art of Quiet Reading');
  const [currentChapterTitle, setCurrentChapterTitle] = useState<string>('Bab 1');
  const [toc, setToc] = useState<TocNode[]>([]);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [pageLocationLabel, setPageLocationLabel] = useState<string>('Hal. 1');
  const [locationsReady, setLocationsReady] = useState<boolean>(false);
  const [loaderText, setLoaderText] = useState<string | null>('Memuat isi buku EPUB...');

  // Bookmarks & Vocabulary
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('reader_bookmarks') || '[]');
    } catch {
      return [];
    }
  });
  const [vocabList, setVocabList] = useState<VocabItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('reader_vocab') || '[]');
    } catch {
      return [];
    }
  });

  // Selection Popover & Translation Drawer
  const [selectedText, setSelectedText] = useState<string>('');
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [drawerSourceText, setDrawerSourceText] = useState<string>('');
  const [drawerResultText, setDrawerResultText] = useState<string>('');
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Full-Book Batch Translation
  const [hasCachedChapters, setHasCachedChapters] = useState<boolean>(false);
  const [showBatchBar, setShowBatchBar] = useState<boolean>(false);
  const [batchState, setBatchState] = useState<BatchJobState>({
    running: false,
    paused: false,
    cancelled: false,
    total: 0,
    completed: 0,
    statusText: '',
    error: false,
  });

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // PWA & Online Status
  const { isInstallable, isInstalled, isSafariMac, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();

  // Mutable Refs for EPUB.js & Async Loops
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const currentBookIdRef = useRef<string>(currentBookId);
  const currentBookTitleRef = useRef<string>(currentBookTitle);
  const currentChapterTitleRef = useRef<string>(currentChapterTitle);
  const currentCfiRef = useRef<string | null>(null);
  const currentSpineHrefRef = useRef<string | null>(null);
  const locationsReadyRef = useRef<boolean>(false);
  const readingModeRef = useRef<ReadingMode>(readingMode);
  const targetLangRef = useRef<string>(targetLang);
  const chapterCacheRef = useRef<Record<string, ChapterTranslation>>({});
  const activeSectionTranslatingRef = useRef<string | null>(null);
  const batchControlRef = useRef<{ running: boolean; paused: boolean; cancelled: boolean }>({
    running: false,
    paused: false,
    cancelled: false,
  });

  useEffect(() => {
    readingModeRef.current = readingMode;
    localStorage.setItem('reader_reading_mode', readingMode);
  }, [readingMode]);

  useEffect(() => {
    targetLangRef.current = targetLang;
    localStorage.setItem('reader_target_lang', targetLang);
  }, [targetLang]);

  const showToast = useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  // Sync HTML theme classes & theme-color meta for MacBook titlebar
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('dark', 'theme-sepia');
    if (theme === 'dark') {
      html.classList.add('dark');
    } else if (theme === 'sepia') {
      html.classList.add('theme-sepia');
    }
    localStorage.setItem('reader_theme', theme);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute(
        'content',
        theme === 'dark' ? '#0b0f17' : theme === 'sepia' ? '#efe6d5' : '#f7f7f8'
      );
    }
  }, [theme]);

  // Apply typography and palette styles inside EPUB iframe
  const applyRenditionStyling = useCallback(() => {
    localStorage.setItem('reader_font', fontFamily);
    localStorage.setItem('reader_font_size', String(fontSize));
    localStorage.setItem('reader_line_height', String(lineHeight));

    const rendition = renditionRef.current;
    if (!rendition) return;

    const themeStyles = {
      light: {
        bg: '#ffffff',
        color: '#111827',
        link: '#2563eb',
        bilingualBorder: '#e2e8f0',
        bilingualBg: '#f8fafc',
      },
      sepia: {
        bg: '#fbf6ec',
        color: '#3b2f23',
        link: '#b45309',
        bilingualBorder: '#dfd2bc',
        bilingualBg: '#f4ecdc',
      },
      dark: {
        bg: '#0f172a',
        color: '#f1f5f9',
        link: '#60a5fa',
        bilingualBorder: '#334155',
        bilingualBg: '#1e293b',
      },
    };

    const palette = themeStyles[theme];
    const fontStack =
      fontFamily === 'serif'
        ? "'Lora', Georgia, serif"
        : "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";

    rendition.themes.register('custom', {
      body: {
        'background-color': `${palette.bg} !important`,
        color: `${palette.color} !important`,
        'font-family': `${fontStack} !important`,
        'line-height': `${lineHeight} !important`,
        padding: '24px 32px !important',
      },
      'p, div, span, li, blockquote': {
        color: `${palette.color} !important`,
        'font-family': `${fontStack} !important`,
        'line-height': `${lineHeight} !important`,
      },
      'h1, h2, h3, h4': {
        color: `${palette.color} !important`,
        'font-family': `${fontStack} !important`,
        'margin-bottom': '0.75em !important',
      },
      a: {
        color: `${palette.link} !important`,
      },
      '.ai-bilingual-trans': {
        display: 'block',
        'margin-top': '0.5em',
        'margin-bottom': '1.15em',
        padding: '0.65em 0.9em',
        border: `1px solid ${palette.bilingualBorder}`,
        'background-color': palette.bilingualBg,
        'border-radius': '8px',
        'font-size': '0.94em',
        opacity: '0.95',
      },
    });
    rendition.themes.select('custom');
    rendition.themes.fontSize(`${fontSize}%`);
  }, [fontFamily, fontSize, lineHeight, theme]);

  useEffect(() => {
    applyRenditionStyling();
  }, [applyRenditionStyling]);

  // Extract paragraph blocks from an EPUB spine section
  const extractSectionParagraphs = useCallback(async (section: SpineSection): Promise<string[]> => {
    const book = bookRef.current;
    if (!book) return [];
    try {
      const doc = await section.load(book.load.bind(book));
      if (!doc) return [];
      const nodes = Array.from(doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote'));
      const texts = nodes
        .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t.length > 0);
      const unique: string[] = [];
      for (let i = 0; i < texts.length; i++) {
        if (i === 0 || texts[i] !== texts[i - 1]) unique.push(texts[i]);
      }
      return unique;
    } catch {
      return [];
    }
  }, []);

  // Translate and cache one chapter section
  const translateAndCacheSection = useCallback(
    async (section: SpineSection): Promise<ChapterTranslation | null> => {
      if (!section?.href) return null;
      const hrefKey = section.href.split('#')[0];
      const existing = chapterCacheRef.current[hrefKey];
      if (existing && existing.pairs.length > 0) {
        return existing;
      }

      const paragraphs = await extractSectionParagraphs(section);
      if (paragraphs.length === 0) {
        const emptyRec: ChapterTranslation = { href: hrefKey, pairs: [], updatedAt: Date.now() };
        chapterCacheRef.current[hrefKey] = emptyRec;
        return emptyRec;
      }

      const translatedList = await translateParagraphsApi(paragraphs, targetLangRef.current);
      const pairs = paragraphs.map((orig, idx) => ({
        orig,
        trans: translatedList[idx] || orig,
      }));

      const record: ChapterTranslation = {
        href: hrefKey,
        pairs,
        updatedAt: Date.now(),
      };

      chapterCacheRef.current[hrefKey] = record;
      setHasCachedChapters(true);
      await BookTranslationDB.saveBookCache(
        currentBookIdRef.current,
        targetLangRef.current,
        currentBookTitleRef.current,
        chapterCacheRef.current
      );

      return record;
    },
    [extractSectionParagraphs]
  );

  // Inject original, translated, or bilingual paragraphs into active EPUB iframe DOM
  const applyReadingModeToCurrentView = useCallback(
    async (hrefOverride?: string) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const contentsList = rendition.getContents() as unknown as Array<{ document: Document }>;
      if (!contentsList || contentsList.length === 0) return;

      const activeHref = (hrefOverride || currentSpineHrefRef.current || '').split('#')[0];
      const doc = contentsList[0].document;
      if (!doc?.body) return;

      const blocks = Array.from(
        doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote')
      ).filter((node) => {
        const el = node as HTMLElement;
        return (el.dataset.origText || el.innerText.trim()).length > 0;
      }) as HTMLElement[];

      blocks.forEach((node) => {
        if (!node.dataset.origHtml) {
          node.dataset.origHtml = node.innerHTML;
          node.dataset.origText = node.innerText.trim();
        }
      });

      const mode = readingModeRef.current;
      if (mode === 'original') {
        blocks.forEach((node) => {
          if (node.dataset.origHtml) {
            node.innerHTML = node.dataset.origHtml;
          }
        });
        return;
      }

      let cachedChapter: ChapterTranslation | undefined = chapterCacheRef.current[activeHref];
      if (!cachedChapter) {
        const matchedKey = Object.keys(chapterCacheRef.current).find(
          (k) => k.endsWith(activeHref) || activeHref.endsWith(k)
        );
        if (matchedKey) cachedChapter = chapterCacheRef.current[matchedKey];
      }

      if (!cachedChapter && activeHref && activeSectionTranslatingRef.current !== activeHref) {
        const book = bookRef.current;
        const section = book?.spine?.get(activeHref) as unknown as SpineSection | undefined;
        if (section) {
          try {
            activeSectionTranslatingRef.current = activeHref;
            setLoaderText(`Menerjemahkan bab ini ke ${targetLangRef.current}...`);
            cachedChapter = (await translateAndCacheSection(section)) ?? undefined;
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Gagal menerjemahkan bab otomatis.';
            showToast(msg, 'error');
          } finally {
            activeSectionTranslatingRef.current = null;
            setLoaderText(null);
          }
        }
      }

      if (!cachedChapter || cachedChapter.pairs.length === 0) return;

      const translationMap = new Map<string, string>();
      cachedChapter.pairs.forEach((p) => {
        translationMap.set(p.orig.replace(/\s+/g, ' ').trim(), p.trans);
      });

      blocks.forEach((node, idx) => {
        const origText = (node.dataset.origText || '').replace(/\s+/g, ' ').trim();
        const translatedText =
          translationMap.get(origText) || cachedChapter?.pairs[idx]?.trans || null;
        if (!translatedText) return;

        if (mode === 'translated') {
          node.textContent = translatedText;
        } else if (mode === 'bilingual') {
          node.innerHTML = `${node.dataset.origHtml}<span class="ai-bilingual-trans">${escapeHtml(
            translatedText
          )}</span>`;
        }
      });
    },
    [showToast, translateAndCacheSection]
  );

  const refreshLibraryList = useCallback(async () => {
    const items = await LibraryDB.listMeta();
    setLibraryBooks(items);
  }, []);

  // Load an EPUB buffer into EPUB.js rendition
  const loadEpubBook = useCallback(
    async (
      data: ArrayBuffer,
      options?: { bookId?: string; title?: string; author?: string; isSample?: boolean; persist?: boolean }
    ) => {
      if (!viewerRef.current) return;

      try {
        if (batchControlRef.current.running) {
          batchControlRef.current.cancelled = true;
          batchControlRef.current.running = false;
        }
        setShowBatchBar(false);
        setLoaderText('Memuat isi buku EPUB...');
        setPopoverPos(null);

        if (bookRef.current) {
          bookRef.current.destroy();
          bookRef.current = null;
        }
        viewerRef.current.innerHTML = '';

        const book = ePub(data.slice(0));
        bookRef.current = book;
        await book.ready;

        const metadata = await book.loaded.metadata;
        const resolvedTitle = options?.title || metadata.title || 'Buku Tanpa Judul';
        const resolvedAuthor = options?.author || metadata.creator || 'Penulis Tidak Diketahui';
        const resolvedId =
          options?.bookId || metadata.identifier || `${resolvedTitle}-${data.byteLength}`;

        currentBookIdRef.current = resolvedId;
        currentBookTitleRef.current = resolvedTitle;
        setCurrentBookId(resolvedId);
        setCurrentBookTitle(resolvedTitle);

        // Save to persistent IndexedDB library if requested
        if (options?.persist !== false) {
          const existing = await LibraryDB.getBook(resolvedId);
          await LibraryDB.saveBook({
            id: resolvedId,
            title: resolvedTitle,
            author: resolvedAuthor,
            isSample: options?.isSample,
            addedAt: existing?.addedAt || Date.now(),
            lastOpenedAt: Date.now(),
            progressPct: existing?.progressPct || 0,
            lastCfi: existing?.lastCfi,
            data: data.slice(0),
          });
          await refreshLibraryList();
        }

        // Load cached translations
        const cached = await BookTranslationDB.getBookCache(resolvedId, targetLangRef.current);
        chapterCacheRef.current = cached;
        const cachedCount = Object.keys(cached).length;
        const spineItems = ((book.spine as unknown as { spineItems?: SpineSection[] })?.spineItems ||
          []) as SpineSection[];
        setHasCachedChapters(cachedCount > 0);
        if (cachedCount > 0) {
          showToast(
            `Ditemukan ${cachedCount}/${spineItems.length} bab terjemahan tersimpan (${targetLangRef.current}).`,
            'success'
          );
        }

        const rendition = book.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'paginated',
        });
        renditionRef.current = rendition;
        applyRenditionStyling();

        const navigation = await book.loaded.navigation;
        const tocList = (navigation.toc || []) as TocNode[];
        setToc(tocList);
        if (tocList.length > 0) {
          const firstTitle = tocList[0].label.trim();
          currentChapterTitleRef.current = firstTitle;
          setCurrentChapterTitle(firstTitle);
        }

        // Rendition events
        rendition.on('relocated', async (location: RenditionLocation) => {
          setPopoverPos(null);
          if (location?.start) {
            currentCfiRef.current = location.start.cfi;
            currentSpineHrefRef.current = location.start.href;
            localStorage.setItem(`reader_pos_${currentBookIdRef.current}`, location.start.cfi);

            let pct = 0;
            if (locationsReadyRef.current && book.locations) {
              pct = Math.round(book.locations.percentageFromCfi(location.start.cfi) * 100);
            } else if (typeof location.start.percentage === 'number') {
              pct = Math.round(location.start.percentage * 100);
            }
            pct = Math.max(0, Math.min(100, pct || 0));
            setProgressPct(pct);

            if (location.start.displayed) {
              setPageLocationLabel(
                `Hal. ${location.start.displayed.page} / ${location.start.displayed.total}`
              );
            }

            const cleanHref = (location.start.href || '').split('#')[0];
            const foundToc = tocList.find((item) => item.href && item.href.includes(cleanHref));
            if (foundToc) {
              const title = foundToc.label.trim();
              currentChapterTitleRef.current = title;
              setCurrentChapterTitle(title);
            }

            await LibraryDB.updateProgress(currentBookIdRef.current, pct, location.start.cfi);
            await applyReadingModeToCurrentView(location.start.href);
          }
        });

        rendition.on('selected', (_cfiRange: string, contents: { window: Window }) => {
          try {
            const selection = contents.window.getSelection();
            const text = selection ? selection.toString().trim() : '';
            if (!selection || !text || !viewerRef.current || selection.rangeCount === 0) return;

            setSelectedText(text);
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const viewerRect = viewerRef.current.getBoundingClientRect();

            const popX = Math.min(
              Math.max(viewerRect.left + rect.left + rect.width / 2, 150),
              window.innerWidth - 150
            );
            const popY = Math.max(viewerRect.top + rect.top - 52, 72);
            setPopoverPos({ x: popX, y: popY });
          } catch {
            // ignore selection bounds error
          }
        });

        rendition.hooks.content.register((contents: { document: Document }) => {
          const doc = contents.document;
          const blocks = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote');
          blocks.forEach((node) => {
            const el = node as HTMLElement;
            if (!el.dataset.origHtml && el.innerText.trim().length > 0) {
              el.dataset.origHtml = el.innerHTML;
              el.dataset.origText = el.innerText.trim();
            }
          });

          doc.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') rendition.prev();
            if (e.key === 'ArrowRight') rendition.next();
          });

          doc.addEventListener('mousedown', () => {
            setPopoverPos(null);
          });
        });

        const savedCfi = localStorage.getItem(`reader_pos_${resolvedId}`);
        await rendition.display(savedCfi || undefined);

        locationsReadyRef.current = false;
        setLocationsReady(false);
        book.locations.generate(1200).then(() => {
          locationsReadyRef.current = true;
          setLocationsReady(true);
          const loc = rendition.currentLocation() as unknown as RenditionLocation;
          if (loc?.start?.cfi) {
            const pct = Math.round(book.locations.percentageFromCfi(loc.start.cfi) * 100);
            setProgressPct(Math.max(0, Math.min(100, pct || 0)));
          }
        });

        setLoaderText(null);
      } catch (err) {
        console.error(err);
        setLoaderText(null);
        showToast('Gagal membaca file EPUB. Pastikan format file valid.', 'error');
      }
    },
    [applyReadingModeToCurrentView, applyRenditionStyling, refreshLibraryList, showToast]
  );

  // Initialize library and load last-opened book or built-in sample
  useEffect(() => {
    let mounted = true;
    (async () => {
      const existingLibrary = await LibraryDB.listMeta();
      if (!mounted) return;

      if (existingLibrary.length > 0) {
        const latest = await LibraryDB.getBook(existingLibrary[0].id);
        if (latest && mounted) {
          await loadEpubBook(latest.data, {
            bookId: latest.id,
            title: latest.title,
            author: latest.author,
            isSample: latest.isSample,
            persist: false,
          });
          await refreshLibraryList();
          return;
        }
      }

      const sampleBuffer = await createSampleEpubBuffer();
      if (mounted) {
        await loadEpubBook(sampleBuffer, {
          bookId: SAMPLE_BOOK_ID,
          title: 'The Art of Quiet Reading (Buku Contoh)',
          author: 'Eleanor Vance',
          isSample: true,
          persist: true,
        });
      }
    })();

    return () => {
      mounted = false;
      if (bookRef.current) {
        bookRef.current.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize EPUB rendition cleanly
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (renditionRef.current && viewerRef.current) {
          renditionRef.current.resize(
            viewerRef.current.clientWidth,
            viewerRef.current.clientHeight
          );
        }
      }, 180);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Trigger resize when sidebars/drawers toggle on MacBook
  useEffect(() => {
    const timer = setTimeout(() => {
      if (renditionRef.current && viewerRef.current) {
        renditionRef.current.resize(
          viewerRef.current.clientWidth,
          viewerRef.current.clientHeight
        );
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [sidebarDesktopOpen, drawerOpen, focusMode]);

  // Contextual translation action
  const handleContextualTranslate = useCallback(
    async (text: string, isFullChapter: boolean) => {
      const clean = text.trim();
      if (!clean) {
        showToast('Tidak ada teks yang dipilih untuk diterjemahkan.', 'error');
        return;
      }

      setDrawerOpen(true);
      setDrawerSourceText(clean);
      setDrawerResultText('');
      setDrawerError(null);
      setDrawerLoading(true);

      try {
        const translation = await translateContextualApi(clean, targetLangRef.current, isFullChapter);
        setDrawerResultText(translation);
      } catch (err) {
        setDrawerError(err instanceof Error ? err.message : 'Gagal terhubung ke layanan AI.');
      } finally {
        setDrawerLoading(false);
      }
    },
    [showToast]
  );

  // Extract visible page text
  const getVisiblePageText = useCallback((): string => {
    try {
      const contentsList = renditionRef.current?.getContents() as unknown as Array<{
        document: Document;
      }>;
      if (contentsList && contentsList.length > 0) {
        const bodyText = contentsList[0].document.body?.innerText?.trim() || '';
        return bodyText.slice(0, 3500);
      }
    } catch {
      // ignore
    }
    return '';
  }, []);

  // Save vocabulary item
  const handleSaveVocab = useCallback(
    async (rawWord: string) => {
      const word = rawWord.trim();
      if (!word) return;
      const shortWord = word.length > 120 ? `${word.slice(0, 120)}...` : word;

      if (vocabList.some((v) => v.word.toLowerCase() === shortWord.toLowerCase())) {
        showToast('Kosakata ini sudah tersimpan di kamus pribadi.', 'info');
        return;
      }

      showToast('Menyimpan & mencari arti singkat...', 'info');
      let meaning = 'Tersimpan dari bacaan';
      try {
        meaning = await translateVocabApi(shortWord, targetLangRef.current);
      } catch {
        // fallback when offline
      }

      const item: VocabItem = {
        id: Date.now().toString(),
        word: shortWord,
        meaning,
        bookTitle: currentBookTitleRef.current,
        savedAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      };

      const next = [item, ...vocabList];
      setVocabList(next);
      localStorage.setItem('reader_vocab', JSON.stringify(next));
      showToast('Kosakata berhasil disimpan!', 'success');
    },
    [showToast, vocabList]
  );

  // Add current bookmark
  const handleAddBookmark = useCallback(() => {
    const cfi = currentCfiRef.current;
    if (!cfi) {
      showToast('Tunggu hingga halaman selesai dimuat.', 'info');
      return;
    }

    const exists = bookmarks.some((b) => b.bookId === currentBookIdRef.current && b.cfi === cfi);
    if (exists) {
      showToast('Halaman ini sudah ada di daftar penanda.', 'info');
      return;
    }

    const newBookmark: BookmarkItem = {
      id: Date.now().toString(),
      bookId: currentBookIdRef.current,
      bookTitle: currentBookTitleRef.current,
      chapterTitle: currentChapterTitleRef.current,
      cfi,
      createdAt: new Date().toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const next = [newBookmark, ...bookmarks];
    setBookmarks(next);
    localStorage.setItem('reader_bookmarks', JSON.stringify(next));
    showToast('Halaman berhasil ditandai!', 'success');
  }, [bookmarks, showToast]);

  // Handle EPUB File open (from input or drag-drop)
  const handleOpenEpubFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.epub')) {
        showToast('Harap pilih file berformat .epub', 'error');
        return;
      }

      try {
        const buffer = await file.arrayBuffer();
        const cleanTitle = file.name.replace(/\.epub$/i, '');
        await loadEpubBook(buffer, { title: cleanTitle, persist: true });
        showToast(`Berhasil membuka "${cleanTitle}"`, 'success');
      } catch {
        showToast('Gagal membaca file dari perangkat.', 'error');
      }
    },
    [loadEpubBook, showToast]
  );

  // MacBook Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileInputRef.current?.click();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setSidebarDesktopOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleAddBookmark();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        const text = getVisiblePageText();
        if (text) {
          setSelectedText(text);
          handleContextualTranslate(text, true);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFocusMode((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setShortcutsOpen(false);
        setInstallModalOpen(false);
        setPopoverPos(null);
        if (focusMode) setFocusMode(false);
        return;
      }

      if (isInput) return;
      if (e.key === 'ArrowLeft') renditionRef.current?.prev();
      if (e.key === 'ArrowRight') renditionRef.current?.next();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusMode, getVisiblePageText, handleAddBookmark, handleContextualTranslate]);

  // Switch Reading Mode
  const handleChangeReadingMode = async (nextMode: ReadingMode) => {
    setReadingMode(nextMode);
    readingModeRef.current = nextMode;
    await applyReadingModeToCurrentView();
  };

  // Switch Target Language
  const handleChangeTargetLang = async (nextLang: string) => {
    setTargetLang(nextLang);
    targetLangRef.current = nextLang;
    const cached = await BookTranslationDB.getBookCache(currentBookIdRef.current, nextLang);
    chapterCacheRef.current = cached;
    setHasCachedChapters(Object.keys(cached).length > 0);
    showToast(`Bahasa target diubah ke ${nextLang}`, 'info');
    if (readingModeRef.current !== 'original') {
      await applyReadingModeToCurrentView();
    }
  };

  // Full-Book Batch Translation
  const startFullBookTranslation = async () => {
    const book = bookRef.current;
    const spineItems = ((book?.spine as unknown as { spineItems?: SpineSection[] })?.spineItems ||
      []) as SpineSection[];

    if (!book || spineItems.length === 0) {
      showToast('Struktur bab buku belum siap.', 'error');
      return;
    }

    if (batchControlRef.current.running) {
      setShowBatchBar(true);
      showToast('Penerjemahan seluruh buku sedang berjalan.', 'info');
      return;
    }

    if (readingModeRef.current === 'original') {
      setReadingMode('translated');
      readingModeRef.current = 'translated';
    }

    batchControlRef.current = { running: true, paused: false, cancelled: false };
    setShowBatchBar(true);
    setBatchState({
      running: true,
      paused: false,
      cancelled: false,
      total: spineItems.length,
      completed: 0,
      statusText: 'Menyiapkan penerjemahan seluruh buku...',
      error: false,
    });

    try {
      for (let i = 0; i < spineItems.length; i++) {
        if (batchControlRef.current.cancelled) break;

        while (batchControlRef.current.paused && !batchControlRef.current.cancelled) {
          await new Promise((r) => setTimeout(r, 250));
        }
        if (batchControlRef.current.cancelled) break;

        const section = spineItems[i];
        setBatchState((prev) => ({
          ...prev,
          completed: i,
          statusText: `Menerjemahkan Bab ${i + 1} dari ${spineItems.length} (${targetLangRef.current})...`,
        }));

        await translateAndCacheSection(section);

        const currentHrefClean = (currentSpineHrefRef.current || '').split('#')[0];
        const sectionHrefClean = (section.href || '').split('#')[0];
        if (
          currentHrefClean &&
          (currentHrefClean.endsWith(sectionHrefClean) || sectionHrefClean.endsWith(currentHrefClean))
        ) {
          await applyReadingModeToCurrentView(currentHrefClean);
        }

        setBatchState((prev) => ({
          ...prev,
          completed: i + 1,
        }));
      }

      if (!batchControlRef.current.cancelled) {
        setBatchState((prev) => ({
          ...prev,
          running: false,
          completed: spineItems.length,
          statusText: `Selesai! Seluruh ${spineItems.length} bab diterjemahkan ke ${targetLangRef.current}.`,
        }));
        showToast('Seluruh buku berhasil diterjemahkan & disimpan luring!', 'success');
        await applyReadingModeToCurrentView();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gangguan jaringan saat menerjemahkan.';
      setBatchState((prev) => ({
        ...prev,
        running: false,
        error: true,
        statusText: `${msg} Progres yang selesai tetap tersimpan.`,
      }));
      showToast('Penerjemahan terhenti sementara. Klik Terjemahkan Buku untuk melanjutkan.', 'error');
    } finally {
      batchControlRef.current.running = false;
    }
  };

  const togglePauseBatch = () => {
    if (!batchControlRef.current.running) return;
    const nextPaused = !batchControlRef.current.paused;
    batchControlRef.current.paused = nextPaused;
    setBatchState((prev) => ({
      ...prev,
      paused: nextPaused,
      statusText: nextPaused
        ? `Dijeda pada Bab ${prev.completed} dari ${prev.total}`
        : `Melanjutkan Bab ${prev.completed + 1} dari ${prev.total}...`,
    }));
  };

  const cancelBatch = () => {
    if (batchControlRef.current.running) {
      batchControlRef.current.cancelled = true;
      batchControlRef.current.running = false;
      showToast('Penerjemahan dihentikan. Bab yang sudah selesai tetap tersimpan.', 'info');
    }
    setShowBatchBar(false);
    setBatchState((prev) => ({ ...prev, running: false, cancelled: true }));
  };

  const downloadTranslatedBookHtml = () => {
    const spineItems = ((bookRef.current?.spine as unknown as { spineItems?: SpineSection[] })
      ?.spineItems || []) as SpineSection[];
    let chaptersHtml = '';

    spineItems.forEach((sec, index) => {
      const hrefClean = (sec.href || '').split('#')[0];
      const cached = chapterCacheRef.current[hrefClean];
      if (!cached || cached.pairs.length === 0) return;

      const parasHtml = cached.pairs
        .map((p) => {
          if (readingMode === 'bilingual') {
            return `<div class="pair"><p class="orig">${escapeHtml(p.orig)}</p><p class="trans">${escapeHtml(
              p.trans
            )}</p></div>`;
          }
          return `<p>${escapeHtml(p.trans)}</p>`;
        })
        .join('\n');

      chaptersHtml += `<section class="chapter"><h2>Bagian ${index + 1}</h2>${parasHtml}</section>\n`;
    });

    if (!chaptersHtml) {
      showToast('Belum ada bab yang diterjemahkan untuk diunduh.', 'info');
      return;
    }

    const fullDoc = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(currentBookTitle)} — Terjemahan (${escapeHtml(targetLang)})</title>
<style>
  body { font-family: Georgia, serif; max-width: 760px; margin: 48px auto; padding: 0 24px; line-height: 1.85; color: #1e293b; background: #fbf6ec; }
  h1 { text-align: center; border-bottom: 1px solid #d6c5a9; padding-bottom: 16px; }
  .chapter { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2d5be; }
  .pair { margin-bottom: 20px; }
  .orig { color: #64748b; font-style: italic; margin-bottom: 6px; }
  .trans { border: 1px solid #dfd2bc; background: #f4ecdc; padding: 10px 14px; border-radius: 8px; margin-top: 0; }
</style>
</head>
<body>
  <h1>${escapeHtml(currentBookTitle)}<br/><small style="font-size:0.55em; color:#64748b;">Terjemahan: ${escapeHtml(
      targetLang
    )}</small></h1>
  ${chaptersHtml}
</body>
</html>`;

    const blob = new Blob([fullDoc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentBookTitle.replace(/[^a-z0-9]/gi, '_')}_${targetLang.replace(
      /\s+/g,
      '_'
    )}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('File buku terjemahan berhasil diunduh!', 'success');
  };

  const batchPct =
    batchState.total > 0 ? Math.round((batchState.completed / batchState.total) * 100) : 0;

  return (
    <div
      className="flex h-screen flex-col overflow-hidden select-none sm:select-auto"
      onClick={() => setSettingsOpen(false)}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleOpenEpubFile(file);
      }}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,application/epub+zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleOpenEpubFile(file);
          e.target.value = '';
        }}
      />

      {/* Drag & Drop EPUB Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-600/15 backdrop-blur-xs">
          <div className="mac-surface rounded-2xl border-2 border-dashed border-blue-600 px-10 py-8 text-center shadow-2xl">
            <Upload className="mx-auto h-10 w-10 text-blue-600" />
            <p className="mt-3 text-base font-bold">Lepaskan file EPUB di sini</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Buku akan dibuka dan disimpan otomatis ke Pustaka MacBook
            </p>
          </div>
        </div>
      )}

      {/* Toast Container */}
      <div className="pointer-events-none fixed bottom-20 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border px-4 py-2.5 text-xs font-medium shadow-lg sm:text-sm ${
              t.type === 'success'
                ? 'border-emerald-500 bg-emerald-600 text-white'
                : t.type === 'error'
                ? 'border-rose-500 bg-rose-600 text-white'
                : 'border-slate-700 bg-slate-900 text-white dark:bg-slate-800'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* Offline Connectivity Banner */}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
          <WifiOff className="h-3.5 w-3.5" />
          Mode Luring — Buku & terjemahan tersimpan tetap dapat dibaca
        </div>
      )}

      {/* Top macOS Workspace Toolbar */}
      {!focusMode && (
        <header className="mac-surface z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-5">
          {/* Left: Sidebar Toggle & Book Identity */}
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 1024) {
                  setSidebarMobileOpen((v) => !v);
                } else {
                  setSidebarDesktopOpen((v) => !v);
                }
              }}
              title="Pustaka & Daftar Isi (⌘\)"
              className="flex items-center gap-1.5 rounded-xl p-2 text-xs font-semibold transition hover:bg-slate-500/10 whitespace-nowrap shrink-0"
            >
              <PanelLeft className="h-4 w-4" />
              <span className="hidden md:inline">Pustaka</span>
            </button>

            <div className="hidden h-5 w-px bg-[var(--border-color)] sm:block" />

            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                <BookOpen className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xs font-bold leading-tight sm:text-sm">
                  {currentBookTitle}
                </h1>
                <p className="truncate text-[11px] text-[var(--text-secondary)]">
                  {currentChapterTitle}
                </p>
              </div>
            </div>
          </div>

          {/* Center: Reading Mode Segmented Control */}
          <div
            className="hidden items-center rounded-xl border border-[var(--border-color)] bg-slate-500/5 p-0.5 text-xs font-semibold xl:flex shrink-0"
            title="Mode Tampilan Teks Buku"
          >
            {(
              [
                { id: 'original', label: 'Asli' },
                { id: 'translated', label: 'Terjemahan' },
                { id: 'bilingual', label: 'Bilingual' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => handleChangeReadingMode(mode.id)}
                className={`rounded-lg px-3 py-1.5 whitespace-nowrap transition ${
                  readingMode === mode.id
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* Right: Actions */}
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="mac-surface hidden items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs lg:flex">
              <Languages className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <select
                value={targetLang}
                onChange={(e) => handleChangeTargetLang(e.target.value)}
                aria-label="Bahasa Target Terjemahan"
                className="cursor-pointer bg-transparent font-semibold focus:outline-none"
              >
                {TARGET_LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value} className="text-slate-900">
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={startFullBookTranslation}
              title="Terjemahkan Seluruh Bab Buku"
              className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 whitespace-nowrap shrink-0"
            >
              <BookA className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Terjemahkan Buku</span>
              <span className="md:hidden">Semua</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const text = getVisiblePageText();
                if (!text) {
                  showToast('Konten halaman belum siap diterjemahkan.', 'error');
                  return;
                }
                setSelectedText(text);
                handleContextualTranslate(text, true);
              }}
              title="Terjemahkan Halaman Aktif (⌘T)"
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Halaman Ini</span>
            </button>

            <button
              type="button"
              onClick={handleAddBookmark}
              title="Tandai Halaman Ini (⌘D)"
              className="mac-surface rounded-xl border p-2 transition hover:bg-slate-500/10"
            >
              <Bookmark className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen((v) => !v);
              }}
              title="Pengaturan Tampilan & Mode Baca"
              className="mac-surface rounded-xl border p-2 transition hover:bg-slate-500/10"
            >
              <TypeIcon className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setFocusMode(true)}
              title="Mode Fokus Baca (⌘F)"
              className="mac-surface hidden rounded-xl border p-2 transition hover:bg-slate-500/10 sm:inline-flex"
            >
              <Maximize2 className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Unggah EPUB (⌘O)"
              className="mac-surface flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-500/10 whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span className="hidden md:inline">Unggah EPUB</span>
            </button>

            {!isInstalled && (
              <button
                type="button"
                onClick={() => {
                  if (isInstallable) {
                    install();
                  } else {
                    setInstallModalOpen(true);
                  }
                }}
                title="Pasang ke Dock MacBook"
                className="mac-surface hidden items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-500/10 whitespace-nowrap shrink-0 xl:flex"
              >
                <Laptop className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <span>Pasang di Mac</span>
              </button>
            )}
          </div>
        </header>
      )}

      {/* Full-Book Batch Translation Progress Bar */}
      {!focusMode && showBatchBar && (
        <div className="mac-surface z-20 border-b px-4 py-2.5">
          <div className="mx-auto flex max-w-6xl flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  {batchState.running && !batchState.paused && (
                    <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
                  )}
                  <span className="truncate font-semibold">{batchState.statusText}</span>
                </div>
                <span className="font-mono-mac shrink-0 font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {batchPct}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-500/15">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${batchPct}%` }}
                />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
              {batchState.running && (
                <button
                  type="button"
                  onClick={togglePauseBatch}
                  className="mac-surface flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-500/10 whitespace-nowrap"
                >
                  {batchState.paused ? (
                    <>
                      <Play className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Lanjutkan</span>
                    </>
                  ) : (
                    <>
                      <Pause className="h-3.5 w-3.5 text-amber-600" />
                      <span>Jeda</span>
                    </>
                  )}
                </button>
              )}

              {(hasCachedChapters || (!batchState.running && batchState.completed > 0)) && (
                <button
                  type="button"
                  onClick={downloadTranslatedBookHtml}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Unduh Terjemahan</span>
                </button>
              )}

              <button
                type="button"
                onClick={cancelBatch}
                className="flex items-center gap-1 rounded-xl border border-rose-500/30 px-2.5 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-500/10 whitespace-nowrap"
              >
                <X className="h-3.5 w-3.5" />
                <span>Tutup</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Popover */}
      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        readingMode={readingMode}
        onChangeReadingMode={handleChangeReadingMode}
        theme={theme}
        onChangeTheme={setTheme}
        fontFamily={fontFamily}
        onChangeFontFamily={setFontFamily}
        fontSize={fontSize}
        onChangeFontSize={setFontSize}
        lineHeight={lineHeight}
        onChangeLineHeight={setLineHeight}
        targetLang={targetLang}
        onChangeTargetLang={handleChangeTargetLang}
        onTranslateFullBook={startFullBookTranslation}
      />

      {/* Main Workspace */}
      <div className="relative flex flex-1 overflow-hidden">
        {!focusMode && (
          <Sidebar
            openDesktop={sidebarDesktopOpen}
            openMobile={sidebarMobileOpen}
            onCloseMobile={() => setSidebarMobileOpen(false)}
            activeTab={sidebarTab}
            onChangeTab={setSidebarTab}
            libraryBooks={libraryBooks}
            currentBookId={currentBookId}
            onSelectLibraryBook={async (bookId) => {
              const rec = await LibraryDB.getBook(bookId);
              if (rec) {
                await loadEpubBook(rec.data, {
                  bookId: rec.id,
                  title: rec.title,
                  author: rec.author,
                  isSample: rec.isSample,
                  persist: true,
                });
              }
            }}
            onDeleteLibraryBook={async (bookId) => {
              await LibraryDB.deleteBook(bookId);
              await refreshLibraryList();
              showToast('Buku dihapus dari Pustaka MacBook.', 'info');
            }}
            onTriggerUpload={() => fileInputRef.current?.click()}
            onLoadSampleBook={async () => {
              const sampleBuffer = await createSampleEpubBuffer();
              await loadEpubBook(sampleBuffer, {
                bookId: SAMPLE_BOOK_ID,
                title: 'The Art of Quiet Reading (Buku Contoh)',
                author: 'Eleanor Vance',
                isSample: true,
                persist: true,
              });
              showToast('Buku contoh bawaan dimuat.', 'info');
            }}
            toc={toc}
            onSelectTocHref={(href) => renditionRef.current?.display(href)}
            bookmarks={bookmarks}
            onSelectBookmark={(cfi) => renditionRef.current?.display(cfi)}
            onDeleteBookmark={(id) => {
              const next = bookmarks.filter((b) => b.id !== id);
              setBookmarks(next);
              localStorage.setItem('reader_bookmarks', JSON.stringify(next));
              showToast('Penanda dihapus.', 'info');
            }}
            vocabList={vocabList}
            onDeleteVocab={(id) => {
              const next = vocabList.filter((v) => v.id !== id);
              setVocabList(next);
              localStorage.setItem('reader_vocab', JSON.stringify(next));
            }}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
        )}

        {/* Center Reader + Right AI Drawer */}
        <main className="relative flex min-w-0 flex-1 flex-col lg:flex-row">
          <div className="relative flex min-w-0 flex-1 flex-col">
            {/* Compact Mode Switcher for Narrower Screens */}
            {!focusMode && (
              <div className="flex items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-1.5 text-xs xl:hidden">
                <div className="flex items-center gap-1 rounded-lg bg-slate-500/10 p-0.5 font-semibold">
                  {(
                    [
                      { id: 'original', label: 'Asli' },
                      { id: 'translated', label: 'Terjemahan' },
                      { id: 'bilingual', label: 'Bilingual' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => handleChangeReadingMode(mode.id)}
                      className={`rounded-md px-2.5 py-1 whitespace-nowrap ${
                        readingMode === mode.id
                          ? 'bg-blue-600 text-white'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {hasCachedChapters && (
                  <button
                    type="button"
                    onClick={downloadTranslatedBookHtml}
                    className="flex items-center gap-1 font-semibold text-emerald-600 hover:underline dark:text-emerald-400 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Unduh
                  </button>
                )}
              </div>
            )}

            {/* Focus Mode Exit Pill-free Button */}
            {focusMode && (
              <button
                type="button"
                onClick={() => setFocusMode(false)}
                title="Keluar dari Mode Fokus (Esc)"
                className="mac-surface fixed right-4 top-4 z-40 flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-md transition hover:bg-slate-500/10"
              >
                <Minimize2 className="h-3.5 w-3.5" />
                <span>Keluar Fokus</span>
              </button>
            )}

            {/* Reader Stage */}
            <div className="relative flex flex-1 items-center justify-center overflow-hidden p-3 sm:p-5">
              {loaderText && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[var(--bg-app)]/85 backdrop-blur-xs">
                  <div className="h-9 w-9 animate-spin rounded-full border-3 border-blue-600 border-t-transparent" />
                  <p className="text-sm font-semibold">{loaderText}</p>
                </div>
              )}

              <div
                id="epub-viewer"
                ref={viewerRef}
                className="mac-reader-stage relative h-full w-full max-w-4xl overflow-hidden rounded-2xl border shadow-xs"
              />

              {/* Floating Selection Popover */}
              {popoverPos && (
                <div
                  style={{ left: `${popoverPos.x}px`, top: `${popoverPos.y}px` }}
                  className="mac-surface fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-2xl border p-1.5 shadow-2xl"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPopoverPos(null);
                      handleContextualTranslate(selectedText, false);
                    }}
                    className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 whitespace-nowrap"
                  >
                    <Languages className="h-3.5 w-3.5" />
                    Terjemahkan
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPopoverPos(null);
                      handleSaveVocab(selectedText);
                    }}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-500/10 whitespace-nowrap"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    Simpan Kosakata
                  </button>
                  <button
                    type="button"
                    onClick={() => setPopoverPos(null)}
                    aria-label="Tutup Menu"
                    className="rounded-xl p-1.5 text-[var(--text-secondary)] hover:bg-slate-500/10"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Bottom Progress & Navigation */}
            <footer className="mac-surface shrink-0 border-t px-4 py-2.5">
              <div className="mx-auto flex max-w-4xl flex-col gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono-mac w-10 text-right text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                    {progressPct}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={progressPct}
                    onChange={(e) => {
                      if (!bookRef.current || !locationsReady) return;
                      const pct = parseInt(e.target.value, 10) / 100;
                      const cfi = bookRef.current.locations.cfiFromPercentage(pct);
                      if (cfi) renditionRef.current?.display(cfi);
                    }}
                    aria-label="Progres Membaca"
                    className="h-1.5 flex-1 cursor-pointer rounded-lg accent-blue-600"
                  />
                  <span className="font-mono-mac hidden text-xs tabular-nums text-[var(--text-secondary)] sm:inline">
                    {pageLocationLabel}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => renditionRef.current?.prev()}
                    className="mac-surface flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition hover:bg-slate-500/10 whitespace-nowrap"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Sebelumnya
                  </button>

                  <div className="hidden items-center gap-2 text-xs text-[var(--text-secondary)] md:flex">
                    <span>Navigasi cepat:</span>
                    <kbd className="font-mono-mac rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[11px]">
                      ←
                    </kbd>
                    <kbd className="font-mono-mac rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[11px]">
                      →
                    </kbd>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setShortcutsOpen(true)}
                      className="hover:underline"
                    >
                      Pintasan ⌘/
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => renditionRef.current?.next()}
                    className="mac-surface flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition hover:bg-slate-500/10 whitespace-nowrap"
                  >
                    Selanjutnya
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </footer>
          </div>

          <TranslationDrawer
            open={drawerOpen}
            targetLang={targetLang}
            sourceText={drawerSourceText}
            resultText={drawerResultText}
            loading={drawerLoading}
            errorText={drawerError}
            onClose={() => setDrawerOpen(false)}
            onCopy={async () => {
              if (!drawerResultText) return;
              try {
                await navigator.clipboard.writeText(drawerResultText);
                showToast('Hasil terjemahan disalin ke papan klip!', 'success');
              } catch {
                showToast('Gagal menyalin teks.', 'error');
              }
            }}
            onSaveVocab={() => {
              if (drawerSourceText) handleSaveVocab(drawerSourceText);
            }}
          />
        </main>
      </div>

      {/* Modals */}
      <PWAInstallModal
        open={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        isInstallable={isInstallable}
        isSafariMac={isSafariMac}
        isIOS={isIOS}
        onInstallClick={install}
      />

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
