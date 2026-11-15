import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_NAME = 'gemini-4-hydrogen';

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi pada environment server.');
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

async function withBackoff<T>(fn: () => Promise<T>, retries = 2, delayMs = 800): Promise<T> {
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

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Contextual translation for selected word/phrase or active page
  app.post('/api/translate/contextual', async (req, res) => {
    try {
      const { text, targetLang = 'Bahasa Indonesia', isFullChapter = false } = req.body ?? {};
      const cleanText = typeof text === 'string' ? text.trim() : '';

      if (!cleanText) {
        return res.status(400).json({ error: 'Teks untuk diterjemahkan tidak boleh kosong.' });
      }

      const ai = getAiClient();
      const wordCount = cleanText.split(/\s+/).length;
      const isSingleWordOrPhrase = !isFullChapter && wordCount <= 4;

      const systemInstruction = `Anda adalah penerjemah sastra dan ahli bahasa profesional. Terjemahkan teks dari buku ke dalam ${targetLang} dengan gaya bahasa yang alami, mengalir, dan akurat sesuai konteks bacaan. Gunakan bahasa penjelasan yang jelas dalam Bahasa Indonesia.`;

      const userPrompt = isSingleWordOrPhrase
        ? `Analisis dan terjemahkan kata/frasa berikut ke dalam ${targetLang}:\n"${cleanText}"\n\nBerikan format ringkas:\n1. **Terjemahan Utama**: (arti paling tepat)\n2. **Nuansa & Makna Kontekstual**: (penjelasan singkat penggunaan kata ini dalam sastra/kalimat)\n3. **Contoh Kalimat**: (1 contoh kalimat singkat beserta artinya)`
        : `Terjemahkan kutipan/halaman buku berikut ke dalam ${targetLang} secara alami dan sastrawi tanpa mengubah makna aslinya. Pertahankan pembagian paragraf agar nyaman dibaca:\n\n"${cleanText}"`;

      const response = await withBackoff(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: userPrompt,
          config: {
            systemInstruction,
          },
        })
      );

      const translation = response.text?.trim();
      if (!translation) {
        return res.status(502).json({ error: 'Respons kosong dari layanan terjemahan AI.' });
      }

      return res.json({ translation });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terjadi kesalahan pada server.';
      return res.status(500).json({ error: message });
    }
  });

  // 1:1 Paragraph array translation for Bilingual / Full-Book Translation modes
  app.post('/api/translate/paragraphs', async (req, res) => {
    try {
      const { paragraphs, targetLang = 'Bahasa Indonesia' } = req.body ?? {};
      if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
        return res.status(400).json({ error: 'Daftar paragraf tidak valid.' });
      }

      const cleanParagraphs = paragraphs
        .slice(0, 24)
        .map((p) => (typeof p === 'string' ? p.trim() : ''));

      const ai = getAiClient();
      const systemInstruction = `Anda adalah penerjemah buku sastra dan non-fiksi profesional. Terjemahkan setiap elemen teks dalam array JSON ke dalam ${targetLang} secara alami, akurat, dan sastrawi. Pertahankan jumlah dan urutan elemen array secara persis (${cleanParagraphs.length} item).`;

      const userPrompt = `Terjemahkan array paragraf buku berikut ke dalam ${targetLang}:\n${JSON.stringify(cleanParagraphs)}`;

      const response = await withBackoff(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
        })
      );

      const rawJson = (response.text ?? '[]').trim();
      let parsed: string[] = [];
      try {
        const candidate = JSON.parse(rawJson);
        if (Array.isArray(candidate)) {
          parsed = candidate.map((item, idx) =>
            typeof item === 'string' && item.trim() ? item : cleanParagraphs[idx]
          );
        }
      } catch {
        parsed = cleanParagraphs;
      }

      const translations = cleanParagraphs.map((orig, idx) => parsed[idx] || orig);
      return res.json({ translations });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal menerjemahkan paragraf.';
      return res.status(500).json({ error: message });
    }
  });

  // Quick vocabulary meaning lookup
  app.post('/api/translate/vocab', async (req, res) => {
    try {
      const { word, targetLang = 'Bahasa Indonesia' } = req.body ?? {};
      const cleanWord = typeof word === 'string' ? word.trim() : '';
      if (!cleanWord) {
        return res.status(400).json({ error: 'Kata tidak boleh kosong.' });
      }

      const ai = getAiClient();
      const response = await withBackoff(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: `Berikan terjemahan sangat singkat (maksimal 12 kata) dalam ${targetLang} untuk kata/frasa berikut tanpa pembukaan: "${cleanWord}"`,
        })
      );

      return res.json({ meaning: (response.text ?? 'Tersimpan dari bacaan').trim() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal mencari arti kosakata.';
      return res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PustakaMac server listening on http://localhost:${PORT}`);
  });
}

createServer();
