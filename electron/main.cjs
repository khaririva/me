const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const dotenv = require('dotenv');
const { GoogleGenAI, ThinkingLevel, Type } = require('@google/genai');

// Load .env from app root or userData on local Mac
const envCandidates = [
  path.join(app.getPath('userData'), '.env'),
  path.join(__dirname, '..', '.env'),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const MODEL_NAME = 'gemini-4-hydrogen';
let mainWindow = null;
let localServer = null;

function sanitizeDesktopText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAiClient() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Layanan AI server lokal belum terkonfigurasi.');
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

async function withBackoff(fn, retries = 2, delayMs = 800) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, delayMs * Math.pow(2, attempt)));
    }
  }
  throw new Error('Gagal memproses permintaan AI');
}

function startEmbeddedServer() {
  return new Promise((resolve, reject) => {
    const expressApp = express();
    expressApp.use(express.json({ limit: '4mb' }));

    expressApp.get('/api/health', (_req, res) => {
      res.json({ ok: true, desktop: true, hasDefaultEnvKey: Boolean((process.env.GEMINI_API_KEY || '').trim()) });
    });

    const resolveDesktopModel = (modelInput) => {
      const custom = typeof modelInput === 'string' ? modelInput.trim() : '';
      if (!custom || custom === 'gemini-3.8-flash' || custom === 'gemini-3.8-pro') {
        return MODEL_NAME;
      }
      return custom;
    };

    const resolveDesktopThinkingLevel = (targetModel) => {
      if (/^gemini-4/i.test(targetModel)) return ThinkingLevel.LOW;
      if (/^gemini-3\.1-flash-lite/i.test(targetModel)) return ThinkingLevel.MINIMAL;
      return undefined;
    };

    const generateDesktopWithGemini = async ({ model, userPrompt, systemInstruction, responseMimeType, responseSchema }) => {
      const targetModel = resolveDesktopModel(model);
      const ai = getAiClient();
      return withBackoff(async () => {
        const run = async (includeThinking) => {
          const thinkingLevel = includeThinking ? resolveDesktopThinkingLevel(targetModel) : undefined;
          return ai.models.generateContent({
            model: targetModel,
            contents: userPrompt,
            config: {
              ...(systemInstruction ? { systemInstruction } : {}),
              ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
              ...(responseMimeType ? { responseMimeType } : {}),
              ...(responseSchema ? { responseSchema } : {}),
            },
          });
        };

        try {
          const response = await run(true);
          const text = (response.text ?? '').trim();
          if (!text) throw new Error('Respons kosong dari AI.');
          return text;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/400/.test(msg) && /thinking/i.test(msg)) {
            const retryResponse = await run(false);
            const retryText = (retryResponse.text ?? '').trim();
            if (!retryText) throw new Error('Respons kosong dari AI.');
            return retryText;
          }
          throw err;
        }
      });
    };

    expressApp.post('/api/translate/contextual', async (req, res) => {
      try {
        const { text, targetLang = 'Bahasa Indonesia', isFullChapter = false, model } = req.body ?? {};
        const cleanText = sanitizeDesktopText(text);
        if (!cleanText) {
          return res.status(400).json({ error: 'Teks untuk diterjemahkan tidak boleh kosong.' });
        }

        const wordCount = cleanText.split(/\s+/).length;
        const isSingleWordOrPhrase = !isFullChapter && wordCount <= 4;

        const systemInstruction = `Anda adalah penerjemah sastra dan ahli bahasa profesional. Terjemahkan teks dari buku ke dalam ${targetLang} dengan gaya bahasa yang alami, mengalir, dan akurat sesuai konteks bacaan. Jangan menerjemahkan nama orang, tempat, jurus, atau judul asli. Gunakan bahasa penjelasan yang jelas dalam Bahasa Indonesia.`;
        const userPrompt = isSingleWordOrPhrase
          ? `Analisis dan terjemahkan kata/frasa berikut ke dalam ${targetLang}:\n"${cleanText}"\n\nBerikan format ringkas:\n1. **Terjemahan Utama**: (arti paling tepat)\n2. **Nuansa & Makna Kontekstual**: (penjelasan singkat penggunaan kata ini dalam sastra/kalimat)\n3. **Contoh Kalimat**: (1 contoh kalimat singkat beserta artinya)`
          : `Terjemahkan kutipan/halaman buku berikut ke dalam ${targetLang} secara alami dan sastrawi tanpa mengubah makna aslinya. Pertahankan pembagian paragraf agar nyaman dibaca:\n\n"${cleanText}"`;

        const translation = await generateDesktopWithGemini({
          model,
          userPrompt,
          systemInstruction,
        });

        return res.json({ translation });
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : 'Terjadi kesalahan pada server lokal.',
        });
      }
    });

    expressApp.post('/api/translate/instant-draft', async (req, res) => {
      try {
        const { paragraphs, targetLang = 'Bahasa Indonesia' } = req.body ?? {};
        if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
          return res.status(400).json({ error: 'Daftar paragraf tidak valid.' });
        }
        const cleanParagraphs = paragraphs.slice(0, 200).map((p) => sanitizeDesktopText(p));
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
        const gtRes = await fetch(
          `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: new URLSearchParams({ q: combined }).toString(),
          }
        );
        if (!gtRes.ok) {
          return res.status(502).json({ error: `Google Translate HTTP ${gtRes.status}` });
        }
        const raw = await gtRes.json();
        const fullText = Array.isArray(raw?.[0])
          ? raw[0].map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('')
          : '';
        const parts = fullText.split(/\s*\[\[\[\s*P_SEP\s*\]\]\]\s*/g).map((s) => sanitizeDesktopText(s));
        const translations = cleanParagraphs.map((orig, idx) => (parts[idx] && parts[idx].length > 0 ? parts[idx] : orig));
        return res.json({ translations });
      } catch (error) {
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Gagal membuat draf.' });
      }
    });

    expressApp.post('/api/translate/polish', async (req, res) => {
      try {
        const { items, targetLang = 'Bahasa Indonesia', model } = req.body ?? {};
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: 'Daftar item polish tidak valid.' });
        }
        const cleanItems = items.slice(0, 200).map((it, idx) => ({
          id: typeof it?.id === 'number' ? it.id : idx,
          original: sanitizeDesktopText(it?.original),
          draft: sanitizeDesktopText(it?.draft),
        }));
        const systemInstruction = `Kamu adalah editor sastra dan penerjemah novel profesional berbahasa ${targetLang}.
Perhalus setiap draf terjemahan ("draft") dengan merujuk teks asli ("original") agar mengalir luwes, ekspresif, akurat, dan natural seperti novel terjemahan terbitan profesional.
ATURAN WAJIB PROTEKSI PENAMAAN & JUDUL:
- DILARANG menerjemahkan nama orang/karakter, nama tempat/kota/kerajaan/benua, nama jurus/teknik/skill/sihir, nama organisasi/klan, istilah khusus dunia cerita (proper nouns/world-building terms), dan judul asli bab/karya/buku.
- Jika pada draf Tahap 1 kata-kata penamaan atau istilah khusus tersebut terlanjur diterjemahkan secara harfiah, WAJIB perbaiki dan kembalikan ke bentuk ejaan aslinya persis seperti pada teks "original".
- Pastikan jumlah elemen dan urutan "id" paragraf 100% sama persis dengan input tanpa menggabungkan atau memecah paragraf. Kembalikan array JSON berisi objek { "id": number, "polished": string }.`;

        const rawOutput = await generateDesktopWithGemini({
          model,
          userPrompt: JSON.stringify(cleanItems),
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { id: { type: Type.INTEGER }, polished: { type: Type.STRING } },
              required: ['id', 'polished'],
            },
          },
        });

        const stripFences = rawOutput.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
        const candidates = [stripFences];
        const firstBracket = stripFences.indexOf('[');
        const lastBracket = stripFences.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          const sliced = stripFences.slice(firstBracket, lastBracket + 1);
          candidates.push(sliced, sliced.replace(/,\s*([\]}])/g, '$1'));
        }
        let parsed = [];
        for (const candidate of candidates) {
          try {
            const val = JSON.parse(candidate);
            if (Array.isArray(val) && val.length > 0) {
              parsed = val;
              break;
            }
          } catch {
            // continue trying
          }
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return res.json({ polished: cleanItems.map((it) => it.draft) });
        }
        const byId = new Map();
        parsed.forEach((entry, idx) => {
          if (!entry || typeof entry !== 'object') return;
          const idNum = typeof entry.id === 'number' ? entry.id : Number(entry.id);
          const val = sanitizeDesktopText(entry.polished || entry.translation || entry.text || '');
          if (Number.isFinite(idNum) && val) {
            byId.set(idNum, val);
          } else if (val && cleanItems[idx]) {
            byId.set(cleanItems[idx].id, val);
          }
        });
        return res.json({ polished: cleanItems.map((it) => byId.get(it.id) || it.draft) });
      } catch (error) {
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Gagal memperhalus terjemahan.' });
      }
    });

    expressApp.post('/api/translate/vocab', async (req, res) => {
      try {
        const { word, targetLang = 'Bahasa Indonesia', model } = req.body ?? {};
        const cleanWord = typeof word === 'string' ? word.trim() : '';
        if (!cleanWord) {
          return res.status(400).json({ error: 'Kata tidak boleh kosong.' });
        }

        const meaning = await generateDesktopWithGemini({
          model,
          userPrompt: `Berikan terjemahan sangat singkat (maksimal 12 kata) dalam ${targetLang} untuk kata/frasa berikut tanpa pembukaan: "${cleanWord}"`,
        });

        return res.json({ meaning: meaning || 'Tersimpan dari bacaan' });
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : 'Gagal mencari arti kosakata.',
        });
      }
    });

    const distPath = path.join(__dirname, '..', 'dist');
    expressApp.use(express.static(distPath));
    expressApp.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    const server = http.createServer(expressApp);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      localServer = server;
      resolve(address.port);
    });
  });
}

async function openEpubDialog() {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Pilih Buku EPUB',
    properties: ['openFile'],
    filters: [{ name: 'EPUB Books', extensions: ['epub'] }],
  });

  if (result.canceled || result.filePaths.length === 0) return;
  const filePath = result.filePaths[0];
  const fileBuffer = fs.readFileSync(filePath);
  mainWindow.webContents.send('epub:opened-from-mac', {
    fileName: path.basename(filePath),
    buffer: Uint8Array.from(fileBuffer),
  });
}

function createMacMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'Tentang PustakaLoka' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Sembunyikan PustakaLoka' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Keluar PustakaLoka' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Buka File EPUB...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openEpubDialog(),
        },
        { type: 'separator' },
        { role: 'close', label: 'Tutup Jendela' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen', label: 'Layar Penuh' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const devUrl = process.env.ELECTRON_DEV_URL;
  const targetUrl = devUrl || `http://127.0.0.1:${await startEmbeddedServer()}`;
  const iconCandidates = [
    path.join(__dirname, '..', 'assets', 'icon.png'),
    path.join(__dirname, '..', 'public', 'icon-512.png'),
    path.join(__dirname, '..', 'public', 'icon.png'),
    path.join(__dirname, '..', 'dist', 'icon.png'),
  ];
  const resolvedIconPath = iconCandidates.find((p) => fs.existsSync(p));

  if (process.platform === 'darwin' && resolvedIconPath && app.dock) {
    app.dock.setIcon(resolvedIconPath);
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    title: 'PustakaLoka — Pembaca EPUB & Terjemahan AI',
    ...(resolvedIconPath ? { icon: resolvedIconPath } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('mac:open-epub-dialog', () => openEpubDialog());

app.whenReady().then(async () => {
  createMacMenu();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (localServer) {
    localServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
