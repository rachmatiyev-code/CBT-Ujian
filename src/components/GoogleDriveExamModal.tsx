import React, { useState, useEffect } from "react";
import {
  X,
  Cloud,
  CloudUpload,
  CloudDownload,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Sparkles,
  ShieldCheck,
  Check,
  Copy,
  Link2,
  FileCode,
  Globe,
  Database,
  Trash2,
} from "lucide-react";
import { ExamPackage, StudentTokenItem } from "../types";
import {
  GoogleDriveExamItem,
  listExamsFromGoogleDrive,
  saveExamToGoogleDrive,
  loadExamFromGoogleDrive,
  extractGoogleDriveFileId,
  formatExamDriveFileName,
  cleanupDuplicateDriveFiles,
} from "../utils/googleDrive";
import {
  getCachedAccessToken,
  formatGoogleAuthErrorMessage,
} from "../utils/googleAuth";
import {
  isGasConfigured,
  getGasConfig,
  saveGasConfig,
  testGasConnection,
  syncExamToGAS,
  fetchExamFromGAS,
  listExamsFromGAS,
  getGasBackendCode,
  cleanupGasDriveDuplicates,
} from "../utils/gasService";
import { getExamPackages, saveExamPackages, getStudentTokens } from "../utils/storage";

interface GoogleDriveExamModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeExam: ExamPackage;
  onUpdateExam: (updated: ExamPackage) => void;
  onSelectExam?: (exam: ExamPackage) => void;
  tokens?: StudentTokenItem[];
}

export const GoogleDriveExamModal: React.FC<GoogleDriveExamModalProps> = ({
  isOpen,
  onClose,
  activeExam,
  onUpdateExam,
  onSelectExam,
  tokens = [],
}) => {
  const [gasConfig, setGasConfig] = useState(() => getGasConfig());
  const [gasUrlInput, setGasUrlInput] = useState(gasConfig.webAppUrl || "");
  const [isEditingGasUrl, setIsEditingGasUrl] = useState(!gasConfig.webAppUrl);
  const [isTestingGas, setIsTestingGas] = useState(false);
  const [isSavingGasUrl, setIsSavingGasUrl] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [gasScriptCode, setGasScriptCode] = useState<string>("");
  const [copiedScript, setCopiedScript] = useState(false);

  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  const [driveExams, setDriveExams] = useState<GoogleDriveExamItem[]>([]);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Paste Google Drive Link states
  const [driveLinkInput, setDriveLinkInput] = useState("");
  const [isLoadingFromLink, setIsLoadingFromLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);

  const handleCleanupDuplicates = async () => {
    if (
      !confirm(
        "Bersihkan file duplikat (seperti file ganda Naskah_Soal_CBT.json) di Google Drive? Sistem akan mempertahankan 1 file terbaru per naskah ujian dan memindahkan file duplikat lama ke Sampah (Trash)."
      )
    ) {
      return;
    }
    setIsCleaningDuplicates(true);
    setStatusMsg(null);
    try {
      let trashedTotal = 0;
      let executed = false;

      if (isGasConfigured()) {
        const gasClean = await cleanupGasDriveDuplicates();
        if (gasClean.success) {
          trashedTotal += gasClean.trashedCount || 0;
          executed = true;
        }
      }

      const token = getCachedAccessToken();
      if (token) {
        const driveClean = await cleanupDuplicateDriveFiles(token);
        trashedTotal += driveClean.trashedCount || 0;
        executed = true;
      }

      if (executed) {
        setStatusMsg({
          type: "success",
          text: `✓ Pembersihan berhasil! ${trashedTotal} file duplikat lama dipindahkan ke Sampah Google Drive. Setiap naskah kini memiliki 1 file unik terbaru.`,
        });
        await fetchExamsList();
      } else {
        setStatusMsg({
          type: "info",
          text: "Silakan hubungkan Web App Google Apps Script atau aktifkan Google Drive untuk menjalankan pembersihan duplikat.",
        });
      }
    } catch (err: any) {
      setStatusMsg({
        type: "error",
        text: err?.message || "Gagal membersihkan file duplikat di Google Drive.",
      });
    } finally {
      setIsCleaningDuplicates(false);
    }
  };

  // Load GAS script code on demand
  useEffect(() => {
    if (showCodeModal && !gasScriptCode) {
      getGasBackendCode().then(setGasScriptCode).catch(() => {});
    }
  }, [showCodeModal, gasScriptCode]);

  // Fetch exams list from Google Apps Script or cached OAuth
  const fetchExamsList = async () => {
    setIsLoadingList(true);
    try {
      if (isGasConfigured()) {
        const res = await listExamsFromGAS();
        if (res && res.success && Array.isArray(res.exams)) {
          const formatted: GoogleDriveExamItem[] = res.exams.map((ex: any) => ({
            id: ex.id || ex.code || `gas_${Date.now()}`,
            name: `${ex.title || "Naskah Soal"} (${ex.code || "-"})`,
            createdTime: ex.createdAt || ex.updatedAt || new Date().toISOString(),
            modifiedTime: ex.updatedAt || new Date().toISOString(),
            size: undefined,
            webViewLink: ex.sheetUrl || undefined,
            examCode: ex.code,
            examTitle: ex.title,
            questionCount: ex.questionsCount || ex.totalQuestions || 0,
            subject: ex.subject,
            classLevel: ex.classLevel,
          }));
          setDriveExams(formatted);
          return;
        }
      }

      // Fallback: If cached OAuth token exists
      const token = getCachedAccessToken();
      if (token) {
        const list = await listExamsFromGoogleDrive(token);
        setDriveExams(list);
      }
    } catch (err: any) {
      console.warn("Fetch exams error:", err);
      setStatusMsg({
        type: "error",
        text: `Gagal memuat naskah soal: ${err?.message || "Koneksi terputus"}`,
      });
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const cfg = getGasConfig();
      setGasConfig(cfg);
      setGasUrlInput(cfg.webAppUrl || "");
      setIsEditingGasUrl(!cfg.webAppUrl);
      if (cfg.webAppUrl) {
        fetchExamsList();
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle Save & Test Google Apps Script Web App URL
  const handleSaveGasUrl = async (testAfter = false) => {
    const cleanUrl = gasUrlInput.trim();
    if (!cleanUrl) {
      setStatusMsg({ type: "error", text: "Silakan masukkan Web App URL Google Apps Script Anda." });
      return;
    }

    if (!cleanUrl.startsWith("https://script.google.com/macros/s/")) {
      setStatusMsg({
        type: "error",
        text: "Format URL tidak valid. Web App URL harus diawali dengan 'https://script.google.com/macros/s/...' dan berakhiran '/exec'.",
      });
      return;
    }

    setIsSavingGasUrl(true);
    setStatusMsg(null);

    try {
      saveGasConfig({ webAppUrl: cleanUrl, connected: true });
      setGasConfig(getGasConfig());
      setIsEditingGasUrl(false);

      if (testAfter) {
        setIsTestingGas(true);
        const testRes = await testGasConnection(cleanUrl);
        setIsTestingGas(false);

        if (testRes.success) {
          setStatusMsg({
            type: "success",
            text: `✓ Koneksi Google Drive via Apps Script berhasil! Folder 'CBT SlideExam Database' & Spreadsheet aktif.`,
          });
          await fetchExamsList();
        } else {
          setStatusMsg({
            type: "error",
            text: `Uji koneksi gagal: ${testRes.message}. Pastikan deployment disetel 'Execute as: Me' dan 'Who has access: Anyone'.`,
          });
        }
      } else {
        setStatusMsg({
          type: "success",
          text: "URL Google Apps Script berhasil disimpan. Sistem siap menyimpan naskah ke Google Drive guru!",
        });
        await fetchExamsList();
      }
    } catch (err: any) {
      setStatusMsg({
        type: "error",
        text: `Gagal menyimpan konfigurasi: ${err?.message || "Terjadi kesalahan"}`,
      });
    } finally {
      setIsSavingGasUrl(false);
      setIsTestingGas(false);
    }
  };

  // Test active GAS connection
  const handleTestConnection = async () => {
    if (!gasConfig.webAppUrl) {
      setStatusMsg({ type: "error", text: "URL Google Apps Script belum disetel." });
      return;
    }
    setIsTestingGas(true);
    setStatusMsg(null);
    try {
      const res = await testGasConnection();
      if (res.success) {
        setStatusMsg({
          type: "success",
          text: `✓ Koneksi Google Drive aktif & siap digunakan! Subfolder naskah soal dan spreadsheet terhubung.`,
        });
        await fetchExamsList();
      } else {
        setStatusMsg({
          type: "error",
          text: `Uji koneksi gagal: ${res.message}. Pastikan akses deployment Web App disetel 'Anyone'.`,
        });
      }
    } catch (e: any) {
      setStatusMsg({
        type: "error",
        text: `Koneksi gagal: ${e?.message || "Periksa koneksi internet"}`,
      });
    } finally {
      setIsTestingGas(false);
    }
  };

  // Save current active exam to Google Drive
  const handleSaveActiveExam = async () => {
    setIsSaving(true);
    setStatusMsg(null);
    try {
      if (isGasConfigured()) {
        const effectiveTokens = (tokens && tokens.length > 0)
          ? tokens
          : (activeExam.tokens && activeExam.tokens.length > 0)
            ? activeExam.tokens
            : getStudentTokens();

        const gasRes = await syncExamToGAS(activeExam, effectiveTokens);
        if (gasRes && gasRes.success) {
          const updatedExam: ExamPackage = {
            ...activeExam,
            tokens: effectiveTokens,
            gdriveSyncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...(gasRes.fileUrl ? { gdriveWebViewLink: gasRes.fileUrl } : {}),
          };
          onUpdateExam(updatedExam);

          // Update storage
          const all = getExamPackages();
          const idx = all.findIndex((e) => e.id === updatedExam.id);
          if (idx >= 0) all[idx] = updatedExam;
          else all.unshift(updatedExam);
          saveExamPackages(all);

          setGasConfig(getGasConfig());

          const qCount = gasRes.questionsCount || activeExam.questions.length;
          const sCount = gasRes.studentsCount !== undefined ? gasRes.studentsCount : effectiveTokens.length;

          setStatusMsg({
            type: "success",
            text: `✓ Naskah Soal & Data Siswa Berhasil Ditulis ke Google Sheets! (${qCount} Butir Soal di Data_Bank_Soal • ${sCount} Siswa di Data_Siswa_Dan_Kelas)`,
          });
          await fetchExamsList();
          return;
        } else {
          throw new Error(gasRes?.message || "Gagal menyimpan naskah ke Apps Script.");
        }
      }

      // Check if OAuth token cached
      const token = getCachedAccessToken();
      if (token) {
        const res = await saveExamToGoogleDrive(token, activeExam);
        const updatedExam: ExamPackage = {
          ...activeExam,
          gdriveFileId: res.fileId,
          gdriveWebViewLink: res.webViewLink,
          gdriveDownloadLink: res.downloadUrl,
          gdriveSyncedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        onUpdateExam(updatedExam);
        setStatusMsg({
          type: "success",
          text: `✓ Naskah Soal "${activeExam.title}" tersimpan di Google Drive!`,
        });
        await fetchExamsList();
        return;
      }

      // If neither is configured, show configuration prompt
      setIsEditingGasUrl(true);
      setStatusMsg({
        type: "info",
        text: "Silakan masukkan Web App URL Google Apps Script Anda di atas untuk langsung menyimpan naskah ke Google Drive guru (100% Bebas Google Cloud & Bebas Firebase).",
      });
    } catch (err: any) {
      setStatusMsg({
        type: "error",
        text: formatGoogleAuthErrorMessage(err) || err?.message || "Gagal menyimpan naskah ke Google Drive.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Load Exam from Google Drive / GAS into current session
  const handleLoadExam = async (item: GoogleDriveExamItem) => {
    if (!confirm(`Muat naskah soal "${item.name}" dari Google Drive ke editor dan sesi CBT saat ini?`)) {
      return;
    }

    setLoadingFileId(item.id);
    setStatusMsg(null);
    try {
      let loadedExam: ExamPackage | null = null;

      // 1. Try loading via GAS if examCode is present
      if (isGasConfigured() && item.examCode) {
        const gasData = await fetchExamFromGAS(item.examCode);
        if (gasData && gasData.success && gasData.exam) {
          loadedExam = gasData.exam;
        }
      }

      // 2. Try loading via file loader if file ID is valid Google Drive file ID
      if (!loadedExam) {
        const token = getCachedAccessToken();
        loadedExam = await loadExamFromGoogleDrive(token || null, item.id);
      }

      if (!loadedExam) {
        throw new Error("Tidak dapat mengunduh data naskah soal dari Google Drive.");
      }

      onUpdateExam(loadedExam);
      if (onSelectExam) {
        onSelectExam(loadedExam);
      }

      setStatusMsg({
        type: "success",
        text: `✓ Naskah Soal "${loadedExam.title}" (${loadedExam.questions.length} butir) berhasil dimuat ke editor!`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: "error",
        text: formatGoogleAuthErrorMessage(err) || "Gagal memuat naskah soal dari Google Drive.",
      });
    } finally {
      setLoadingFileId(null);
    }
  };

  // Load Exam directly from pasted Google Drive link or file ID
  const handleLoadFromLink = async () => {
    const rawInput = driveLinkInput.trim();
    if (!rawInput) {
      setLinkError("Silakan masukkan tautan (link) Google Drive atau ID file naskah soal.");
      return;
    }

    setLinkError(null);
    setIsLoadingFromLink(true);
    setStatusMsg(null);

    try {
      const extracted = extractGoogleDriveFileId(rawInput);
      if (extracted.error || !extracted.fileId) {
        setLinkError(extracted.error || "Format tautan Google Drive tidak valid.");
        setIsLoadingFromLink(false);
        return;
      }

      const token = getCachedAccessToken();
      const loadedExam = await loadExamFromGoogleDrive(token || null, extracted.fileId);
      if (!loadedExam || !Array.isArray(loadedExam.questions) || loadedExam.questions.length === 0) {
        throw new Error("File naskah soal berhasil diunduh namun tidak memuat butir soal yang valid.");
      }

      const updatedExam: ExamPackage = {
        ...loadedExam,
        gdriveFileId: extracted.fileId,
        gdriveSyncedAt: new Date().toISOString(),
      };

      const allExams = getExamPackages();
      const existingIdx = allExams.findIndex(
        (e) =>
          e.id === updatedExam.id ||
          (updatedExam.code && e.code === updatedExam.code) ||
          e.gdriveFileId === extracted.fileId
      );

      if (existingIdx >= 0) {
        allExams[existingIdx] = updatedExam;
      } else {
        allExams.unshift(updatedExam);
      }
      saveExamPackages(allExams);

      onUpdateExam(updatedExam);
      if (onSelectExam) {
        onSelectExam(updatedExam);
      }

      setStatusMsg({
        type: "success",
        text: `✓ Berhasil memuat naskah soal "${updatedExam.title}" (${updatedExam.questions.length} butir soal, Kode: ${updatedExam.code || "-"}) dari Google Drive!`,
      });
      setDriveLinkInput("");
    } catch (err: any) {
      const errMsg = err?.message || "Gagal memuat naskah soal dari tautan Google Drive tersebut. Pastikan izin file disetel publik ('Siapa saja yang memiliki link').";
      setLinkError(errMsg);
      setStatusMsg({
        type: "error",
        text: errMsg,
      });
    } finally {
      setIsLoadingFromLink(false);
    }
  };

  // Sync all local exams in batch
  const handleSyncAllExams = async () => {
    if (!isGasConfigured()) {
      setIsEditingGasUrl(true);
      setStatusMsg({ type: "info", text: "Atur Web App URL Google Apps Script di atas untuk mencadangkan seluruh naskah ke Google Drive." });
      return;
    }

    const allExams = getExamPackages();
    if (allExams.length === 0) {
      setStatusMsg({ type: "info", text: "Tidak ada paket naskah soal lokal untuk disinkronkan." });
      return;
    }

    setIsSyncingAll(true);
    setStatusMsg(null);
    let successCount = 0;

    try {
      const updatedList: ExamPackage[] = [...allExams];
      for (let i = 0; i < allExams.length; i++) {
        const ex = allExams[i];
        try {
          const gasRes = await syncExamToGAS(ex, ex.tokens);
          if (gasRes && gasRes.success) {
            updatedList[i] = {
              ...ex,
              gdriveSyncedAt: new Date().toISOString(),
              ...(gasRes.fileUrl ? { gdriveWebViewLink: gasRes.fileUrl } : {}),
            };
            successCount++;
          }
        } catch (itemErr) {
          console.warn("Could not sync exam to Drive:", ex.title, itemErr);
        }
      }

      saveExamPackages(updatedList);
      const activeIdx = updatedList.findIndex((e) => e.id === activeExam.id);
      if (activeIdx >= 0) {
        onUpdateExam(updatedList[activeIdx]);
      }

      await fetchExamsList();
      setStatusMsg({
        type: "success",
        text: `✓ Berhasil menyimpan ${successCount} dari ${allExams.length} naskah soal ke Google Drive (Folder Data Soal)!`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: "error",
        text: err?.message || "Gagal menyinkronkan semua naskah ke Google Drive.",
      });
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleCopyLink = (item: GoogleDriveExamItem) => {
    const link = item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`;
    navigator.clipboard.writeText(link);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 3000);
  };

  const isConnected = isGasConfigured();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#121214] border border-slate-800 rounded-3xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-800/80 flex items-center justify-between bg-[#16161a]">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-md">
              <Cloud className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <span>Penyimpanan Google Drive & Cloud Database</span>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Bebas Google Cloud / OAuth
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Simpan, cadangkan, dan muat naskah soal langsung ke Google Drive & Sheets guru tanpa registrasi GCP.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-300 text-sm">
          {/* Status Message */}
          {statusMsg && (
            <div
              className={`p-4 rounded-2xl border flex items-start gap-3 animate-in fade-in ${
                statusMsg.type === "success"
                  ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-200"
                  : statusMsg.type === "error"
                  ? "bg-rose-950/40 border-rose-500/30 text-rose-200"
                  : "bg-indigo-950/40 border-indigo-500/30 text-indigo-200"
              }`}
            >
              {statusMsg.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
              {statusMsg.type === "error" && <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
              {statusMsg.type === "info" && <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />}
              <div className="flex-1 text-xs leading-relaxed font-medium">{statusMsg.text}</div>
            </div>
          )}

          {/* Card 1: Google Apps Script Web App Connection (Zero OAuth / No GCP) */}
          <div className="p-5 bg-[#18181c] border border-indigo-500/30 rounded-2xl space-y-3.5 shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                  isConnected ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                }`}>
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-white text-sm flex items-center gap-2">
                    <span>Integrasi Google Drive & Apps Script Guru</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                      isConnected ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                    }`}>
                      {isConnected ? "TERHUBUNG" : "BELUM DIHUBUNGKAN"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    100% Bebas Google Cloud & Firebase. Script berjalan langsung di akun Google Drive guru dengan akses folder otomatis.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCodeModal(true)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>Kode Script (Code.gs)</span>
              </button>
            </div>

            {/* Input or Connected Status */}
            {isEditingGasUrl ? (
              <div className="space-y-2 pt-1">
                <label className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Web App URL Google Apps Script:</span>
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={gasUrlInput}
                    onChange={(e) => setGasUrlInput(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="flex-1 px-3.5 py-2.5 bg-black/50 border border-slate-700 focus:border-indigo-500 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 font-mono transition-all"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveGasUrl(true)}
                      disabled={isSavingGasUrl || isTestingGas || !gasUrlInput.trim()}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-md shadow-emerald-950 shrink-0"
                    >
                      {isTestingGas ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      <span>{isTestingGas ? "Menguji..." : "Simpan & Hubungkan"}</span>
                    </button>
                    {gasConfig.webAppUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setGasUrlInput(gasConfig.webAppUrl);
                          setIsEditingGasUrl(false);
                        }}
                        className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium cursor-pointer"
                      >
                        Batal
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-black/40 border border-slate-800 rounded-xl text-xs">
                <div className="space-y-0.5 truncate">
                  <div className="text-slate-400 text-[11px]">URL Web App Aktif:</div>
                  <div className="font-mono text-emerald-400 truncate max-w-lg">{gasConfig.webAppUrl}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTestingGas}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 rounded-lg font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isTestingGas ? "animate-spin text-indigo-400" : ""}`} />
                    <span>{isTestingGas ? "Menguji..." : "Uji Koneksi"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingGasUrl(true)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg font-semibold cursor-pointer"
                  >
                    Ganti URL
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Card 2: Active Exam Quick Save Section */}
          <div className="p-5 bg-gradient-to-r from-indigo-950/30 via-purple-950/20 to-slate-900/40 border border-indigo-500/30 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-full border border-indigo-500/20">
                  Naskah Soal yang Sedang Aktif
                </span>
                <h3 className="text-base font-bold text-white mt-1">{activeExam.title}</h3>
                <p className="text-xs text-slate-400">
                  {activeExam.teacherProfile.subject} • Kode: <strong className="font-mono text-emerald-400">{activeExam.code}</strong> • {activeExam.questions.length} Butir Soal ({activeExam.totalScore} Poin)
                </p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-300 bg-black/40 border border-slate-700/60 px-2.5 py-1 rounded-lg font-mono">
                    Nama File: <strong>{formatExamDriveFileName(activeExam)}</strong>
                  </span>
                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <Check className="w-3 h-3 text-emerald-400" />
                    Pembaruan Langsung (Bebas Duplikat)
                  </span>
                </div>
              </div>

              <button
                onClick={handleSaveActiveExam}
                disabled={isSaving}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-950 cursor-pointer shrink-0"
              >
                <CloudUpload className={`w-4 h-4 ${isSaving ? "animate-bounce" : ""}`} />
                <span>{isSaving ? "Menyimpan ke Drive..." : activeExam.gdriveSyncedAt ? "Perbarui di Google Drive" : "Simpan ke Google Drive"}</span>
              </button>
            </div>

            {activeExam.gdriveSyncedAt && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 px-3 py-2 rounded-xl">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-semibold">
                    Tersinkron ke Google Drive & Sheets • {new Date(activeExam.gdriveSyncedAt).toLocaleString("id-ID")}
                  </span>
                  {activeExam.gdriveWebViewLink && (
                    <a
                      href={activeExam.gdriveWebViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-semibold underline text-[11px]"
                    >
                      <span>Lihat File JSON Soal</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {/* Direct Links to Google Sheets Databases */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <a
                    href={gasConfig.sheets?.soal?.url || `https://drive.google.com/drive/search?q=${encodeURIComponent("Data_Bank_Soal")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2.5 bg-slate-900/80 hover:bg-slate-800/90 border border-amber-500/30 hover:border-amber-500/50 rounded-xl flex items-center justify-between transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                        <Database className="w-3.5 h-3.5" />
                      </div>
                      <div className="text-left">
                        <div className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">
                          Data_Bank_Soal
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Sheet: Paket_Ujian & Butir_Soal
                        </div>
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-amber-300" />
                  </a>

                  <a
                    href={gasConfig.sheets?.siswa?.url || `https://drive.google.com/drive/search?q=${encodeURIComponent("Data_Siswa_Dan_Kelas")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2.5 bg-slate-900/80 hover:bg-slate-800/90 border border-emerald-500/30 hover:border-emerald-500/50 rounded-xl flex items-center justify-between transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                        <Database className="w-3.5 h-3.5" />
                      </div>
                      <div className="text-left">
                        <div className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors">
                          Data_Siswa_Dan_Kelas
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Sheet: Roster_Siswa & Token_Ujian
                        </div>
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-300" />
                  </a>
                </div>

                {/* Panduan jika spreadsheet masih kosong */}
                <div className="p-3 bg-amber-950/20 border border-amber-500/20 rounded-xl space-y-1.5 text-xs text-amber-200/90">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300 text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Catatan Jika Spreadsheet di Google Drive Anda Masih Kosong:</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-300">
                    Jika spreadsheet sudah terbuat di Drive tetapi isinya masih kosong, biasanya dikarenakan script di Google Apps Script Anda belum diperbarui ke versi terbaru. Buka tombol <strong>Kode Script (Code.gs)</strong> di kanan atas, salin kode terbaru, lalu di Google Apps Script klik <strong>Deploy &rarr; Kelola Deployment &rarr; Edit (pensil) &rarr; Versi Baru &rarr; Terapkan</strong>, lalu klik kembali tombol <strong>Perbarui di Google Drive</strong> di atas.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Card 3: Tempel Link Naskah Soal dari Google Drive (Akses Cepat Publik) */}
          <div className="p-5 bg-[#18181c] border border-slate-800 rounded-2xl space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                <Link2 className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <div className="font-bold text-white text-sm flex items-center gap-2">
                  <span>Tempel Link Naskah Soal dari Google Drive</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
                    Akses Langsung
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Tempelkan link berbagi (share link) file naskah .json dari Google Drive di sini untuk memuat soal seketika.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={driveLinkInput}
                  onChange={(e) => {
                    setDriveLinkInput(e.target.value);
                    if (linkError) setLinkError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleLoadFromLink();
                    }
                  }}
                  placeholder="https://drive.google.com/file/d/1A2b3c4d5e.../view?usp=sharing atau ID file"
                  className="w-full px-3.5 py-2.5 bg-black/40 border border-slate-700/80 focus:border-indigo-500 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 font-mono transition-all pr-8"
                />
                {driveLinkInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setDriveLinkInput("");
                      setLinkError(null);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleLoadFromLink}
                disabled={isLoadingFromLink || !driveLinkInput.trim()}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-950 cursor-pointer shrink-0"
              >
                {isLoadingFromLink ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Memuat Soal...</span>
                  </>
                ) : (
                  <>
                    <CloudDownload className="w-4 h-4" />
                    <span>Muat Naskah Soal</span>
                  </>
                )}
              </button>
            </div>

            {linkError && (
              <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-500/30 px-3 py-2 rounded-xl animate-in fade-in">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{linkError}</span>
              </div>
            )}
          </div>

          {/* Card 4: Stored Google Drive Exams List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-amber-400" />
                <span>Daftar Naskah Soal di Google Drive ({driveExams.length})</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCleanupDuplicates}
                  disabled={isCleaningDuplicates}
                  className="px-2.5 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Pindai dan bersihkan file naskah duplikat lama ke Trash Google Drive"
                >
                  <Trash2 className={`w-3.5 h-3.5 ${isCleaningDuplicates ? "animate-spin" : ""}`} />
                  <span>{isCleaningDuplicates ? "Membersihkan..." : "Bersihkan Duplikat"}</span>
                </button>
                {isConnected && (
                  <button
                    onClick={handleSyncAllExams}
                    disabled={isSyncingAll}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Simpan seluruh naskah lokal ke Google Drive"
                  >
                    <CloudUpload className={`w-3.5 h-3.5 ${isSyncingAll ? "animate-spin" : ""}`} />
                    <span>{isSyncingAll ? "Menyinkronkan..." : "Sinkron Semua"}</span>
                  </button>
                )}
                <button
                  onClick={fetchExamsList}
                  disabled={isLoadingList}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition-colors cursor-pointer"
                  title="Segarkan daftar"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? "animate-spin text-indigo-400" : ""}`} />
                </button>
              </div>
            </div>

            {isLoadingList ? (
              <div className="p-8 text-center bg-[#16161a] rounded-2xl border border-slate-800 space-y-2">
                <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin mx-auto" />
                <p className="text-xs text-slate-400">Memuat daftar naskah soal dari Google Drive...</p>
              </div>
            ) : !isConnected ? (
              <div className="p-8 text-center bg-[#16161a] rounded-2xl border border-slate-800 space-y-3">
                <Cloud className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Hubungkan URL Google Apps Script Anda di atas untuk melihat naskah soal yang tersimpan di Google Drive guru.
                </p>
                <button
                  onClick={() => setIsEditingGasUrl(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold inline-flex items-center gap-2 cursor-pointer shadow-md"
                >
                  <Cloud className="w-4 h-4" />
                  <span>Atur Web App URL</span>
                </button>
              </div>
            ) : driveExams.length === 0 ? (
              <div className="p-8 text-center bg-[#16161a] rounded-2xl border border-slate-800 space-y-2">
                <FolderOpen className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400">
                  Belum ada naskah soal yang terdaftar di Google Drive / Spreadsheet Anda.
                </p>
                <p className="text-[11px] text-indigo-400">
                  Klik tombol <strong>"Simpan ke Google Drive"</strong> di atas untuk menyimpan naskah aktif pertama Anda.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {driveExams.map((item) => {
                  const isCurrentActive = activeExam.gdriveFileId === item.id || activeExam.code === item.examCode;

                  return (
                    <div
                      key={item.id}
                      className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isCurrentActive
                          ? "bg-indigo-950/20 border-indigo-500/40 shadow-sm shadow-indigo-950/50"
                          : "bg-[#18181c] hover:bg-[#1e1e24] border-slate-800"
                      }`}
                    >
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white text-xs truncate">
                            {item.examTitle || item.name}
                          </span>
                          {item.examCode && (
                            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-bold">
                              {item.examCode}
                            </span>
                          )}
                          {isCurrentActive && (
                            <span className="text-[9px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-extrabold border border-indigo-500/30">
                              SEDANG DIBUKA
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                          {item.subject && <span>Mata Pelajaran: {item.subject}</span>}
                          {item.questionCount !== undefined && <span>• {item.questionCount} Soal</span>}
                          <span>• Diperbarui: {new Date(item.modifiedTime).toLocaleString("id-ID")}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {/* Load Button */}
                        <button
                          onClick={() => handleLoadExam(item)}
                          disabled={loadingFileId === item.id}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                          title="Muat naskah soal ini ke aplikasi CBT"
                        >
                          <CloudDownload className={`w-3.5 h-3.5 ${loadingFileId === item.id ? "animate-spin" : ""}`} />
                          <span>{loadingFileId === item.id ? "Memuat..." : "Muat Soal"}</span>
                        </button>

                        {/* Copy Link */}
                        <button
                          onClick={() => handleCopyLink(item)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all cursor-pointer"
                          title="Salin Tautan"
                        >
                          {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>

                        {/* View in Drive/Sheet */}
                        {item.webViewLink && (
                          <a
                            href={item.webViewLink}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all cursor-pointer inline-flex"
                            title="Buka di Google Drive / Spreadsheet"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-800 bg-[#16161a] flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Naskah soal tersimpan aman di Google Drive pribadi Anda, siap diakses kapan pun tanpa batas.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* Code Modal */}
      {showCodeModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in">
          <div className="bg-[#141418] border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-[#18181e]">
              <div className="flex items-center gap-2">
                <FileCode className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Kode Script Backend (Code.gs)</h3>
              </div>
              <button
                onClick={() => setShowCodeModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-3 text-xs text-slate-300 flex-1">
              <div className="p-3 bg-indigo-950/30 border border-indigo-500/30 rounded-xl space-y-2">
                <div className="font-bold text-white text-xs">Petunjuk Penggunaan / Pembaruan Script:</div>
                <div className="space-y-1.5 text-slate-300 text-[11px]">
                  <div className="font-semibold text-emerald-300">A. Untuk Deployment Baru:</div>
                  <ol className="list-decimal list-inside space-y-0.5 pl-1">
                    <li>Buka <a href="https://script.google.com" target="_blank" rel="noreferrer" className="text-indigo-400 underline font-semibold">script.google.com</a> &rarr; Proyek Baru.</li>
                    <li>Salin & tempel kode script di bawah ke file <code className="text-emerald-300">Code.gs</code>.</li>
                    <li>Klik <strong>Deploy (Terapkan)</strong> &rarr; <strong>Deployment Baru</strong> &rarr; Pilih <strong>Aplikasi Web</strong>.</li>
                    <li>Setel <em>Who has access</em>: <strong>Anyone (Siapa saja)</strong> &rarr; Klik <strong>Deploy</strong>.</li>
                    <li>Salin Web App URL (akhiran <code>/exec</code>) ke aplikasi ini.</li>
                  </ol>

                  <div className="font-semibold text-amber-300 pt-1">B. Jika Sudah Pernah Deploy & Spreadsheet Masih Kosong:</div>
                  <ol className="list-decimal list-inside space-y-0.5 pl-1 text-amber-100/90">
                    <li>Salin kode script terbaru di bawah ini ke <code className="text-white font-mono">Code.gs</code> di Apps Script Anda lalu simpan.</li>
                    <li>Klik <strong>Deploy (Terapkan)</strong> &rarr; pilih <strong>Kelola Deployment (Manage deployments)</strong>.</li>
                    <li>Klik ikon pensil <strong>Edit</strong> di kanan atas dialog deployment.</li>
                    <li>Pada pilihan Versi, ganti ke <strong>Versi baru (New version)</strong>.</li>
                    <li>Klik tombol biru <strong>Terapkan (Deploy)</strong>.</li>
                    <li>Kembali ke aplikasi ini lalu klik <strong>Perbarui di Google Drive</strong>. Semua data soal & siswa akan langsung masuk ke spreadsheet!</li>
                  </ol>
                </div>
              </div>

              <div className="relative">
                <pre className="p-3 bg-black/60 border border-slate-800 rounded-xl text-[11px] font-mono text-slate-300 overflow-x-auto max-h-64 select-all">
                  {gasScriptCode || "// Memuat script..."}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(gasScriptCode);
                    setCopiedScript(true);
                    setTimeout(() => setCopiedScript(false), 2500);
                  }}
                  className="absolute top-2.5 right-2.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-md cursor-pointer"
                >
                  {copiedScript ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedScript ? "Tersalin!" : "Salin Kode"}</span>
                </button>
              </div>
            </div>
            <div className="p-3 border-t border-slate-800 bg-[#18181e] flex justify-end">
              <button
                onClick={() => setShowCodeModal(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
