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
  Trash2,
  ExternalLink,
  BookOpen,
  GraduationCap,
  Sparkles,
  Key,
  ShieldCheck,
  Check,
  Copy,
  LogOut,
  User as UserIcon,
  HardDrive,
  Link2
} from "lucide-react";
import { ExamPackage, StudentTokenItem } from "../types";
import {
  GoogleDriveExamItem,
  listExamsFromGoogleDrive,
  saveExamToGoogleDrive,
  loadExamFromGoogleDrive,
  deleteExamFromGoogleDrive,
  getOrCreateExamsSubfolder,
  extractGoogleDriveFileId,
} from "../utils/googleDrive";
import {
  googleSignIn,
  googleSignOut,
  initAuth,
  getCachedAccessToken,
  requestGoogleTokenViaGIS,
  onGoogleAuthExpired,
  isAuthExpiredError,
  formatGoogleAuthErrorMessage,
  GoogleUser,
  User,
} from "../utils/googleAuth";

import {
  isDriveAutoSyncEnabled,
  setDriveAutoSyncEnabled,
  subscribeToDriveSync,
  triggerExamAutoSyncToDrive,
  performImmediateDriveSync,
  DriveSyncState,
} from "../utils/googleDriveSync";
import { getExamPackages, saveExamPackages } from "../utils/storage";

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
  const [currentUser, setCurrentUser] = useState<User | any | null>(null);
  const [driveToken, setDriveToken] = useState<string>(() => getCachedAccessToken() || "");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [driveExams, setDriveExams] = useState<GoogleDriveExamItem[]>([]);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState<boolean>(() => isDriveAutoSyncEnabled());
  const [driveSyncState, setDriveSyncState] = useState<DriveSyncState>({ status: "idle", lastSyncedAt: null });

  // Paste Google Drive Link states
  const [driveLinkInput, setDriveLinkInput] = useState("");
  const [isLoadingFromLink, setIsLoadingFromLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Sync listener
  useEffect(() => {
    const unsub = subscribeToDriveSync((state) => {
      setDriveSyncState(state);
    });
    return () => unsub();
  }, []);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setDriveToken(token);
      },
      () => {
        setCurrentUser(null);
        setDriveToken("");
      }
    );
    const unsubExpired = onGoogleAuthExpired(() => {
      setCurrentUser(null);
      setDriveToken("");
      setStatusMsg({
        type: "error",
        text: "Sesi login Google Drive telah kedaluwarsa. Silakan hubungkan ulang akun Google Anda untuk melanjutkan.",
      });
    });
    return () => {
      unsubscribe();
      unsubExpired();
    };
  }, []);

  // Fetch Drive Exam List
  const fetchDriveExams = async (token: string) => {
    if (!token) return;
    setIsLoadingList(true);
    try {
      const list = await listExamsFromGoogleDrive(token);
      setDriveExams(list);
    } catch (err: any) {
      console.warn("Drive exams fetch error:", err);
      if (isAuthExpiredError(err)) {
        setCurrentUser(null);
        setDriveToken("");
      }
      setStatusMsg({
        type: "error",
        text: formatGoogleAuthErrorMessage(err) || "Gagal memuat naskah soal dari Google Drive.",
      });
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    if (isOpen && driveToken) {
      fetchDriveExams(driveToken);
    }
  }, [isOpen, driveToken]);

  if (!isOpen) return null;

  // Handle Google Drive Connection
  const handleConnect = async () => {
    setIsConnecting(true);
    setStatusMsg(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setCurrentUser(res.user);
        setDriveToken(res.accessToken);
        setStatusMsg({
          type: "success",
          text: `Berhasil terhubung ke Google Drive sebagai ${res.user.displayName || res.user.email || "Pengguna"}!`,
        });
        await fetchDriveExams(res.accessToken);
      }
    } catch (err: any) {
      // Fallback GIS if unauthorized domain error
      const isUnauth =
        err?.code === "auth/unauthorized-domain" ||
        err?.message?.includes("unauthorized-domain");

      if (isUnauth) {
        try {
          const gisRes = await requestGoogleTokenViaGIS();
          if (gisRes) {
            setCurrentUser(gisRes.user);
            setDriveToken(gisRes.accessToken);
            setStatusMsg({
              type: "success",
              text: `Berhasil terhubung via Google Identity Services sebagai ${gisRes.user.displayName || "Pengguna"}!`,
            });
            await fetchDriveExams(gisRes.accessToken);
            return;
          }
        } catch (gisErr: any) {
          setStatusMsg({
            type: "error",
            text: gisErr.message || "Gagal otentikasi Google Drive via GIS.",
          });
          return;
        }
      }

      setStatusMsg({
        type: "error",
        text: err?.message || "Gagal menghubungkan akun Google. Pastikan jendela pop-up diizinkan.",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await googleSignOut();
      setCurrentUser(null);
      setDriveToken("");
      setDriveExams([]);
      setStatusMsg({ type: "info", text: "Akun Google Drive berhasil diputuskan." });
    } catch (e: any) {
      console.warn("Signout error", e);
    }
  };

  // Save current active exam to Google Drive
  const handleSaveActiveExam = async () => {
    if (!driveToken) {
      await handleConnect();
      return;
    }

    setIsSaving(true);
    setStatusMsg(null);
    try {
      const res = await saveExamToGoogleDrive(driveToken, activeExam);
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
        text: `Naskah Soal "${activeExam.title}" (${activeExam.questions.length} butir) berhasil disimpan di folder SlideExam_CBT/Naskah_Soal di Google Drive!`,
      });
      await fetchDriveExams(driveToken);
    } catch (err: any) {
      if (isAuthExpiredError(err)) {
        setCurrentUser(null);
        setDriveToken("");
      }
      setStatusMsg({
        type: "error",
        text: formatGoogleAuthErrorMessage(err) || "Gagal menyimpan naskah ke Google Drive.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Load Exam from Google Drive into current session
  const handleLoadExam = async (item: GoogleDriveExamItem) => {
    if (!confirm(`Muat naskah soal "${item.name}" dari Google Drive ke editor dan sesi CBT saat ini?`)) {
      return;
    }

    setLoadingFileId(item.id);
    setStatusMsg(null);
    try {
      const loadedExam = await loadExamFromGoogleDrive(driveToken, item.id);
      onUpdateExam(loadedExam);
      if (onSelectExam) {
        onSelectExam(loadedExam);
      }
      setStatusMsg({
        type: "success",
        text: `Naskah Soal "${loadedExam.title}" (${loadedExam.questions.length} butir) berhasil dimuat dari Google Drive!`,
      });
    } catch (err: any) {
      if (isAuthExpiredError(err)) {
        setCurrentUser(null);
        setDriveToken("");
      }
      setStatusMsg({
        type: "error",
        text: formatGoogleAuthErrorMessage(err) || "Gagal memuat naskah soal dari Google Drive.",
      });
    } finally {
      setLoadingFileId(null);
    }
  };

  // Delete Exam from Google Drive
  const handleDeleteExam = async (item: GoogleDriveExamItem) => {
    if (!confirm(`Hapus file naskah "${item.name}" secara permanen dari Google Drive?`)) {
      return;
    }

    setDeletingFileId(item.id);
    try {
      await deleteExamFromGoogleDrive(driveToken, item.id);
      setStatusMsg({
        type: "info",
        text: `File "${item.name}" berhasil dihapus dari Google Drive.`,
      });
      setDriveExams((prev) => prev.filter((ex) => ex.id !== item.id));
    } catch (err: any) {
      if (isAuthExpiredError(err)) {
        setCurrentUser(null);
        setDriveToken("");
      }
      setStatusMsg({
        type: "error",
        text: formatGoogleAuthErrorMessage(err) || "Gagal menghapus file dari Google Drive.",
      });
    } finally {
      setDeletingFileId(null);
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

      // Load exam using resilient multi-tier loader
      const loadedExam = await loadExamFromGoogleDrive(driveToken || null, extracted.fileId);
      if (!loadedExam || !Array.isArray(loadedExam.questions) || loadedExam.questions.length === 0) {
        throw new Error("File naskah soal berhasil diunduh namun tidak memuat butir soal yang valid.");
      }

      const updatedExam: ExamPackage = {
        ...loadedExam,
        gdriveFileId: extracted.fileId,
        gdriveSyncedAt: new Date().toISOString(),
      };

      // Persist into local storage packages
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

      // Notify parent & apply
      onUpdateExam(updatedExam);
      if (onSelectExam) {
        onSelectExam(updatedExam);
      }

      // Share to server registry so students can find it immediately
      try {
        await fetch("/api/exams/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exam: updatedExam,
            token: driveToken || null,
          }),
        });
      } catch {}

      // Cache locally
      try {
        localStorage.setItem(`gdrive_cache_${extracted.fileId}`, JSON.stringify(updatedExam));
        if (updatedExam.code) {
          localStorage.setItem(`gdrive_code_${updatedExam.code.toUpperCase()}`, JSON.stringify(updatedExam));
        }
      } catch {}

      setStatusMsg({
        type: "success",
        text: `Berhasil memuat naskah soal "${updatedExam.title}" (${updatedExam.questions.length} butir soal, Kode: ${updatedExam.code || "-"}) dari Google Drive!`,
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

  const handleCopyLink = (item: GoogleDriveExamItem) => {
    const link = item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`;
    navigator.clipboard.writeText(link);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 3000);
  };

  const handleToggleAutoSync = (enabled: boolean) => {
    setAutoSync(enabled);
    setDriveAutoSyncEnabled(enabled);
    if (enabled && driveToken) {
      triggerExamAutoSyncToDrive(activeExam, 500, (updated) => onUpdateExam(updated));
      setStatusMsg({
        type: "success",
        text: "Otomatisasi sinkronisasi ke Google Drive diaktifkan. Setiap perubahan soal akan otomatis tersimpan.",
      });
    } else {
      setStatusMsg({
        type: "info",
        text: "Otomatisasi sinkronisasi ke Google Drive dinonaktifkan.",
      });
    }
  };

  // Sync all local exams to Google Drive in batch
  const handleSyncAllExams = async () => {
    if (!driveToken) {
      await handleConnect();
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
          const res = await saveExamToGoogleDrive(driveToken, ex);
          updatedList[i] = {
            ...ex,
            gdriveFileId: res.fileId,
            gdriveWebViewLink: res.webViewLink,
            gdriveDownloadLink: res.downloadUrl,
            gdriveSyncedAt: new Date().toISOString(),
          };
          successCount++;
        } catch (itemErr) {
          console.warn("Could not sync exam to Drive:", ex.title, itemErr);
        }
      }

      saveExamPackages(updatedList);
      const activeIdx = updatedList.findIndex((e) => e.id === activeExam.id);
      if (activeIdx >= 0) {
        onUpdateExam(updatedList[activeIdx]);
      }

      await fetchDriveExams(driveToken);
      setStatusMsg({
        type: "success",
        text: `Berhasil menyinkronkan ${successCount} dari ${allExams.length} naskah soal ke Google Drive!`,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#121214] border border-slate-800 rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-800/80 flex items-center justify-between bg-[#16161a]">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-md">
              <Cloud className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <span>Penyimpanan Google Drive CBT</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Otomatisasi Cloud
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Simpan, muat, dan sinkronkan naskah soal secara otomatis ke Google Drive guru
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

          {/* Card: Tempel Link Naskah Soal dari Google Drive */}
          <div className="p-5 bg-gradient-to-br from-[#1b1a29] via-[#161622] to-[#121218] border border-indigo-500/40 rounded-2xl shadow-lg space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                  <Link2 className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <div className="font-bold text-white text-sm flex items-center gap-2">
                    <span>Tempel Link Naskah Soal dari Google Drive</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
                      Akses Cepat
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Jika kode soal belum terindeks otomatis, tempelkan link berbagi (share link) file naskah .json dari Google Drive di sini.
                  </p>
                </div>
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

            <div className="flex flex-col gap-1.5 text-[11px] text-slate-400 pt-0.5 border-t border-slate-800/60 mt-1">
              <div>
                💡 <strong>Petunjuk Izin:</strong> Buka file naskah di Google Drive &rarr; klik <strong>Bagikan</strong> &rarr; pastikan setelan akses <strong>"Siapa saja yang memiliki link"</strong> &rarr; Salin Link lalu tempel di sini.
              </div>
              <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200/90 text-[11px] space-y-1">
                <span className="font-bold flex items-center gap-1.5 text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  Perhatian Khusus Akun @belajar.id:
                </span>
                <p className="leading-relaxed">
                  Akun Google Workspace Kemdikbud (<strong>@belajar.id</strong>) membatasi akses file hanya untuk anggota domain organisasi sekolah. Pengguna di luar domain (atau siswa tanpa login belajar.id) akan terblokir (<em>403 Forbidden / Soal Tidak Ditemukan</em>).
                </p>
                <p className="text-slate-300 font-medium">
                  <strong>Rekomendasi:</strong> Gunakan akun Gmail pribadi (<strong>@gmail.com</strong>) untuk menyimpan naskah ujian publik, atau bagikan naskah via <strong>"Paket Anti-Gagal"</strong> di menu Bagikan Ujian (100% mandiri tanpa Google Drive).
                </p>
              </div>
            </div>
          </div>

          {/* Account Connection Card */}
          <div className="p-4 bg-[#18181c] border border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300">
                {currentUser?.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt={currentUser.displayName || "Google User"}
                    className="w-10 h-10 rounded-xl object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <UserIcon className="w-5 h-5 text-slate-400" />
                )}
              </div>
              <div>
                <div className="font-bold text-white text-sm">
                  {currentUser ? currentUser.displayName || currentUser.email || "Akun Google Terhubung" : "Google Drive Belum Terhubung"}
                </div>
                <div className="text-xs text-slate-400">
                  {currentUser
                    ? currentUser.email || "Siap menyimpan & memuat naskah soal"
                    : "Hubungkan akun Google/belajar.id untuk sinkronisasi otomatis"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {currentUser ? (
                <>
                  <button
                    onClick={() => fetchDriveExams(driveToken)}
                    disabled={isLoadingList}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Segarkan daftar soal dari Google Drive"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? "animate-spin text-indigo-400" : ""}`} />
                    <span>Segarkan</span>
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="px-3 py-2 bg-slate-800 hover:bg-rose-950/40 text-rose-400 border border-slate-700 hover:border-rose-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Keluar</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-indigo-950 cursor-pointer"
                >
                  <Cloud className="w-4 h-4" />
                  <span>{isConnecting ? "Menghubungkan..." : "Hubungkan Google Drive"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Auto-Sync Setting Card */}
          <div className="p-4 bg-[#18181c] border border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-white text-xs">Otomatisasi Sinkronisasi Google Drive</span>
                <span
                  className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                    autoSync && currentUser
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-slate-800 text-slate-400 border border-slate-700"
                  }`}
                >
                  {autoSync && currentUser ? "AKTIF" : "NONAKTIF"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Setiap kali Anda membuat, mengedit soal, atau menerima sesi siswa, data akan otomatis dicadangkan ke Google Drive.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={(e) => handleToggleAutoSync(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>

              {currentUser && (
                <button
                  onClick={handleSyncAllExams}
                  disabled={isSyncingAll}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Sinkronkan semua naskah lokal ke Google Drive"
                >
                  <CloudUpload className={`w-3.5 h-3.5 ${isSyncingAll ? "animate-spin" : ""}`} />
                  <span>{isSyncingAll ? "Menyinkronkan..." : "Sinkron Semua"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Active Exam Quick Save Section */}
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
              </div>

              <button
                onClick={handleSaveActiveExam}
                disabled={isSaving}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-950 cursor-pointer shrink-0"
              >
                <CloudUpload className={`w-4 h-4 ${isSaving ? "animate-bounce" : ""}`} />
                <span>{isSaving ? "Menyimpan ke Drive..." : activeExam.gdriveFileId ? "Perbarui di Drive" : "Simpan ke Google Drive"}</span>
              </button>
            </div>

            {activeExam.gdriveSyncedAt && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-500/20 px-3 py-1.5 rounded-xl">
                <Check className="w-3.5 h-3.5" />
                <span>Tersimpan di Google Drive • Terakhir disinkronkan: {new Date(activeExam.gdriveSyncedAt).toLocaleString("id-ID")}</span>
                {activeExam.gdriveWebViewLink && (
                  <a
                    href={activeExam.gdriveWebViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-semibold underline text-[11px]"
                  >
                    <span>Buka File</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Stored Google Drive Exams List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-amber-400" />
                <span>Daftar Naskah Soal di Google Drive ({driveExams.length})</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                Folder: <code className="text-indigo-300 bg-slate-800 px-1.5 py-0.5 rounded font-mono">SlideExam_CBT/Naskah_Soal</code>
              </span>
            </div>

            {isLoadingList ? (
              <div className="p-8 text-center bg-[#16161a] rounded-2xl border border-slate-800 space-y-2">
                <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin mx-auto" />
                <p className="text-xs text-slate-400">Memuat daftar naskah soal dari Google Drive...</p>
              </div>
            ) : !currentUser ? (
              <div className="p-8 text-center bg-[#16161a] rounded-2xl border border-slate-800 space-y-3">
                <Cloud className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Hubungkan akun Google Drive Anda di atas untuk melihat naskah soal yang tersimpan di cloud.
                </p>
                <button
                  onClick={handleConnect}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold inline-flex items-center gap-2 cursor-pointer shadow-md"
                >
                  <Cloud className="w-4 h-4" />
                  <span>Hubungkan Sekarang</span>
                </button>
              </div>
            ) : driveExams.length === 0 ? (
              <div className="p-8 text-center bg-[#16161a] rounded-2xl border border-slate-800 space-y-2">
                <FolderOpen className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400">
                  Belum ada naskah soal yang tersimpan di folder Google Drive Anda.
                </p>
                <p className="text-[11px] text-indigo-400">
                  Klik tombol <strong>"Simpan ke Google Drive"</strong> di atas untuk mengunggah naskah aktif pertama Anda.
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
                          <span>Diperbarui: {new Date(item.modifiedTime).toLocaleString("id-ID")}</span>
                          {item.size && <span>• {(Number(item.size) / 1024).toFixed(1)} KB</span>}
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
                          title="Salin Tautan Google Drive"
                        >
                          {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>

                        {/* View in Drive */}
                        {item.webViewLink && (
                          <a
                            href={item.webViewLink}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all cursor-pointer inline-flex"
                            title="Buka File di Google Drive"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}

                        {/* Delete */}
                        <button
                          onClick={() => handleDeleteExam(item)}
                          disabled={deletingFileId === item.id}
                          className="p-1.5 bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 rounded-xl transition-all cursor-pointer"
                          title="Hapus dari Google Drive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
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
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span>Naskah soal otomatis diatur dengan izin publik untuk akses cepat perangkat siswa saat ujian.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
