import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Copy,
  Check,
  QrCode,
  Share2,
  ExternalLink,
  Smartphone,
  Globe,
  Sparkles,
  KeyRound,
  MessageSquare,
  Download,
  Maximize2,
  Zap,
  Info,
  Cloud,
  CloudUpload,
  RefreshCw,
  FolderOpen,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ExamPackage, StudentTokenItem } from "../types";
import {
  generateShortStudentUrl,
  generateDriveStudentUrl,
  generateStudentShareUrl,
} from "../utils/examShareEncoder";
import { getStudentTokens, saveExamPackages, getExamPackages } from "../utils/storage";
import { deduplicateStudentTokens } from "../utils/tokenValidator";
import { syncExamToGAS, isGasConfigured } from "../utils/gasService";
import { saveExamToGoogleDrive, formatExamDriveFileName, formatGoogleDriveDirectDownloadUrl } from "../utils/googleDrive";
import {
  getCachedAccessToken,
  isAuthExpiredError,
  formatGoogleAuthErrorMessage,
  clearAuthSession,
} from "../utils/googleAuth";

interface DirectStudentShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  exam: ExamPackage;
  token?: string;
  tokens?: StudentTokenItem[];
  allExams?: ExamPackage[];
  onSelectExam?: (exam: ExamPackage) => void;
}

interface SafeQRCodeSVGProps {
  value: string;
  size?: number;
  level?: "L" | "M" | "Q" | "H";
  bgColor?: string;
  fgColor?: string;
  marginSize?: number;
  svgRef?: React.Ref<SVGSVGElement>;
  className?: string;
}

const SafeQRCodeSVG: React.FC<SafeQRCodeSVGProps> = ({
  value,
  size = 140,
  level = "L",
  bgColor = "#ffffff",
  fgColor = "#09090b",
  marginSize = 1,
  svgRef,
  className,
}) => {
  // QR codes have a mathematical maximum capacity (Version 40).
  // When a value longer than ~1,000 characters is provided, mobile cameras cannot scan it,
  // and qrcode.react throws "RangeError: Data too long".
  // Guarding against length prevents RangeError entirely.
  const isSafeLength = Boolean(value && value.trim().length > 0 && value.trim().length <= 1000);

  if (!isSafeLength) {
    return (
      <div className="flex flex-col items-center justify-center p-3 text-center text-xs text-amber-300 bg-amber-950/40 rounded-2xl border border-amber-500/30 max-w-[200px]">
        <AlertCircle className="w-5 h-5 text-amber-400 mb-1" />
        <span className="font-semibold text-[11px]">Tautan Terlalu Panjang</span>
        <span className="text-[10px] text-slate-400 mt-0.5">Gunakan tombol Salin Link / Kirim WhatsApp</span>
      </div>
    );
  }

  return (
    <QRCodeSVG
      ref={svgRef}
      value={value.trim()}
      size={size}
      level={level}
      bgColor={bgColor}
      fgColor={fgColor}
      marginSize={marginSize}
      className={className}
    />
  );
};

export const DirectStudentShareModal: React.FC<DirectStudentShareModalProps> = ({
  isOpen,
  onClose,
  exam,
  token,
  tokens,
  allExams = [],
  onSelectExam,
}) => {
  const [selectedExamId, setSelectedExamId] = useState<string>(exam.id);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);
  const [includeTokenInLink, setIncludeTokenInLink] = useState(true);
  const [linkMode, setLinkMode] = useState<"student" | "offline_pkg" | "gdrive_alternative">("student");
  const [showEnlargedQr, setShowEnlargedQr] = useState(false);
  const [isUploadingToDrive, setIsUploadingToDrive] = useState(false);
  const [driveUploadError, setDriveUploadError] = useState<string | null>(null);
  const [driveUploadSuccess, setDriveUploadSuccess] = useState<string | null>(null);
  const qrRef = useRef<SVGSVGElement | null>(null);

  const [cloudSynced, setCloudSynced] = useState(false);

  // Sync selectedExamId when exam prop changes
  useEffect(() => {
    if (exam && exam.id) {
      setSelectedExamId(exam.id);
    }
  }, [exam.id]);

  const currentExam = useMemo(() => {
    if (allExams && allExams.length > 0) {
      const found = allExams.find((e) => e.id === selectedExamId);
      if (found) return found;
    }
    return exam;
  }, [allExams, selectedExamId, exam]);

  const currentToken = useMemo(() => {
    return currentExam.sessionToken || token || "TOKEN1";
  }, [currentExam.sessionToken, token]);

  const availableTokens = useMemo(() => {
    let list: StudentTokenItem[] = [];
    if (currentExam.tokens && currentExam.tokens.length > 0) {
      list = currentExam.tokens;
    } else if (tokens && tokens.length > 0) {
      list = tokens;
    } else {
      list = getStudentTokens();
    }
    return deduplicateStudentTokens(
      list,
      currentExam.code,
      currentExam.teacherProfile?.gradeLevel,
      currentExam.id
    );
  }, [tokens, currentExam.tokens, currentExam.code, currentExam.teacherProfile?.gradeLevel, currentExam.id]);

  // When modal is opened or exam is switched, auto-sync package to Google Sheets/GAS, backend server, and register Drive entry
  useEffect(() => {
    if (isOpen && currentExam && currentExam.id) {
      // 1. Sync to Google Apps Script / Sheets & local cache
      syncExamToGAS(currentExam, availableTokens)
        .then(() => setCloudSynced(true))
        .catch((err) => console.warn("GAS sync error on share modal:", err));

      // 2. Sync to Express backend
      fetch("/api/exams/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam: currentExam,
          token: currentToken,
          tokens: availableTokens,
        }),
      }).catch((err) => console.warn("Express backend sync error on share modal:", err));

      // 3. Register Drive file mapping with backend if available
      const activeToken = getCachedAccessToken();
      fetch("/api/gdrive/register-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: currentExam.code,
          fileId: currentExam.gdriveFileId || "",
          fileName: currentExam.gdriveFileName || formatExamDriveFileName(currentExam),
          webViewLink: currentExam.gdriveWebViewLink || "",
          downloadUrl: currentExam.gdriveDownloadLink || "",
          exam: currentExam,
          accessToken: activeToken || undefined,
        }),
      }).catch((err) => console.warn("Express gdrive registration error:", err));
    }
  }, [isOpen, currentExam.id, currentExam.code, currentExam.updatedAt, currentToken]);

  const currentUrl = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
  const baseUrl = currentUrl.endsWith("/") ? currentUrl.slice(0, -1) : currentUrl;

  // 1. Primary Student Link (Murni Mode Siswa Aplikasi: ?mode=student&code=...)
  const studentLinkWithToken = generateShortStudentUrl(baseUrl, currentExam, currentToken);
  const studentLinkWithoutToken = generateShortStudentUrl(baseUrl, currentExam, undefined);
  const studentActiveLink = includeTokenInLink && currentToken ? studentLinkWithToken : studentLinkWithoutToken;

  // 2. Self-Contained Offline/Direct Package Link (100% Anti-Gagal - embeds compressed exam data in URL)
  const selfContainedLink = generateStudentShareUrl(
    baseUrl,
    currentExam,
    includeTokenInLink ? currentToken : undefined,
    availableTokens,
    true
  );

  // 3. Alternative Direct Google Drive File Link (Raw JSON file for teacher archive)
  const driveFileDirectUrl =
    currentExam.gdriveWebViewLink ||
    (currentExam.gdriveFileId
      ? `https://drive.google.com/file/d/${currentExam.gdriveFileId}/view?usp=sharing`
      : "");

  // 4. Student CBT Link with Google Drive ID (Opens SlideExam CBT and fetches from Drive automatically)
  const driveStudentCbtLink = currentExam.gdriveFileId
    ? `${baseUrl.replace(/\/$/, "")}?mode=student&code=${encodeURIComponent(currentExam.code)}&driveId=${encodeURIComponent(currentExam.gdriveFileId)}${includeTokenInLink && currentToken ? `&token=${encodeURIComponent(currentToken)}` : ""}`
    : studentActiveLink;

  // Link selected in the input box
  const activeSelectedLink =
    linkMode === "gdrive_alternative"
      ? driveStudentCbtLink
      : linkMode === "offline_pkg"
      ? selfContainedLink
      : studentActiveLink;

  // QR Code ALWAYS encodes a clean, concise, high-speed mobile-scannable CBT link (< 300 chars)
  // Physical QR codes cannot encode massive package payloads (which causes RangeError: Data too long)
  const qrCodeTargetUrl =
    studentActiveLink && studentActiveLink.length <= 600
      ? studentActiveLink
      : generateShortStudentUrl(
          baseUrl,
          currentExam,
          includeTokenInLink && currentToken ? currentToken : undefined
        );

  // Handle uploading current exam to Google Drive
  const handleUploadCurrentExamToDrive = async () => {
    setIsUploadingToDrive(true);
    setDriveUploadError(null);
    setDriveUploadSuccess(null);
    try {
      // 1. Prioritaskan Google Apps Script (100% Bebas Google Cloud & Bebas Firebase)
      if (isGasConfigured()) {
        const gasRes = await syncExamToGAS(currentExam, currentToken ? [currentToken] : currentExam.tokens);
        if (gasRes && gasRes.success) {
          const updatedExam: ExamPackage = {
            ...currentExam,
            gdriveSyncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...(gasRes.fileUrl ? { gdriveWebViewLink: gasRes.fileUrl } : {}),
          };

          const all = getExamPackages();
          const idx = all.findIndex((e) => e.id === updatedExam.id);
          let updatedAll: ExamPackage[];
          if (idx >= 0) {
            updatedAll = [...all];
            updatedAll[idx] = updatedExam;
          } else {
            updatedAll = [updatedExam, ...all];
          }
          saveExamPackages(updatedAll);

          if (onSelectExam) {
            onSelectExam(updatedExam);
          }

          setDriveUploadSuccess(`✓ Naskah berhasil disimpan di Google Drive (Folder Data Soal) & Sheets via Apps Script!`);
          setTimeout(() => setDriveUploadSuccess(null), 5000);
          return;
        }
      }

      // 2. Jika ada token Drive aktif yang tersimpan
      let tokenToUse = getCachedAccessToken();
      if (tokenToUse) {
        const res = await saveExamToGoogleDrive(tokenToUse, currentExam);
        const updatedExam: ExamPackage = {
          ...currentExam,
          gdriveFileId: res.fileId,
          gdriveFileName: res.fileName,
          gdriveWebViewLink: res.webViewLink,
          gdriveDownloadLink: res.downloadUrl,
          gdriveSyncedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const all = getExamPackages();
        const idx = all.findIndex((e) => e.id === updatedExam.id);
        let updatedAll: ExamPackage[];
        if (idx >= 0) {
          updatedAll = [...all];
          updatedAll[idx] = updatedExam;
        } else {
          updatedAll = [updatedExam, ...all];
        }
        saveExamPackages(updatedAll);

        if (onSelectExam) {
          onSelectExam(updatedExam);
        }

        setDriveUploadSuccess(`✓ Naskah berhasil disimpan di Google Drive (Backup_Data_Aplikasi) dengan nama: ${res.fileName}`);
        setTimeout(() => setDriveUploadSuccess(null), 5000);
        return;
      }

      // 3. Jika belum dikonfigurasi
      setDriveUploadError("URL Google Apps Script belum disetel. Atur Web App URL di menu 'Integrasi Google Apps Script & Sheets' (100% Bebas Google Cloud/OAuth), atau gunakan tautan 'Paket Anti-Gagal (Link Langsung)' di tab sebelah yang siap diakses siswa tanpa perlu Google Drive.");
    } catch (err: any) {
      console.warn("Upload to Drive error:", err);
      setDriveUploadError(formatGoogleAuthErrorMessage(err) || "Gagal menyimpan naskah soal ke Google Drive.");
    } finally {
      setIsUploadingToDrive(false);
    }
  };

  const handleCopyLink = (textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Structured message for WhatsApp sharing
  const shareMessageText =
    `📋 *LINK UJIAN CBT SISWA - ${currentExam.title.toUpperCase()}*\n\n` +
    `👤 Mata Pelajaran: *${currentExam.teacherProfile?.subject || "Umum"}* (${currentExam.teacherProfile?.gradeLevel || "Umum"})\n` +
    `⏱️ Durasi: *${currentExam.durationMinutes || 60} Menit* (${currentExam.questions?.length || 0} Butir Soal)\n` +
    `📁 Kode Soal: *${currentExam.code}*` +
    (currentExam.gdriveFileName ? `\n📄 File Drive: *${currentExam.gdriveFileName}*` : "") +
    (includeTokenInLink && currentToken ? `\n🔑 Token Masuk: *${currentToken}*` : "") +
    `\n\n👉 *Link Ujian Siswa (Mode Siswa Aplikasi):*\n${activeSelectedLink}\n` +
    `\n🛡️ *Link Cadangan Paket Mandiri (Anti-Gagal):*\n${selfContainedLink}\n` +
    `\n_Petunjuk: Buka link ujian di HP atau laptop siswa. Aplikasi akan langsung membuka Mode Siswa. Pilih nama, masukkan token jika diminta, lalu kerjakan dengan teliti._`;

  const handleCopyWhatsAppTemplate = () => {
    navigator.clipboard.writeText(shareMessageText);
    setCopiedTemplate(true);
    setTimeout(() => setCopiedTemplate(false), 2000);
  };

  const handleOpenWhatsApp = () => {
    const encoded = encodeURIComponent(shareMessageText);
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
  };

  const handleDownloadQrSvg = () => {
    const svgEl = qrRef.current;
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `QR-Ujian-${currentExam.code || "CBT"}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSwitchExam = (newId: string) => {
    setSelectedExamId(newId);
    if (onSelectExam && allExams) {
      const found = allExams.find((e) => e.id === newId);
      if (found) onSelectExam(found);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        id="direct-student-share-modal"
        className="bg-[#121214] border border-indigo-500/40 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl shadow-indigo-950/60 flex flex-col max-h-[92vh]"
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-indigo-950/50 via-[#121214] to-purple-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>Bagikan Ujian ke Siswa</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">
                  Mode Siswa
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Pilih link ujian atau tautan alternatif Google Drive untuk siswa.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* Exam Selector Dropdown */}
          {allExams && allExams.length > 1 && (
            <div className="p-3 bg-[#18181b] border border-slate-800 rounded-2xl space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Pilih Naskah Soal yang Dibagikan:</span>
                <span className="text-[11px] text-indigo-400 font-mono">
                  {allExams.length} Naskah Tersedia
                </span>
              </label>
              <select
                value={selectedExamId}
                onChange={(e) => handleSwitchExam(e.target.value)}
                className="w-full bg-[#121214] border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 font-medium focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {allExams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title} — Kode: {ex.code} ({ex.questions?.length || 0} Soal)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Exam Summary Banner */}
          <div className="p-3.5 bg-gradient-to-r from-indigo-950/40 via-[#18181b] to-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between flex-wrap gap-2">
            <div className="space-y-0.5">
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <span>{currentExam.title}</span>
                <span className="text-xs px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-300 font-mono font-bold">
                  {currentExam.code}
                </span>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-3">
                <span>{currentExam.teacherProfile?.subject || "Umum"}</span>
                <span>•</span>
                <span>{currentExam.questions?.length || 0} Butir Soal</span>
                <span>•</span>
                <span>{currentExam.durationMinutes || 60} Menit</span>
              </div>
            </div>

            {/* Token Badge */}
            {currentToken && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs">
                <KeyRound className="w-3.5 h-3.5" />
                <span>Token: </span>
                <strong className="font-mono text-sm tracking-wider">{currentToken}</strong>
              </div>
            )}
          </div>

          {/* Mode Switcher Tabs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                <span>Tipe Tautan yang Dibagikan:</span>
              </span>

              {token && (
                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeTokenInLink}
                    onChange={(e) => setIncludeTokenInLink(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                  <span>Sertakan Token Otomatis</span>
                </label>
              )}
            </div>

            {/* 3-Option Tabs: Student CBT Link vs Self-Contained Offline Link vs Alternative Google Drive Link */}
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#161618] rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setLinkMode("student")}
                className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  linkMode === "student"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-950"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Zap className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span className="truncate">Mode Siswa (Aplikasi)</span>
              </button>

              <button
                type="button"
                onClick={() => setLinkMode("offline_pkg")}
                className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  linkMode === "offline_pkg"
                    ? "bg-emerald-600 text-white shadow-md shadow-emerald-950"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-300" />
                <span className="truncate">Paket Anti-Gagal</span>
              </button>

              <button
                type="button"
                onClick={() => setLinkMode("gdrive_alternative")}
                className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  linkMode === "gdrive_alternative"
                    ? "bg-cyan-600 text-white shadow-md shadow-cyan-950"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Cloud className="w-3.5 h-3.5 shrink-0 text-cyan-300" />
                <span className="truncate">Google Drive</span>
              </button>
            </div>

            {/* Content for Link Ujian Siswa (Utama - Mode Siswa Aplikasi) */}
            {linkMode === "student" && (
              <div className="p-3 bg-indigo-950/20 border border-indigo-500/20 rounded-xl space-y-2 text-xs">
                <p className="text-[11px] text-indigo-200 leading-relaxed">
                  <strong>Link Mode Siswa Aplikasi:</strong> Tautan resmi langsung membuka aplikasi dalam Mode Siswa{" "}
                  <code className="text-amber-300 font-mono bg-amber-950/50 px-1 py-0.5 rounded">?mode=student&code={currentExam.code}</code>.
                  Siswa langsung masuk ke antarmuka pengerjaan ujian secara aman tanpa akses ke dashboard guru dan tanpa memerlukan Firestore.
                </p>
                {includeTokenInLink && currentToken && (
                  <p className="text-[11px] text-emerald-300 flex items-center gap-1 font-mono">
                    <KeyRound className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span>Token tersemat: {currentToken} (siswa tidak perlu mengetik token manual).</span>
                  </p>
                )}
                {currentExam.gdriveFileId && (
                  <p className="text-[11px] text-cyan-300 flex items-center gap-1">
                    <Cloud className="w-3 h-3 text-cyan-400 shrink-0" />
                    <span>Terhubung ke backup Drive (ID: {currentExam.gdriveFileId.slice(0, 8)}...).</span>
                  </p>
                )}
              </div>
            )}

            {/* Content for Link Paket Anti-Gagal */}
            {linkMode === "offline_pkg" && (
              <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-xl space-y-2 text-xs">
                <p className="text-[11px] text-emerald-200 leading-relaxed">
                  <strong>Link Paket Mandiri (100% Pasti Terbuka):</strong> Tautan ini membawa seluruh data naskah soal dalam format terkompresi. Naskah dijamin <strong>100% langsung muncul di HP/laptop siswa</strong> tanpa takut "soal tidak ditemukan", bahkan tanpa Google Drive atau saat server restart.
                </p>
              </div>
            )}

            {/* Content for Link Google Drive (Alternatif) */}
            {linkMode === "gdrive_alternative" && (
              <div className="p-3 bg-cyan-950/30 border border-cyan-500/30 rounded-xl space-y-2.5 text-xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 font-bold text-cyan-300">
                    <Cloud className="w-4 h-4 text-cyan-400" />
                    <span>Fitur Link Google Drive Alternatif</span>
                  </div>
                  {currentExam.gdriveFileId ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1">
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Tersimpan di Drive</span>
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
                      Belum Diunggah ke Drive
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-slate-300 space-y-1">
                  <div>
                    <span className="text-slate-400">Nama File di Drive: </span>
                    <span className="font-mono text-cyan-200 font-semibold">
                      {currentExam.gdriveFileName || formatExamDriveFileName(currentExam)}
                    </span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Tautan di bawah ini adalah <strong>Link Ujian Siswa berbasis Google Drive</strong>. Saat siswa membuka link ini, aplikasi CBT langsung memuat naskah soal dari Google Drive Anda secara otomatis.
                  </p>
                </div>

                {driveUploadSuccess && (
                  <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-[11px]">
                    {driveUploadSuccess}
                  </div>
                )}

                {driveUploadError && (
                  <div className="p-2 rounded-lg bg-red-950/60 border border-red-500/40 text-red-300 text-[11px]">
                    {driveUploadError}
                  </div>
                )}

                <div className="pt-1 flex items-center flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isUploadingToDrive}
                    onClick={handleUploadCurrentExamToDrive}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all shadow-sm shadow-cyan-950"
                  >
                    {isUploadingToDrive ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Mengunggah ke Drive...</span>
                      </>
                    ) : (
                      <>
                        <CloudUpload className="w-3.5 h-3.5" />
                        <span>{currentExam.gdriveFileId ? "Perbarui File di Drive" : "Unggah Naskah ke Google Drive Sekarang"}</span>
                      </>
                    )}
                  </button>

                  {driveFileDirectUrl && (
                    <a
                      href={driveFileDirectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 font-semibold text-[11px] flex items-center gap-1 border border-slate-700"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Buka File di Drive</span>
                    </a>
                  )}

                  {currentExam.gdriveFileId && (
                    <button
                      type="button"
                      onClick={() => {
                        const directUrl = formatGoogleDriveDirectDownloadUrl(currentExam.gdriveFileId!);
                        navigator.clipboard.writeText(directUrl);
                        handleCopyLink(directUrl);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-[11px] flex items-center gap-1 border border-amber-500/30 cursor-pointer"
                      title="Salin Link Direct Download (drive.google.com/uc?export=download&id=...)"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Salin Direct Download URL</span>
                    </button>
                  )}
                </div>

                {/* Catatan Penting Akun Belajar.id */}
                <div className="p-3 bg-black/40 border border-amber-500/30 rounded-xl space-y-1.5 text-[11px]">
                  <div className="flex items-center gap-1.5 text-amber-300 font-bold">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Perhatian Pengguna Akun @belajar.id:</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    Google Workspace Pendidikan (<strong>@belajar.id</strong>) membatasi akses file hanya untuk domain sekolah. Jika link dibuka oleh siswa umum/tanpa akun belajar.id, Google akan memblokir (<em>403 Forbidden</em>).
                  </p>
                  <div className="text-slate-400 space-y-1 pt-0.5">
                    <div>👉 <strong>Solusi 1:</strong> Simpan file menggunakan akun Gmail pribadi (<strong>@gmail.com</strong>) dengan akses <em>"Siapa saja yang memiliki link"</em>.</div>
                    <div>👉 <strong>Solusi 2 (Rekomendasi Utama):</strong> Gunakan tab <strong>"Paket Anti-Gagal"</strong> di atas. Link tersebut 100% mandiri dan tidak terpengaruh kebijakan privasi Google Drive.</div>
                  </div>
                </div>
              </div>
            )}

            {/* Direct Link Input Box */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                readOnly
                value={activeSelectedLink}
                placeholder={linkMode === "gdrive_alternative" && !driveFileDirectUrl ? "Unggah file ke Google Drive terlebih dahulu" : ""}
                className="flex-1 px-3.5 py-2.5 bg-[#1a1a1c] border border-slate-800 rounded-xl text-slate-200 text-xs font-mono select-all focus:outline-none focus:border-indigo-500 truncate"
              />
              <button
                type="button"
                disabled={!activeSelectedLink}
                onClick={() => handleCopyLink(activeSelectedLink)}
                className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0 disabled:opacity-50 ${
                  copiedLink
                    ? "bg-emerald-600 text-white shadow-md shadow-emerald-950"
                    : linkMode === "gdrive_alternative"
                    ? "bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-950"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-950"
                }`}
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Tersalin!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Salin Link</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Share Grid: QR Code & WhatsApp Template */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 pt-1">
            {/* QR Code Card (Rendered 100% Client-Side with SVG) */}
            <div className="sm:col-span-5 p-4 bg-[#161618] rounded-2xl border border-slate-800 flex flex-col items-center justify-between text-center space-y-3">
              <div className="w-full flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                  <QrCode className="w-4 h-4 text-indigo-400" />
                  <span>Scan QR Code Ujian</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 font-semibold">
                  CBT Siswa
                </span>
              </div>

              {/* Native SVG QR Container */}
              <div
                onClick={() => setShowEnlargedQr(true)}
                className="p-3 bg-white rounded-2xl shadow-xl shadow-black/70 inline-flex items-center justify-center cursor-pointer hover:scale-102 transition-transform group relative"
                title="Klik untuk memperbesar QR Code"
              >
                <SafeQRCodeSVG
                  svgRef={qrRef}
                  value={qrCodeTargetUrl}
                  size={140}
                  level="L"
                  bgColor="#ffffff"
                  fgColor="#09090b"
                  marginSize={1}
                />
                <div className="absolute inset-0 bg-black/40 rounded-2xl opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold gap-1 transition-opacity backdrop-blur-[1px]">
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Perbesar</span>
                </div>
              </div>

              <div className="space-y-1.5 w-full">
                <p className="text-[10px] text-slate-400 leading-tight">
                  ✨ Siswa cukup memindai QR Code ini menggunakan kamera HP untuk langsung masuk ujian.
                </p>

                <div className="flex items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleDownloadQrSvg}
                    className="px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white rounded-lg bg-[#1f1f23] border border-slate-700 hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Download className="w-3 h-3 text-indigo-400" />
                    <span>Unduh SVG</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEnlargedQr(true)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white rounded-lg bg-[#1f1f23] border border-slate-700 hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Maximize2 className="w-3 h-3 text-slate-300" />
                    <span>Layar Penuh</span>
                  </button>
                </div>
              </div>
            </div>

            {/* WhatsApp / Telegram Share Card */}
            <div className="sm:col-span-7 p-4 bg-[#161618] rounded-2xl border border-slate-800 space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                    <MessageSquare className="w-4 h-4 text-emerald-400" />
                    <span>Format Pesan Grup WhatsApp</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyWhatsAppTemplate}
                    className="text-[11px] font-semibold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer bg-[#1f1f23] px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-700 transition-colors"
                  >
                    {copiedTemplate ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedTemplate ? "Disalin!" : "Salin Teks"}</span>
                  </button>
                </div>

                <div className="p-3 bg-[#111113] rounded-xl border border-slate-800 text-[11px] text-slate-300 font-mono whitespace-pre-line leading-relaxed max-h-36 overflow-y-auto select-all">
                  {shareMessageText}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleOpenWhatsApp}
                  className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-950 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Kirim ke WhatsApp</span>
                </button>
                <a
                  href={studentActiveLink}
                  target="_blank"
                  rel="noreferrer"
                  className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all border border-slate-700"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Buka Ujian</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-[#141416]">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Smartphone className="w-4 h-4 text-indigo-400" />
            <span className="hidden sm:inline">Siswa dapat langsung mengerjakan lewat HP, Tablet, atau Laptop.</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold text-xs cursor-pointer transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* Enlarged QR Code Lightbox Modal for Classroom Projector */}
      {showEnlargedQr && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-[#161618] border border-indigo-500/50 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="text-left">
                <h3 className="font-bold text-white text-base">QR Code Ujian CBT</h3>
                <p className="text-xs text-indigo-300 font-medium">{currentExam.title} ({currentExam.code})</p>
              </div>
              <button
                onClick={() => setShowEnlargedQr(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-white rounded-3xl inline-block shadow-2xl shadow-black/80">
              <SafeQRCodeSVG
                value={qrCodeTargetUrl}
                size={260}
                level="L"
                bgColor="#ffffff"
                fgColor="#09090b"
                marginSize={2}
              />
            </div>

            <div className="p-3 bg-[#111113] rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1">
              <div className="font-bold text-white">Petunjuk Scan Siswa:</div>
              <div>1. Buka kamera HP atau aplikasi scanner.</div>
              <div>2. Arahkan kamera ke QR Code di atas.</div>
              <div>3. Tekan link yang muncul untuk mulai ujian.</div>
            </div>

            <button
              onClick={() => setShowEnlargedQr(false)}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs cursor-pointer shadow-lg shadow-indigo-950"
            >
              Kembali
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
