/**
 * Membersihkan teks hasil ekstraksi HTML/EPUB dari karakter kontrol, zero-width,
 * atau unpaired UTF-16 surrogates agar aman diserialisasi ke JSON dan diproses penerjemah.
 */
export function sanitizeTextForTranslation(raw: string): string {
  if (!raw) return '';

  // Remove unpaired UTF-16 surrogates that break JSON.stringify / Gemini JSON payloads
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = raw.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += raw[i] + raw[i + 1];
        i++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    out += raw[i];
  }

  return out
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PolishIdLike {
  id: number;
  draft: string;
}

/**
 * Mengurai output JSON array dari Gemini secara defensif agar JSON.parse tidak pernah menggagalkan aplikasi.
 */
export function safeParsePolishedJsonArray(
  rawJson: string,
  items: PolishIdLike[]
): string[] | null {
  if (!rawJson || items.length === 0) return null;

  const stripFences = rawJson
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const candidates: string[] = [stripFences];
  const firstBracket = stripFences.indexOf('[');
  const lastBracket = stripFences.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const sliced = stripFences.slice(firstBracket, lastBracket + 1);
    candidates.push(sliced);
    // Remove trailing commas before closing brackets/braces
    candidates.push(sliced.replace(/,\s*([\]}])/g, '$1'));
  }

  let parsed: unknown = null;
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
    return null;
  }

  const byId = new Map<number, string>();
  parsed.forEach((entry, idx) => {
    if (entry && typeof entry === 'object') {
      const obj = entry as {
        id?: unknown;
        polished?: unknown;
        translation?: unknown;
        text?: unknown;
      };
      const idNum = typeof obj.id === 'number' ? obj.id : Number(obj.id);
      const rawVal =
        typeof obj.polished === 'string'
          ? obj.polished
          : typeof obj.translation === 'string'
          ? obj.translation
          : typeof obj.text === 'string'
          ? obj.text
          : '';
      const cleanVal = sanitizeTextForTranslation(rawVal);
      if (Number.isFinite(idNum) && cleanVal) {
        byId.set(idNum, cleanVal);
      } else if (cleanVal && items[idx]) {
        byId.set(items[idx].id, cleanVal);
      }
    } else if (typeof entry === 'string' && items[idx]) {
      const cleanVal = sanitizeTextForTranslation(entry);
      if (cleanVal) {
        byId.set(items[idx].id, cleanVal);
      }
    }
  });

  if (byId.size === 0) return null;
  return items.map((item) => byId.get(item.id) || item.draft);
}
