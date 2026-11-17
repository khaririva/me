import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import ePub, { type Book, type Rendition } from 'epubjs';
import {
  BookMarked,
  BookOpen,
  Bookmark,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  PanelLeft,
  Pause,
  Play,
  Settings,
  Sparkles,
  Type as TypeIcon,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { ApiSettingsModal } from './components/ApiSettingsModal';
import { SettingsPopover } from './components/SettingsPopover';
import { ShortcutsModal } from './components/ShortcutsModal';
import { Sidebar } from './components/Sidebar';
import { TranslationDrawer } from './components/TranslationDrawer';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import {
  checkServerHealthApi,
  getClientActiveApiKey,
  polishChapterTranslationsDetailedApi,
  translateChapterDraftApi,
  translateContextualApi,
  translateVocabApi,
} from './lib/api';
import { SAMPLE_BOOK_ID, createSampleEpubBuffer } from './lib/sampleEpub';
import { applyEpubJsFixes } from './lib/patchEpubJs';
import { BookTranslationDB, LibraryDB } from './lib/storage';
import { sanitizeTextForTranslation } from './lib/textSanitize';
import {
  clearStoredSyncPassphrase,
  getFriendlyDeviceName,
  getOrCreateDeviceId,
  getStoredDeletedBookmarks,
  getStoredSyncPassphrase,
  mergeBookmarkLists,
  recordDeletedBookmarkId,
  sanitizeFirestoreKey,
  saveCustomDeviceName,
  saveStoredSyncPassphrase,
  syncService,
} from './services/syncService';

applyEpubJsFixes();
import type {
  BatchJobState,
  BookmarkItem,
  ChapterTranslation,
  LibraryBookMeta,
  ReaderContentWidth,
  ReaderFlow,
  ReaderFont,
  ReaderTextAlign,
  ReaderTheme,
  ReadingMode,
  RemotePositionPrompt,
  SidebarTab,
  SyncConnectionStatus,
  SyncDeviceInfo,
  SyncReadingPosition,
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

interface RenditionContentsItem {
  document: Document;
  window: Window;
  section?: {
    href?: string;
  };
  cfiFromNode?: (node: Node, ignoreClass?: string) => string;
  cfiFromRange?: (range: Range, ignoreClass?: string) => string;
}

interface SpineSection {
  href: string;
  index?: number;
  canonical?: string;
  load: (loader: unknown) => Promise<Document>;
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote';

const CONTENT_WIDTH_PX: Record<ReaderContentWidth, number> = {
  narrow: 620,
  medium: 760,
  wide: 940,
};

const CONTENT_WIDTH_CLASS: Record<ReaderContentWidth, string> = {
  narrow: 'max-w-[660px]',
  medium: 'max-w-[820px]',
  wide: 'max-w-[1020px]',
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeBlockText(text: string): string {
  return sanitizeTextForTranslation(text);
}

function normalizeHref(href?: string | null): string {
  if (!href) return '';
  const withoutHash = href.split('#')[0].split('?')[0].replace(/\\/g, '/').trim();
  let decoded = withoutHash;
  try {
    decoded = decodeURIComponent(withoutHash);
  } catch {
    decoded = withoutHash;
  }
  return decoded.replace(/^(\.\.?\/|\/)+/, '');
}

function hrefMatches(a?: string | null, b?: string | null): boolean {
  const na = normalizeHref(a);
  const nb = normalizeHref(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`) || na.endsWith(nb) || nb.endsWith(na)) {
    return true;
  }
  const baseA = (na.split('/').pop() || '').toLowerCase();
  const baseB = (nb.split('/').pop() || '').toLowerCase();
  return Boolean(baseA && baseB && baseA === baseB);
}

function findSpineSectionByHref(
  spineItems: SpineSection[],
  targetHref?: string | null
): SpineSection | undefined {
  const cleanTarget = normalizeHref(targetHref);
  if (!cleanTarget || spineItems.length === 0) return undefined;

  const exactMatch = spineItems.find((s) => normalizeHref(s.href) === cleanTarget);
  if (exactMatch) return exactMatch;

  const endsWithMatch = spineItems.find((s) => {
    const cleanSpine = normalizeHref(s.href);
    return (
      cleanSpine.endsWith(`/${cleanTarget}`) ||
      cleanTarget.endsWith(`/${cleanSpine}`) ||
      cleanSpine.endsWith(cleanTarget) ||
      cleanTarget.endsWith(cleanSpine)
    );
  });
  if (endsWithMatch) return endsWithMatch;

  const targetBase = (cleanTarget.split('/').pop() || '').toLowerCase();
  if (!targetBase) return undefined;
  return spineItems.find((s) => {
    const spineBase = (normalizeHref(s.href).split('/').pop() || '').toLowerCase();
    return Boolean(spineBase && spineBase === targetBase);
  });
}

function findTocNodeByHref(items: TocNode[], targetHref?: string | null): TocNode | undefined {
  for (const item of items) {
    if (hrefMatches(item.href, targetHref)) return item;
    if (item.subitems && item.subitems.length > 0) {
      const nested = findTocNodeByHref(item.subitems, targetHref);
      if (nested) return nested;
    }
  }
  return undefined;
}

function getTranslatableBlocks(doc: Document): HTMLElement[] {
  const all = Array.from(doc.querySelectorAll(BLOCK_SELECTOR)) as HTMLElement[];
  return all.filter((el) => {
    if (el.querySelector(BLOCK_SELECTOR)) return false;
    const text = normalizeBlockText(el.dataset?.origText || el.textContent || '');
    return text.length > 0;
  });
}

function captureOriginalBlocks(doc: Document): HTMLElement[] {
  const blocks = getTranslatableBlocks(doc);
  blocks.forEach((node, idx) => {
    node.dataset.paragraphIndex = String(idx + 1);
    if (!node.dataset.origHtml) {
      node.dataset.origHtml = node.innerHTML;
      node.dataset.origText = normalizeBlockText(node.textContent || '');
    }
  });
  return blocks;
}

function injectTranslationIntoDocument(
  doc: Document,
  mode: ReadingMode,
  cachedChapter?: ChapterTranslation
): boolean {
  if (!doc?.body) return false;
  const blocks = captureOriginalBlocks(doc);
  if (blocks.length === 0) return false;

  if (mode === 'original') {
    blocks.forEach((node) => {
      if (node.dataset.origHtml !== undefined) {
        node.innerHTML = node.dataset.origHtml;
      }
    });
    return true;
  }

  if (!cachedChapter || cachedChapter.pairs.length === 0) return false;

  const translationMap = new Map<string, string>();
  cachedChapter.pairs.forEach((p) => {
    translationMap.set(normalizeBlockText(p.orig), p.trans);
  });

  let appliedAny = false;
  blocks.forEach((node, idx) => {
    const origText = normalizeBlockText(node.dataset.origText || node.textContent || '');
    const pairAtIdx = cachedChapter.pairs[idx];
    const translatedText =
      (pairAtIdx && normalizeBlockText(pairAtIdx.orig) === origText ? pairAtIdx.trans : null) ||
      translationMap.get(origText) ||
      pairAtIdx?.trans ||
      null;
    if (!translatedText) return;

    if (mode === 'translated') {
      node.textContent = translatedText;
      appliedAny = true;
    } else if (mode === 'bilingual') {
      const origHtml = node.dataset.origHtml ?? escapeHtml(origText);
      node.innerHTML = `${origHtml}<span class="ai-bilingual-trans">${escapeHtml(
        translatedText
      )}</span>`;
      appliedAny = true;
    }
  });

  return appliedAny;
}

type ChapterPolishStatus = 'idle' | 'drafting' | 'polishing' | 'polished' | 'draft-only';

export default function App() {
  // Appearance & Typography Preferences (persisted in localStorage)
  const [theme, setTheme] = useState<ReaderTheme>(
    () => (localStorage.getItem('reader_theme') as ReaderTheme) || 'light'
  );
  const [fontFamily, setFontFamily] = useState<ReaderFont>(
    () => (localStorage.getItem('reader_font') as ReaderFont) || 'serif'
  );
  const [fontSize, setFontSize] = useState<number>(() =>
    Math.min(180, Math.max(70, parseInt(localStorage.getItem('reader_font_size') || '100', 10)))
  );
  const [lineHeight, setLineHeight] = useState<number>(() =>
    Math.min(2.2, Math.max(1.4, parseFloat(localStorage.getItem('reader_line_height') || '1.75')))
  );
  const [paragraphSpacing, setParagraphSpacing] = useState<number>(() =>
    Math.min(32, Math.max(8, parseInt(localStorage.getItem('reader_paragraph_spacing') || '16', 10)))
  );
  const [contentWidth, setContentWidth] = useState<ReaderContentWidth>(() => {
    const stored = localStorage.getItem('reader_content_width');
    return stored === 'narrow' || stored === 'wide' ? stored : 'medium';
  });
  const [textAlign, setTextAlign] = useState<ReaderTextAlign>(() =>
    localStorage.getItem('reader_text_align') === 'justify' ? 'justify' : 'left'
  );
  const [targetLang, setTargetLang] = useState<string>(
    () => localStorage.getItem('reader_target_lang') || 'Bahasa Indonesia'
  );
  const [readingMode, setReadingMode] = useState<ReadingMode>(
    () => (localStorage.getItem('reader_reading_mode') as ReadingMode) || 'original'
  );
  const [readerFlow, setReaderFlow] = useState<ReaderFlow>(() =>
    localStorage.getItem('reader_flow') === 'scroll' ? 'scroll' : 'paginated'
  );

  // Layout, Auto-Hide Chrome & Modals
  const [chromeVisible, setChromeVisible] = useState(true);
  const [sidebarDesktopOpen, setSidebarDesktopOpen] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('toc');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [hasServerEnvKey, setHasServerEnvKey] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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

  // Fixed Bottom Selection Action Bar & Translation Drawer
  const [selectionBar, setSelectionBar] = useState<{
    text: string;
    cfiRange?: string;
    href?: string;
    paragraphIndex?: number;
  } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [drawerSourceText, setDrawerSourceText] = useState<string>('');
  const [drawerResultText, setDrawerResultText] = useState<string>('');
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Full-Book Batch Translation & Two-Stage Polish Status
  const [hasCachedChapters, setHasCachedChapters] = useState<boolean>(false);
  const [chapterPolishStatus, setChapterPolishStatus] = useState<ChapterPolishStatus>('idle');
  const [polishFallbackReason, setPolishFallbackReason] = useState<string | null>(null);
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

  // Brave-Style Sync Chain State
  const [localDeviceId] = useState<string>(() => getOrCreateDeviceId());
  const [localDeviceName, setLocalDeviceName] = useState<string>(() => getFriendlyDeviceName());
  const [syncPassphrase, setSyncPassphrase] = useState<string>(() => getStoredSyncPassphrase());
  const [syncChainHash, setSyncChainHash] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncConnectionStatus>(() =>
    getStoredSyncPassphrase() ? 'connecting' : 'disconnected'
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncDevices, setSyncDevices] = useState<SyncDeviceInfo[]>([]);
  const [remotePrompt, setRemotePrompt] = useState<RemotePositionPrompt | null>(null);

  // Platform Runtime, Fullscreen & Online Status
  const { isElectron } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );
  const [isTouchOrMobileDevice, setIsTouchOrMobileDevice] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 || 'ontouchstart' in window : false
  );

  // Mutable Refs for EPUB.js, AbortControllers & Async Loops
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const currentBookIdRef = useRef<string>(currentBookId);
  const currentBookTitleRef = useRef<string>(currentBookTitle);
  const currentChapterTitleRef = useRef<string>(currentChapterTitle);
  const currentCfiRef = useRef<string | null>(null);
  const currentSpineHrefRef = useRef<string | null>(null);
  const progressPctRef = useRef<number>(progressPct);
  const locationsReadyRef = useRef<boolean>(false);
  const readingModeRef = useRef<ReadingMode>(readingMode);
  const readerFlowRef = useRef<ReaderFlow>(readerFlow);
  const targetLangRef = useRef<string>(targetLang);
  const hasServerEnvKeyRef = useRef<boolean>(hasServerEnvKey);
  const chapterCacheRef = useRef<Record<string, ChapterTranslation>>({});
  const activeSectionTranslatingRef = useRef<string | null>(null);
  const chapterAbortControllerRef = useRef<AbortController | null>(null);
  const backgroundPolishInFlightRef = useRef<Set<string>>(new Set());
  const scrollLastTopRef = useRef<number>(0);
  const scrollContainerBoundRef = useRef<HTMLElement | null>(null);
  const chromeVisibleRef = useRef<boolean>(chromeVisible);
  const lastChromeToggleAtRef = useRef<number>(0);
  const lastTapToggleAtRef = useRef<number>(0);
  const immersiveTransitionUntilRef = useRef<number>(0);
  const immersiveTransitionVersionRef = useRef<number>(0);
  const lastNativeStatusBarHiddenRef = useRef<boolean | null>(null);
  const lastViewerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const outerScrollTrackerRef = useRef<{ lastY: number; downwardAccum: number; syncedVersion: number }>({
    lastY: 0,
    downwardAccum: 0,
    syncedVersion: 0,
  });
  const containerScrollTrackerRef = useRef<{ lastY: number; downwardAccum: number; syncedVersion: number }>({
    lastY: 0,
    downwardAccum: 0,
    syncedVersion: 0,
  });
  const isAnyModalOpenRef = useRef<boolean>(false);
  const handleEscapeRef = useRef<() => void>(() => {});
  const bookmarksRef = useRef<BookmarkItem[]>(bookmarks);
  const deletedBookmarkIdsRef = useRef<Record<string, number>>(getStoredDeletedBookmarks());
  const lastSeenRemotePosTimestampRef = useRef<number>(0);
  const localPositionUpdatedAtRef = useRef<number>(0);
  const wasSelfRegisteredRef = useRef<boolean>(false);
  const flashHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollStopSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushCurrentReadingPositionToSyncRef = useRef<() => void>(() => {});
  const lastDoubleTapHandledAtRef = useRef<number>(0);
  const handleToggleParagraphBookmarkRef = useRef<
    (blockEl: HTMLElement, sectionHref?: string, contentsItem?: RenditionContentsItem) => void
  >(() => {});
  const batchControlRef = useRef<{ running: boolean; paused: boolean; cancelled: boolean }>({
    running: false,
    paused: false,
    cancelled: false,
  });

  useEffect(() => {
    chromeVisibleRef.current = chromeVisible;
  }, [chromeVisible]);

  useEffect(() => {
    progressPctRef.current = progressPct;
  }, [progressPct]);

  useEffect(() => {
    bookmarksRef.current = bookmarks;
  }, [bookmarks]);

  useEffect(() => {
    isAnyModalOpenRef.current = Boolean(
      apiSettingsOpen || shortcutsOpen || settingsOpen
    );
  }, [apiSettingsOpen, settingsOpen, shortcutsOpen]);

  const effectiveChromeVisible =
    chromeVisible ||
    settingsOpen ||
    apiSettingsOpen ||
    shortcutsOpen ||
    drawerOpen ||
    showBatchBar ||
    sidebarMobileOpen ||
    Boolean(loaderText);

  const isImmersive = !effectiveChromeVisible || isFullscreen;

  useEffect(() => {
    readingModeRef.current = readingMode;
    localStorage.setItem('reader_reading_mode', readingMode);
  }, [readingMode]);

  useEffect(() => {
    readerFlowRef.current = readerFlow;
    localStorage.setItem('reader_flow', readerFlow);
  }, [readerFlow]);

  useEffect(() => {
    targetLangRef.current = targetLang;
    localStorage.setItem('reader_target_lang', targetLang);
  }, [targetLang]);

  useEffect(() => {
    hasServerEnvKeyRef.current = hasServerEnvKey;
  }, [hasServerEnvKey]);

  useEffect(() => {
    checkServerHealthApi().then((health) => {
      hasServerEnvKeyRef.current = health.hasDefaultEnvKey;
      setHasServerEnvKey(health.hasDefaultEnvKey);
    });
  }, []);

  useEffect(() => {
    const macDesktop = (
      window as unknown as {
        macDesktop?: {
          isFullScreen?: () => Promise<boolean>;
          onFullScreenChanged?: (cb: (val: boolean) => void) => () => void;
        };
      }
    ).macDesktop;

    const syncBrowserFullscreen = () => {
      if (document.fullscreenElement) {
        setIsFullscreen(true);
      } else {
        void macDesktop?.isFullScreen?.().then((fs) => setIsFullscreen(Boolean(fs))).catch(() => {
          setIsFullscreen(false);
        });
        if (!macDesktop?.isFullScreen) {
          setIsFullscreen(false);
        }
      }
    };

    syncBrowserFullscreen();
    document.addEventListener('fullscreenchange', syncBrowserFullscreen);
    const unsubMacFs = macDesktop?.onFullScreenChanged?.((fs) => {
      setIsFullscreen(Boolean(fs) || Boolean(document.fullscreenElement));
    });

    return () => {
      document.removeEventListener('fullscreenchange', syncBrowserFullscreen);
      unsubMacFs?.();
    };
  }, []);

  const showToast = useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const abortActiveChapterTranslation = useCallback(() => {
    if (chapterAbortControllerRef.current) {
      chapterAbortControllerRef.current.abort();
      chapterAbortControllerRef.current = null;
    }
    activeSectionTranslatingRef.current = null;
  }, []);

  // Sync HTML theme classes & theme-color meta
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

  // Configure Capacitor Android StatusBar edge-to-edge overlay & icon contrast
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    void StatusBar.setStyle({
      style: theme === 'dark' ? Style.Dark : Style.Light,
    }).catch(() => {});
  }, [theme]);

  // Apply complete typography & comfort styles inside EPUB iframe
  const applyRenditionStyling = useCallback(() => {
    localStorage.setItem('reader_font', fontFamily);
    localStorage.setItem('reader_font_size', String(fontSize));
    localStorage.setItem('reader_line_height', String(lineHeight));
    localStorage.setItem('reader_paragraph_spacing', String(paragraphSpacing));
    localStorage.setItem('reader_content_width', contentWidth);
    localStorage.setItem('reader_text_align', textAlign);

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
    const isScroll = readerFlow === 'scroll';
    const columnWidthPx = CONTENT_WIDTH_PX[contentWidth];

    rendition.themes.register('custom', {
      body: {
        'background-color': `${palette.bg} !important`,
        color: `${palette.color} !important`,
        'font-family': `${fontStack} !important`,
        'line-height': `${lineHeight} !important`,
        'text-align': `${textAlign} !important`,
        ...(isScroll
          ? {
              'max-width': `${columnWidthPx}px !important`,
              margin: '0 auto !important',
              padding: `${isMobileViewport ? '64px 18px 80px' : '72px 36px 88px'} !important`,
            }
          : {
              padding: `${isMobileViewport ? '62px 18px 64px' : '66px 36px 68px'} !important`,
            }),
      },
      'p, li, blockquote': {
        color: `${palette.color} !important`,
        'font-family': `${fontStack} !important`,
        'line-height': `${lineHeight} !important`,
        'margin-bottom': `${paragraphSpacing}px !important`,
        'text-align': `${textAlign} !important`,
      },
      'div, span': {
        color: `${palette.color} !important`,
        'font-family': `${fontStack} !important`,
        'line-height': `${lineHeight} !important`,
      },
      'h1, h2, h3, h4': {
        color: `${palette.color} !important`,
        'font-family': `${fontStack} !important`,
        'margin-bottom': `${Math.max(12, Math.round(paragraphSpacing * 0.9))}px !important`,
      },
      a: {
        color: `${palette.link} !important`,
      },
      '.ai-bilingual-trans': {
        display: 'block',
        'margin-top': '0.45em',
        'margin-bottom': `${Math.max(8, Math.round(paragraphSpacing * 0.75))}px`,
        padding: '0.65em 0.9em',
        border: `1px solid ${palette.bilingualBorder}`,
        'background-color': palette.bilingualBg,
        'border-radius': '8px',
        'font-size': '0.94em',
        'text-align': `${textAlign} !important`,
        opacity: '0.95',
      },
      '.pl-scroll-chapter-nav': {
        display: 'flex',
        'justify-content': 'space-between',
        'align-items': 'center',
        gap: '12px',
        'flex-wrap': 'wrap',
        'margin-top': '2.5em',
        'padding-top': '1.5em',
        'border-top': `1px solid ${palette.bilingualBorder}`,
      },
      '.pl-scroll-nav-btn': {
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
        padding: '0.65em 1.2em',
        'border-radius': '10px',
        border: `1px solid ${palette.bilingualBorder}`,
        'background-color': palette.bilingualBg,
        color: `${palette.color} !important`,
        'font-family': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif !important",
        'font-size': '0.9rem',
        'font-weight': '600',
        cursor: 'pointer',
      },
      '.pl-scroll-nav-btn:disabled': {
        opacity: '0.4',
        cursor: 'not-allowed',
      },
      '.pl-scroll-nav-btn-primary': {
        'background-color': `${palette.link} !important`,
        'border-color': `${palette.link} !important`,
        color: '#ffffff !important',
      },
      '[data-bookmarked="true"]': {
        'border-left': `3px solid ${palette.link} !important`,
        'padding-left': '0.75em !important',
        'background-color':
          theme === 'dark'
            ? 'rgba(96, 165, 250, 0.08) !important'
            : theme === 'sepia'
            ? 'rgba(180, 83, 9, 0.06) !important'
            : 'rgba(37, 99, 235, 0.05) !important',
        'border-radius': '0 6px 6px 0',
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
      },
      '[data-flash-highlight="true"]': {
        'background-color':
          theme === 'dark'
            ? 'rgba(250, 204, 21, 0.24) !important'
            : 'rgba(253, 224, 71, 0.42) !important',
        'box-shadow':
          theme === 'dark'
            ? '0 0 0 4px rgba(250, 204, 21, 0.16)'
            : '0 0 0 4px rgba(253, 224, 71, 0.28)',
        'border-radius': '6px',
        transition: 'background-color 0.35s ease, box-shadow 0.35s ease',
      },
    });
    rendition.themes.select('custom');
    rendition.themes.fontSize(`${fontSize}%`);
  }, [contentWidth, fontFamily, fontSize, isMobileViewport, lineHeight, paragraphSpacing, readerFlow, textAlign, theme]);

  useEffect(() => {
    applyRenditionStyling();
  }, [applyRenditionStyling]);

  const syncBookmarkHighlightsInDoc = useCallback(
    (doc: Document, sectionHref?: string, listOverride?: BookmarkItem[]) => {
      if (!doc?.body) return;
      const activeBookId = currentBookIdRef.current;
      const targetHref = sectionHref || currentSpineHrefRef.current || '';
      const activeList = listOverride ?? bookmarksRef.current;

      const bookmarkedIndexes = new Set<number>();
      activeList.forEach((bm) => {
        if (bm.bookId !== activeBookId || typeof bm.paragraphIndex !== 'number') return;
        if (bm.href && targetHref && !hrefMatches(bm.href, targetHref)) return;
        bookmarkedIndexes.add(bm.paragraphIndex);
      });

      const taggedBlocks = doc.querySelectorAll('[data-paragraph-index]');
      taggedBlocks.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const idx = Number(htmlEl.dataset.paragraphIndex);
        if (Number.isFinite(idx) && bookmarkedIndexes.has(idx)) {
          htmlEl.dataset.bookmarked = 'true';
        } else {
          delete htmlEl.dataset.bookmarked;
        }
      });
    },
    []
  );

  const syncAllBookmarkHighlights = useCallback(
    (listOverride?: BookmarkItem[]) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const contentsList = (rendition.getContents() || []) as unknown as RenditionContentsItem[];
      contentsList.forEach((c) => {
        if (c.document?.body) {
          syncBookmarkHighlightsInDoc(c.document, c.section?.href, listOverride);
        }
      });
    },
    [syncBookmarkHighlightsInDoc]
  );

  useEffect(() => {
    syncAllBookmarkHighlights();
  }, [bookmarks, currentBookId, syncAllBookmarkHighlights]);

  const clearReaderSelection = useCallback(() => {
    setSelectionBar(null);
    const rendition = renditionRef.current;
    if (!rendition) return;
    try {
      const contentsList = (rendition.getContents() || []) as unknown as RenditionContentsItem[];
      contentsList.forEach((c) => {
        c.window?.getSelection()?.removeAllRanges();
        c.document?.getSelection()?.removeAllRanges();
      });
    } catch {
      // ignore cross-frame cleanup errors
    }
  }, []);

  const safeResizeRendition = useCallback((force = false) => {
    const rendition = renditionRef.current as
      | (Rendition & { manager?: { resize?: unknown } })
      | null;
    const container = viewerRef.current;
    if (!rendition || !rendition.manager || !container) return;
    const nextWidth = container.clientWidth;
    const nextHeight = container.clientHeight;
    if (nextWidth <= 0 || nextHeight <= 0) return;

    const prev = lastViewerSizeRef.current;
    const widthChanged = Math.abs(nextWidth - prev.width) > 2;
    const heightDiff = Math.abs(nextHeight - prev.height);

    // Skip no-op resizes when container dimensions have not changed
    if (prev.width > 0 && Math.abs(nextWidth - prev.width) <= 1 && Math.abs(nextHeight - prev.height) <= 1) {
      return;
    }

    // Avoid EPUB.js re-layout on Android StatusBar height transitions to prevent white flashes and scroll resets
    if (!force && prev.width > 0 && !widthChanged) {
      if (readerFlowRef.current === 'scroll') return;
      if (Date.now() < immersiveTransitionUntilRef.current || heightDiff < 96) return;
    }

    lastViewerSizeRef.current = { width: nextWidth, height: nextHeight };
    try {
      rendition.resize(nextWidth, nextHeight);
    } catch {
      // ignore transient resize errors while switching books
    }
  }, []);

  // Re-measure rendition cleanly when reading column width changes in paginated mode
  useEffect(() => {
    const timer = setTimeout(() => safeResizeRendition(true), 120);
    return () => clearTimeout(timer);
  }, [contentWidth, safeResizeRendition]);

  // Ignore scroll changes for 400ms after immersive/StatusBar transitions to prevent viewport-resize feedback
  useEffect(() => {
    immersiveTransitionVersionRef.current += 1;
    immersiveTransitionUntilRef.current = Date.now() + 400;
  }, [isImmersive]);

  // Sync Android Status Bar visibility strictly when immersive state changes
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    if (lastNativeStatusBarHiddenRef.current === isImmersive) return;
    lastNativeStatusBarHiddenRef.current = isImmersive;

    if (isImmersive) {
      void StatusBar.hide().catch(() => {});
    } else {
      void StatusBar.show().catch(() => {});
    }
  }, [isImmersive]);

  const setChromeVisibleGuarded = useCallback((nextVisible: boolean) => {
    const now = Date.now();
    if (now < immersiveTransitionUntilRef.current) return;
    if (now - lastChromeToggleAtRef.current < 350) return;
    if (chromeVisibleRef.current === nextVisible) return;

    lastChromeToggleAtRef.current = now;
    chromeVisibleRef.current = nextVisible;
    setChromeVisible(nextVisible);
  }, []);

  const toggleChromeByTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapToggleAtRef.current < 180) return;
    lastTapToggleAtRef.current = now;
    lastChromeToggleAtRef.current = now;
    const next = !chromeVisibleRef.current;
    chromeVisibleRef.current = next;
    setChromeVisible(next);
  }, []);

  const handleScrollMetric = useCallback(
    (
      currentScrollY: number,
      tracker: { lastY: number; downwardAccum: number; syncedVersion: number }
    ) => {
      const now = Date.now();
      const currentVersion = immersiveTransitionVersionRef.current;

      if (now < immersiveTransitionUntilRef.current) {
        tracker.lastY = currentScrollY;
        tracker.downwardAccum = 0;
        tracker.syncedVersion = currentVersion;
        return;
      }

      if (tracker.syncedVersion !== currentVersion) {
        tracker.lastY = currentScrollY;
        tracker.downwardAccum = 0;
        tracker.syncedVersion = currentVersion;
        return;
      }

      const step = currentScrollY - tracker.lastY;
      tracker.lastY = currentScrollY;
      scrollLastTopRef.current = currentScrollY;

      if (currentScrollY <= 10) {
        tracker.downwardAccum = 0;
        if (!chromeVisibleRef.current && now - lastChromeToggleAtRef.current >= 350) {
          setChromeVisibleGuarded(true);
        }
        return;
      }

      if (step > 0) {
        tracker.downwardAccum += step;
        if (
          tracker.downwardAccum > 80 &&
          currentScrollY > 80 &&
          chromeVisibleRef.current &&
          now - lastChromeToggleAtRef.current >= 350
        ) {
          tracker.downwardAccum = 0;
          setChromeVisibleGuarded(false);
        }
      } else if (step < 0) {
        // Do not auto-show toolbar/StatusBar on small upward scroll; wait until scrollTop <= 10 or user tap
        tracker.downwardAccum = 0;
      }
    },
    [setChromeVisibleGuarded]
  );

  const expandScrolledViews = useCallback(() => {
    if (readerFlowRef.current !== 'scroll') return;
    const rendition = renditionRef.current;
    if (!rendition || typeof rendition.views !== 'function') return;
    try {
      const views = rendition.views() as unknown as Array<{ expand?: () => void }> | undefined;
      views?.forEach((v) => v?.expand?.());
    } catch {
      // ignore transient view expansion errors
    }
  }, []);

  const bindScrollAutoHide = useCallback(() => {
    const container = viewerRef.current?.querySelector('.epub-container') as HTMLElement | null;
    if (!container || scrollContainerBoundRef.current === container) return;
    scrollContainerBoundRef.current = container;
    scrollLastTopRef.current = container.scrollTop;
    containerScrollTrackerRef.current = {
      lastY: container.scrollTop,
      downwardAccum: 0,
      syncedVersion: immersiveTransitionVersionRef.current,
    };

    container.addEventListener(
      'scroll',
      () => {
        if (readerFlowRef.current !== 'scroll') return;
        handleScrollMetric(container.scrollTop, containerScrollTrackerRef.current);
        if (scrollStopSyncTimerRef.current) clearTimeout(scrollStopSyncTimerRef.current);
        scrollStopSyncTimerRef.current = setTimeout(() => {
          pushCurrentReadingPositionToSyncRef.current();
        }, 550);
      },
      { passive: true }
    );
  }, [handleScrollMetric]);

  const scrollReaderVertical = useCallback((deltaY: number) => {
    const container = viewerRef.current?.querySelector('.epub-container') as HTMLElement | null;
    if (!container) return;
    container.scrollBy({ top: deltaY, behavior: 'smooth' });
  }, []);

  const navigateReader = useCallback((direction: 'prev' | 'next') => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const scrollToTopIfScrollMode = () => {
      if (readerFlowRef.current !== 'scroll') return;
      const container = viewerRef.current?.querySelector('.epub-container') as HTMLElement | null;
      if (container) container.scrollTo({ top: 0, behavior: 'auto' });
    };

    if (direction === 'prev') {
      void Promise.resolve(rendition.prev()).then(scrollToTopIfScrollMode);
    } else {
      void Promise.resolve(rendition.next()).then(scrollToTopIfScrollMode);
    }
  }, []);

  const navigateReaderRef = useRef(navigateReader);
  const scrollReaderVerticalRef = useRef(scrollReaderVertical);
  useEffect(() => {
    navigateReaderRef.current = navigateReader;
  }, [navigateReader]);
  useEffect(() => {
    scrollReaderVerticalRef.current = scrollReaderVertical;
  }, [scrollReaderVertical]);

  const syncScrollNavFooterInDoc = useCallback(
    (doc: Document, sectionHref?: string) => {
      if (!doc?.body) return;
      const existing = doc.getElementById('pl-scroll-chapter-nav');
      if (readerFlowRef.current !== 'scroll') {
        if (existing) existing.remove();
        return;
      }

      const spineItems = ((bookRef.current?.spine as unknown as { spineItems?: SpineSection[] })
        ?.spineItems || []) as SpineSection[];
      const targetHref = sectionHref || currentSpineHrefRef.current || '';
      const currentIdx = spineItems.findIndex((s) => hrefMatches(s.href, targetHref));
      const hasPrev = currentIdx > 0;
      const hasNext =
        currentIdx >= 0 ? currentIdx < spineItems.length - 1 : spineItems.length > 1;

      let navEl = existing;
      if (!navEl) {
        navEl = doc.createElement('div');
        navEl.id = 'pl-scroll-chapter-nav';
        navEl.className = 'pl-scroll-chapter-nav';

        const prevBtn = doc.createElement('button');
        prevBtn.type = 'button';
        prevBtn.dataset.plNav = 'prev';
        prevBtn.className = 'pl-scroll-nav-btn';
        prevBtn.textContent = '← Bab Sebelumnya';
        prevBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          navigateReaderRef.current('prev');
        });

        const nextBtn = doc.createElement('button');
        nextBtn.type = 'button';
        nextBtn.dataset.plNav = 'next';
        nextBtn.className = 'pl-scroll-nav-btn pl-scroll-nav-btn-primary';
        nextBtn.textContent = 'Bab Berikutnya →';
        nextBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          navigateReaderRef.current('next');
        });

        navEl.appendChild(prevBtn);
        navEl.appendChild(nextBtn);
        doc.body.appendChild(navEl);
      }

      const prevButton = navEl.querySelector('button[data-pl-nav="prev"]') as HTMLButtonElement | null;
      const nextButton = navEl.querySelector('button[data-pl-nav="next"]') as HTMLButtonElement | null;
      if (prevButton) prevButton.disabled = !hasPrev;
      if (nextButton) nextButton.disabled = !hasNext;

      setTimeout(() => {
        expandScrolledViews();
        bindScrollAutoHide();
      }, 40);
    },
    [bindScrollAutoHide, expandScrolledViews]
  );

  const findCachedChapterInMemory = useCallback(
    (href?: string): ChapterTranslation | undefined => {
      if (!href) return undefined;
      const cache = chapterCacheRef.current;
      const direct = cache[href] || cache[href.split('#')[0]];
      if (direct) return direct;
      const matchedKey = Object.keys(cache).find((k) => hrefMatches(k, href));
      return matchedKey ? cache[matchedKey] : undefined;
    },
    []
  );

  // Extract sanitized paragraph blocks from live DOM or EPUB spine section
  const extractSectionParagraphs = useCallback(async (section: SpineSection): Promise<string[]> => {
    try {
      const rendition = renditionRef.current;
      if (rendition) {
        const contentsList = (rendition.getContents() || []) as unknown as RenditionContentsItem[];
        const liveContent = contentsList.find((c) =>
          hrefMatches(c.section?.href || currentSpineHrefRef.current || '', section.href)
        );
        if (liveContent?.document?.body) {
          const blocks = captureOriginalBlocks(liveContent.document);
          if (blocks.length > 0) {
            return blocks
              .map((b) => normalizeBlockText(b.dataset.origText || b.textContent || ''))
              .filter((t) => t.length > 0);
          }
        }
      }
    } catch {
      // fallback to section.load
    }

    const book = bookRef.current;
    if (!book) return [];
    try {
      const doc = await section.load(book.load.bind(book));
      if (!doc) return [];
      const blocks = getTranslatableBlocks(doc);
      return blocks
        .map((n) => normalizeBlockText(n.textContent || ''))
        .filter((t) => t.length > 0);
    } catch {
      return [];
    }
  }, []);

  const syncActiveIframesForHref = useCallback(
    (hrefKey: string, record: ChapterTranslation) => {
      if (readingModeRef.current === 'original') return;
      const activeHref = currentSpineHrefRef.current;
      if (activeHref && !hrefMatches(activeHref, hrefKey)) return;

      const contentsList = (renditionRef.current?.getContents() ||
        []) as unknown as RenditionContentsItem[];
      contentsList.forEach((c) => {
        const cHref = c.section?.href || '';
        if (cHref && hrefMatches(cHref, hrefKey) && c.document?.body) {
          injectTranslationIntoDocument(c.document, readingModeRef.current, record);
          syncScrollNavFooterInDoc(c.document, cHref);
        }
      });
      setTimeout(expandScrolledViews, 50);
    },
    [expandScrolledViews, syncScrollNavFooterInDoc]
  );

  const setStatusIfActiveHref = useCallback((hrefKey: string, status: ChapterPolishStatus) => {
    if (readingModeRef.current === 'original') {
      setChapterPolishStatus('idle');
      return;
    }
    const activeHref = currentSpineHrefRef.current;
    if (activeHref && hrefMatches(activeHref, hrefKey)) {
      setChapterPolishStatus(status);
    }
  }, []);

  // Stage 2 (Background AI Polish) with AbortController & Active-Chapter Guard
  const runBackgroundAiPolish = useCallback(
    async (
      hrefKey: string,
      paragraphs: string[],
      drafts: string[],
      signal?: AbortSignal
    ): Promise<ChapterTranslation | null> => {
      if (signal?.aborted) return null;
      const bookId = currentBookIdRef.current;
      const bookTitle = currentBookTitleRef.current;
      const lang = targetLangRef.current;
      const jobKey = `${bookId}::${lang}::${hrefKey}`;

      if (backgroundPolishInFlightRef.current.has(jobKey)) {
        return null;
      }

      const canRunAi = Boolean(getClientActiveApiKey() || hasServerEnvKeyRef.current);
      if (!canRunAi) {
        setPolishFallbackReason(null);
        setStatusIfActiveHref(hrefKey, 'draft-only');
        return null;
      }

      backgroundPolishInFlightRef.current.add(jobKey);
      setPolishFallbackReason(null);
      setStatusIfActiveHref(hrefKey, 'polishing');

      try {
        const items = paragraphs.map((original, id) => ({
          id,
          original: sanitizeTextForTranslation(original),
          draft: sanitizeTextForTranslation(drafts[id] || original),
        }));

        const polishResult = await polishChapterTranslationsDetailedApi(
          items,
          lang,
          hasServerEnvKeyRef.current,
          signal
        );

        if (signal?.aborted || polishResult.errorCode === 'ABORTED') return null;

        const polishedList = polishResult.polished;
        if (!polishedList || polishedList.length === 0) {
          setPolishFallbackReason(polishResult.reason || null);
          setStatusIfActiveHref(hrefKey, 'draft-only');
          return null;
        }

        const polishedRecord: ChapterTranslation = {
          href: hrefKey,
          pairs: paragraphs.map((orig, idx) => ({
            orig,
            trans: polishedList[idx] || drafts[idx] || orig,
          })),
          stage: 'polished',
          updatedAt: Date.now(),
        };

        if (currentBookIdRef.current === bookId && targetLangRef.current === lang) {
          chapterCacheRef.current[hrefKey] = polishedRecord;
          setHasCachedChapters(true);
          await BookTranslationDB.saveBookCache(bookId, lang, bookTitle, chapterCacheRef.current);
          // Hanya perbarui DOM bila pengguna masih berada di bab yang sama
          if (hrefMatches(currentSpineHrefRef.current, hrefKey)) {
            syncActiveIframesForHref(hrefKey, polishedRecord);
            setPolishFallbackReason(null);
            setStatusIfActiveHref(hrefKey, 'polished');
          }
        } else {
          const otherCache = await BookTranslationDB.getBookCache(bookId, lang);
          otherCache[hrefKey] = polishedRecord;
          await BookTranslationDB.saveBookCache(bookId, lang, bookTitle, otherCache);
        }

        const spineItems = ((bookRef.current?.spine as unknown as { spineItems?: SpineSection[] })
          ?.spineItems || []) as SpineSection[];
        const chapterIdx = spineItems.findIndex((s) => hrefMatches(s.href, hrefKey));
        syncService.scheduleTranslationSync({
          bookId,
          bookTitle,
          targetLang: lang,
          chapterIndex: chapterIdx >= 0 ? chapterIdx : 0,
          href: hrefKey,
          stage: polishedRecord.stage || 'polished',
          pairs: polishedRecord.pairs,
          updatedAt: polishedRecord.updatedAt,
        });

        return polishedRecord;
      } catch (err) {
        if (!signal?.aborted) {
          setPolishFallbackReason(
            err instanceof Error ? err.message : 'Gagal memperhalus terjemahan dengan AI.'
          );
          setStatusIfActiveHref(hrefKey, 'draft-only');
        }
        return null;
      } finally {
        backgroundPolishInFlightRef.current.delete(jobKey);
      }
    },
    [setStatusIfActiveHref, syncActiveIframesForHref]
  );

  // Two-Stage Hybrid Translation helper
  const translateParagraphsTwoStage = useCallback(
    async (
      hrefKey: string,
      paragraphs: string[],
      options?: { waitForPolish?: boolean; signal?: AbortSignal }
    ): Promise<ChapterTranslation> => {
      if (paragraphs.length === 0) {
        const emptyRec: ChapterTranslation = {
          href: hrefKey,
          pairs: [],
          stage: 'polished',
          updatedAt: Date.now(),
        };
        chapterCacheRef.current[hrefKey] = emptyRec;
        return emptyRec;
      }

      const bookId = currentBookIdRef.current;
      const bookTitle = currentBookTitleRef.current;
      const lang = targetLangRef.current;
      const signal = options?.signal;

      // Stage 1: Instant Draft (< 1s)
      setStatusIfActiveHref(hrefKey, 'drafting');
      const drafts = await translateChapterDraftApi(paragraphs, lang, signal);
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const draftRecord: ChapterTranslation = {
        href: hrefKey,
        pairs: paragraphs.map((orig, idx) => ({
          orig,
          trans: drafts[idx] || orig,
        })),
        stage: 'draft',
        updatedAt: Date.now(),
      };

      if (currentBookIdRef.current === bookId && targetLangRef.current === lang) {
        chapterCacheRef.current[hrefKey] = draftRecord;
        setHasCachedChapters(true);
        if (hrefMatches(currentSpineHrefRef.current, hrefKey)) {
          syncActiveIframesForHref(hrefKey, draftRecord);
        }
        void BookTranslationDB.saveBookCache(bookId, lang, bookTitle, chapterCacheRef.current);
        const spineItems = ((bookRef.current?.spine as unknown as { spineItems?: SpineSection[] })
          ?.spineItems || []) as SpineSection[];
        const chapterIdx = spineItems.findIndex((s) => hrefMatches(s.href, hrefKey));
        syncService.scheduleTranslationSync({
          bookId,
          bookTitle,
          targetLang: lang,
          chapterIndex: chapterIdx >= 0 ? chapterIdx : 0,
          href: hrefKey,
          stage: 'draft',
          pairs: draftRecord.pairs,
          updatedAt: draftRecord.updatedAt,
        });
      }

      // Stage 2: Background AI Polish
      const polishPromise = runBackgroundAiPolish(hrefKey, paragraphs, drafts, signal);
      if (options?.waitForPolish) {
        const polished = await polishPromise;
        return polished || draftRecord;
      }

      void polishPromise;
      return draftRecord;
    },
    [runBackgroundAiPolish, setStatusIfActiveHref, syncActiveIframesForHref]
  );

  const translateAndCacheSection = useCallback(
    async (
      section: SpineSection,
      options?: { waitForPolish?: boolean; signal?: AbortSignal }
    ): Promise<ChapterTranslation | null> => {
      if (!section?.href) return null;
      const hrefKey = normalizeHref(section.href);
      const existing = findCachedChapterInMemory(hrefKey);
      if (existing && existing.pairs.length > 0) {
        if (hrefMatches(currentSpineHrefRef.current, hrefKey)) {
          syncActiveIframesForHref(hrefKey, existing);
        }
        if (existing.stage === 'draft') {
          const polishPromise = runBackgroundAiPolish(
            hrefKey,
            existing.pairs.map((p) => p.orig),
            existing.pairs.map((p) => p.trans),
            options?.signal
          );
          if (options?.waitForPolish) {
            const polished = await polishPromise;
            return polished || existing;
          }
          void polishPromise;
        } else {
          setStatusIfActiveHref(hrefKey, 'polished');
        }
        return existing;
      }

      const paragraphs = await extractSectionParagraphs(section);
      return translateParagraphsTwoStage(hrefKey, paragraphs, options);
    },
    [
      extractSectionParagraphs,
      findCachedChapterInMemory,
      runBackgroundAiPolish,
      setStatusIfActiveHref,
      syncActiveIframesForHref,
      translateParagraphsTwoStage,
    ]
  );

  // Inject original, translated, or bilingual paragraphs into active EPUB iframe DOM(s)
  const applyReadingModeToCurrentView = useCallback(
    async (hrefOverride?: string, options?: { autoTranslateIfMissing?: boolean }) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const contentsList = (rendition.getContents() || []) as unknown as RenditionContentsItem[];
      if (!contentsList || contentsList.length === 0) return;

      const mode = readingModeRef.current;
      if (mode === 'original') {
        abortActiveChapterTranslation();
        setChapterPolishStatus('idle');
        contentsList.forEach((item) => {
          if (item.document?.body) {
            injectTranslationIntoDocument(item.document, 'original');
          }
        });
        return;
      }

      if (Object.keys(chapterCacheRef.current).length === 0 && currentBookIdRef.current) {
        const dbCache = await BookTranslationDB.getBookCache(
          currentBookIdRef.current,
          targetLangRef.current
        );
        if (Object.keys(dbCache).length > 0) {
          chapterCacheRef.current = dbCache;
          setHasCachedChapters(true);
        }
      }

      for (const item of contentsList) {
        const doc = item.document;
        if (!doc?.body) continue;

        const targetHref =
          item.section?.href || hrefOverride || currentSpineHrefRef.current || '';
        const cleanTargetHref = normalizeHref(targetHref);
        if (!cleanTargetHref) continue;

        let cachedChapter = findCachedChapterInMemory(cleanTargetHref);

        if (cachedChapter && cachedChapter.pairs.length > 0) {
          injectTranslationIntoDocument(doc, mode, cachedChapter);
          if (cachedChapter.stage === 'draft') {
            if (!chapterAbortControllerRef.current || chapterAbortControllerRef.current.signal.aborted) {
              chapterAbortControllerRef.current = new AbortController();
            }
            void runBackgroundAiPolish(
              cleanTargetHref,
              cachedChapter.pairs.map((p) => p.orig),
              cachedChapter.pairs.map((p) => p.trans),
              chapterAbortControllerRef.current.signal
            );
          } else {
            setStatusIfActiveHref(cleanTargetHref, 'polished');
          }
          continue;
        }

        if (
          !cachedChapter &&
          options?.autoTranslateIfMissing !== false &&
          activeSectionTranslatingRef.current !== cleanTargetHref
        ) {
          abortActiveChapterTranslation();
          const controller = new AbortController();
          chapterAbortControllerRef.current = controller;

          const book = bookRef.current;
          const spineItems = ((book?.spine as unknown as { spineItems?: SpineSection[] })
            ?.spineItems || []) as SpineSection[];
          const section =
            (book?.spine?.get(targetHref) as unknown as SpineSection | undefined) ||
            spineItems.find((s) => hrefMatches(s.href, cleanTargetHref));

          try {
            activeSectionTranslatingRef.current = cleanTargetHref;
            if (section) {
              cachedChapter =
                (await translateAndCacheSection(section, { signal: controller.signal })) ??
                undefined;
            } else {
              const blocks = captureOriginalBlocks(doc);
              const paragraphs = blocks
                .map((b) => normalizeBlockText(b.dataset.origText || b.textContent || ''))
                .filter((t) => t.length > 0);
              if (paragraphs.length > 0) {
                cachedChapter = await translateParagraphsTwoStage(cleanTargetHref, paragraphs, {
                  signal: controller.signal,
                });
              }
            }
          } catch (err) {
            if ((err as { name?: string })?.name !== 'AbortError') {
              const msg =
                err instanceof Error ? err.message : 'Gagal menerjemahkan bab otomatis.';
              showToast(msg, 'error');
              setStatusIfActiveHref(cleanTargetHref, 'idle');
            }
          } finally {
            if (activeSectionTranslatingRef.current === cleanTargetHref) {
              activeSectionTranslatingRef.current = null;
            }
          }
        }

        if (
          cachedChapter &&
          cachedChapter.pairs.length > 0 &&
          hrefMatches(currentSpineHrefRef.current, cleanTargetHref)
        ) {
          injectTranslationIntoDocument(doc, mode, cachedChapter);
        }
      }
    },
    [
      abortActiveChapterTranslation,
      findCachedChapterInMemory,
      runBackgroundAiPolish,
      setStatusIfActiveHref,
      showToast,
      translateAndCacheSection,
      translateParagraphsTwoStage,
    ]
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
        abortActiveChapterTranslation();
        if (batchControlRef.current.running) {
          batchControlRef.current.cancelled = true;
          batchControlRef.current.running = false;
        }
        setShowBatchBar(false);
        setChapterPolishStatus('idle');
        setLoaderText('Memuat isi buku EPUB...');
        setSelectionBar(null);
        scrollContainerBoundRef.current = null;

        if (bookRef.current) {
          renditionRef.current = null;
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

        const cached = await BookTranslationDB.getBookCache(resolvedId, targetLangRef.current);
        chapterCacheRef.current = cached;
        const cachedCount = Object.keys(cached).length;
        setHasCachedChapters(cachedCount > 0);

        const rendition = book.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: readerFlowRef.current === 'scroll' ? 'scrolled-doc' : 'paginated',
        });
        renditionRef.current = rendition;
        lastViewerSizeRef.current = {
          width: viewerRef.current.clientWidth,
          height: viewerRef.current.clientHeight,
        };
        applyRenditionStyling();

        const navigation = await book.loaded.navigation;
        const tocList = (navigation.toc || []) as TocNode[];
        setToc(tocList);
        if (tocList.length > 0) {
          const firstTitle = tocList[0].label.trim();
          currentChapterTitleRef.current = firstTitle;
          setCurrentChapterTitle(firstTitle);
        }

        let initialRelocationHandled = false;
        rendition.on('relocated', async (location: RenditionLocation) => {
          setSelectionBar(null);
          if (location?.start) {
            const prevHref = normalizeHref(currentSpineHrefRef.current);
            const nextHref = normalizeHref(location.start.href);
            if (prevHref && nextHref && !hrefMatches(prevHref, nextHref)) {
              abortActiveChapterTranslation();
              setChapterPolishStatus('idle');
            }

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

            const foundToc = findTocNodeByHref(tocList, location.start?.href);
            if (foundToc) {
              const title = foundToc.label.trim();
              currentChapterTitleRef.current = title;
              setCurrentChapterTitle(title);
            }

            await LibraryDB.updateProgress(currentBookIdRef.current, pct, location.start.cfi);
            await applyReadingModeToCurrentView(location.start.href);
            syncAllBookmarkHighlights();
            if (!initialRelocationHandled) {
              initialRelocationHandled = true;
            } else {
              pushCurrentReadingPositionToSyncRef.current();
            }
          }
        });

        rendition.on('rendered', async (section: { href?: string }) => {
          if (section?.href) {
            currentSpineHrefRef.current = section.href;
          }
          const contentsList = (rendition.getContents() || []) as unknown as RenditionContentsItem[];
          contentsList.forEach((c) => {
            if (c.document?.body) {
              syncScrollNavFooterInDoc(c.document, c.section?.href || section?.href);
              syncBookmarkHighlightsInDoc(c.document, c.section?.href || section?.href);
            }
          });
          await applyReadingModeToCurrentView(section?.href);
          syncAllBookmarkHighlights();
          expandScrolledViews();
          bindScrollAutoHide();
        });

        rendition.on('selected', (cfiRange: string, contents: RenditionContentsItem) => {
          try {
            if (Date.now() - lastDoubleTapHandledAtRef.current < 450) {
              contents.window.getSelection()?.removeAllRanges();
              setSelectionBar(null);
              return;
            }
            const selection = contents.window.getSelection();
            const text = selection ? selection.toString().trim() : '';
            if (!selection || !text || selection.rangeCount === 0) {
              setSelectionBar(null);
              return;
            }

            const anchorNode = selection.anchorNode || selection.getRangeAt(0).commonAncestorContainer;
            const anchorEl = (
              anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode
            ) as HTMLElement | null;
            const blockEl = anchorEl?.closest('[data-paragraph-index]') as HTMLElement | null;
            const parsedIdx = blockEl?.dataset.paragraphIndex
              ? Number(blockEl.dataset.paragraphIndex)
              : undefined;

            setSelectionBar({
              text,
              cfiRange,
              href: contents.section?.href || currentSpineHrefRef.current || undefined,
              paragraphIndex: Number.isFinite(parsedIdx) ? parsedIdx : undefined,
            });
          } catch {
            // ignore selection inspection error
          }
        });

        rendition.hooks.content.register((contents: RenditionContentsItem) => {
          const doc = contents.document;
          captureOriginalBlocks(doc);

          if (readingModeRef.current !== 'original') {
            const cHref = contents.section?.href || currentSpineHrefRef.current || '';
            const cachedRec = findCachedChapterInMemory(cHref);
            if (cachedRec && cachedRec.pairs.length > 0) {
              injectTranslationIntoDocument(doc, readingModeRef.current, cachedRec);
            }
          }

          syncScrollNavFooterInDoc(doc, contents.section?.href);
          syncBookmarkHighlightsInDoc(doc, contents.section?.href);

          doc.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              handleEscapeRef.current();
              return;
            }
            const target = e.target as HTMLElement | null;
            const isTyping =
              target &&
              (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
            if (isTyping || isAnyModalOpenRef.current) return;

            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              navigateReaderRef.current('prev');
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              navigateReaderRef.current('next');
            } else if (e.key === 'ArrowUp' && readerFlowRef.current === 'scroll') {
              e.preventDefault();
              scrollReaderVerticalRef.current(-200);
            } else if (e.key === 'ArrowDown' && readerFlowRef.current === 'scroll') {
              e.preventDefault();
              scrollReaderVerticalRef.current(200);
            }
          });

          // Show/hide fixed bottom selection bar smoothly when native text selection changes
          doc.addEventListener('selectionchange', () => {
            if (Date.now() - lastDoubleTapHandledAtRef.current < 450) {
              doc.getSelection()?.removeAllRanges();
              setSelectionBar(null);
              return;
            }
            const sel = doc.getSelection();
            const text = sel ? sel.toString().trim() : '';
            if (!text || !sel || sel.rangeCount === 0) {
              setSelectionBar(null);
              return;
            }
            const anchorNode = sel.anchorNode || sel.getRangeAt(0).commonAncestorContainer;
            const anchorEl = (
              anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode
            ) as HTMLElement | null;
            const blockEl = anchorEl?.closest('[data-paragraph-index]') as HTMLElement | null;
            const parsedIdx = blockEl?.dataset.paragraphIndex
              ? Number(blockEl.dataset.paragraphIndex)
              : undefined;
            let cfiRange: string | undefined;
            try {
              cfiRange = contents.cfiFromRange?.(sel.getRangeAt(0));
            } catch {
              cfiRange = undefined;
            }
            setSelectionBar((prev) => ({
              text,
              cfiRange: cfiRange || prev?.cfiRange,
              href: contents.section?.href || currentSpineHrefRef.current || undefined,
              paragraphIndex: Number.isFinite(parsedIdx) ? parsedIdx : undefined,
            }));
          });

          let singleTapTimer: ReturnType<typeof setTimeout> | null = null;
          let lastTouchEndAt = 0;
          let lastTapMeta: {
            time: number;
            x: number;
            y: number;
            paragraphIndex: string | null;
          } | null = null;

          const cancelSingleTapTimer = () => {
            if (singleTapTimer !== null) {
              clearTimeout(singleTapTimer);
              singleTapTimer = null;
            }
          };

          const scheduleChromeToggle = () => {
            cancelSingleTapTimer();
            singleTapTimer = setTimeout(() => {
              singleTapTimer = null;
              const activeSel = doc.getSelection()?.toString().trim();
              if (activeSel) return;
              if (Date.now() - lastDoubleTapHandledAtRef.current < 400) return;
              setSettingsOpen(false);
              toggleChromeByTap();
            }, 240);
          };

          // Toggle auto-hide chrome on desktop single click; double-click toggles paragraph bookmark
          let pointerDownPos: { x: number; y: number; time: number } | null = null;
          doc.addEventListener('pointerdown', (e) => {
            pointerDownPos = { x: e.clientX, y: e.clientY, time: Date.now() };
          });

          doc.addEventListener('click', (e) => {
            if (Date.now() - lastTouchEndAt < 600) return;
            if (Date.now() - lastDoubleTapHandledAtRef.current < 500 || e.detail >= 2) {
              cancelSingleTapTimer();
              return;
            }
            const target = e.target as HTMLElement | null;
            if (target?.closest('a, button, input, select, textarea, [role="button"]')) return;
            const sel = doc.getSelection()?.toString().trim();
            if (sel) return;
            if (pointerDownPos) {
              const moved =
                Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 10;
              const heldLong = Date.now() - pointerDownPos.time > 400;
              if (moved || heldLong) return;
            }
            scheduleChromeToggle();
          });

          doc.addEventListener('dblclick', (e) => {
            if (Date.now() - lastDoubleTapHandledAtRef.current < 500) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest('a, button, input, select, textarea, [role="button"]')) return;
            const blockEl = target?.closest('[data-paragraph-index]') as HTMLElement | null;
            if (!blockEl) return;

            cancelSingleTapTimer();
            e.preventDefault();
            lastDoubleTapHandledAtRef.current = Date.now();
            doc.getSelection()?.removeAllRanges();
            setSelectionBar(null);
            handleToggleParagraphBookmarkRef.current(blockEl, contents.section?.href, contents);
          });

          let touchStartX = 0;
          let touchStartY = 0;
          let touchStartTime = 0;
          let touchStartTarget: HTMLElement | null = null;
          doc.addEventListener(
            'touchstart',
            (e) => {
              if (e.touches.length !== 1) {
                touchStartTime = 0;
                touchStartTarget = null;
                return;
              }
              touchStartX = e.touches[0].clientX;
              touchStartY = e.touches[0].clientY;
              touchStartTime = Date.now();
              touchStartTarget = e.target as HTMLElement | null;
            },
            { passive: true }
          );
          doc.addEventListener(
            'touchend',
            (e) => {
              if (!touchStartTime || e.changedTouches.length !== 1) return;
              const endX = e.changedTouches[0].clientX;
              const endY = e.changedTouches[0].clientY;
              const dx = endX - touchStartX;
              const dy = endY - touchStartY;
              const elapsed = Date.now() - touchStartTime;
              const tappedTarget = touchStartTarget;
              touchStartTime = 0;
              touchStartTarget = null;
              lastTouchEndAt = Date.now();

              const isQuickTap = Math.hypot(dx, dy) < 14 && elapsed < 320;
              const isInteractive = Boolean(
                tappedTarget?.closest('a, button, input, select, textarea, [role="button"]')
              );
              const blockEl = tappedTarget?.closest('[data-paragraph-index]') as HTMLElement | null;

              if (isQuickTap && !isInteractive && blockEl) {
                const now = Date.now();
                const blockIdx = blockEl.dataset.paragraphIndex || null;
                if (
                  lastTapMeta &&
                  blockIdx &&
                  lastTapMeta.paragraphIndex === blockIdx &&
                  now - lastTapMeta.time < 340 &&
                  Math.hypot(endX - lastTapMeta.x, endY - lastTapMeta.y) < 48
                ) {
                  // Double-tap detected on paragraph: prevent Android text selection & toggle bookmark
                  e.preventDefault();
                  cancelSingleTapTimer();
                  lastTapMeta = null;
                  lastDoubleTapHandledAtRef.current = now;
                  doc.getSelection()?.removeAllRanges();
                  setSelectionBar(null);
                  handleToggleParagraphBookmarkRef.current(
                    blockEl,
                    contents.section?.href,
                    contents
                  );
                  return;
                }

                lastTapMeta = {
                  time: now,
                  x: endX,
                  y: endY,
                  paragraphIndex: blockIdx,
                };
                const sel = doc.getSelection()?.toString().trim();
                if (!sel) {
                  scheduleChromeToggle();
                }
                return;
              }

              lastTapMeta = null;
              const sel = doc.getSelection()?.toString().trim();
              if (sel) return;

              if (isQuickTap && !isInteractive) {
                scheduleChromeToggle();
                return;
              }

              // In Vertical Scroll mode, horizontal chapter swipe is completely disabled to avoid accidental jumps
              if (readerFlowRef.current === 'scroll') {
                if (dy < -80 && Math.abs(dy) > Math.abs(dx) * 1.4) {
                  setChromeVisibleGuarded(false);
                }
                return;
              }

              // Paginated mode only: require strict horizontal swipe threshold
              if (elapsed > 650) return;
              if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
                if (dx < 0) {
                  rendition.next();
                } else {
                  rendition.prev();
                }
              }
            },
            { passive: false }
          );

          const iframeWin = doc.defaultView;
          if (iframeWin) {
            const iframeTracker = {
              lastY: iframeWin.scrollY || 0,
              downwardAccum: 0,
              syncedVersion: immersiveTransitionVersionRef.current,
            };
            iframeWin.addEventListener(
              'scroll',
              () => {
                if (readerFlowRef.current !== 'scroll') return;
                handleScrollMetric(iframeWin.scrollY || 0, iframeTracker);
                if (scrollStopSyncTimerRef.current) clearTimeout(scrollStopSyncTimerRef.current);
                scrollStopSyncTimerRef.current = setTimeout(() => {
                  pushCurrentReadingPositionToSyncRef.current();
                }, 550);
              },
              { passive: true }
            );
          }
        });

        const savedCfi = localStorage.getItem(`reader_pos_${resolvedId}`);
        try {
          await rendition.display(savedCfi || undefined);
        } catch {
          if (savedCfi) {
            localStorage.removeItem(`reader_pos_${resolvedId}`);
            await rendition.display();
          } else {
            throw new Error('Failed to render initial EPUB view');
          }
        }

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
    [
      abortActiveChapterTranslation,
      applyReadingModeToCurrentView,
      applyRenditionStyling,
      bindScrollAutoHide,
      expandScrolledViews,
      findCachedChapterInMemory,
      refreshLibraryList,
      showToast,
      syncScrollNavFooterInDoc,
    ]
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

      if (localStorage.getItem('pustakaloka_sample_dismissed') === 'true') {
        if (mounted) {
          currentBookIdRef.current = '';
          currentBookTitleRef.current = 'Belum Ada Buku';
          setCurrentBookId('');
          setCurrentBookTitle('Belum Ada Buku');
          setCurrentChapterTitle('');
          setToc([]);
          setProgressPct(0);
          setPageLocationLabel('');
          setLoaderText(null);
        }
        return;
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
      abortActiveChapterTranslation();
      renditionRef.current = null;
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for File -> Open EPUB from macOS Electron menu bar
  useEffect(() => {
    const macDesktop = (
      window as unknown as {
        macDesktop?: {
          onEpubOpenedFromMenu?: (
            cb: (payload: { fileName: string; buffer: Uint8Array }) => void
          ) => () => void;
        };
      }
    ).macDesktop;

    if (!macDesktop?.onEpubOpenedFromMenu) return;
    return macDesktop.onEpubOpenedFromMenu(async ({ fileName, buffer }) => {
      const cleanTitle = fileName.replace(/\.epub$/i, '');
      const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      await loadEpubBook(ab, { title: cleanTitle, persist: true });
      showToast(`Berhasil membuka "${cleanTitle}"`, 'success');
    });
  }, [loadEpubBook, showToast]);

  // Resize EPUB rendition cleanly only on actual horizontal/desktop layout shifts
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      const nextIsMobile = window.innerWidth < 640;
      setIsMobileViewport((prev) => (prev === nextIsMobile ? prev : nextIsMobile));
      const nextTouchOrMobile = window.innerWidth < 768 || 'ontouchstart' in window;
      setIsTouchOrMobileDevice((prev) => (prev === nextTouchOrMobile ? prev : nextTouchOrMobile));
      if (Date.now() < immersiveTransitionUntilRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => safeResizeRendition(false), 200);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [safeResizeRendition]);

  useEffect(() => {
    const timer = setTimeout(() => safeResizeRendition(true), 220);
    return () => clearTimeout(timer);
  }, [sidebarDesktopOpen, drawerOpen, safeResizeRendition]);

  // Contextual translation action
  const handleContextualTranslate = useCallback(
    async (text: string, isFullChapter: boolean) => {
      const clean = sanitizeTextForTranslation(text);
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
        const translation = await translateContextualApi(
          clean,
          targetLangRef.current,
          isFullChapter,
          hasServerEnvKeyRef.current
        );
        setDrawerResultText(translation);
      } catch (err) {
        setDrawerError(err instanceof Error ? err.message : 'Gagal terhubung ke layanan AI.');
      } finally {
        setDrawerLoading(false);
      }
    },
    [showToast]
  );

  // Translate active chapter/page directly in EPUB reader using Two-Stage Hybrid Translation
  const handleTranslateCurrentPage = useCallback(async () => {
    const contentsList = (renditionRef.current?.getContents() ||
      []) as unknown as RenditionContentsItem[];
    if (!contentsList || contentsList.length === 0) {
      showToast('Konten halaman belum siap diterjemahkan.', 'error');
      return;
    }

    if (readingModeRef.current === 'original') {
      setReadingMode('translated');
      readingModeRef.current = 'translated';
    }

    await applyReadingModeToCurrentView(undefined, { autoTranslateIfMissing: true });
  }, [applyReadingModeToCurrentView, showToast]);

  // Save vocabulary item
  const handleSaveVocab = useCallback(
    async (rawWord: string) => {
      const word = sanitizeTextForTranslation(rawWord);
      if (!word) return;
      const shortWord = word.length > 120 ? `${word.slice(0, 120)}...` : word;

      if (vocabList.some((v) => v.word.toLowerCase() === shortWord.toLowerCase())) {
        showToast('Kosakata ini sudah tersimpan di kamus pribadi.', 'info');
        return;
      }

      showToast('Menyimpan & mencari arti singkat...', 'info');
      let meaning = 'Tersimpan dari bacaan';
      try {
        meaning = await translateVocabApi(
          shortWord,
          targetLangRef.current,
          hasServerEnvKeyRef.current
        );
      } catch {
        // fallback silently
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

  const computeCurrentReadingMetrics = useCallback(() => {
    const rendition = renditionRef.current;
    const liveLocation = (rendition?.currentLocation() || null) as RenditionLocation | null;
    const cfi = liveLocation?.start?.cfi || currentCfiRef.current || '';
    const href = liveLocation?.start?.href || currentSpineHrefRef.current || undefined;

    let pct = progressPctRef.current;
    if (cfi && locationsReadyRef.current && bookRef.current?.locations) {
      const computedPct = Math.round(bookRef.current.locations.percentageFromCfi(cfi) * 100);
      if (Number.isFinite(computedPct)) {
        pct = Math.max(0, Math.min(100, computedPct));
      }
    }

    let scrollRatio: number | undefined;
    if (readerFlowRef.current === 'scroll') {
      const container = viewerRef.current?.querySelector('.epub-container') as HTMLElement | null;
      if (container) {
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        scrollRatio = maxScroll > 0 ? Math.min(1, Math.max(0, container.scrollTop / maxScroll)) : 0;
      }
    }

    return { cfi, href, pct, scrollRatio };
  }, []);

  const findTopmostVisibleBlock = useCallback(
    (content?: RenditionContentsItem): HTMLElement | null => {
      const doc = content?.document;
      if (!doc?.body) return null;
      const blocks = captureOriginalBlocks(doc);
      if (blocks.length === 0) return null;

      const viewerRect = viewerRef.current?.getBoundingClientRect();
      const frameEl = doc.defaultView?.frameElement as HTMLElement | null;
      const frameRect = frameEl?.getBoundingClientRect();

      const visTop = viewerRect ? Math.max(viewerRect.top, 0) + 12 : 12;
      const visBottom = viewerRect ? Math.min(viewerRect.bottom, window.innerHeight) : window.innerHeight;
      const visLeft = viewerRect ? Math.max(viewerRect.left, 0) : 0;
      const visRight = viewerRect ? Math.min(viewerRect.right, window.innerWidth) : window.innerWidth;

      if (frameRect) {
        const match = blocks.find((el) => {
          const r = el.getBoundingClientRect();
          const top = frameRect.top + r.top;
          const bottom = frameRect.top + r.bottom;
          const left = frameRect.left + r.left;
          const right = frameRect.left + r.right;

          const verticallyVisible = bottom > visTop && top < visBottom;
          if (readerFlowRef.current === 'scroll') return verticallyVisible;
          const horizontallyVisible = right > visLeft + 8 && left < visRight - 8;
          return verticallyVisible && horizontallyVisible;
        });
        if (match) return match;
      }

      const viewportH = content?.window?.innerHeight || window.innerHeight || 700;
      return (
        blocks.find((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > 12 && r.top < viewportH;
        }) || blocks[0]
      );
    },
    []
  );

  // Double-tap / double-click on a paragraph toggles bookmark for that paragraph
  const handleToggleParagraphBookmark = useCallback(
    (blockEl: HTMLElement, sectionHref?: string, contentsItem?: RenditionContentsItem) => {
      const parsedIdx = Number(blockEl.dataset.paragraphIndex);
      if (!Number.isFinite(parsedIdx) || parsedIdx <= 0) return;

      const bookId = currentBookIdRef.current;
      const { cfi, href, pct, scrollRatio } = computeCurrentReadingMetrics();
      const resolvedHref = sectionHref || href;

      const existingIdx = bookmarksRef.current.findIndex((b) => {
        if (b.bookId !== bookId || b.paragraphIndex !== parsedIdx) return false;
        if (b.href && resolvedHref) return hrefMatches(b.href, resolvedHref);
        return true;
      });

      if (existingIdx >= 0) {
        const removed = bookmarksRef.current[existingIdx];
        const next = bookmarksRef.current.filter((_, i) => i !== existingIdx);
        bookmarksRef.current = next;
        setBookmarks(next);
        localStorage.setItem('reader_bookmarks', JSON.stringify(next));
        syncAllBookmarkHighlights(next);
        if (removed?.id) {
          deletedBookmarkIdsRef.current = recordDeletedBookmarkId(removed.id);
        }
        syncService.scheduleBookmarksSync(next, deletedBookmarkIdsRef.current);
        showToast(`Penanda pada paragraf #${parsedIdx} dihapus.`, 'info');
        return;
      }

      let blockCfi = cfi || resolvedHref || '';
      try {
        const nodeCfi = contentsItem?.cfiFromNode?.(blockEl);
        if (nodeCfi) blockCfi = nodeCfi;
      } catch {
        // fallback to current CFI
      }

      const rawText = normalizeBlockText(blockEl.textContent || blockEl.dataset.origText || '');
      const excerpt = rawText
        ? rawText.length > 78
          ? `${rawText.slice(0, 75).trimEnd()}…`
          : rawText
        : undefined;

      const newBookmark: BookmarkItem = {
        id: `${Date.now()}-${parsedIdx}`,
        bookId,
        bookTitle: currentBookTitleRef.current,
        chapterTitle: currentChapterTitleRef.current,
        cfi: blockCfi,
        href: resolvedHref,
        paragraphIndex: parsedIdx,
        progressPct: pct,
        scrollRatio,
        excerpt,
        createdAt: new Date().toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      const next = [newBookmark, ...bookmarksRef.current];
      bookmarksRef.current = next;
      setBookmarks(next);
      localStorage.setItem('reader_bookmarks', JSON.stringify(next));
      syncAllBookmarkHighlights(next);
      syncService.scheduleBookmarksSync(next, deletedBookmarkIdsRef.current);
      showToast(`Penanda disimpan pada paragraf #${parsedIdx}`, 'success');
    },
    [computeCurrentReadingMetrics, showToast, syncAllBookmarkHighlights]
  );

  useEffect(() => {
    handleToggleParagraphBookmarkRef.current = handleToggleParagraphBookmark;
  }, [handleToggleParagraphBookmark]);

  // Add bookmark from Sidebar "+ Tambah Penanda" or Header button (marks topmost visible paragraph)
  const handleAddBookmark = useCallback(() => {
    const rendition = renditionRef.current;
    const { cfi, href, pct, scrollRatio } = computeCurrentReadingMetrics();

    if (!cfi && !href) {
      showToast('Tunggu hingga halaman selesai dimuat.', 'info');
      return;
    }

    let visibleBlock: HTMLElement | null = null;
    let activeContent: RenditionContentsItem | undefined;
    try {
      const contentsList = (rendition?.getContents() || []) as unknown as RenditionContentsItem[];
      activeContent =
        contentsList.find((c) => c.section?.href && href && hrefMatches(c.section.href, href)) ||
        contentsList[0];
      visibleBlock = findTopmostVisibleBlock(activeContent);
    } catch {
      visibleBlock = null;
    }

    const parsedIdx = visibleBlock?.dataset.paragraphIndex
      ? Number(visibleBlock.dataset.paragraphIndex)
      : undefined;
    const paragraphIndex =
      typeof parsedIdx === 'number' && Number.isFinite(parsedIdx) && parsedIdx > 0
        ? parsedIdx
        : undefined;

    if (typeof paragraphIndex === 'number') {
      const duplicate = bookmarksRef.current.some((b) => {
        if (b.bookId !== currentBookIdRef.current || b.paragraphIndex !== paragraphIndex) {
          return false;
        }
        if (b.href && href) return hrefMatches(b.href, href);
        return true;
      });
      if (duplicate) {
        showToast(`Paragraf #${paragraphIndex} sudah ada di daftar penanda.`, 'info');
        return;
      }
    }

    let resolvedCfi = cfi || href || '';
    if (visibleBlock && activeContent?.cfiFromNode) {
      try {
        const nodeCfi = activeContent.cfiFromNode(visibleBlock);
        if (nodeCfi) resolvedCfi = nodeCfi;
      } catch {
        // fallback to live CFI
      }
    }

    const rawText = visibleBlock
      ? normalizeBlockText(visibleBlock.textContent || visibleBlock.dataset.origText || '')
      : '';
    const excerpt = rawText
      ? rawText.length > 78
        ? `${rawText.slice(0, 75).trimEnd()}…`
        : rawText
      : undefined;

    const newBookmark: BookmarkItem = {
      id: Date.now().toString(),
      bookId: currentBookIdRef.current,
      bookTitle: currentBookTitleRef.current,
      chapterTitle: currentChapterTitleRef.current,
      cfi: resolvedCfi,
      href,
      paragraphIndex,
      progressPct: pct,
      scrollRatio,
      excerpt,
      createdAt: new Date().toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const next = [newBookmark, ...bookmarksRef.current];
    bookmarksRef.current = next;
    setBookmarks(next);
    localStorage.setItem('reader_bookmarks', JSON.stringify(next));
    syncAllBookmarkHighlights(next);
    syncService.scheduleBookmarksSync(next, deletedBookmarkIdsRef.current);
    showToast(
      typeof paragraphIndex === 'number'
        ? `Penanda disimpan pada paragraf #${paragraphIndex}`
        : 'Penanda berhasil ditambahkan!',
      'success'
    );
  }, [computeCurrentReadingMetrics, findTopmostVisibleBlock, showToast, syncAllBookmarkHighlights]);

  const handleBookmarkSelection = useCallback(() => {
    if (!selectionBar) return;
    const { cfi, href, pct, scrollRatio } = computeCurrentReadingMetrics();
    const resolvedHref = selectionBar.href || href;
    const paragraphIndex = selectionBar.paragraphIndex;
    const cleanText = normalizeBlockText(selectionBar.text);
    const excerpt =
      cleanText.length > 90 ? `${cleanText.slice(0, 87).trimEnd()}…` : cleanText || undefined;

    const newBookmark: BookmarkItem = {
      id: `${Date.now()}-${paragraphIndex ?? 'sel'}`,
      bookId: currentBookIdRef.current,
      bookTitle: currentBookTitleRef.current,
      chapterTitle: currentChapterTitleRef.current,
      cfi: selectionBar.cfiRange || cfi || resolvedHref || '',
      href: resolvedHref,
      paragraphIndex,
      progressPct: pct,
      scrollRatio,
      excerpt,
      createdAt: new Date().toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const next = [newBookmark, ...bookmarksRef.current];
    bookmarksRef.current = next;
    setBookmarks(next);
    localStorage.setItem('reader_bookmarks', JSON.stringify(next));
    syncAllBookmarkHighlights(next);
    syncService.scheduleBookmarksSync(next, deletedBookmarkIdsRef.current);
    clearReaderSelection();
    showToast(
      typeof paragraphIndex === 'number'
        ? `Kalimat ditandai pada paragraf #${paragraphIndex}`
        : 'Kalimat berhasil ditandai!',
      'success'
    );
  }, [clearReaderSelection, computeCurrentReadingMetrics, selectionBar, showToast, syncAllBookmarkHighlights]);

  const handleSelectBookmark = useCallback(
    async (bm: BookmarkItem) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const target = bm.cfi || bm.href;
      if (!target) return;

      try {
        await rendition.display(target);
      } catch {
        if (bm.href && bm.href !== target) {
          try {
            await rendition.display(bm.href);
          } catch {
            // ignore unresolvable fallback
          }
        }
      }

      syncAllBookmarkHighlights();

      setTimeout(() => {
        const contentsList = (rendition.getContents() || []) as unknown as RenditionContentsItem[];
        const targetContent =
          contentsList.find(
            (c) => c.section?.href && bm.href && hrefMatches(c.section.href, bm.href)
          ) || contentsList[0];

        if (typeof bm.paragraphIndex === 'number') {
          const el = targetContent?.document?.querySelector(
            `[data-paragraph-index="${bm.paragraphIndex}"]`
          ) as HTMLElement | null;

          if (el) {
            try {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch {
              // ignore nested iframe scroll fallback
            }

            if (readerFlowRef.current === 'scroll') {
              const container = viewerRef.current?.querySelector('.epub-container') as HTMLElement | null;
              const frameEl = targetContent?.document?.defaultView?.frameElement as HTMLElement | null;
              if (container && frameEl) {
                const containerRect = container.getBoundingClientRect();
                const frameRect = frameEl.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                const targetTop =
                  frameRect.top +
                  elRect.top -
                  containerRect.top +
                  container.scrollTop -
                  Math.max(72, Math.round(container.clientHeight * 0.35));
                container.scrollTo({ top: Math.max(0, Math.round(targetTop)), behavior: 'smooth' });
              }
            }

            if (flashHighlightTimerRef.current) clearTimeout(flashHighlightTimerRef.current);
            el.dataset.flashHighlight = 'true';
            flashHighlightTimerRef.current = setTimeout(() => {
              delete el.dataset.flashHighlight;
              flashHighlightTimerRef.current = null;
            }, 2000);
            return;
          }
        }

        if (readerFlowRef.current === 'scroll' && typeof bm.scrollRatio === 'number' && bm.scrollRatio > 0.01) {
          const container = viewerRef.current?.querySelector('.epub-container') as HTMLElement | null;
          if (!container) return;
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          if (maxScroll > 0 && container.scrollTop <= 16) {
            container.scrollTo({
              top: Math.round(maxScroll * bm.scrollRatio),
              behavior: 'smooth',
            });
          }
        }
      }, 160);
    },
    [syncAllBookmarkHighlights]
  );

  const pushCurrentReadingPositionToSync = useCallback(() => {
    if (!syncService.getActiveChainHash()) return;
    const rendition = renditionRef.current;
    const { cfi, href, pct, scrollRatio } = computeCurrentReadingMetrics();
    if (!cfi && !href) return;

    const spineItems = ((bookRef.current?.spine as unknown as { spineItems?: SpineSection[] })
      ?.spineItems || []) as SpineSection[];
    const foundIdx = href ? spineItems.findIndex((s) => hrefMatches(s.href, href)) : -1;

    let paragraphIndex: number | undefined;
    try {
      const contentsList = (rendition?.getContents() || []) as unknown as RenditionContentsItem[];
      const activeContent =
        contentsList.find((c) => c.section?.href && href && hrefMatches(c.section.href, href)) ||
        contentsList[0];
      const topBlock = findTopmostVisibleBlock(activeContent);
      const parsed = topBlock?.dataset.paragraphIndex ? Number(topBlock.dataset.paragraphIndex) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) paragraphIndex = parsed;
    } catch {
      paragraphIndex = undefined;
    }

    const now = Date.now();
    localPositionUpdatedAtRef.current = now;
    syncService.schedulePositionSync({
      bookId: currentBookIdRef.current,
      bookTitle: currentBookTitleRef.current,
      chapterTitle: currentChapterTitleRef.current,
      chapterIndex: foundIdx >= 0 ? foundIdx : 0,
      href,
      cfi: cfi || href || '',
      paragraphIndex,
      progressPct: pct,
      scrollRatio,
      updatedAt: now,
      deviceId: getOrCreateDeviceId(),
      deviceName: getFriendlyDeviceName(),
    });
  }, [computeCurrentReadingMetrics, findTopmostVisibleBlock]);

  useEffect(() => {
    pushCurrentReadingPositionToSyncRef.current = pushCurrentReadingPositionToSync;
  }, [pushCurrentReadingPositionToSync]);

  const handleAcceptRemotePosition = useCallback(
    async (pos: SyncReadingPosition) => {
      setRemotePrompt(null);
      localPositionUpdatedAtRef.current = Date.now();
      await handleSelectBookmark({
        id: 'remote-pos',
        bookId: pos.bookId,
        bookTitle: pos.bookTitle,
        chapterTitle: pos.chapterTitle,
        cfi: pos.cfi,
        href: pos.href,
        paragraphIndex: pos.paragraphIndex,
        progressPct: pos.progressPct,
        scrollRatio: pos.scrollRatio,
        createdAt: '',
      });
    },
    [handleSelectBookmark]
  );

  const handleLeaveSyncChain = useCallback(() => {
    clearStoredSyncPassphrase();
    syncService.disconnect();
    wasSelfRegisteredRef.current = false;
    setSyncPassphrase('');
    setSyncChainHash(null);
    setSyncStatus('disconnected');
    setSyncError(null);
    setSyncDevices([]);
    setRemotePrompt(null);
    showToast('Keluar dari Sync Chain.', 'info');
  }, [showToast]);

  // Real-time Sync Chain connection lifecycle (onSnapshot + auto-merge + device registry)
  useEffect(() => {
    if (!syncPassphrase) {
      syncService.disconnect();
      wasSelfRegisteredRef.current = false;
      setSyncChainHash(null);
      setSyncStatus('disconnected');
      setSyncError(null);
      setSyncDevices([]);
      setRemotePrompt(null);
      return;
    }

    let cancelled = false;
    wasSelfRegisteredRef.current = false;

    const connectChain = async () => {
      try {
        const hash = await syncService.connect(syncPassphrase, {
          onStatusChange: (status, message) => {
            if (cancelled) return;
            setSyncStatus(status);
            if (message && status === 'error') setSyncError(message);
            else if (status !== 'error') setSyncError(null);
          },
          onRemoteChainData: (data) => {
            if (cancelled) return;

            if (!data) {
              wasSelfRegisteredRef.current = true;
              void syncService.registerDeviceNow();
              syncService.scheduleBookmarksSync(bookmarksRef.current, deletedBookmarkIdsRef.current);
              pushCurrentReadingPositionToSyncRef.current();
              return;
            }

            // 0. Sync Connected Devices Registry
            const devicesMap = data.devices || {};
            if (wasSelfRegisteredRef.current && data.devices && !devicesMap[localDeviceId]) {
              handleLeaveSyncChain();
              showToast('Perangkat ini telah dihapus dari Sync Chain.', 'info');
              return;
            }
            if (devicesMap[localDeviceId]) {
              wasSelfRegisteredRef.current = true;
            } else {
              wasSelfRegisteredRef.current = true;
              void syncService.registerDeviceNow();
            }

            const sortedDevices = Object.values(devicesMap)
              .filter((d): d is SyncDeviceInfo => Boolean(d?.deviceId && d?.name))
              .sort((a, b) => {
                if (a.deviceId === localDeviceId) return -1;
                if (b.deviceId === localDeviceId) return 1;
                return (b.lastActive || 0) - (a.lastActive || 0);
              });
            setSyncDevices(sortedDevices);

            // 1. Merge deleted bookmark tombstones & bookmarks
            const remoteDeleted = data.deletedBookmarkIds || {};
            const mergedDeleted = { ...deletedBookmarkIdsRef.current };
            let deletedChanged = false;
            Object.entries(remoteDeleted).forEach(([id, ts]) => {
              if (!mergedDeleted[id] || ts > mergedDeleted[id]) {
                mergedDeleted[id] = ts;
                deletedChanged = true;
              }
            });
            if (deletedChanged) {
              deletedBookmarkIdsRef.current = mergedDeleted;
              try {
                localStorage.setItem(
                  'pustakaloka_sync_deleted_bookmarks',
                  JSON.stringify(mergedDeleted)
                );
              } catch {
                // ignore storage quota errors
              }
            }

            const remoteBookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
            const mergedBookmarks = mergeBookmarkLists(
              bookmarksRef.current,
              remoteBookmarks,
              mergedDeleted
            );

            const localIds = bookmarksRef.current
              .map((b) => b.id)
              .sort()
              .join(',');
            const mergedIds = mergedBookmarks
              .map((b) => b.id)
              .sort()
              .join(',');
            const remoteIds = remoteBookmarks
              .filter((b) => !mergedDeleted[b.id])
              .map((b) => b.id)
              .sort()
              .join(',');

            if (localIds !== mergedIds) {
              bookmarksRef.current = mergedBookmarks;
              setBookmarks(mergedBookmarks);
              localStorage.setItem('reader_bookmarks', JSON.stringify(mergedBookmarks));
              syncAllBookmarkHighlights(mergedBookmarks);
            }

            if (mergedIds !== remoteIds) {
              syncService.scheduleBookmarksSync(mergedBookmarks, mergedDeleted);
            }

            // 2. Check for newer reading position from another device (match by bookId or bookTitle)
            const bookKey = sanitizeFirestoreKey(currentBookIdRef.current, 72);
            const normalizedTitle = currentBookTitleRef.current.trim().toLowerCase();
            const matchedByTitle = normalizedTitle
              ? Object.values(data.positions || {}).find(
                  (p) => p?.bookTitle?.trim().toLowerCase() === normalizedTitle
                )
              : undefined;
            const candidate =
              data.positions?.[bookKey] ||
              matchedByTitle ||
              (data.lastPosition &&
              (data.lastPosition.bookId === currentBookIdRef.current ||
                data.lastPosition.bookTitle.trim().toLowerCase() === normalizedTitle)
                ? data.lastPosition
                : undefined);

            if (
              candidate &&
              candidate.deviceId !== localDeviceId &&
              candidate.updatedAt > lastSeenRemotePosTimestampRef.current &&
              candidate.updatedAt > localPositionUpdatedAtRef.current
            ) {
              let isDifferent = true;
              const sameHref = hrefMatches(candidate.href, currentSpineHrefRef.current);
              if (sameHref) {
                try {
                  const contentsList = (renditionRef.current?.getContents() ||
                    []) as unknown as RenditionContentsItem[];
                  const activeContent =
                    contentsList.find(
                      (c) =>
                        c.section?.href &&
                        candidate.href &&
                        hrefMatches(c.section.href, candidate.href)
                    ) || contentsList[0];
                  const topBlock = findTopmostVisibleBlock(activeContent);
                  const currentPara = topBlock?.dataset.paragraphIndex
                    ? Number(topBlock.dataset.paragraphIndex)
                    : undefined;
                  if (
                    typeof candidate.paragraphIndex === 'number' &&
                    currentPara === candidate.paragraphIndex
                  ) {
                    isDifferent = false;
                  } else if (
                    typeof candidate.paragraphIndex !== 'number' &&
                    Math.abs((candidate.progressPct || 0) - progressPctRef.current) <= 2
                  ) {
                    isDifferent = false;
                  }
                } catch {
                  // assume different if inspection fails
                }
              }

              if (isDifferent) {
                lastSeenRemotePosTimestampRef.current = candidate.updatedAt;
                setRemotePrompt({ position: candidate });
              }
            }
          },
          onRemoteTranslations: async (docs) => {
            if (cancelled) return;
            const activeBookId = currentBookIdRef.current;
            const activeBookTitle = currentBookTitleRef.current;
            const activeLang = targetLangRef.current;

            let updatedCurrentCache = false;
            const otherBooksQueue = new Map<
              string,
              {
                bookId: string;
                bookTitle: string;
                targetLang: string;
                items: typeof docs;
              }
            >();

            for (const item of docs) {
              const matchesCurrentBook =
                item.bookId === activeBookId ||
                (Boolean(item.bookTitle) && item.bookTitle === activeBookTitle);

              if (matchesCurrentBook && item.targetLang === activeLang) {
                const existing = findCachedChapterInMemory(item.href);
                const shouldAccept =
                  !existing ||
                  item.updatedAt > existing.updatedAt ||
                  (item.stage === 'polished' && existing.stage !== 'polished');
                if (shouldAccept) {
                  chapterCacheRef.current[item.href] = {
                    href: item.href,
                    pairs: item.pairs,
                    stage: item.stage,
                    updatedAt: item.updatedAt,
                  };
                  updatedCurrentCache = true;
                }
              } else {
                const key = `${item.bookId}::${item.targetLang}`;
                if (!otherBooksQueue.has(key)) {
                  otherBooksQueue.set(key, {
                    bookId: item.bookId,
                    bookTitle: item.bookTitle,
                    targetLang: item.targetLang,
                    items: [],
                  });
                }
                otherBooksQueue.get(key)!.items.push(item);
              }
            }

            if (updatedCurrentCache) {
              setHasCachedChapters(true);
              await BookTranslationDB.saveBookCache(
                activeBookId,
                activeLang,
                activeBookTitle,
                chapterCacheRef.current
              );
              const activeHref = currentSpineHrefRef.current;
              if (activeHref && readingModeRef.current !== 'original') {
                const cachedActive = findCachedChapterInMemory(activeHref);
                if (cachedActive) {
                  syncActiveIframesForHref(activeHref, cachedActive);
                  setChapterPolishStatus(
                    cachedActive.stage === 'polished' ? 'polished' : 'draft-only'
                  );
                }
              }
            }

            for (const entry of otherBooksQueue.values()) {
              const existingCache = await BookTranslationDB.getBookCache(
                entry.bookId,
                entry.targetLang
              );
              let dirty = false;
              for (const item of entry.items) {
                const prev = existingCache[item.href];
                if (
                  !prev ||
                  item.updatedAt > prev.updatedAt ||
                  (item.stage === 'polished' && prev.stage !== 'polished')
                ) {
                  existingCache[item.href] = {
                    href: item.href,
                    pairs: item.pairs,
                    stage: item.stage,
                    updatedAt: item.updatedAt,
                  };
                  dirty = true;
                }
              }
              if (dirty) {
                await BookTranslationDB.saveBookCache(
                  entry.bookId,
                  entry.targetLang,
                  entry.bookTitle,
                  existingCache
                );
              }
            }
          },
        });

        if (!cancelled) {
          setSyncChainHash(hash);
          // Seed cached chapters silently (position & bookmarks wait for initial snapshot to avoid overwriting newer remote state)
          const spineItems = ((bookRef.current?.spine as unknown as { spineItems?: SpineSection[] })
            ?.spineItems || []) as SpineSection[];
          Object.values(chapterCacheRef.current).forEach((rec) => {
            if (!rec?.pairs?.length) return;
            const idx = spineItems.findIndex((s) => hrefMatches(s.href, rec.href));
            syncService.scheduleTranslationSync({
              bookId: currentBookIdRef.current,
              bookTitle: currentBookTitleRef.current,
              targetLang: targetLangRef.current,
              chapterIndex: idx >= 0 ? idx : 0,
              href: rec.href,
              stage: rec.stage || 'polished',
              pairs: rec.pairs,
              updatedAt: rec.updatedAt || Date.now(),
            });
          });
        }
      } catch (err) {
        if (!cancelled) {
          setSyncStatus('error');
          setSyncError(err instanceof Error ? err.message : 'Gagal menghubungkan Sync Chain.');
        }
      }
    };

    void connectChain();

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible' && syncService.getActiveChainHash()) {
        void syncService.registerDeviceNow();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      syncService.disconnect();
    };
  }, [
    findCachedChapterInMemory,
    findTopmostVisibleBlock,
    handleLeaveSyncChain,
    localDeviceId,
    showToast,
    syncAllBookmarkHighlights,
    syncActiveIframesForHref,
    syncPassphrase,
  ]);

  const handleJoinOrCreateSyncChain = useCallback(
    (rawPassphrase: string) => {
      const normalized = saveStoredSyncPassphrase(rawPassphrase);
      if (!normalized) return;
      lastSeenRemotePosTimestampRef.current = 0;
      setSyncError(null);
      setSyncPassphrase(normalized);
      showToast('Perangkat terhubung ke Sync Chain!', 'success');
    },
    [showToast]
  );

  const handleRenameSyncDevice = useCallback(
    async (rawName: string) => {
      const resolved = saveCustomDeviceName(rawName);
      setLocalDeviceName(resolved);
      if (syncService.getActiveChainHash()) {
        await syncService.registerDeviceNow();
      }
      showToast(`Nama perangkat diperbarui menjadi "${resolved}"`, 'success');
    },
    [showToast]
  );

  const handleRemoveSyncDevice = useCallback(
    async (targetDeviceId: string) => {
      await syncService.removeDeviceFromChain(targetDeviceId);
      if (targetDeviceId === localDeviceId) {
        handleLeaveSyncChain();
      } else {
        showToast('Perangkat dihapus dari Sync Chain.', 'info');
      }
    },
    [handleLeaveSyncChain, localDeviceId, showToast]
  );

  // Handle EPUB File open
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

  const handleEscapeKey = useCallback(() => {
    const hasOpenOverlay = Boolean(
      settingsOpen ||
        apiSettingsOpen ||
        shortcutsOpen ||
        selectionBar !== null ||
        drawerOpen ||
        sidebarMobileOpen
    );

    if (hasOpenOverlay) {
      setSettingsOpen(false);
      setApiSettingsOpen(false);
      setShortcutsOpen(false);
      clearReaderSelection();
      setDrawerOpen(false);
      setSidebarMobileOpen(false);
      setChromeVisible(true);
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    setChromeVisible(true);
  }, [
    apiSettingsOpen,
    clearReaderSelection,
    drawerOpen,
    selectionBar,
    settingsOpen,
    shortcutsOpen,
    sidebarMobileOpen,
  ]);

  useEffect(() => {
    handleEscapeRef.current = handleEscapeKey;
  }, [handleEscapeKey]);

  const handleSelectTocHref = useCallback(async (rawHref: string, label?: string) => {
    const rendition = renditionRef.current;
    const book = bookRef.current;
    if (!rendition || !book) return;

    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setSidebarMobileOpen(false);
    }

    const cleanHref = normalizeHref(rawHref);
    const spineItems = ((book.spine as unknown as { spineItems?: SpineSection[] })?.spineItems ||
      []) as SpineSection[];
    const matchedSection = findSpineSectionByHref(spineItems, rawHref);

    if (label && label.trim()) {
      const trimmed = label.trim();
      currentChapterTitleRef.current = trimmed;
      setCurrentChapterTitle(trimmed);
    }

    const displayTarget =
      matchedSection && typeof matchedSection.index === 'number'
        ? matchedSection.index
        : matchedSection?.href || cleanHref || rawHref;

    try {
      await rendition.display(displayTarget as string);
    } catch {
      if (cleanHref && cleanHref !== displayTarget) {
        try {
          await rendition.display(cleanHref);
        } catch {
          // ignore unresolvable href fallback
        }
      }
    }

    const resetScrollTop = () => {
      const container = viewerRef.current?.querySelector('.epub-container') as HTMLElement | null;
      if (container) {
        container.scrollTop = 0;
        container.scrollTo({ top: 0, behavior: 'auto' });
      }
      const contentsList = (renditionRef.current?.getContents() ||
        []) as unknown as RenditionContentsItem[];
      contentsList.forEach((c) => {
        try {
          c.window?.scrollTo?.(0, 0);
          if (c.document?.documentElement) c.document.documentElement.scrollTop = 0;
          if (c.document?.body) c.document.body.scrollTop = 0;
        } catch {
          // ignore iframe scroll reset errors
        }
      });
    };

    resetScrollTop();
    setTimeout(resetScrollTop, 80);
  }, []);

  // MacBook / Desktop Keyboard Shortcuts & Arrow Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);

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
        handleTranslateCurrentPage();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setChromeVisible((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        if (!isTouchOrMobileDevice) {
          setShortcutsOpen((v) => !v);
        }
        return;
      }
      if (e.key === 'Escape') {
        handleEscapeKey();
        return;
      }

      if (isInput || apiSettingsOpen || shortcutsOpen || settingsOpen) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateReader('prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateReader('next');
      } else if (e.key === 'ArrowUp' && readerFlowRef.current === 'scroll') {
        e.preventDefault();
        scrollReaderVertical(-200);
      } else if (e.key === 'ArrowDown' && readerFlowRef.current === 'scroll') {
        e.preventDefault();
        scrollReaderVertical(200);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    apiSettingsOpen,
    handleAddBookmark,
    handleEscapeKey,
    handleTranslateCurrentPage,
    isTouchOrMobileDevice,
    navigateReader,
    scrollReaderVertical,
    settingsOpen,
    shortcutsOpen,
  ]);

  // Switch Reading Layout Flow (Paginated vs Vertical Scroll)
  const handleChangeReaderFlow = useCallback(
    (nextFlow: ReaderFlow) => {
      if (nextFlow === readerFlowRef.current) return;
      setReaderFlow(nextFlow);
      readerFlowRef.current = nextFlow;
      localStorage.setItem('reader_flow', nextFlow);
      scrollContainerBoundRef.current = null;

      const rendition = renditionRef.current as
        | (Rendition & { flow?: (f: string) => void })
        | null;
      if (rendition?.flow) {
        try {
          rendition.flow(nextFlow === 'scroll' ? 'scrolled-doc' : 'paginated');
        } catch {
          // ignore transient flow update errors
        }
      }

      setTimeout(() => {
        applyRenditionStyling();
        const contentsList = (renditionRef.current?.getContents() ||
          []) as unknown as RenditionContentsItem[];
        contentsList.forEach((c) => {
          if (c.document?.body) {
            syncScrollNavFooterInDoc(c.document, c.section?.href);
          }
        });
        expandScrolledViews();
        bindScrollAutoHide();
        safeResizeRendition();
      }, 120);

      showToast(
        nextFlow === 'scroll'
          ? 'Mode baca diubah ke Scroll Vertikal'
          : 'Mode baca diubah ke Mode Halaman',
        'info'
      );
    },
    [
      applyRenditionStyling,
      bindScrollAutoHide,
      expandScrolledViews,
      safeResizeRendition,
      showToast,
      syncScrollNavFooterInDoc,
    ]
  );

  // Switch Reading Mode
  const handleChangeReadingMode = async (nextMode: ReadingMode) => {
    setReadingMode(nextMode);
    readingModeRef.current = nextMode;
    await applyReadingModeToCurrentView();
    expandScrolledViews();
  };

  // Switch Target Language
  const handleChangeTargetLang = async (nextLang: string) => {
    abortActiveChapterTranslation();
    setTargetLang(nextLang);
    targetLangRef.current = nextLang;
    const cached = await BookTranslationDB.getBookCache(currentBookIdRef.current, nextLang);
    chapterCacheRef.current = cached;
    setHasCachedChapters(Object.keys(cached).length > 0);
    setChapterPolishStatus('idle');
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
      const activeHref = currentSpineHrefRef.current;
      const orderedSections = [...spineItems].sort((a, b) => {
        const aActive = hrefMatches(activeHref, a.href) ? 0 : 1;
        const bActive = hrefMatches(activeHref, b.href) ? 0 : 1;
        return aActive - bActive;
      });

      let completedCount = 0;
      const CONCURRENCY = 2;
      let cursor = 0;

      const worker = async () => {
        while (cursor < orderedSections.length && !batchControlRef.current.cancelled) {
          while (batchControlRef.current.paused && !batchControlRef.current.cancelled) {
            await new Promise((r) => setTimeout(r, 250));
          }
          if (batchControlRef.current.cancelled) break;

          const idx = cursor++;
          const section = orderedSections[idx];
          const isActiveChapter = hrefMatches(currentSpineHrefRef.current, section.href);
          setBatchState((prev) => ({
            ...prev,
            statusText: `Menerjemahkan Bab ${Math.min(completedCount + 1, spineItems.length)} dari ${spineItems.length} (${targetLangRef.current})...`,
          }));

          await translateAndCacheSection(section, { waitForPolish: !isActiveChapter });

          if (isActiveChapter) {
            await applyReadingModeToCurrentView(section.href, { autoTranslateIfMissing: false });
          }

          completedCount += 1;
          setBatchState((prev) => ({
            ...prev,
            completed: completedCount,
          }));
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, orderedSections.length) }, () => worker())
      );

      if (!batchControlRef.current.cancelled) {
        if ((readingModeRef.current as ReadingMode) === 'original') {
          setReadingMode('translated');
          readingModeRef.current = 'translated';
        }
        setBatchState((prev) => ({
          ...prev,
          running: false,
          completed: spineItems.length,
          statusText: `Selesai! Seluruh ${spineItems.length} bab diterjemahkan ke ${targetLangRef.current}.`,
        }));
        showToast('Seluruh buku berhasil diterjemahkan & disimpan luring!', 'success');
        await applyReadingModeToCurrentView(undefined, { autoTranslateIfMissing: false });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gangguan jaringan saat menerjemahkan.';
      setBatchState((prev) => ({
        ...prev,
        running: false,
        error: true,
        statusText: `${msg} Progres yang selesai tetap tersimpan.`,
      }));
      showToast('Penerjemahan terhenti sementara.', 'error');
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
      const cached = findCachedChapterInMemory(sec.href);
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
      className="fixed inset-0 flex flex-col overflow-hidden select-none sm:select-auto"
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
              Buku akan dibuka dan disimpan otomatis ke PustakaLoka
            </p>
          </div>
        </div>
      )}

      {/* Toast Container */}
      <div className="pointer-events-none fixed inset-x-4 bottom-[max(4.75rem,calc(4.25rem+env(safe-area-inset-bottom)))] z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-16 sm:right-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-sm rounded-xl border px-4 py-2.5 text-center text-xs font-medium shadow-lg sm:text-left sm:text-sm ${
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

      {/* Minimal Offline Indicator */}
      {!isOnline && (
        <div className="fixed bottom-16 left-3 z-50 flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-md sm:left-4">
          <WifiOff className="h-3 w-3" />
          <span>Mode Luring</span>
        </div>
      )}

      {/* Hover Reveal Strip at Top Edge on Desktop when auto-hidden */}
      <div
        onMouseEnter={() => setChromeVisible(true)}
        onClick={() => setChromeVisible(true)}
        className={`fixed inset-x-0 top-0 z-30 h-5 cursor-pointer ${
          effectiveChromeVisible ? 'pointer-events-none' : 'pointer-events-auto'
        }`}
        aria-hidden="true"
      />

      {/* Floating Minimalist Auto-Hide Top Bar */}
      <header
        className={`mac-surface fixed inset-x-0 top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between gap-1 border-b pt-[env(safe-area-inset-top)] backdrop-blur-md transition-transform duration-200 will-change-transform sm:gap-3 ${
          isElectron ? 'mac-drag-region' : ''
        } ${
          isElectron && !isFullscreen ? 'pl-20 pr-3 sm:pr-5' : 'px-1.5 sm:px-5'
        } ${
          effectiveChromeVisible ? 'translate-y-0' : '-translate-y-full pointer-events-none'
        }`}
        style={{ backgroundColor: 'color-mix(in srgb, var(--bg-surface) 88%, transparent)' }}
      >
        {/* Left: Sidebar Toggle & Book Title (hidden on mobile <640px) */}
        <div className="flex shrink-0 items-center gap-1 sm:min-w-0 sm:flex-1 sm:gap-2">
          <button
            type="button"
            onClick={() => {
              if (window.innerWidth < 1024) {
                setSidebarMobileOpen((v) => !v);
              } else {
                setSidebarDesktopOpen((v) => !v);
              }
            }}
            title="Daftar Isi & Pustaka (⌘\)"
            aria-label="Daftar Isi & Pustaka"
            className="mac-no-drag flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-xl p-1.5 transition hover:bg-slate-500/10 sm:min-h-[36px] sm:min-w-[36px] sm:p-2"
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <div className="hidden h-4 w-px bg-[var(--border-color)] sm:block" />

          <div className="hidden min-w-0 sm:block">
            <h1 className="truncate text-sm font-bold leading-tight">
              {currentBookTitle}
            </h1>
            <p className="truncate text-[11px] text-[var(--text-secondary)]">
              {currentChapterTitle}
            </p>
          </div>
        </div>

        {/* Center: Clean Reading Mode Switch */}
        <div className="mac-no-drag flex shrink-0 items-center rounded-xl border border-[var(--border-color)] bg-slate-500/5 p-0.5 font-semibold">
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
              className={`shrink-0 rounded-lg px-2 py-1 text-xs whitespace-nowrap transition sm:px-2.5 ${
                readingMode === mode.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Right: Essential Reader Actions */}
        <div className="mac-no-drag flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={handleTranslateCurrentPage}
            title="Terjemahkan Bab Aktif (⌘T)"
            aria-label="Terjemahkan Bab Aktif"
            className="flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 whitespace-nowrap sm:min-h-[36px] sm:px-3"
          >
            {readingMode !== 'original' &&
            (chapterPolishStatus === 'drafting' || chapterPolishStatus === 'polishing') ? (
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Terjemahkan</span>
          </button>

          <button
            type="button"
            onClick={handleAddBookmark}
            title="Tandai Halaman Ini (⌘D)"
            aria-label="Tandai Halaman Ini"
            className="hidden min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-xl p-2 transition hover:bg-slate-500/10 sm:inline-flex"
          >
            <Bookmark className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSettingsOpen((v) => !v);
            }}
            title="Tipografi & Mode Baca (Aa)"
            aria-label="Tipografi & Mode Baca"
            className={`flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-xl p-1.5 transition hover:bg-slate-500/10 sm:min-h-[36px] sm:min-w-[36px] sm:p-2 ${
              settingsOpen ? 'bg-blue-600/12 text-blue-600 dark:text-blue-400' : ''
            }`}
          >
            <TypeIcon className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSettingsOpen(false);
              setApiSettingsOpen(true);
            }}
            title="Pengaturan Gemini API & Model AI"
            aria-label="Pengaturan Gemini API & Model AI"
            className="flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-xl p-1.5 transition hover:bg-slate-500/10 sm:min-h-[36px] sm:min-w-[36px] sm:p-2"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Full-Book Batch Translation Progress Bar */}
      {showBatchBar && (
        <div className="mac-surface fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-30 border-b px-4 py-2.5 shadow-md">
          <div className="mx-auto flex max-w-5xl flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
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
                  <span>Unduh HTML</span>
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

      {/* Appearance & Typography Popover */}
      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        readingMode={readingMode}
        onChangeReadingMode={handleChangeReadingMode}
        readerFlow={readerFlow}
        onChangeReaderFlow={handleChangeReaderFlow}
        theme={theme}
        onChangeTheme={setTheme}
        fontFamily={fontFamily}
        onChangeFontFamily={setFontFamily}
        fontSize={fontSize}
        onChangeFontSize={setFontSize}
        lineHeight={lineHeight}
        onChangeLineHeight={setLineHeight}
        paragraphSpacing={paragraphSpacing}
        onChangeParagraphSpacing={setParagraphSpacing}
        contentWidth={contentWidth}
        onChangeContentWidth={setContentWidth}
        textAlign={textAlign}
        onChangeTextAlign={setTextAlign}
        targetLang={targetLang}
        onChangeTargetLang={handleChangeTargetLang}
        onTranslateFullBook={startFullBookTranslation}
      />

      {/* Main Workspace */}
      <div className="relative flex flex-1 overflow-hidden">
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
            if (bookId === SAMPLE_BOOK_ID) {
              localStorage.setItem('pustakaloka_sample_dismissed', 'true');
            }
            await LibraryDB.deleteBook(bookId);
            const nextMeta = await LibraryDB.listMeta();
            setLibraryBooks(nextMeta);

            if (bookId === currentBookIdRef.current) {
              if (nextMeta.length > 0) {
                const nextBook = await LibraryDB.getBook(nextMeta[0].id);
                if (nextBook) {
                  await loadEpubBook(nextBook.data, {
                    bookId: nextBook.id,
                    title: nextBook.title,
                    author: nextBook.author,
                    isSample: nextBook.isSample,
                    persist: false,
                  });
                }
              } else {
                abortActiveChapterTranslation();
                renditionRef.current = null;
                if (bookRef.current) {
                  bookRef.current.destroy();
                  bookRef.current = null;
                }
                if (viewerRef.current) {
                  viewerRef.current.innerHTML = '';
                }
                currentBookIdRef.current = '';
                currentBookTitleRef.current = 'Belum Ada Buku';
                currentChapterTitleRef.current = '';
                currentCfiRef.current = null;
                currentSpineHrefRef.current = null;
                chapterCacheRef.current = {};
                setCurrentBookId('');
                setCurrentBookTitle('Belum Ada Buku');
                setCurrentChapterTitle('');
                setToc([]);
                setProgressPct(0);
                setPageLocationLabel('');
                setHasCachedChapters(false);
                setChapterPolishStatus('idle');
              }
            }
            showToast('Buku dihapus dari PustakaLoka.', 'info');
          }}
          isElectron={isElectron}
          isFullscreen={isFullscreen}
          headerVisible={effectiveChromeVisible}
          onTriggerUpload={() => fileInputRef.current?.click()}
          onLoadSampleBook={async () => {
            localStorage.removeItem('pustakaloka_sample_dismissed');
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
          onSelectTocHref={handleSelectTocHref}
          bookmarks={bookmarks}
          onAddBookmark={handleAddBookmark}
          onSelectBookmark={handleSelectBookmark}
          onDeleteBookmark={(id) => {
            const next = bookmarks.filter((b) => b.id !== id);
            bookmarksRef.current = next;
            setBookmarks(next);
            localStorage.setItem('reader_bookmarks', JSON.stringify(next));
            deletedBookmarkIdsRef.current = recordDeletedBookmarkId(id);
            syncService.scheduleBookmarksSync(next, deletedBookmarkIdsRef.current);
            showToast('Penanda dihapus.', 'info');
          }}
          vocabList={vocabList}
          onDeleteVocab={(id) => {
            const next = vocabList.filter((v) => v.id !== id);
            setVocabList(next);
            localStorage.setItem('reader_vocab', JSON.stringify(next));
          }}
          onOpenShortcuts={() => {
            if (!isTouchOrMobileDevice) setShortcutsOpen(true);
          }}
          hideKeyboardShortcuts={isTouchOrMobileDevice}
        />

        {/* Center Reader Stage + Right AI Drawer */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <div
            onScroll={(e) => {
              if (readerFlowRef.current !== 'scroll') return;
              handleScrollMetric(e.currentTarget.scrollTop, outerScrollTrackerRef.current);
              if (scrollStopSyncTimerRef.current) clearTimeout(scrollStopSyncTimerRef.current);
              scrollStopSyncTimerRef.current = setTimeout(() => {
                pushCurrentReadingPositionToSyncRef.current();
              }, 550);
            }}
            className="fixed inset-0 z-0 flex flex-col items-center overflow-y-auto overscroll-y-contain bg-[var(--bg-reader)] lg:relative lg:inset-auto lg:min-w-0 lg:flex-1 lg:justify-center lg:overflow-hidden"
          >
            {loaderText && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[var(--bg-app)]/90 backdrop-blur-xs">
                <div className="h-9 w-9 animate-spin rounded-full border-3 border-blue-600 border-t-transparent" />
                <p className="text-sm font-semibold">{loaderText}</p>
              </div>
            )}

            <div
              id="epub-viewer"
              ref={viewerRef}
              className={`mac-reader-stage relative h-full w-full overflow-hidden transition-[max-width] duration-200 ${
                readerFlow === 'paginated' ? CONTENT_WIDTH_CLASS[contentWidth] : 'max-w-none'
              }`}
            />

            {!currentBookId && !loaderText && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-0 z-10 flex items-center justify-center p-6"
              >
                <div className="mac-surface max-w-sm space-y-4 rounded-2xl border p-6 text-center shadow-lg">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/10 text-blue-600 dark:text-blue-400">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-sm font-bold">Pustaka Buku Kosong</h2>
                    <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                      Buka file EPUB dari perangkat Anda atau muat kembali buku contoh bawaan.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>Buka File EPUB</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        localStorage.removeItem('pustakaloka_sample_dismissed');
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
                      className="mac-surface inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition hover:bg-slate-500/10"
                    >
                      <BookMarked className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Muat Buku Contoh</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Fixed Bottom Selection Action Bar (Anti-Overlap with Android System Selection Menu) */}
            {selectionBar && (
              <div
                role="toolbar"
                aria-label="Aksi Seleksi Teks"
                onClick={(e) => e.stopPropagation()}
                className="mac-surface fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] shadow-xl sm:px-4"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const text = selectionBar.text;
                        clearReaderSelection();
                        handleSaveVocab(text);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.98] whitespace-nowrap"
                    >
                      <BookmarkPlus className="h-3 w-3" />
                      <span>Simpan Kosakata</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleBookmarkSelection}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-blue-700 active:scale-[0.98] whitespace-nowrap"
                    >
                      <Bookmark className="h-3 w-3" />
                      <span>Tandai Kalimat Ini</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={clearReaderSelection}
                    aria-label="Tutup Aksi Seleksi"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-slate-500/10"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
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

      {/* Hover Reveal Strip at Bottom Edge on Desktop when auto-hidden */}
      <div
        onMouseEnter={() => setChromeVisible(true)}
        onClick={() => setChromeVisible(true)}
        className={`fixed inset-x-0 bottom-0 z-10 h-5 cursor-pointer ${
          effectiveChromeVisible ? 'pointer-events-none' : 'pointer-events-auto'
        }`}
        aria-hidden="true"
      />

      {/* Translation Status Badge: tucked behind solid footer in normal mode, visible in fullscreen */}
      {readingMode !== 'original' && chapterPolishStatus !== 'idle' && (
        <div
          aria-live="polite"
          className={`mac-surface fixed bottom-[max(0.6rem,env(safe-area-inset-bottom))] right-3 z-20 flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-semibold shadow-md sm:bottom-3 sm:right-4 ${
            chapterPolishStatus === 'polished'
              ? 'text-emerald-600 dark:text-emerald-400'
              : chapterPolishStatus === 'polishing' || chapterPolishStatus === 'drafting'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          {(chapterPolishStatus === 'drafting' || chapterPolishStatus === 'polishing') && (
            <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          )}
          {chapterPolishStatus === 'drafting' && <span>Menyiapkan draf...</span>}
          {chapterPolishStatus === 'polishing' && <span>Memperhalus AI...</span>}
          {chapterPolishStatus === 'polished' && <span>AI Polished ✨</span>}
          {chapterPolishStatus === 'draft-only' && (
            <button
              type="button"
              title={polishFallbackReason || 'Draf Terjemahan Instan · Ketuk untuk Pengaturan AI'}
              onClick={() => {
                if (polishFallbackReason) {
                  showToast(polishFallbackReason, 'info');
                } else {
                  setApiSettingsOpen(true);
                }
              }}
              className="transition hover:underline"
            >
              Terjemahan Instan
            </button>
          )}
        </div>
      )}

      {/* Floating Minimalist Auto-Hide Bottom Bar (solid background & higher z-index to cover status badge) */}
      <footer
        className={`mac-surface fixed inset-x-0 bottom-0 z-40 border-t bg-[var(--bg-surface)] px-3 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 transition-transform duration-200 will-change-transform sm:px-5 sm:py-2 ${
          effectiveChromeVisible ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        <div className="mx-auto flex max-w-4xl items-center gap-2.5 sm:gap-4">
          <button
            type="button"
            onClick={() => navigateReader('prev')}
            title={readerFlow === 'scroll' ? 'Bab Sebelumnya (←)' : 'Halaman Sebelumnya (←)'}
            aria-label={readerFlow === 'scroll' ? 'Bab Sebelumnya' : 'Halaman Sebelumnya'}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center gap-1 rounded-xl border border-[var(--border-color)] px-2 text-xs font-semibold transition hover:bg-slate-500/10 active:scale-95 whitespace-nowrap sm:min-h-[34px] sm:px-3"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">
              {readerFlow === 'scroll' ? 'Bab Sebelumnya' : 'Sebelumnya'}
            </span>
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <span className="font-mono-mac w-8 text-right text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">
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
                if (cfi) void renditionRef.current?.display(cfi).catch(() => {});
              }}
              aria-label="Progres Membaca"
              className="h-1.5 flex-1 cursor-pointer rounded-lg accent-blue-600"
            />
            <span className="font-mono-mac hidden shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)] sm:inline">
              {pageLocationLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={() => navigateReader('next')}
            title={readerFlow === 'scroll' ? 'Bab Berikutnya (→)' : 'Halaman Selanjutnya (→)'}
            aria-label={readerFlow === 'scroll' ? 'Bab Berikutnya' : 'Halaman Selanjutnya'}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center gap-1 rounded-xl border border-[var(--border-color)] px-2 text-xs font-semibold transition hover:bg-slate-500/10 active:scale-95 whitespace-nowrap sm:min-h-[34px] sm:px-3"
          >
            <span className="hidden sm:inline">
              {readerFlow === 'scroll' ? 'Bab Berikutnya' : 'Selanjutnya'}
            </span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </footer>

      {/* Remote Sync Position Resume Banner */}
      {remotePrompt && (
        <div
          role="status"
          aria-live="polite"
          onClick={(e) => e.stopPropagation()}
          className="mac-surface fixed inset-x-3 top-[calc(4rem+env(safe-area-inset-top))] z-40 mx-auto flex max-w-lg items-center justify-between gap-2 rounded-2xl border border-blue-500/40 px-3.5 py-2.5 shadow-xl backdrop-blur-md"
        >
          <p className="min-w-0 flex-1 text-xs font-medium leading-snug">
            Lanjutkan dari posisi terakhir di{' '}
            <span className="font-semibold">
              {remotePrompt.position.deviceName || 'perangkat lain'}
            </span>{' '}
            (
            <span className="font-semibold text-blue-600 dark:text-blue-400">
              {remotePrompt.position.chapterTitle || `Bab ${remotePrompt.position.chapterIndex + 1}`}
              {typeof remotePrompt.position.paragraphIndex === 'number'
                ? `, Paragraf ${remotePrompt.position.paragraphIndex}`
                : ''}
            </span>
            )?
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleAcceptRemotePosition(remotePrompt.position)}
              className="rounded-xl bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-blue-700"
            >
              Lanjutkan
            </button>
            <button
              type="button"
              onClick={() => setRemotePrompt(null)}
              aria-label="Tutup Pemberitahuan Sinkronisasi"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-slate-500/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <ApiSettingsModal
        open={apiSettingsOpen}
        hasServerEnvKey={hasServerEnvKey}
        onClose={() => setApiSettingsOpen(false)}
        onSaved={({ activeModel, usingUserKey }) => {
          showToast(
            `Pengaturan AI disimpan (${activeModel} · ${
              usingUserKey ? 'Client API Key' : hasServerEnvKey ? 'Server Default' : 'Draf Instan'
            }).`,
            'success'
          );
          if (readingModeRef.current !== 'original') {
            void applyReadingModeToCurrentView(undefined, { autoTranslateIfMissing: false });
          }
        }}
        syncPassphrase={syncPassphrase}
        syncChainHash={syncChainHash}
        syncStatus={syncStatus}
        syncError={syncError}
        syncDevices={syncDevices}
        localDeviceId={localDeviceId}
        localDeviceName={localDeviceName}
        onJoinOrCreateSyncChain={handleJoinOrCreateSyncChain}
        onLeaveSyncChain={handleLeaveSyncChain}
        onRenameSyncDevice={handleRenameSyncDevice}
        onRemoveSyncDevice={handleRemoveSyncDevice}
      />
    </div>
  );
}
