export async function translateContextualApi(
  text: string,
  targetLang: string,
  isFullChapter: boolean
): Promise<string> {
  const res = await fetch('/api/translate/contextual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLang, isFullChapter }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Gagal menerjemahkan (${res.status})`);
  }
  return data.translation as string;
}

export async function translateParagraphsApi(
  paragraphs: string[],
  targetLang: string
): Promise<string[]> {
  const CHUNK_SIZE = 18;
  const results: string[] = [];

  for (let i = 0; i < paragraphs.length; i += CHUNK_SIZE) {
    const chunk = paragraphs.slice(i, i + CHUNK_SIZE);
    const res = await fetch('/api/translate/paragraphs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paragraphs: chunk, targetLang }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Gagal menerjemahkan bab (${res.status})`);
    }
    const translatedChunk = Array.isArray(data.translations) ? data.translations : chunk;
    for (let j = 0; j < chunk.length; j++) {
      results.push(translatedChunk[j] || chunk[j]);
    }
  }

  return results;
}

export async function translateVocabApi(word: string, targetLang: string): Promise<string> {
  const res = await fetch('/api/translate/vocab', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, targetLang }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Gagal mencari arti kosakata');
  }
  return data.meaning as string;
}
