import React, { useEffect, useState } from 'react';
import { Cpu, Eye, EyeOff, KeyRound, Link2, RotateCcw, Settings, X } from 'lucide-react';
import {
  DEFAULT_GEMINI_MODEL,
  PRESET_GEMINI_MODELS,
  getStoredApiKeyOverride,
  getStoredModelSelection,
  saveModelSelection,
  setStoredApiKeyOverride,
} from '../lib/aiConfig';
import type { SyncConnectionStatus, SyncDeviceInfo } from '../types/reader';
import { SyncChainSection } from './SyncChainSection';

interface ApiSettingsModalProps {
  open: boolean;
  hasServerEnvKey: boolean;
  onClose: () => void;
  onSaved?: (info: { activeModel: string; usingUserKey: boolean }) => void;
  syncPassphrase: string;
  syncChainHash: string | null;
  syncStatus: SyncConnectionStatus;
  syncError: string | null;
  syncDevices: SyncDeviceInfo[];
  localDeviceId: string;
  localDeviceName: string;
  onJoinOrCreateSyncChain: (passphrase: string) => void;
  onLeaveSyncChain: () => void;
  onRenameSyncDevice: (name: string) => void | Promise<void>;
  onRemoveSyncDevice: (deviceId: string) => void | Promise<void>;
}

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({
  open,
  hasServerEnvKey,
  onClose,
  onSaved,
  syncPassphrase,
  syncChainHash,
  syncStatus,
  syncError,
  syncDevices,
  localDeviceId,
  localDeviceName,
  onJoinOrCreateSyncChain,
  onLeaveSyncChain,
  onRenameSyncDevice,
  onRemoveSyncDevice,
}) => {
  const [activeTab, setActiveTab] = useState<'ai' | 'sync'>('ai');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [modelPreset, setModelPreset] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [customModelInput, setCustomModelInput] = useState('');

  useEffect(() => {
    if (!open) return;
    setApiKeyInput(getStoredApiKeyOverride());
    const stored = getStoredModelSelection();
    setModelPreset(stored.preset);
    setCustomModelInput(stored.customModel);
  }, [open]);

  if (!open) return null;

  const trimmedKey = apiKeyInput.trim();
  const resolvedModel =
    modelPreset === 'custom'
      ? customModelInput.trim() || DEFAULT_GEMINI_MODEL
      : modelPreset || DEFAULT_GEMINI_MODEL;

  const isSyncHealthy = Boolean(syncPassphrase) && (syncStatus === 'synced' || syncStatus === 'syncing');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setStoredApiKeyOverride(trimmedKey);
    saveModelSelection(modelPreset, customModelInput);
    onSaved?.({
      activeModel: resolvedModel,
      usingUserKey: Boolean(trimmedKey),
    });
    onClose();
  };

  const handleReset = () => {
    setApiKeyInput('');
    setModelPreset(DEFAULT_GEMINI_MODEL);
    setCustomModelInput('');
    setStoredApiKeyOverride('');
    saveModelSelection(DEFAULT_GEMINI_MODEL, '');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-xs sm:p-4"
      onClick={onClose}
    >
      <div
        className="mac-surface max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-color)] pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <Settings className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <h3 className="truncate text-sm font-bold">Pengaturan PustakaLoka</h3>
            {isSyncHealthy && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Tersinkron otomatis
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup Pengaturan"
            className="flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-lg p-1 text-[var(--text-secondary)] hover:bg-slate-500/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Settings Navigation Tabs */}
        <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-500/10 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('ai')}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 transition ${
              activeTab === 'ai'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="truncate">Gemini API &amp; AI</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sync')}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 transition ${
              activeTab === 'sync'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Link2 className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="truncate">Sync Chain</span>
            {Boolean(syncPassphrase) && (
              <span
                title={isSyncHealthy ? 'Tersinkron otomatis' : 'Status sinkronisasi'}
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isSyncHealthy
                    ? 'bg-emerald-500'
                    : syncStatus === 'error'
                    ? 'bg-rose-500'
                    : 'bg-amber-500'
                }`}
              />
            )}
          </button>
        </div>

        {activeTab === 'sync' ? (
          <div className="mt-4">
            <SyncChainSection
              passphrase={syncPassphrase}
              chainHash={syncChainHash}
              syncStatus={syncStatus}
              syncError={syncError}
              devices={syncDevices}
              localDeviceId={localDeviceId}
              localDeviceName={localDeviceName}
              onJoinOrCreateChain={onJoinOrCreateSyncChain}
              onLeaveChain={onLeaveSyncChain}
              onRenameDevice={onRenameSyncDevice}
              onRemoveDevice={onRemoveSyncDevice}
            />
          </div>
        ) : (
          <form onSubmit={handleSave} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="gemini-api-key-input"
                  className="flex items-center gap-1.5 text-xs font-semibold"
                >
                  <KeyRound className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  Gemini API Key (Opsional)
                </label>
                {trimmedKey && (
                  <button
                    type="button"
                    onClick={() => setApiKeyInput('')}
                    className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Kosongkan
                  </button>
                )}
              </div>

              <div className="relative flex items-center">
                <input
                  id="gemini-api-key-input"
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Masukkan Gemini API Key untuk mengaktifkan AI Polished ✨"
                  autoComplete="off"
                  className="mac-surface min-h-[42px] w-full rounded-xl border py-2 pl-3 pr-10 text-xs focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? 'Sembunyikan API Key' : 'Tampilkan API Key'}
                  className="absolute right-2 flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-slate-500/10"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <p className="text-[11px] leading-snug text-[var(--text-secondary)]">
                {trimmedKey
                  ? 'Mode aktif: Panggilan langsung (client-side) ke Gemini API menggunakan API Key di localStorage perangkat ini.'
                  : hasServerEnvKey
                  ? 'Kosongkan untuk memakai layanan server bawaan, atau isi API Key sendiri untuk panggilan langsung.'
                  : 'Opsional: Jika dikosongkan pada mode mandiri (Electron macOS / Capacitor Android), terjemahan otomatis memakai Draf Terjemahan Instan tanpa pop-up error.'}
              </p>
            </div>

            <div className="space-y-2 border-t border-[var(--border-color)] pt-3">
              <label
                htmlFor="gemini-model-select"
                className="flex items-center gap-1.5 text-xs font-semibold"
              >
                <Cpu className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                Pilihan Model Gemini
              </label>

              <select
                id="gemini-model-select"
                value={modelPreset}
                onChange={(e) => setModelPreset(e.target.value)}
                className="mac-surface min-h-[42px] w-full rounded-xl border px-3 py-2 text-xs font-semibold focus:border-blue-500 focus:outline-none"
              >
                {PRESET_GEMINI_MODELS.map((modelId) => (
                  <option key={modelId} value={modelId}>
                    {modelId === DEFAULT_GEMINI_MODEL ? `${modelId} (Default)` : modelId}
                  </option>
                ))}
                <option value="custom">Model Custom (Ketik Nama Model Sendiri)</option>
              </select>

              <div className="space-y-1">
                <label
                  htmlFor="gemini-custom-model-input"
                  className="text-[11px] font-semibold text-[var(--text-secondary)]"
                >
                  Nama Model Custom (Opsional)
                </label>
                <input
                  id="gemini-custom-model-input"
                  type="text"
                  value={customModelInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomModelInput(val);
                    if (val.trim()) {
                      setModelPreset('custom');
                    }
                  }}
                  placeholder="Contoh: gemini-4-hydrogen atau gemini-3.1-flash-lite"
                  className="mac-surface font-mono-mac min-h-[42px] w-full rounded-xl border px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>

              <p className="font-mono-mac break-all text-[11px] text-[var(--text-secondary)]">
                Endpoint: generativelanguage.googleapis.com/v1beta/models/{resolvedModel}:generateContent
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)] pt-3">
              <button
                type="button"
                onClick={handleReset}
                className="mac-surface flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition hover:bg-slate-500/10"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Default
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="mac-surface min-h-[40px] rounded-xl border px-3.5 py-2 text-xs font-semibold transition hover:bg-slate-500/10"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
                >
                  Simpan Pengaturan
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

