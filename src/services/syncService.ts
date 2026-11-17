import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  collection,
  deleteField,
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  BookmarkItem,
  SyncConnectionStatus,
  SyncDeviceInfo,
  SyncDevicePlatform,
  SyncReadingPosition,
  TranslationPair,
  TranslationStage,
} from '../types/reader';

const firebaseConfig = {
  apiKey: 'AIzaSyAM0ZZl0gwDDjdV31U58UsS0yGQxMfj7EA',
  authDomain: 'pustakaloka-sync.firebaseapp.com',
  projectId: 'pustakaloka-sync',
  storageBucket: 'pustakaloka-sync.firebasestorage.app',
  messagingSenderId: '953153644507',
  appId: '1:953153644507:web:ddda2d10069d7fae7829fe',
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function formatSyncUiError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('permission-denied')
  ) {
    return 'Izin Firestore ditolak. Buka Firebase Console (pustakaloka-sync) → Firestore Database → Rules lalu Publish aturan dari firestore.rules.';
  }
  return msg;
}

let connectionTested = false;
export async function testFirestoreConnection(): Promise<void> {
  if (connectionTested) return;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export const SYNC_PASSPHRASE_STORAGE_KEY = 'pustakaloka_sync_passphrase';
export const SYNC_DEVICE_ID_STORAGE_KEY = 'pustakaloka_sync_device_id';
export const SYNC_DEVICE_NAME_STORAGE_KEY = 'pustakaloka_sync_device_name';
export const SYNC_DELETED_BOOKMARKS_STORAGE_KEY = 'pustakaloka_sync_deleted_bookmarks';
export const SYNC_DEBOUNCE_MS = 1500;

const PASSPHRASE_WORD_POOL = Array.from(
  new Set([
    'elang',
    'samudra',
    'bintang',
    'kopi',
    'hutan',
    'senja',
    'awan',
    'lentera',
    'angin',
    'ombak',
    'gunung',
    'pelangi',
    'bulan',
    'mentari',
    'purnama',
    'embun',
    'lembah',
    'sungai',
    'cahaya',
    'aksara',
    'pustaka',
    'lembar',
    'pena',
    'tinta',
    'layar',
    'kompas',
    'perahu',
    'dermaga',
    'merpati',
    'rajawali',
    'kijang',
    'rubah',
    'teratai',
    'melati',
    'anggrek',
    'cemara',
    'bambu',
    'daun',
    'galaksi',
    'komet',
    'nusa',
    'rimba',
    'telaga',
    'kisah',
    'karya',
    'fajar',
    'mega',
    'badai',
    'karam',
    'karang',
    'pasir',
    'pulau',
    'aurora',
    'zephyr',
    'amber',
    'cedar',
    'river',
    'harbor',
    'meadow',
    'canyon',
    'velvet',
    'silver',
    'golden',
    'spark',
    'oasis',
    'summit',
    'horizon',
    'beacon',
    'cobalt',
    'jade',
    'coral',
    'ivory',
    'maple',
    'willow',
    'pine',
    'pebble',
    'crystal',
    'glacier',
    'orchid',
    'lotus',
    'falcon',
    'phoenix',
    'atlas',
    'solaris',
    'lumen',
    'prism',
    'voyage',
    'breeze',
    'echo',
  ])
);

export function normalizePassphrase(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .split(/[\s\-_,.;:|/]+/)
    .filter(Boolean)
    .join('-');
}

export function isValidPassphrase(raw: string): boolean {
  const words = normalizePassphrase(raw).split('-').filter(Boolean);
  return words.length >= 6 && words.every((w) => /^[a-z0-9]{2,24}$/.test(w));
}

export function generateSyncPassphrase(wordCount = 8): string {
  const pool = [...PASSPHRASE_WORD_POOL];
  const chosen: string[] = [];
  const randomBuffer = new Uint32Array(wordCount);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomBuffer);
  } else {
    for (let i = 0; i < wordCount; i++) {
      randomBuffer[i] = Math.floor(Math.random() * 0xffffffff);
    }
  }

  for (let i = 0; i < wordCount && pool.length > 0; i++) {
    const idx = randomBuffer[i] % pool.length;
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return chosen.join('-');
}

function sha256Fallback(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H)
    .map((val) => val.toString(16).padStart(8, '0'))
    .join('');
}

export async function deriveChainHash(rawPassphrase: string): Promise<string> {
  const normalized = normalizePassphrase(rawPassphrase);
  if (!normalized) {
    throw new Error('Kode frasa tidak boleh kosong.');
  }
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const data = new TextEncoder().encode(normalized);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return sha256Fallback(normalized);
    }
  }
  return sha256Fallback(normalized);
}

export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(SYNC_DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(SYNC_DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `dev-${Date.now()}`;
  }
}

export function getDevicePlatform(): SyncDevicePlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return 'mobile';
  }
  if (typeof window !== 'undefined' && 'ontouchstart' in window && window.innerWidth < 1024) {
    return 'mobile';
  }
  return 'desktop';
}

export function detectDefaultDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Perangkat Web';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android Mobile';
  if (/iPhone/i.test(ua)) return 'iPhone (iOS)';
  if (/iPad/i.test(ua)) return 'iPad (iPadOS)';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'MacBook (macOS)';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux Desktop';
  return 'Perangkat Web';
}

export function getFriendlyDeviceName(): string {
  try {
    const custom = localStorage.getItem(SYNC_DEVICE_NAME_STORAGE_KEY)?.trim();
    if (custom) return custom.slice(0, 64);
  } catch {
    // ignore storage access errors
  }
  return detectDefaultDeviceName();
}

export function saveCustomDeviceName(rawName: string): string {
  const cleaned = rawName.trim().slice(0, 64);
  try {
    if (cleaned) {
      localStorage.setItem(SYNC_DEVICE_NAME_STORAGE_KEY, cleaned);
    } else {
      localStorage.removeItem(SYNC_DEVICE_NAME_STORAGE_KEY);
    }
  } catch {
    // ignore storage access errors
  }
  return cleaned || detectDefaultDeviceName();
}

export function getCurrentDeviceInfo(): SyncDeviceInfo {
  return {
    deviceId: getOrCreateDeviceId().slice(0, 128),
    name: getFriendlyDeviceName().slice(0, 64),
    platform: getDevicePlatform(),
    lastActive: Date.now(),
  };
}

export function getStoredSyncPassphrase(): string {
  try {
    const raw = localStorage.getItem(SYNC_PASSPHRASE_STORAGE_KEY) || '';
    return raw ? normalizePassphrase(raw) : '';
  } catch {
    return '';
  }
}

export function saveStoredSyncPassphrase(passphrase: string): string {
  const normalized = normalizePassphrase(passphrase);
  if (!normalized) {
    localStorage.removeItem(SYNC_PASSPHRASE_STORAGE_KEY);
    return '';
  }
  localStorage.setItem(SYNC_PASSPHRASE_STORAGE_KEY, normalized);
  return normalized;
}

export function clearStoredSyncPassphrase(): void {
  try {
    localStorage.removeItem(SYNC_PASSPHRASE_STORAGE_KEY);
  } catch {
    // ignore storage cleanup errors
  }
}

export function getStoredDeletedBookmarks(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_DELETED_BOOKMARKS_STORAGE_KEY) || '{}');
    if (parsed && typeof parsed === 'object') return parsed as Record<string, number>;
  } catch {
    // ignore malformed json
  }
  return {};
}

export function recordDeletedBookmarkId(id: string): Record<string, number> {
  const map = getStoredDeletedBookmarks();
  map[id] = Date.now();
  // Keep latest 300 deletion tombstones to keep document compact
  const entries = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300);
  const trimmed = Object.fromEntries(entries);
  try {
    localStorage.setItem(SYNC_DELETED_BOOKMARKS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage quota errors
  }
  return trimmed;
}

export function sanitizeFirestoreKey(input: string, maxLen = 80): string {
  const cleaned = input.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned || 'item').slice(0, maxLen);
}

export function buildTranslationDocId(bookId: string, chapterIndex: number): string {
  const safeIdx = Number.isFinite(chapterIndex) && chapterIndex >= 0 ? Math.floor(chapterIndex) : 0;
  return `${sanitizeFirestoreKey(bookId, 72)}_${safeIdx}`;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    });
    return out as T;
  }
  return value;
}

export interface SyncChainDocument {
  chainHash: string;
  updatedAt: number;
  lastDeviceId: string;
  lastDeviceName: string;
  lastPosition?: SyncReadingPosition;
  positions?: Record<string, SyncReadingPosition>;
  bookmarks?: BookmarkItem[];
  deletedBookmarkIds?: Record<string, number>;
  devices?: Record<string, SyncDeviceInfo>;
}

export interface SyncTranslationDoc {
  docId: string;
  bookId: string;
  bookTitle: string;
  targetLang: string;
  chapterIndex: number;
  href: string;
  stage: TranslationStage;
  pairs: TranslationPair[];
  updatedAt: number;
  deviceId: string;
}

export function mergeBookmarkLists(
  localList: BookmarkItem[],
  remoteList: BookmarkItem[],
  deletedMap: Record<string, number>
): BookmarkItem[] {
  const byId = new Map<string, BookmarkItem>();
  [...localList, ...remoteList].forEach((bm) => {
    if (!bm?.id) return;
    if (deletedMap[bm.id]) return;
    if (!byId.has(bm.id)) {
      byId.set(bm.id, bm);
    }
  });
  return Array.from(byId.values()).slice(0, 500);
}

class PustakaSyncService {
  private activeChainHash: string | null = null;
  private chainDocUnsub: Unsubscribe | null = null;
  private translationsUnsub: Unsubscribe | null = null;

  private positionTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPosition: SyncReadingPosition | null = null;

  private bookmarksTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingBookmarks: {
    bookmarks: BookmarkItem[];
    deletedBookmarkIds: Record<string, number>;
  } | null = null;

  private translationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingTranslations = new Map<string, SyncTranslationDoc>();

  private statusListener: ((status: SyncConnectionStatus, message?: string) => void) | null = null;
  private currentStatus: SyncConnectionStatus = 'disconnected';
  private activeWriteCount = 0;

  private setStatus(status: SyncConnectionStatus, message?: string) {
    this.currentStatus = status;
    this.statusListener?.(status, message);
  }

  getActiveChainHash(): string | null {
    return this.activeChainHash;
  }

  getStatus(): SyncConnectionStatus {
    return this.currentStatus;
  }

  disconnect() {
    if (this.positionTimer) {
      clearTimeout(this.positionTimer);
      this.positionTimer = null;
    }
    this.pendingPosition = null;

    if (this.bookmarksTimer) {
      clearTimeout(this.bookmarksTimer);
      this.bookmarksTimer = null;
    }
    this.pendingBookmarks = null;

    this.translationTimers.forEach((t) => clearTimeout(t));
    this.translationTimers.clear();
    this.pendingTranslations.clear();

    this.chainDocUnsub?.();
    this.chainDocUnsub = null;

    this.translationsUnsub?.();
    this.translationsUnsub = null;

    this.activeChainHash = null;
    this.activeWriteCount = 0;
    this.setStatus('disconnected');
  }

  async connect(
    passphrase: string,
    callbacks: {
      onStatusChange?: (status: SyncConnectionStatus, message?: string) => void;
      onRemoteChainData: (data: SyncChainDocument | null) => void;
      onRemoteTranslations: (docs: SyncTranslationDoc[]) => void;
    }
  ): Promise<string> {
    this.disconnect();
    this.statusListener = callbacks.onStatusChange || null;
    this.setStatus('connecting');

    void testFirestoreConnection();

    const chainHash = await deriveChainHash(passphrase);
    this.activeChainHash = chainHash;

    const chainPath = `sync_chains/${chainHash}`;
    const chainDocRef = doc(db, 'sync_chains', chainHash);

    this.chainDocUnsub = onSnapshot(
      chainDocRef,
      (snapshot) => {
        if (this.activeChainHash !== chainHash) return;
        this.setStatus(this.activeWriteCount > 0 ? 'syncing' : 'synced');
        if (!snapshot.exists()) {
          callbacks.onRemoteChainData(null);
          return;
        }
        const data = snapshot.data() as SyncChainDocument | undefined;
        callbacks.onRemoteChainData(data || null);
      },
      (error) => {
        this.setStatus('error', formatSyncUiError(error));
        try {
          handleFirestoreError(error, OperationType.GET, chainPath);
        } catch {
          // error logged in handleFirestoreError; keep reader UI resilient
        }
      }
    );

    const translationsPath = `sync_chains/${chainHash}/translations`;
    const translationsColRef = collection(db, 'sync_chains', chainHash, 'translations');

    this.translationsUnsub = onSnapshot(
      translationsColRef,
      (snapshot) => {
        if (this.activeChainHash !== chainHash) return;
        const items: SyncTranslationDoc[] = [];
        snapshot.forEach((docSnap) => {
          const raw = docSnap.data() as Omit<SyncTranslationDoc, 'docId'> | undefined;
          if (raw && Array.isArray(raw.pairs) && raw.href && raw.bookId) {
            items.push({
              docId: docSnap.id,
              ...raw,
            });
          }
        });
        if (items.length > 0) {
          callbacks.onRemoteTranslations(items);
        }
      },
      (error) => {
        this.setStatus('error', formatSyncUiError(error));
        try {
          handleFirestoreError(error, OperationType.LIST, translationsPath);
        } catch {
          // error logged; keep reader UI resilient
        }
      }
    );

    return chainHash;
  }

  schedulePositionSync(position: SyncReadingPosition) {
    if (!this.activeChainHash) return;
    this.pendingPosition = position;
    if (this.positionTimer) clearTimeout(this.positionTimer);
    this.positionTimer = setTimeout(() => {
      this.positionTimer = null;
      const payload = this.pendingPosition;
      this.pendingPosition = null;
      if (payload) {
        void this.writePositionNow(payload);
      }
    }, SYNC_DEBOUNCE_MS);
  }

  private async writePositionNow(position: SyncReadingPosition) {
    const chainHash = this.activeChainHash;
    if (!chainHash) return;

    const path = `sync_chains/${chainHash}`;
    const bookKey = sanitizeFirestoreKey(position.bookId, 72);
    const cleanPos = stripUndefinedDeep({
      ...position,
      bookId: position.bookId.slice(0, 160),
      bookTitle: position.bookTitle.slice(0, 240),
      chapterTitle: position.chapterTitle.slice(0, 240),
      href: position.href ? position.href.slice(0, 300) : undefined,
      deviceId: position.deviceId.slice(0, 128),
      deviceName: position.deviceName.slice(0, 64),
    });

    this.activeWriteCount += 1;
    this.setStatus('syncing');
    const deviceInfo = getCurrentDeviceInfo();
    try {
      await setDoc(
        doc(db, 'sync_chains', chainHash),
        stripUndefinedDeep({
          chainHash,
          updatedAt: Date.now(),
          lastDeviceId: cleanPos.deviceId,
          lastDeviceName: cleanPos.deviceName,
          lastPosition: cleanPos,
          positions: {
            [bookKey]: cleanPos,
          },
          devices: {
            [deviceInfo.deviceId]: deviceInfo,
          },
        }),
        { merge: true }
      );
      if (this.activeChainHash === chainHash) {
        this.setStatus(this.activeWriteCount <= 1 ? 'synced' : 'syncing');
      }
    } catch (error) {
      this.setStatus('error', formatSyncUiError(error));
      try {
        handleFirestoreError(error, OperationType.WRITE, path);
      } catch {
        // non-fatal background sync error
      }
    } finally {
      this.activeWriteCount = Math.max(0, this.activeWriteCount - 1);
      if (this.activeChainHash === chainHash && this.activeWriteCount === 0 && this.currentStatus === 'syncing') {
        this.setStatus('synced');
      }
    }
  }

  scheduleBookmarksSync(bookmarks: BookmarkItem[], deletedBookmarkIds: Record<string, number>) {
    if (!this.activeChainHash) return;
    this.pendingBookmarks = { bookmarks, deletedBookmarkIds };
    if (this.bookmarksTimer) clearTimeout(this.bookmarksTimer);
    this.bookmarksTimer = setTimeout(() => {
      this.bookmarksTimer = null;
      const payload = this.pendingBookmarks;
      this.pendingBookmarks = null;
      if (payload) {
        void this.writeBookmarksNow(payload.bookmarks, payload.deletedBookmarkIds);
      }
    }, SYNC_DEBOUNCE_MS);
  }

  private async writeBookmarksNow(
    bookmarks: BookmarkItem[],
    deletedBookmarkIds: Record<string, number>
  ) {
    const chainHash = this.activeChainHash;
    if (!chainHash) return;

    const path = `sync_chains/${chainHash}`;
    this.activeWriteCount += 1;
    this.setStatus('syncing');
    const deviceInfo = getCurrentDeviceInfo();
    try {
      await setDoc(
        doc(db, 'sync_chains', chainHash),
        stripUndefinedDeep({
          chainHash,
          updatedAt: Date.now(),
          lastDeviceId: deviceInfo.deviceId,
          lastDeviceName: deviceInfo.name,
          bookmarks: bookmarks.slice(0, 500),
          deletedBookmarkIds,
          devices: {
            [deviceInfo.deviceId]: deviceInfo,
          },
        }),
        { merge: true }
      );
      if (this.activeChainHash === chainHash) {
        this.setStatus(this.activeWriteCount <= 1 ? 'synced' : 'syncing');
      }
    } catch (error) {
      this.setStatus('error', formatSyncUiError(error));
      try {
        handleFirestoreError(error, OperationType.WRITE, path);
      } catch {
        // non-fatal background sync error
      }
    } finally {
      this.activeWriteCount = Math.max(0, this.activeWriteCount - 1);
      if (this.activeChainHash === chainHash && this.activeWriteCount === 0 && this.currentStatus === 'syncing') {
        this.setStatus('synced');
      }
    }
  }

  scheduleTranslationSync(params: {
    bookId: string;
    bookTitle: string;
    targetLang: string;
    chapterIndex: number;
    href: string;
    stage: TranslationStage;
    pairs: TranslationPair[];
    updatedAt: number;
  }) {
    if (!this.activeChainHash) return;
    const safeBookId = params.bookId.slice(0, 160);
    const safeChapterIdx =
      Number.isFinite(params.chapterIndex) && params.chapterIndex >= 0
        ? Math.floor(params.chapterIndex)
        : 0;
    const docId = buildTranslationDocId(safeBookId, safeChapterIdx);
    const docPayload: SyncTranslationDoc = {
      docId,
      bookId: safeBookId,
      bookTitle: (params.bookTitle || '').slice(0, 240),
      targetLang: (params.targetLang || 'Indonesian').slice(0, 64),
      chapterIndex: safeChapterIdx,
      href: (params.href || 'chapter').slice(0, 300),
      stage: params.stage,
      pairs: params.pairs.slice(0, 2500),
      updatedAt: params.updatedAt || Date.now(),
      deviceId: getOrCreateDeviceId().slice(0, 128),
    };

    this.pendingTranslations.set(docId, docPayload);
    const prevTimer = this.translationTimers.get(docId);
    if (prevTimer) clearTimeout(prevTimer);

    const timer = setTimeout(() => {
      this.translationTimers.delete(docId);
      const pending = this.pendingTranslations.get(docId);
      this.pendingTranslations.delete(docId);
      if (pending) {
        void this.writeTranslationNow(pending);
      }
    }, SYNC_DEBOUNCE_MS);
    this.translationTimers.set(docId, timer);
  }

  private async writeTranslationNow(payload: SyncTranslationDoc) {
    const chainHash = this.activeChainHash;
    if (!chainHash) return;

    const { docId, ...body } = payload;
    const serializedSize = JSON.stringify(body).length;
    if (serializedSize > 900_000) {
      // Skip oversized single-file chapter documents to respect Firestore 1MB limit
      return;
    }

    const path = `sync_chains/${chainHash}/translations/${docId}`;
    this.activeWriteCount += 1;
    this.setStatus('syncing');
    try {
      await setDoc(
        doc(db, 'sync_chains', chainHash, 'translations', docId),
        stripUndefinedDeep(body),
        { merge: true }
      );
      if (this.activeChainHash === chainHash) {
        this.setStatus(this.activeWriteCount <= 1 ? 'synced' : 'syncing');
      }
    } catch (error) {
      this.setStatus('error', formatSyncUiError(error));
      try {
        handleFirestoreError(error, OperationType.WRITE, path);
      } catch {
        // non-fatal background sync error
      }
    } finally {
      this.activeWriteCount = Math.max(0, this.activeWriteCount - 1);
      if (this.activeChainHash === chainHash && this.activeWriteCount === 0 && this.currentStatus === 'syncing') {
        this.setStatus('synced');
      }
    }
  }

  async registerDeviceNow(): Promise<void> {
    const chainHash = this.activeChainHash;
    if (!chainHash) return;

    const path = `sync_chains/${chainHash}`;
    const deviceInfo = getCurrentDeviceInfo();
    this.activeWriteCount += 1;
    this.setStatus('syncing');
    try {
      await setDoc(
        doc(db, 'sync_chains', chainHash),
        stripUndefinedDeep({
          chainHash,
          updatedAt: Date.now(),
          lastDeviceId: deviceInfo.deviceId,
          lastDeviceName: deviceInfo.name,
          devices: {
            [deviceInfo.deviceId]: deviceInfo,
          },
        }),
        { merge: true }
      );
      if (this.activeChainHash === chainHash) {
        this.setStatus(this.activeWriteCount <= 1 ? 'synced' : 'syncing');
      }
    } catch (error) {
      this.setStatus('error', formatSyncUiError(error));
      try {
        handleFirestoreError(error, OperationType.WRITE, path);
      } catch {
        // non-fatal background registration error
      }
    } finally {
      this.activeWriteCount = Math.max(0, this.activeWriteCount - 1);
      if (this.activeChainHash === chainHash && this.activeWriteCount === 0 && this.currentStatus === 'syncing') {
        this.setStatus('synced');
      }
    }
  }

  async removeDeviceFromChain(targetDeviceId: string): Promise<void> {
    const chainHash = this.activeChainHash;
    if (!chainHash || !targetDeviceId) return;

    const path = `sync_chains/${chainHash}`;
    this.activeWriteCount += 1;
    this.setStatus('syncing');
    try {
      await setDoc(
        doc(db, 'sync_chains', chainHash),
        {
          chainHash,
          updatedAt: Date.now(),
          devices: {
            [targetDeviceId]: deleteField(),
          },
        },
        { merge: true }
      );
      if (this.activeChainHash === chainHash) {
        this.setStatus(this.activeWriteCount <= 1 ? 'synced' : 'syncing');
      }
    } catch (error) {
      this.setStatus('error', formatSyncUiError(error));
      try {
        handleFirestoreError(error, OperationType.WRITE, path);
      } catch {
        // non-fatal background error
      }
    } finally {
      this.activeWriteCount = Math.max(0, this.activeWriteCount - 1);
      if (this.activeChainHash === chainHash && this.activeWriteCount === 0 && this.currentStatus === 'syncing') {
        this.setStatus('synced');
      }
    }
  }
}

export const syncService = new PustakaSyncService();
