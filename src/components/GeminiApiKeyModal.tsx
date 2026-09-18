import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Key,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  X,
  Trash2,
  Zap,
} from "lucide-react";
import {
  getCustomGeminiApiKey,
  saveCustomGeminiApiKey,
  removeCustomGeminiApiKey,
} from "../utils/storage";
import {
  checkGeminiStatus,
  testGeminiConnection,
  GeminiStatusResult,
  GeminiTestResult,
} from "../utils/geminiApi";

interface GeminiApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeyUpdated?: () => void;
}

export const GeminiApiKeyModal: React.FC<GeminiApiKeyModalProps> = ({
  isOpen,
  onClose,
  onKeyUpdated,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [testResult, setTestResult] = useState<GeminiTestResult | null>(null);
  const [serverStatus, setServerStatus] = useState<GeminiStatusResult | null>(null);

  const fetchStatus = async () => {
    setIsCheckingStatus(true);
    try {
      const status = await checkGeminiStatus();
      setServerStatus(status);
    } catch (e) {
      console.error("Failed to check Gemini API status", e);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const existing = getCustomGeminiApiKey();
      setApiKeyInput(existing);
      setTestResult(null);
      fetchStatus();
    }
  }, [isOpen]);

  const handleTestConnection = async (keyToTest?: string) => {
    const key = keyToTest !== undefined ? keyToTest : apiKeyInput.trim();
    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await testGeminiConnection(key);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || "Gagal menghubungi Gemini API.",
      });
    } finally {
      setIsTesting(false);
      fetchStatus();
    }
  };

  const handleSaveKey = async () => {
    const trimmed = apiKeyInput.trim();
    saveCustomGeminiApiKey(trimmed);
    if (onKeyUpdated) onKeyUpdated();
    await handleTestConnection(trimmed);
  };

  const handleRemoveCustomKey = async () => {
    removeCustomGeminiApiKey();
    setApiKeyInput("");
    setTestResult(null);
    if (onKeyUpdated) onKeyUpdated();
    await fetchStatus();
  };

  if (!isOpen) return null;

  return (
    <div
      id="gemini-api-key-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-[#121214] border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col text-slate-200">
        {/* Header */}
        <div className="p-6 border-b border-slate-800/80 flex items-center justify-between bg-[#161618]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Hubungkan Kunci API Gemini
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/50 text-indigo-300">
                  3.7 Flash
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Konfigurasi integrasi Google Gemini AI untuk pembuatan soal otomatis & analisis remedial
              </p>
            </div>
          </div>
          <button
            id="close-gemini-modal-btn"
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Active Status Banner */}
          <div className="p-4 rounded-2xl bg-[#1a1a1c] border border-slate-800/80 flex items-start gap-3">
            {serverStatus?.configured ? (
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                <AlertCircle className="w-4 h-4" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white">
                  {serverStatus?.configured
                    ? serverStatus.source === "custom"
                      ? "Kunci API Kustom Terhubung"
                      : "Kunci API Lingkungan Terhubung"
                    : "Kunci API Belum Terhubung"}
                </span>
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    serverStatus?.configured
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  }`}
                >
                  {serverStatus?.configured ? "Siap Digunakan" : "Perlu Konfigurasi"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {serverStatus?.configured
                  ? `Model aktif: ${serverStatus.model || "gemini-3.8-flash"} (${serverStatus.maskedKey || "Kunci Aktif"})`
                  : "Masukkan kunci API Gemini Anda di bawah untuk mengaktifkan seluruh fitur kecerdasan buatan."}
              </p>
            </div>
          </div>

          {/* API Key Input Form */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-indigo-400" />
                <span>Google Gemini API Key</span>
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline font-medium"
              >
                <span>Dapatkan Kunci Gratis di Google AI Studio</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="relative">
              <input
                id="gemini-api-key-input"
                type={showKey ? "text" : "password"}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Tempelkan API Key (contoh: AIzaSy...)"
                className="w-full pl-3.5 pr-20 py-2.5 bg-[#1a1a1c] border border-slate-700/80 rounded-xl text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 cursor-pointer"
                  title={showKey ? "Sembunyikan Kunci" : "Tampilkan Kunci"}
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {apiKeyInput && (
                  <button
                    type="button"
                    onClick={() => setApiKeyInput("")}
                    className="p-1.5 text-slate-400 hover:text-rose-400 rounded-md hover:bg-slate-800 cursor-pointer"
                    title="Kosongkan"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Kunci API disimpan secara aman di browser Anda dan dikirimkan ke server backend untuk memproses permintaan soal ujian & analisis remedial.
            </p>
          </div>

          {/* Test Connection Results */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 ${
                testResult.success
                  ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-300"
                  : "bg-rose-500/10 border border-rose-500/25 text-rose-300"
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold flex items-center justify-between gap-2">
                  <span>{testResult.success ? "Koneksi Berhasil!" : "Koneksi Gagal"}</span>
                  {testResult.latencyMs !== undefined && (
                    <span className="text-[10px] font-mono opacity-80">
                      {testResult.latencyMs} ms
                    </span>
                  )}
                </div>
                <p className="text-[11px] mt-0.5 opacity-90">{testResult.message}</p>
              </div>
            </div>
          )}

          {/* Security Assurance Card */}
          <div className="p-3 bg-[#161618] rounded-xl border border-slate-800/80 flex items-center gap-2.5 text-slate-400 text-xs">
            <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="text-[11px]">
              Kunci API terlindungi dengan enkripsi transmisi TLS/HTTPS dan diproses secara server-side.
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-slate-800/80 bg-[#161618] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {getCustomGeminiApiKey() && (
              <button
                id="reset-custom-key-btn"
                type="button"
                onClick={handleRemoveCustomKey}
                className="px-3 py-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Kunci Kustom</span>
              </button>
            )}
            <button
              id="test-connection-btn"
              type="button"
              onClick={() => handleTestConnection()}
              disabled={isTesting}
              className="px-3.5 py-2 bg-[#1a1a1c] hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
            >
              {isTesting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  <span>Menguji...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Uji Koneksi</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#1a1a1c] hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Tutup
            </button>
            <button
              id="save-gemini-key-btn"
              type="button"
              onClick={handleSaveKey}
              disabled={isTesting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-950 flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Simpan & Hubungkan</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
