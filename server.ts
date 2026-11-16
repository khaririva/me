import 'dotenv/config';
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from '@google/genai';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveCliFlag(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('-')) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const eqArg = process.argv.find((arg) => arg.startsWith(prefix));
  return eqArg ? eqArg.slice(prefix.length) : undefined;
}

const PORT = Number(resolveCliFlag('--port') || process.env.PORT || 3000);
const HOST = resolveCliFlag('--host') || process.env.HOST || '0.0.0.0';
const DEFAULT_MODEL_NAME = 'gemini-4-hydrogen';

function getEnvApiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

function getServerAiClient(): GoogleGenAI {
  const apiKey = getEnvApiKey();
  if (!apiKey) {
    throw new Error('Layanan AI server belum terkonfigurasi.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function resolveModel(modelInput?: unknown): string {
  const custom = typeof modelInput === 'string' ? modelInput.trim() : '';
  if (!custom || custom === 'gemini-3.8-flash' || custom === 'gemini-3.8-pro') {
    return DEFAULT_MODEL_NAME;
  }
  return custom;
}

async function withBackoff<T>(fn: () => Promise<T>, retries = 2, delayMs = 400): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const noRetry = Boolean((err as { noRetry?: boolean } | null)?.noRetry);
      if (noRetry || attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, delayMs * Math.pow(2, attempt)));
    }
  }
  throw new Error('Gagal memproses permintaan AI');
}

interface GeminiGenerateOptions {
  model: string;
  userPrompt: string;
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: Schema;
}

function resolveThinkingLevel(model: string): ThinkingLevel | undefined {
  if (/^gemini-4/i.test(model)) {
    return ThinkingLevel.LOW;
  }
  if (/^gemini-3\.1-flash-lite/i.test(model)) {
    return ThinkingLevel.MINIMAL;
  }
  return undefined;
}

async function generateWithServerGemini(opts: GeminiGenerateOptions): Promise<string> {
  const ai = getServerAiClient();

  return withBackoff(async () => {
    const run = async (includeThinkingConfig: boolean) => {
      const thinkingLevel = includeThinkingConfig ? resolveThinkingLevel(opts.model) : undefined;
      return ai.models.generateContent({
        model: opts.model,
        contents: opts.userPrompt,
        config: {
          ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
          ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
          ...(opts.responseMimeType ? { responseMimeType: opts.responseMimeType } : {}),
          ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
        },
      });
    };

    try {
      const response = await run(true);
      const text = (response.text ?? '').trim();
      if (!text) {
        throw new Error('Respons kosong dari layanan terjemahan AI.');
      }
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/400/.test(msg) && /thinking/i.test(msg)) {
        const retryResponse = await run(false);
        const retryText = (retryResponse.text ?? '').trim();
        if (!retryText) {
          throw new Error('Respons kosong dari layanan terjemahan AI.');
        }
        return retryText;
      }
      if (/400|401|403|404|INVALID_ARGUMENT|PERMISSION_DENIED|NOT_FOUND/i.test(msg)) {
        const wrapped = new Error(`Gemini (${opts.model}): ${msg}`) as Error & { noRetry?: boolean };
        wrapped.noRetry = true;
        throw wrapped;
      }
      throw err;
    }
  });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasDefaultEnvKey: Boolean(getEnvApiKey()),
      defaultModel: DEFAULT_MODEL_NAME,
    });
  });

  app.get('/api/download/html', (_req, res) => {
    const htmlFile = path.resolve(__dirname, 'dist-html', 'PustakaLoka.html');
    if (!fs.existsSync(htmlFile)) {
      return res.status(404).json({ error: 'File PustakaLoka.html belum dibangun.' });
    }
    return res.download(htmlFile, 'PustakaLoka.html');
  });

  // Contextual translation for selected word/phrase or active page
  app.post('/api/translate/contextual', async (req, res) => {
    try {
      const {
        text,
        targetLang = 'Bahasa Indonesia',
        isFullChapter = false,
        model,
      } = req.body ?? {};
      const cleanText = typeof text === 'string' ? text.trim() : '';

      if (!cleanText) {
        return res.status(400).json({ error: 'Teks untuk diterjemahkan tidak boleh kosong.' });
      }

      const selectedModel = resolveModel(model);
      const wordCount = cleanText.split(/\s+/).length;
      const isSingleWordOrPhrase = !isFullChapter && wordCount <= 4;

      const systemInstruction = `Anda adalah penerjemah sastra profesional. Terjemahkan teks ke ${targetLang} secara alami dan akurat. Jangan menerjemahkan nama orang, tempat, jurus, atau judul asli. Gunakan Bahasa Indonesia untuk penjelasan.`;

      const userPrompt = isSingleWordOrPhrase
        ? `Terjemahkan kata/frasa berikut ke ${targetLang}:\n"${cleanText}"\n\nFormat ringkas:\n1. **Terjemahan Utama**\n2. **Nuansa Kontekstual**\n3. **Contoh Kalimat**`
        : `Terjemahkan kutipan berikut ke ${targetLang} secara alami:\n\n"${cleanText}"`;

      const translation = await generateWithServerGemini({
        model: selectedModel,
        userPrompt,
        systemInstruction,
      });

      return res.json({ translation });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terjadi kesalahan pada server.';
      return res.status(500).json({ error: message });
    }
  });

  const sanitizeServerText = (raw: unknown): string => {
    if (typeof raw !== 'string') return '';
    return raw
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Stage 1 fallback proxy: Google Translate instant draft with \n[[[P_SEP]]]\n
  app.post('/api/translate/instant-draft', async (req, res) => {
    try {
      const { paragraphs, targetLang = 'Bahasa Indonesia' } = req.body ?? {};
      if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
        return res.status(400).json({ error: 'Daftar paragraf tidak valid.' });
      }
      const cleanParagraphs = paragraphs.slice(0, 200).map((p) => sanitizeServerText(p));

      const lower = String(targetLang).toLowerCase();
      const tl = lower.includes('english') || lower.includes('inggris')
        ? 'en'
        : lower.includes('japan') || lower.includes('jepang') || lower.includes('日本語')
        ? 'ja'
        : lower.includes('korea') || lower.includes('한국')
        ? 'ko'
        : lower.includes('arab') || lower.includes('العربية')
        ? 'ar'
        : 'id';

      const combined = cleanParagraphs.join('\n[[[P_SEP]]]\n');
      const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
        tl
      )}&dt=t`;
      const gtRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ q: combined }).toString(),
      });
      if (!gtRes.ok) {
        return res.status(502).json({ error: `Google Translate HTTP ${gtRes.status}` });
      }
      const raw = (await gtRes.json()) as unknown[];
      const fullText = Array.isArray(raw?.[0])
        ? (raw[0] as unknown[])
            .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
            .join('')
        : '';
      const parts = fullText.split(/\s*\[\[\[\s*P_SEP\s*\]\]\]\s*/g).map((s) => sanitizeServerText(s));
      const translations = cleanParagraphs.map((orig, idx) =>
        parts[idx] && parts[idx].length > 0 ? parts[idx] : orig
      );
      return res.json({ translations });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal membuat draf instan.';
      return res.status(500).json({ error: message });
    }
  });

  // Stage 2: Gemini AI literary polish for { id, original, draft } JSON batch
  app.post('/api/translate/polish', async (req, res) => {
    try {
      const { items, targetLang = 'Bahasa Indonesia', model } = req.body ?? {};
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Daftar item polish tidak valid.' });
      }

      const cleanItems = items.slice(0, 200).map((it, idx) => ({
        id: typeof it?.id === 'number' ? it.id : idx,
        original: sanitizeServerText(it?.original),
        draft: sanitizeServerText(it?.draft),
      }));

      const selectedModel = resolveModel(model);
      const systemInstruction = `Kamu adalah editor sastra dan penerjemah novel profesional berbahasa ${targetLang}.
Perhalus setiap draf terjemahan ("draft") dengan merujuk teks asli ("original") agar mengalir luwes, ekspresif, akurat, dan natural seperti novel terjemahan terbitan profesional.
ATURAN WAJIB PROTEKSI PENAMAAN & JUDUL:
- DILARANG menerjemahkan nama orang/karakter, nama tempat/kota/kerajaan/benua, nama jurus/teknik/skill/sihir, nama organisasi/klan, istilah khusus dunia cerita (proper nouns/world-building terms), dan judul asli bab/karya/buku.
- Jika pada draf Tahap 1 kata-kata penamaan atau istilah khusus tersebut terlanjur diterjemahkan secara harfiah, WAJIB perbaiki dan kembalikan ke bentuk ejaan aslinya persis seperti pada teks "original".
- Pastikan jumlah elemen dan urutan "id" paragraf 100% sama persis dengan input tanpa menggabungkan atau memecah paragraf. Kembalikan array JSON berisi objek { "id": number, "polished": string }.`;

      const rawOutput = await generateWithServerGemini({
        model: selectedModel,
        userPrompt: JSON.stringify(cleanItems),
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              polished: { type: Type.STRING },
            },
            required: ['id', 'polished'],
          },
        },
      });

      const stripFences = rawOutput
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();

      const candidates = [stripFences];
      const firstBracket = stripFences.indexOf('[');
      const lastBracket = stripFences.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        const sliced = stripFences.slice(firstBracket, lastBracket + 1);
        candidates.push(sliced, sliced.replace(/,\s*([\]}])/g, '$1'));
      }

      let parsed: Array<{ id?: unknown; polished?: unknown; translation?: unknown; text?: unknown }> = [];
      for (const candidate of candidates) {
        try {
          const val = JSON.parse(candidate);
          if (Array.isArray(val) && val.length > 0) {
            parsed = val;
            break;
          }
        } catch {
          // try next sanitized candidate
        }
      }

      if (!Array.isArray(parsed) || parsed.length === 0) {
        return res.json({ polished: cleanItems.map((it) => it.draft) });
      }

      const byId = new Map<number, string>();
      parsed.forEach((entry, idx) => {
        if (!entry || typeof entry !== 'object') return;
        const idNum = typeof entry.id === 'number' ? entry.id : Number(entry.id);
        const val = sanitizeServerText(
          typeof entry.polished === 'string'
            ? entry.polished
            : typeof entry.translation === 'string'
            ? entry.translation
            : typeof entry.text === 'string'
            ? entry.text
            : ''
        );
        if (Number.isFinite(idNum) && val) {
          byId.set(idNum, val);
        } else if (val && cleanItems[idx]) {
          byId.set(cleanItems[idx].id, val);
        }
      });

      const polished = cleanItems.map((it) => byId.get(it.id) || it.draft);
      return res.json({ polished });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal memperhalus terjemahan.';
      return res.status(500).json({ error: message });
    }
  });

  // Quick vocabulary meaning lookup
  app.post('/api/translate/vocab', async (req, res) => {
    try {
      const { word, targetLang = 'Bahasa Indonesia', model } = req.body ?? {};
      const cleanWord = typeof word === 'string' ? word.trim() : '';
      if (!cleanWord) {
        return res.status(400).json({ error: 'Kata tidak boleh kosong.' });
      }

      const selectedModel = resolveModel(model);
      const meaning = await generateWithServerGemini({
        model: selectedModel,
        userPrompt: `Arti singkat (maksimal 12 kata) dalam ${targetLang} untuk: "${cleanWord}"`,
      });

      return res.json({ meaning });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal mencari arti kosakata.';
      return res.status(500).json({ error: message });
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';

    if (disableHmr) {
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript').send(`
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== "undefined") {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    document.head.appendChild(style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]').forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const parsed = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (parsed.search ? "&" + parsed.search.slice(1) : "") + (parsed.hash || "");
}
export class ErrorOverlay extends HTMLElement {}
`);
      });
    }

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: !disableHmr,
        ws: disableHmr ? false : { server: httpServer },
      },
      plugins: [
        {
          name: 'express-middleware-ws',
          configResolved(resolvedConfig) {
            if (!disableHmr && typeof resolvedConfig.server.ws === 'object') {
              resolvedConfig.server.ws.server = httpServer;
            }
          },
        },
      ],
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`PustakaLoka server listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start PustakaLoka server:', err);
  process.exit(1);
});
