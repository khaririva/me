import { getActiveModel, getStoredApiKeyOverride } from './aiConfig';
import { safeParsePolishedJsonArray, sanitizeTextForTranslation } from './textSanitize';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const PARAGRAPH_SEPARATOR = '\n[[[P_SEP]]]\n';
const PARAGRAPH_SPLIT_REGEX = /\s*\[\[\[\s*P_SEP\s*\]\]\]\s*/g;

export interface PolishParagraphItem {
  id: number;
  original: string;
  draft: string;
}

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function isCapacitorNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (typeof cap?.isNativePlatform === 'function') {
    try {
      return Boolean(cap.isNativePlatform());
    } catch {
      return false;
    }
  }
  return window.location.protocol === 'capacitor:';
}

function isHttpHostedOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  if (isCapacitorNativeShell()) return false;
  const proto = window.location.protocol;
  return proto === 'http:' || proto === 'https:';
}

function canReachBackendApi(): boolean {
  return isHttpHostedOrigin() || Boolean(API_BASE);
}

export function getClientActiveApiKey(): string {
  return getStoredApiKeyOverride();
}

export function resolveGoogleTranslateCode(targetLang: string): string {
  const lower = (targetLang || '').toLowerCase();
  if (lower.includes('indonesia') || lower === 'id') return 'id';
  if (lower.includes('english') || lower.includes('inggris') || lower === 'en') return 'en';
  if (lower.includes('japan') || lower.includes('jepang') || lower.includes('日本語') || lower === 'ja')
    return 'ja';
  if (lower.includes('korea') || lower.includes('한국') || lower === 'ko') return 'ko';
  if (lower.includes('arab') || lower.includes('العربية') || lower === 'ar') return 'ar';
  return 'id';
}

function buildDirectThinkingConfig(model: string): Record<string, unknown> | undefined {
  if (/^gemini-4/i.test(model)) {
    return { thinkingLevel: 'LOW' };
  }
  if (/^gemini-3\.1-flash-lite/i.test(model)) {
    return { thinkingLevel: 'MINIMAL' };
  }
  return { thinkingBudget: 0 };
}

async function callDirectGeminiV1Beta(opts: {
  userPrompt: string;
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<string> {
  const activeApiKey = getStoredApiKeyOverride();
  if (!activeApiKey) {
    throw new Error('NO_LOCAL_API_KEY');
  }

  const selectedModel = getActiveModel();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    selectedModel
  )}:generateContent?key=${encodeURIComponent(activeApiKey)}`;

  const buildPayload = (includeThinkingConfig: boolean): Record<string, unknown> => {
    const thinkingConfig = includeThinkingConfig
      ? buildDirectThinkingConfig(selectedModel)
      : undefined;
    const generationConfig: Record<string, unknown> = {
      ...(thinkingConfig ? { thinkingConfig } : {}),
      ...(opts.responseMimeType ? { responseMimeType: opts.responseMimeType } : {}),
      ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
    };

    const payload: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: opts.userPrompt }] }],
      generationConfig,
    };
    if (opts.systemInstruction) {
      payload.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
    }
    return payload;
  };

  const send = async (includeThinkingConfig: boolean) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(includeThinkingConfig)),
      signal: opts.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return { res, data };
  };

  let { res, data } = await send(true);
  if (!res.ok && res.status === 400 && /thinking/i.test(data?.error?.message || '')) {
    ({ res, data } = await send(false));
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini (${selectedModel}) gagal (${res.status})`);
  }

  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Respons kosong dari layanan terjemahan AI.');
  }
  return text;
}

export async function checkServerHealthApi(): Promise<{
  ok: boolean;
  hasDefaultEnvKey: boolean;
}> {
  if (!canReachBackendApi()) {
    return { ok: true, hasDefaultEnvKey: false };
  }
  try {
    const res = await fetch(apiUrl('/api/health'));
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return { ok: true, hasDefaultEnvKey: false };
    }
    const data = (await res.json().catch(() => ({}))) as { hasDefaultEnvKey?: boolean };
    return {
      ok: true,
      hasDefaultEnvKey: Boolean(data.hasDefaultEnvKey),
    };
  } catch {
    return {
      ok: true,
      hasDefaultEnvKey: false,
    };
  }
}

export async function translateContextualApi(
  text: string,
  targetLang: string,
  isFullChapter: boolean,
  hasServerEnvKey = false
): Promise<string> {
  const cleanText = sanitizeTextForTranslation(text);
  const wordCount = cleanText.split(/\s+/).length;
  const isSingleWordOrPhrase = !isFullChapter && wordCount <= 4;
  const systemInstruction = `Anda adalah penerjemah sastra profesional. Terjemahkan teks ke ${targetLang} secara alami dan akurat. Jangan menerjemahkan nama orang, tempat, jurus, atau judul asli. Gunakan Bahasa Indonesia untuk penjelasan.`;
  const userPrompt = isSingleWordOrPhrase
    ? `Terjemahkan kata/frasa berikut ke ${targetLang}:\n"${cleanText}"\n\nFormat ringkas:\n1. **Terjemahan Utama**\n2. **Nuansa Kontekstual**\n3. **Contoh Kalimat**`
    : `Terjemahkan kutipan berikut ke ${targetLang} secara alami:\n\n"${cleanText}"`;

  // 1. Jika user mengisi API Key di localStorage, panggil langsung ke Gemini API v1beta dari client
  if (getStoredApiKeyOverride()) {
    return callDirectGeminiV1Beta({ userPrompt, systemInstruction });
  }

  // 2. Jika berjalan di server Web yang menyediakan env key, gunakan endpoint server
  if (canReachBackendApi() && hasServerEnvKey) {
    try {
      const res = await fetch(apiUrl('/api/translate/contextual'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText,
          targetLang,
          isFullChapter,
          model: getActiveModel(),
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { translation?: string };
        if (data.translation) return data.translation;
      }
    } catch {
      // Fallback ke draf instan di bawah
    }
  }

  // 3. Fallback tanpa pop-up error API: gunakan Draf Terjemahan Instan
  const [fallbackDraft] = await translateChapterDraftApi([cleanText], targetLang);
  return fallbackDraft || cleanText;
}

function buildDraftChunks(paragraphs: string[]): string[][] {
  const MAX_CHARS = 12000;
  const chunks: string[][] = [];
  let current: string[] = [];
  let chars = 0;

  for (const raw of paragraphs) {
    const p = sanitizeTextForTranslation(raw);
    if (!p) continue;
    if (current.length > 0 && chars + p.length + PARAGRAPH_SEPARATOR.length > MAX_CHARS) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(p);
    chars += p.length + PARAGRAPH_SEPARATOR.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function extractGoogleTranslateSingleText(payload: unknown): string {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return '';
  return (payload[0] as unknown[])
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('');
}

/**
 * Tahap 1 (Instant Draft - < 1 detik):
 * 100% standalone langsung dari client ke endpoint Google Translate (`client=gtx`)
 * dengan pemisah `\n[[[P_SEP]]]\n`.
 */
export async function translateChapterDraftApi(
  paragraphs: string[],
  targetLang: string,
  signal?: AbortSignal
): Promise<string[]> {
  if (paragraphs.length === 0) return [];
  const cleanInputs = paragraphs.map((p) => sanitizeTextForTranslation(p));
  const tl = resolveGoogleTranslateCode(targetLang);
  const chunks = buildDraftChunks(cleanInputs);
  if (chunks.length === 0) return cleanInputs;

  const translateChunk = async (chunk: string[]): Promise<string[]> => {
    const combined = chunk.join(PARAGRAPH_SEPARATOR);
    const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
      tl
    )}&dt=t`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: new URLSearchParams({ q: combined }).toString(),
        signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const raw = await res.json();
      const fullTranslated = extractGoogleTranslateSingleText(raw);
      if (!fullTranslated.trim()) {
        throw new Error('Respons kosong dari Google Translate');
      }

      const parts = fullTranslated.split(PARAGRAPH_SPLIT_REGEX).map((s) => sanitizeTextForTranslation(s));
      return chunk.map((orig, idx) => (parts[idx] && parts[idx].length > 0 ? parts[idx] : orig));
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      if (canReachBackendApi()) {
        const proxyRes = await fetch(apiUrl('/api/translate/instant-draft'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paragraphs: chunk, targetLang }),
          signal,
        });
        if (proxyRes.ok) {
          const data = (await proxyRes.json().catch(() => ({}))) as { translations?: string[] };
          if (Array.isArray(data.translations)) {
            return chunk.map((orig, idx) =>
              sanitizeTextForTranslation(data.translations?.[idx] || '') || orig
            );
          }
        }
      }
      throw new Error('Gagal memuat draf terjemahan instan.');
    }
  };

  const results = await Promise.all(chunks.map(translateChunk));
  return results.flat();
}

function buildPolishBatches(items: PolishParagraphItem[]): PolishParagraphItem[][] {
  const MAX_ITEMS = 35;
  const MAX_JSON_CHARS = 9000;
  const batches: PolishParagraphItem[][] = [];
  let current: PolishParagraphItem[] = [];
  let chars = 0;

  for (const item of items) {
    const cleanItem: PolishParagraphItem = {
      id: item.id,
      original: sanitizeTextForTranslation(item.original),
      draft: sanitizeTextForTranslation(item.draft),
    };
    const est = cleanItem.original.length + cleanItem.draft.length + 36;
    if (current.length > 0 && (current.length >= MAX_ITEMS || chars + est > MAX_JSON_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(cleanItem);
    chars += est;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface PolishChapterResult {
  polished: string[] | null;
  reason?: string;
  errorCode?: 'NO_KEY' | 'QUOTA' | 'INVALID_KEY' | 'MODEL_NOT_FOUND' | 'ABORTED' | 'PARSE' | 'ERROR';
}

function classifyPolishError(rawMsg: string): {
  reason: string;
  errorCode: PolishChapterResult['errorCode'];
} {
  const msg = (rawMsg || '').trim();
  if (/quota|429|resource_exhausted|rate/i.test(msg)) {
    return {
      errorCode: 'QUOTA',
      reason: 'Kuota API Gemini tercapai (429). Gunakan draf instan atau cek model di Pengaturan.',
    };
  }
  if (/api key|permission|unauthorized|401|403|NO_LOCAL_API_KEY/i.test(msg)) {
    return {
      errorCode: 'INVALID_KEY',
      reason: 'API Key Gemini belum diisi atau tidak valid. Menggunakan Draf Terjemahan Instan.',
    };
  }
  if (/not found|404|unsupported model/i.test(msg)) {
    return {
      errorCode: 'MODEL_NOT_FOUND',
      reason: 'Model Gemini tidak tersedia. Buka Pengaturan (Gear) dan pilih gemini-4-hydrogen.',
    };
  }
  return {
    errorCode: 'ERROR',
    reason: msg || 'Menggunakan Draf Terjemahan Instan.',
  };
}

/**
 * Tahap 2 (Background AI Polish):
 * - Memprioritaskan panggilan langsung (client-side fetch) ke Gemini v1beta memakai API Key di localStorage.
 * - Jika API Key kosong pada build standalone, mengembalikan `null` secara senyap dan mempertahankan Draf Instan tanpa pop-up error.
 */
export async function polishChapterTranslationsDetailedApi(
  items: PolishParagraphItem[],
  targetLang: string,
  hasServerEnvKey = false,
  signal?: AbortSignal
): Promise<PolishChapterResult> {
  if (items.length === 0) return { polished: [] };
  if (signal?.aborted) return { polished: null, errorCode: 'ABORTED' };

  const clientKey = getStoredApiKeyOverride();
  const canTryHttpProxy = canReachBackendApi() && hasServerEnvKey;

  if (!clientKey && !canTryHttpProxy) {
    return {
      polished: null,
      errorCode: 'NO_KEY',
    };
  }

  const batches = buildPolishBatches(items);
  const systemInstruction = `Kamu adalah editor sastra dan penerjemah novel profesional berbahasa ${targetLang}.
Perhalus setiap draf terjemahan ("draft") dengan merujuk teks asli ("original") agar mengalir luwes, ekspresif, akurat, dan natural seperti novel terjemahan terbitan profesional.
ATURAN WAJIB PROTEKSI PENAMAAN & JUDUL:
- DILARANG menerjemahkan nama orang/karakter, nama tempat/kota/kerajaan/benua, nama jurus/teknik/skill/sihir, nama organisasi/klan, istilah khusus dunia cerita (proper nouns/world-building terms), dan judul asli bab/karya/buku.
- Jika pada draf Tahap 1 kata-kata penamaan atau istilah khusus tersebut terlanjur diterjemahkan secara harfiah, WAJIB perbaiki dan kembalikan ke bentuk ejaan aslinya persis seperti pada teks "original".
- Pastikan jumlah elemen dan urutan "id" paragraf 100% sama persis dengan input tanpa menggabungkan atau memecah paragraf. Kembalikan array JSON berisi objek { "id": number, "polished": string }.`;

  const model = getActiveModel();

  const polishBatch = async (
    chunk: PolishParagraphItem[]
  ): Promise<{ values: string[] | null; reason?: string; errorCode?: PolishChapterResult['errorCode'] }> => {
    if (signal?.aborted) return { values: null, errorCode: 'ABORTED' };

    if (clientKey) {
      try {
        const rawJson = await callDirectGeminiV1Beta({
          userPrompt: JSON.stringify(chunk),
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'INTEGER' },
                polished: { type: 'STRING' },
              },
              required: ['id', 'polished'],
            },
          },
          signal,
        });
        const parsed = safeParsePolishedJsonArray(rawJson, chunk);
        if (!parsed) {
          return { values: null, errorCode: 'PARSE', reason: 'Format respons AI tidak valid.' };
        }
        return { values: parsed };
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError' || signal?.aborted) {
          return { values: null, errorCode: 'ABORTED' };
        }
        const classified = classifyPolishError(err instanceof Error ? err.message : '');
        return { values: null, ...classified };
      }
    }

    try {
      const res = await fetch(apiUrl('/api/translate/polish'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: chunk,
          targetLang,
          model,
        }),
        signal,
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return { values: null, errorCode: 'NO_KEY' };
      }

      const data = (await res.json().catch(() => null)) as {
        polished?: string[];
        error?: string;
      } | null;

      if (!res.ok) {
        const classified = classifyPolishError(data?.error || `HTTP ${res.status}`);
        return { values: null, ...classified };
      }
      if (!data || !Array.isArray(data.polished) || data.polished.length === 0) {
        return { values: null, errorCode: 'PARSE', reason: 'Respons polish kosong.' };
      }
      return {
        values: chunk.map((item, idx) => {
          const val = sanitizeTextForTranslation(data.polished?.[idx] || '');
          return val || item.draft;
        }),
      };
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || signal?.aborted) {
        return { values: null, errorCode: 'ABORTED' };
      }
      const classified = classifyPolishError(err instanceof Error ? err.message : '');
      return { values: null, ...classified };
    }
  };

  try {
    const batchResults = await Promise.all(batches.map(polishBatch));
    if (signal?.aborted) return { polished: null, errorCode: 'ABORTED' };
    const firstSucceeded = batchResults.some((r) => r.values !== null);
    if (!firstSucceeded) {
      const firstErr = batchResults.find((r) => r.reason);
      return {
        polished: null,
        errorCode: firstErr?.errorCode || 'ERROR',
        reason: firstErr?.reason,
      };
    }
    return {
      polished: batchResults.flatMap((r, bIdx) => r.values ?? batches[bIdx].map((it) => it.draft)),
    };
  } catch (err) {
    const classified = classifyPolishError(err instanceof Error ? err.message : '');
    return { polished: null, ...classified };
  }
}

export async function polishChapterTranslationsApi(
  items: PolishParagraphItem[],
  targetLang: string,
  hasServerEnvKey = false,
  signal?: AbortSignal
): Promise<string[] | null> {
  const result = await polishChapterTranslationsDetailedApi(
    items,
    targetLang,
    hasServerEnvKey,
    signal
  );
  return result.polished;
}

export async function translateVocabApi(
  word: string,
  targetLang: string,
  hasServerEnvKey = false
): Promise<string> {
  const cleanWord = sanitizeTextForTranslation(word);
  const userPrompt = `Arti singkat (maksimal 12 kata) dalam ${targetLang} untuk: "${cleanWord}"`;

  // 1. Direct client-side call bila API Key diisi pengguna di localStorage
  if (getStoredApiKeyOverride()) {
    return callDirectGeminiV1Beta({ userPrompt });
  }

  // 2. Optional backend proxy fallback bila berjalan di server Web
  if (canReachBackendApi() && hasServerEnvKey) {
    try {
      const res = await fetch(apiUrl('/api/translate/vocab'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: cleanWord,
          targetLang,
          model: getActiveModel(),
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { meaning?: string };
        if (data.meaning) return data.meaning;
      }
    } catch {
      // Fallback ke draf instan di bawah
    }
  }

  // 3. Fallback ke Draf Terjemahan Instan tanpa pop-up error API
  const [fallbackMeaning] = await translateChapterDraftApi([cleanWord], targetLang);
  return fallbackMeaning || 'Tersimpan dari bacaan';
}
