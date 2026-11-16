export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

export const PRESET_GEMINI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
] as const;

export type PresetGeminiModel = (typeof PRESET_GEMINI_MODELS)[number];

const LS_API_KEY_OVERRIDE = 'reader_gemini_api_key';
const LS_MODEL_PRESET = 'reader_gemini_model';
const LS_CUSTOM_MODEL = 'reader_gemini_custom_model';
const LEGACY_BROKEN_MODELS = new Set(['gemini-3.8-flash', 'gemini-3.8-pro']);

export function getStoredApiKeyOverride(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (window.localStorage.getItem(LS_API_KEY_OVERRIDE) || '').trim();
  } catch {
    return '';
  }
}

export function setStoredApiKeyOverride(apiKey: string): void {
  if (typeof window === 'undefined') return;
  const clean = apiKey.trim();
  try {
    if (clean) {
      window.localStorage.setItem(LS_API_KEY_OVERRIDE, clean);
    } else {
      window.localStorage.removeItem(LS_API_KEY_OVERRIDE);
    }
  } catch {
    // ignore storage errors
  }
}

export function getStoredModelSelection(): {
  preset: string;
  customModel: string;
  activeModel: string;
} {
  if (typeof window === 'undefined') {
    return {
      preset: DEFAULT_GEMINI_MODEL,
      customModel: '',
      activeModel: DEFAULT_GEMINI_MODEL,
    };
  }
  try {
    const rawPreset = (window.localStorage.getItem(LS_MODEL_PRESET) || DEFAULT_GEMINI_MODEL).trim();
    const savedPreset = LEGACY_BROKEN_MODELS.has(rawPreset) ? DEFAULT_GEMINI_MODEL : rawPreset;
    if (rawPreset !== savedPreset) {
      window.localStorage.setItem(LS_MODEL_PRESET, savedPreset);
    }
    const savedCustom = (window.localStorage.getItem(LS_CUSTOM_MODEL) || '').trim();
    const activeModel =
      savedPreset === 'custom'
        ? savedCustom || DEFAULT_GEMINI_MODEL
        : savedPreset || DEFAULT_GEMINI_MODEL;

    return {
      preset: savedPreset || DEFAULT_GEMINI_MODEL,
      customModel: savedCustom,
      activeModel,
    };
  } catch {
    return {
      preset: DEFAULT_GEMINI_MODEL,
      customModel: '',
      activeModel: DEFAULT_GEMINI_MODEL,
    };
  }
}

export function getActiveModel(): string {
  return getStoredModelSelection().activeModel;
}

export function saveModelSelection(preset: string, customModel: string): void {
  if (typeof window === 'undefined') return;
  const cleanPreset = preset.trim() || DEFAULT_GEMINI_MODEL;
  const cleanCustom = customModel.trim();
  try {
    window.localStorage.setItem(LS_MODEL_PRESET, cleanPreset);
    if (cleanCustom) {
      window.localStorage.setItem(LS_CUSTOM_MODEL, cleanCustom);
    } else {
      window.localStorage.removeItem(LS_CUSTOM_MODEL);
    }
  } catch {
    // ignore storage errors
  }
}
