import React, { useState, useEffect, useRef } from "react";
import {
  HardDrive,
  Download,
  Upload,
  FolderSync,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Folder,
  Database,
  Cloud,
  FileJson,
  RotateCcw,
  Key,
  FolderOpen,
  CloudUpload,
  CloudDownload,
  FileText,
  ShieldCheck,
  Check,
  LogOut,
  User as UserIcon,
  Copy,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Info,
  FileSpreadsheet,
  Code2,
  CheckCircle,
  ExternalLink as LinkIcon,
  Layers,
  X,
  AlertCircle
} from "lucide-react";
import { AppStateBackup } from "../types";
import { createFullAppBackup, restoreFullAppBackup, resetToDefaultData } from "../utils/storage";
import {
  getGasConfig,
  saveGasConfig,
  testGasConnection,
  initializeGasDatabase,
  getGasBackendCode,
  GasConfig,
  backupAppToGAS,
  listAppBackupsFromGAS,
  restoreAppBackupFromGAS,
} from "../utils/gasService";
import {
  GOOGLE_DRIVE_BACKUP_FOLDER_NAME,
  GoogleDriveFileItem,
  getOrCreateSlideExamFolder,
  uploadBackupToGoogleDrive,
  listBackupsFromGoogleDrive,
  downloadBackupFromGoogleDrive,
} from "../utils/googleDrive";
import {
  googleSignIn,
  googleSignOut,
  initAuth,
  getCachedAccessToken,
  requestGoogleTokenViaGIS,
  getOAuthClientId,
  setOAuthClientId,
  resetOAuthClientIdToDefault,
  onGoogleAuthExpired,
  isAuthExpiredError,
  formatGoogleAuthErrorMessage,
  GoogleUser,
  User,
  PRIMARY_USER_EMAIL,
} from "../utils/googleAuth";
import {
  isDriveAutoSyncEnabled,
  setDriveAutoSyncEnabled,
  subscribeToDriveSync,
  triggerFullBackupAutoSyncToDrive,
  DriveSyncState,
} from "../utils/googleDriveSync";

interface BackupRestoreViewProps {
  onDataRestored: () => void;
}

export const BackupRestoreView: React.FC<BackupRestoreViewProps> = ({ onDataRestored }) => {
  // Google Drive & Auth State
  const [currentUser, setCurrentUser] = useState<User | any | null>(null);
  const [driveToken, setDriveToken] = useState<string>(() => getCachedAccessToken() || "");
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);
  const [isLoadingFileList, setIsLoadingFileList] = useState(false);
  const [driveFiles, setDriveFiles] = useState<GoogleDriveFileItem[]>([]);
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveSuccessMsg, setDriveSuccessMsg] = useState<string | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(() => isDriveAutoSyncEnabled());
  const [syncState, setSyncState] = useState<DriveSyncState>({ status: "idle", lastSyncedAt: null });

  // Drive sync subscription
  useEffect(() => {
    return subscribeToDriveSync((st) => {
      setSyncState(st);
    });
  }, []);

  // Unauthorized Domain Guidance State
  const [unauthDomainInfo, setUnauthDomainInfo] = useState<{
    hostname: string;
    projectId: string;
  } | null>(null);
  const [copiedHostname, setCopiedHostname] = useState(false);

  // Local JSON Backup State
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupSuccessMsg, setBackupSuccessMsg] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccessMsg, setRestoreSuccessMsg] = useState<string | null>(null);
  const [showRosterGuide, setShowRosterGuide] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>(() => new Date().toLocaleTimeString("id-ID"));

  // Google Apps Script (GAS) & Google Sheets Database State
  const [gasConfig, setGasConfigState] = useState<GasConfig>(() => getGasConfig());
  const [gasUrlInput, setGasUrlInput] = useState<string>(() => getGasConfig().webAppUrl || "");
  const [isTestingGas, setIsTestingGas] = useState(false);
  const [gasTestResult, setGasTestResult] = useState<{
    success: boolean;
    message: string;
    folders?: Record<string, string>;
    spreadsheets?: Record<string, string>;
  } | null>(null);
  const [isInitializingGas, setIsInitializingGas] = useState(false);
  const [showGasCodeModal, setShowGasCodeModal] = useState(false);
  const [gasCodeContent, setGasCodeContent] = useState<string>("");
  const [isLoadingGasCode, setIsLoadingGasCode] = useState(false);
  const [isCopiedGasCode, setIsCopiedGasCode] = useState(false);

  const [googleClientIdInput, setGoogleClientIdInput] = useState<string>(() => getOAuthClientId());
  const [showClientIdConfig, setShowClientIdConfig] = useState(false);
  const [clientIdSavedMsg, setClientIdSavedMsg] = useState(false);

  // Cloud Backup via Google Apps Script (DriveApp - Zero OAuth)
  const [isBackingUpGAS, setIsBackingUpGAS] = useState(false);
  const [gasBackups, setGasBackups] = useState<any[]>([]);
  const [isLoadingGasBackups, setIsLoadingGasBackups] = useState(false);
  const [isRestoringGAS, setIsRestoringGAS] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleBackupToGasDrive = async () => {
    if (!gasConfig.webAppUrl) {
      setDriveError("URL Web App Google Apps Script belum diatur. Silakan simpan URL Web App terlebih dahulu.");
      return;
    }
    setIsBackingUpGAS(true);
    setDriveError(null);
    setDriveSuccessMsg(null);
    try {
      const backupData = createFullAppBackup();
      const res = await backupAppToGAS(backupData);
      if (res && res.success) {
        setDriveSuccessMsg(res.message || "Cadangan berhasil disimpan langsung ke Google Drive via Google Apps Script!");
        handleLoadGasBackups();
      } else {
        throw new Error(res?.message || "Gagal mencadangkan ke Google Drive via Google Apps Script.");
      }
    } catch (err: any) {
      const rawMsg = err?.message || String(err);
      if (rawMsg.toLowerCase().includes("failed to fetch") || rawMsg.toLowerCase().includes("networkerror")) {
        setDriveError(
          "Gagal menghubungi Google Apps Script (Failed to fetch). Pastikan saat Deploy Web App di script.google.com, opsi 'Who has access' (Siapa yang memiliki akses) dipilih 'Anyone' (Siapa saja), bukan 'Only myself'. Setelah diubah, buat versi deploy baru."
        );
      } else {
        setDriveError(`Gagal backup via Apps Script: ${rawMsg}`);
      }
    } finally {
      setIsBackingUpGAS(false);
    }
  };

  const handleLoadGasBackups = async () => {
    if (!gasConfig.webAppUrl) return;
    setIsLoadingGasBackups(true);
    try {
      const res = await listAppBackupsFromGAS();
      if (res && res.success && Array.isArray(res.backups)) {
        setGasBackups(res.backups);
      }
    } catch (err) {
      console.warn("Gagal memuat daftar backup GAS:", err);
    } finally {
      setIsLoadingGasBackups(false);
    }
  };

  const handleRestoreFromGasDrive = async (fileId: string, fileName: string) => {
    if (!confirm(`Pulihkan seluruh data aplikasi dari file cadangan '${fileName}'? Data saat ini di browser akan ditimpa dengan data ini.`)) {
      return;
    }
    setIsRestoringGAS(fileId);
    setDriveError(null);
    try {
      const res = await restoreAppBackupFromGAS(fileId);
      if (res && res.success && res.data) {
        const ok = restoreFullAppBackup(res.data);
        if (ok) {
          onDataRestored();
          setDriveSuccessMsg(`Data berhasil dipulihkan dari '${fileName}'!`);
        } else {
          throw new Error("Format berkas backup tidak kompatibel.");
        }
      } else {
        throw new Error("Gagal mengunduh file cadangan dari Google Drive.");
      }
    } catch (err: any) {
      setDriveError(`Gagal pemulihan via Apps Script: ${err?.message || String(err)}`);
    } finally {
      setIsRestoringGAS(null);
    }
  };

  useEffect(() => {
    if (gasConfig.webAppUrl && gasConfig.connected) {
      handleLoadGasBackups();
    }
  }, [gasConfig.webAppUrl, gasConfig.connected]);

  const handleSaveGoogleClientId = () => {
    setOAuthClientId(googleClientIdInput.trim());
    setGoogleClientIdInput(getOAuthClientId());
    setClientIdSavedMsg(true);
    setTimeout(() => setClientIdSavedMsg(false), 3500);
  };

  const handleResetGoogleClientId = () => {
    const def = resetOAuthClientIdToDefault();
    setGoogleClientIdInput(def);
    setClientIdSavedMsg(true);
    setTimeout(() => setClientIdSavedMsg(false), 3500);
  };

  const handleSaveGasUrl = () => {
    saveGasConfig({ webAppUrl: gasUrlInput.trim() });
    setGasConfigState(getGasConfig());
    setDriveSuccessMsg("URL Web App Google Apps Script berhasil disimpan.");
  };

  const handleTestGasConnection = async () => {
    setIsTestingGas(true);
    setGasTestResult(null);
    try {
      const res = await testGasConnection(gasUrlInput.trim() || undefined);
      setGasTestResult(res);
      if (res.success) {
        setGasConfigState(getGasConfig());
      }
    } catch (e: any) {
      setGasTestResult({ success: false, message: e?.message || "Koneksi ke Apps Script gagal." });
    } finally {
      setIsTestingGas(false);
    }
  };

  const handleInitializeGasFolders = async () => {
    setIsInitializingGas(true);
    setGasTestResult(null);
    try {
      const res = await initializeGasDatabase();
      if (res.success) {
        setGasConfigState(getGasConfig());
        setGasTestResult({
          success: true,
          message: "Folder Google Drive & Spreadsheet berhasil dibuat dan diinisialisasi!",
          folders: res.folders,
          spreadsheets: res.spreadsheets,
        });
        setDriveSuccessMsg("Folder dan Spreadsheet CBT Database berhasil diinisialisasi di Google Drive!");
      } else {
        setGasTestResult({
          success: false,
          message: res.message || "Gagal menginisialisasi database di Apps Script.",
        });
      }
    } catch (err: any) {
      setGasTestResult({
        success: false,
        message: err?.message || "Gagal menghubungi Apps Script backend.",
      });
    } finally {
      setIsInitializingGas(false);
    }
  };

  const handleOpenGasCodeModal = async () => {
    setShowGasCodeModal(true);
    setIsLoadingGasCode(true);
    try {
      const code = await getGasBackendCode();
      setGasCodeContent(code);
    } catch (e) {
      console.warn("Could not fetch code", e);
    } finally {
      setIsLoadingGasCode(false);
    }
  };

  const handleCopyGasCode = () => {
    if (gasCodeContent) {
      navigator.clipboard.writeText(gasCodeContent);
      setIsCopiedGasCode(true);
      setTimeout(() => setIsCopiedGasCode(false), 2500);
    }
  };

  // Initialize Auth listener on mount
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
      setDriveError("Sesi login Google Drive telah kedaluwarsa. Silakan hubungkan ulang akun Google Anda untuk memperbarui izin.");
    });
    return () => {
      unsubscribe();
      unsubExpired();
    };
  }, []);

  // Refresh Google Drive file list if token available
  const fetchDriveBackups = async (token: string) => {
    if (!token) return;
    setIsLoadingFileList(true);
    setDriveError(null);
    try {
      const folderId = await getOrCreateSlideExamFolder(token);
      setDriveFolderId(folderId);
      const files = await listBackupsFromGoogleDrive(token);
      setDriveFiles(files);
    } catch (err: any) {
      if (isAuthExpiredError(err)) {
        setCurrentUser(null);
        setDriveToken("");
      }
      setDriveError(formatGoogleAuthErrorMessage(err) || "Gagal menyinkronkan dengan Google Drive. Sesi mungkin telah berakhir.");
    } finally {
      setIsLoadingFileList(false);
    }
  };

  useEffect(() => {
    if (driveToken) {
      fetchDriveBackups(driveToken);
    }
  }, [driveToken]);

  // Handle Google Sign In popup with Firebase OAuth
  const handleConnectGoogleDrive = async () => {
    setIsConnectingDrive(true);
    setDriveError(null);
    setUnauthDomainInfo(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setCurrentUser(result.user);
        setDriveToken(result.accessToken);
        setDriveSuccessMsg(`Berhasil terhubung sebagai ${result.user.displayName || result.user.email || "Pengguna"}!`);
        await fetchDriveBackups(result.accessToken);
      }
    } catch (err: any) {
      console.error("Google Auth error:", err);
      const errStr = String(err?.message || err?.type || err || "").toLowerCase();
      const isUnauth =
        err?.code === "auth/unauthorized-domain" ||
        errStr.includes("auth/unauthorized-domain") ||
        errStr.includes("unauthorized-domain") ||
        errStr.includes("origin_mismatch") ||
        errStr.includes("origin mismatch");

      if (isUnauth) {
        const currentOrigin = typeof window !== "undefined" ? window.location.origin : "https://cbt-exam-five.vercel.app";
        const currentHost = typeof window !== "undefined" ? window.location.hostname : "cbt-exam-five.vercel.app";
        setUnauthDomainInfo({
          hostname: currentHost,
          projectId: "Google Cloud / Firebase",
        });
        setDriveError(
          `Domain ${currentOrigin} belum didaftarkan di Authorized JavaScript origins Google Cloud Console.`
        );
      } else {
        setDriveError(err?.message || "Gagal login dengan Google. Pastikan pop-up diizinkan.");
      }
    } finally {
      setIsConnectingDrive(false);
    }
  };

  const handleCopyHostname = () => {
    if (!unauthDomainInfo) return;
    navigator.clipboard.writeText(unauthDomainInfo.hostname);
    setCopiedHostname(true);
    setTimeout(() => setCopiedHostname(false), 3000);
  };

  // Alternative GIS connection attempt
  const handleTryGisDirect = async () => {
    setIsConnectingDrive(true);
    setDriveError(null);
    try {
      const res = await requestGoogleTokenViaGIS();
      if (res && res.accessToken) {
        setCurrentUser(res.user);
        setDriveToken(res.accessToken);
        setUnauthDomainInfo(null);
        setDriveSuccessMsg(`Berhasil terhubung via Google Identity Services sebagai ${res.user.displayName || "Pengguna"}!`);
        await fetchDriveBackups(res.accessToken);
      }
    } catch (e: any) {
      setDriveError(e.message || "Gagal melakukan otentikasi Google GIS.");
    } finally {
      setIsConnectingDrive(false);
    }
  };

  // Upload Snapshot directly to Google Drive Folder 'SlideExam_CBT'
  const handleUploadToGoogleDrive = async () => {
    if (!driveToken) {
      await handleConnectGoogleDrive();
      return;
    }

    setIsSyncingDrive(true);
    setDriveError(null);
    setDriveSuccessMsg(null);

    try {
      const backupData = createFullAppBackup();
      const uploaded = await uploadBackupToGoogleDrive(driveToken, backupData);
      setDriveSuccessMsg(`File backup "${uploaded.name}" berhasil diunggah ke folder ${GOOGLE_DRIVE_BACKUP_FOLDER_NAME} di Google Drive!`);
      setLastSyncTime(new Date().toLocaleTimeString("id-ID"));
      await fetchDriveBackups(driveToken);
    } catch (err: any) {
      if (isAuthExpiredError(err)) {
        setCurrentUser(null);
        setDriveToken("");
      }
      setDriveError(formatGoogleAuthErrorMessage(err) || "Gagal mengunggah backup ke Google Drive. Silakan hubungkan ulang akun Anda.");
    } finally {
      setIsSyncingDrive(false);
    }
  };

  // Restore snapshot from Google Drive file
  const handleRestoreFromDriveFile = async (file: GoogleDriveFileItem) => {
    if (!driveToken) return;
    if (confirm(`Apakah Anda yakin ingin memulihkan seluruh data aplikasi dari file backup "${file.name}"? Data saat ini akan digantikan.`)) {
      setIsSyncingDrive(true);
      setDriveError(null);
      setDriveSuccessMsg(null);

      try {
        const backupData = await downloadBackupFromGoogleDrive(driveToken, file.id);
        const success = restoreFullAppBackup(backupData);
        if (success) {
          setDriveSuccessMsg(`Seluruh data berhasil dipulihkan dari "${file.name}"!`);
          onDataRestored();
        } else {
          setDriveError("Format isi file backup Google Drive tidak sesuai standar SlideExam.");
        }
      } catch (err: any) {
        if (isAuthExpiredError(err)) {
          setCurrentUser(null);
          setDriveToken("");
        }
        setDriveError(formatGoogleAuthErrorMessage(err) || "Gagal memulihkan file dari Google Drive.");
      } finally {
        setIsSyncingDrive(false);
      }
    }
  };

  // Local file download handler
  const handleDownloadBackupFile = () => {
    setIsBackingUp(true);
    try {
      const backupData = createFullAppBackup();
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(backupData, null, 2)
      )}`;
      const downloadAnchor = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadAnchor.setAttribute("href", jsonString);
      downloadAnchor.setAttribute("download", `SlideExam_CBT_Backup_${timestamp}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      setBackupSuccessMsg("File backup JSON berhasil diunduh ke komputer Anda!");
      setLastSyncTime(new Date().toLocaleTimeString("id-ID"));
    } catch (e: any) {
      alert("Gagal membuat backup: " + e.message);
    } finally {
      setIsBackingUp(false);
    }
  };

  // Local file upload / restore handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        setRestoreError(null);
        setRestoreSuccessMsg(null);
        const content = event.target?.result as string;
        const parsed = JSON.parse(content) as AppStateBackup;

        const success = restoreFullAppBackup(parsed);
        if (success) {
          setRestoreSuccessMsg("Seluruh data naskah soal, profil sekolah, token, dan riwayat siswa berhasil dipulihkan!");
          onDataRestored();
        } else {
          setRestoreError("Format file backup tidak valid. Pastikan file berasal dari SlideExam CBT.");
        }
      } catch (err: any) {
        setRestoreError("Gagal membaca file JSON: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleResetDefaults = () => {
    if (confirm("Reset seluruh data aplikasi ke konfigurasi dan contoh soal awal?")) {
      resetToDefaultData();
      onDataRestored();
      alert("Aplikasi berhasil direset ke data awal!");
    }
  };

  const handleDisconnectDrive = async () => {
    await googleSignOut();
    setCurrentUser(null);
    setDriveToken("");
    setDriveFiles([]);
    setDriveFolderId(null);
    setDriveSuccessMsg("Koneksi Google Drive berhasil diputuskan.");
  };

  return (
    <div id="backup-restore-view" className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#121214] rounded-2xl p-6 border border-slate-800 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
            <Sparkles className="w-4 h-4" />
            <span>Arsitektur Bebas Firebase & Google Cloud Console (OAuth)</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">Database Google Sheets & Cloud Backup</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Aplikasi berjalan 100% menggunakan Google Apps Script (GAS) & Google Sheets untuk menyimpan bank soal, token ujian, rekap nilai siswa, serta cadangan Drive tanpa ketergantungan Firebase maupun OAuth.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleBackupToGasDrive}
            disabled={isBackingUpGAS || !gasConfig.webAppUrl}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition-all shadow-lg shadow-emerald-950 cursor-pointer disabled:opacity-50"
            title={!gasConfig.webAppUrl ? "Isi URL Web App Apps Script terlebih dahulu" : "Simpan backup ke Google Drive via GAS"}
          >
            <CloudUpload className={`w-4 h-4 ${isBackingUpGAS ? "animate-spin" : ""}`} />
            <span>{isBackingUpGAS ? "Menyimpan ke Drive..." : "Backup ke Google Drive (GAS)"}</span>
          </button>

          <button
            onClick={handleDownloadBackupFile}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
          >
            <Download className="w-4 h-4 text-indigo-400" />
            <span>Unduh File JSON (Offline)</span>
          </button>
        </div>
      </div>

      {/* Akun Google Aktif Terpilih */}
      <div className="bg-[#16161a] border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
            <UserIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-300">Akun Google Aktif:</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Tersambung (Bebas Restriksi Domain)
              </span>
            </div>
            <div className="text-sm font-semibold text-white font-mono flex items-center gap-2 mt-0.5">
              <span>{currentUser?.email || PRIMARY_USER_EMAIL}</span>
            </div>
          </div>
        </div>
        <div className="text-[11px] text-slate-400 sm:text-right max-w-sm">
          Akun personal (@gmail.com) aktif digunakan untuk Google Drive & Google Apps Script tanpa pembatasan domain organisasi.
        </div>
      </div>

      {/* Google Sheets & Google Apps Script Database Card */}
      <div className="bg-[#121214] rounded-2xl p-6 border border-emerald-500/30 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-white">Database Utama Google Sheets & Apps Script (GAS)</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  gasConfig.connected
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                }`}>
                  {gasConfig.connected ? "● Terhubung ke Google Sheets" : "○ Belum Terhubung"}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  100% Bebas Firebase & OAuth
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Seluruh data disimpan ke dalam 3 subfolder terstruktur di Google Drive: <em>'Data Siswa dan Kelas'</em>, <em>'Data Analisis dan Nilai'</em>, dan <em>'Data Soal'</em>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={handleOpenGasCodeModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-sm"
            >
              <Code2 className="w-4 h-4 text-emerald-400" />
              <span>Lihat / Salin Script Code.gs</span>
            </button>

            <button
              type="button"
              onClick={handleInitializeGasFolders}
              disabled={isInitializingGas || !gasConfig.webAppUrl}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-950 cursor-pointer disabled:opacity-50"
            >
              <FolderSync className={`w-4 h-4 ${isInitializingGas ? "animate-spin" : ""}`} />
              <span>{isInitializingGas ? "Menginisialisasi..." : "Inisialisasi Folder & Sheets"}</span>
            </button>
          </div>
        </div>

        {/* 4 Langkah Pemasangan Apps Script */}
        <div className="bg-[#161618] rounded-xl border border-slate-800 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
            <Sparkles className="w-4 h-4" />
            <span>4 Langkah Mudah Menghubungkan Google Sheets (Tanpa Firebase & Google Cloud Console):</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 bg-[#1c1c20] rounded-xl border border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-white text-xs">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-[10px]">1</span>
                <span>Siapkan Script</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Klik tombol <strong>"Lihat / Salin Script Code.gs"</strong> di atas dan salin seluruh kodenya.
              </p>
            </div>

            <div className="p-3 bg-[#1c1c20] rounded-xl border border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-white text-xs">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-[10px]">2</span>
                <span>Pasang di Apps Script</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Buka Google Sheets &gt; <strong>Ekstensi &gt; Apps Script</strong>. Tempel kode, lalu klik <strong>Deploy &gt; Deployment baru</strong> (Jalankan sebagai: Saya, Akses: Siapa saja).
              </p>
            </div>

            <div className="p-3 bg-[#1c1c20] rounded-xl border border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-white text-xs">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-[10px]">3</span>
                <span>Simpan & Uji Ping</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Salin Web App URL, tempel ke kolom di bawah, klik <strong>Simpan URL</strong>, lalu klik <strong>Uji Koneksi (Ping)</strong> sampai status terhubung.
              </p>
            </div>

            <div className="p-3 bg-[#1c1c20] rounded-xl border border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-white text-xs">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-[10px]">4</span>
                <span>Inisialisasi Database</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Klik <strong>Inisialisasi Folder & Sheets</strong>. Google Apps Script akan otomatis membuat 3 folder dan 3 spreadsheet di Google Drive Anda.
              </p>
            </div>
          </div>
        </div>

        {/* 3 Subfolders Blueprint */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* Subfolder 1 */}
          <div className="p-4 bg-[#161618] rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
              <FolderOpen className="w-4 h-4" />
              <span>📂 Data Siswa dan Kelas</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Menampung data absensi, daftar siswa per rombel, serta token akses ujian aktif.
            </p>
            <div className="pt-1.5 space-y-1 text-[11px] text-slate-300">
              <div className="flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Spreadsheet: <strong>Roster_Siswa</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Spreadsheet: <strong>Token_Ujian</strong></span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowRosterGuide(true)}
              className="mt-2 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer underline"
            >
              <FileSpreadsheet className="w-3 h-3 shrink-0" />
              <span>Cara Pasang Data Siswa Asli (Roster_Siswa) ↗</span>
            </button>
          </div>

          {/* Subfolder 2 */}
          <div className="p-4 bg-[#161618] rounded-xl border border-indigo-900/40 space-y-2">
            <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs">
              <FolderOpen className="w-4 h-4" />
              <span>📂 Data Analisis dan Nilai</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Menyimpan rekap nilai kelulusan, rincian jawaban per butir, serta program Pengayaan & Remidi AI.
            </p>
            <div className="pt-1.5 space-y-1 text-[11px] text-slate-300">
              <div className="flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Spreadsheet: <strong>Hasil_Ujian</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Spreadsheet: <strong>Pengayaan_Dan_Remidi_AI</strong></span>
              </div>
            </div>
          </div>

          {/* Subfolder 3 */}
          <div className="p-4 bg-[#161618] rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
              <FolderOpen className="w-4 h-4" />
              <span>📂 Data Soal</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Menyimpan naskah master paket ujian, kunci jawaban, rubrik, dan file arsip JSON slide.
            </p>
            <div className="pt-1.5 space-y-1 text-[11px] text-slate-300">
              <div className="flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Spreadsheet: <strong>Paket_Ujian</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Arsip File: <strong>Naskah JSON Slide</strong></span>
              </div>
            </div>
          </div>
        </div>

        {/* GAS Web App URL Config Bar */}
        <div className="p-4 bg-[#161618] rounded-xl border border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <LinkIcon className="w-3.5 h-3.5 text-emerald-400" />
              <span>URL Web App Google Apps Script:</span>
            </label>
            <span className="text-[11px] text-slate-400">
              Format: <code>https://script.google.com/macros/s/.../exec</code>
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={gasUrlInput}
              onChange={(e) => setGasUrlInput(e.target.value)}
              placeholder="Tempelkan URL Web App Google Apps Script di sini..."
              className="flex-1 px-3.5 py-2.5 bg-[#0e0e10] border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors font-mono"
            />
            <button
              type="button"
              onClick={handleSaveGasUrl}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer shrink-0"
            >
              Simpan URL
            </button>
            <button
              type="button"
              onClick={handleTestGasConnection}
              disabled={isTestingGas}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isTestingGas ? "animate-spin" : ""}`} />
              <span>{isTestingGas ? "Menguji..." : "Uji Koneksi (Ping)"}</span>
            </button>
          </div>

          {gasTestResult && (
            <div
              className={`p-3 rounded-xl text-xs flex items-start gap-2.5 ${
                gasTestResult.success
                  ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-200"
                  : "bg-rose-500/10 border border-rose-500/30 text-rose-300"
              }`}
            >
              {gasTestResult.success ? (
                <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
              )}
              <div className="space-y-1">
                <span className="font-semibold">{gasTestResult.message}</span>
                {!gasTestResult.success && gasTestResult.message.includes("getFoldersByName") && (
                  <div className="mt-2 pt-2 border-t border-rose-500/20 text-xs text-rose-200">
                    <p className="font-semibold text-white mb-1">Perbaikan Script Diperlukan:</p>
                    <p className="text-[11px] text-rose-300 mb-2 leading-relaxed">
                      Kode Google Apps Script di Google Drive Anda masih menggunakan versi lama. Buka modal di bawah, salin kode <code>Code.gs</code> terbaru yang telah diperbaiki, lalu simpan dan deploy versi baru (<em>Deploy &gt; Manage deployments &gt; Edit &gt; New version</em>).
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenGasCodeModal}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow"
                    >
                      Buka &amp; Salin Code.gs Terbaru
                    </button>
                  </div>
                )}
                {gasTestResult.spreadsheets && (
                  <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                    {Object.entries(gasTestResult.spreadsheets).map(([key, url]) => (
                      <a
                        key={key}
                        href={url as string}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-black/40 hover:bg-black/60 rounded border border-emerald-500/30 text-emerald-300"
                      >
                        <span>{key}</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GAS DriveApp Backup & Restore Card (Zero OAuth Cloud Backup) */}
      <div className="bg-[#121214] rounded-2xl p-6 border border-emerald-500/30 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-white">Cadangan Google Drive via Apps Script (DriveApp)</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  100% Bebas OAuth &amp; GCP
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Mencadangkan seluruh naskah soal, token, dan nilai langsung ke folder <strong>'CBT SlideExam Database'</strong> di Google Drive Anda.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleBackupToGasDrive}
              disabled={isBackingUpGAS || !gasConfig.webAppUrl}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-950 cursor-pointer disabled:opacity-50"
            >
              <CloudUpload className={`w-4 h-4 ${isBackingUpGAS ? "animate-spin" : ""}`} />
              <span>{isBackingUpGAS ? "Menyimpan ke Drive..." : "Backup ke Google Drive Sekarang"}</span>
            </button>

            <button
              type="button"
              onClick={handleLoadGasBackups}
              disabled={isLoadingGasBackups || !gasConfig.webAppUrl}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isLoadingGasBackups ? "animate-spin" : ""}`} />
              <span>Segarkan</span>
            </button>
          </div>
        </div>

        {/* List of GAS Drive backups */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-emerald-400" />
              <span>Daftar Berkas Cadangan di Google Drive ({gasBackups.length} Berkas)</span>
            </span>
            {gasConfig.webAppUrl ? (
              <span className="text-[11px] text-emerald-400 font-medium">DriveApp Service Aktif</span>
            ) : (
              <span className="text-[11px] text-amber-400">Harap isi URL Web App terlebih dahulu</span>
            )}
          </div>

          {isLoadingGasBackups ? (
            <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Memeriksa berkas cadangan di Google Drive...</span>
            </div>
          ) : gasBackups.length === 0 ? (
            <div className="p-5 rounded-2xl bg-[#161618] border border-slate-800 text-center text-xs text-slate-400 space-y-1">
              <div>Belum ada file backup di folder Google Drive via Google Apps Script.</div>
              <div className="text-[11px] text-slate-500">Klik tombol <strong>"Backup ke Google Drive Sekarang"</strong> untuk menyimpan cadangan pertama.</div>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {gasBackups.map((b: any) => (
                <div
                  key={b.id}
                  className="p-3.5 bg-[#161618] border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg shrink-0">
                      <FileJson className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-white font-mono text-xs">{b.name}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-3 mt-0.5">
                        <span>Dibuat: {b.created ? new Date(b.created).toLocaleString("id-ID") : "-"}</span>
                        {b.size && <span>Ukuran: {(b.size / 1024).toFixed(1)} KB</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {b.url && (
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors"
                      >
                        <span>Lihat di Drive</span>
                        <ExternalLink className="w-3 h-3 text-slate-400" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRestoreFromGasDrive(b.id, b.name)}
                      disabled={isRestoringGAS === b.id}
                      className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <CloudDownload className={`w-3.5 h-3.5 ${isRestoringGAS === b.id ? "animate-spin" : ""}`} />
                      <span>{isRestoringGAS === b.id ? "Memulihkan..." : "Pulihkan Cadangan"}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* GAS Code Setup Modal */}
      {showGasCodeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121214] border border-slate-800 rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Code2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Kode Backend Google Apps Script (Code.gs)</h3>
                  <p className="text-xs text-slate-400">Ikuti panduan mudah 3 langkah berikut untuk men-deploy backend.</p>
                </div>
              </div>
              <button
                onClick={() => setShowGasCodeModal(false)}
                className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-300">
              <div className="p-4 bg-emerald-950/20 border border-emerald-800/40 rounded-2xl space-y-2">
                <span className="text-xs font-bold text-emerald-300 block">Langkah Pemasangan di Google Apps Script:</span>
                <ol className="list-decimal list-inside space-y-1 text-slate-200 text-xs">
                  <li>Buka <a href="https://script.google.com" target="_blank" rel="noreferrer" className="text-emerald-400 underline font-semibold">script.google.com</a> lalu buat <strong>New Project</strong>.</li>
                  <li>Beri nama proyek, misalnya <code>SlideExam CBT Database</code>.</li>
                  <li>Hapus isi default di <code>Code.gs</code>, lalu klik tombol <strong>"Salin Seluruh Kode Code.gs"</strong> di bawah dan tempelkan ke editor Apps Script.</li>
                  <li>Klik menu <strong>Deploy</strong> &gt; <strong>New Deployment</strong>.</li>
                  <li>Pilih jenis <strong>Web app</strong>, atur <em>Execute as: Me</em> dan <em>Who has access: Anyone</em>, lalu klik <strong>Deploy</strong>.</li>
                  <li>Salin Web App URL yang dihasilkan dan tempelkan ke kolom URL Web App di atas.</li>
                </ol>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">Pratinjau Kode (Code.gs):</span>
                  <button
                    onClick={handleCopyGasCode}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer"
                  >
                    {isCopiedGasCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{isCopiedGasCode ? "Berhasil Disalin!" : "Salin Seluruh Kode Code.gs"}</span>
                  </button>
                </div>

                <div className="relative">
                  {isLoadingGasCode ? (
                    <div className="h-64 bg-[#0a0a0c] border border-slate-800 rounded-xl flex items-center justify-center text-slate-400 gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                      <span>Memuat kode script...</span>
                    </div>
                  ) : (
                    <textarea
                      readOnly
                      value={gasCodeContent}
                      rows={14}
                      className="w-full p-3 bg-[#0a0a0c] border border-slate-800 rounded-xl font-mono text-[11px] text-emerald-300 leading-relaxed focus:outline-none resize-none"
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-800 bg-[#0e0e10] flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                100% aman: kode berjalan langsung di akun Google Drive pribadi Anda tanpa perantara server pihak ketiga.
              </span>
              <button
                onClick={() => setShowGasCodeModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Sync Cloud Status Card */}
      <div className="bg-[#18181c] border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-white text-sm">Otomatisasi Sinkronisasi Google Drive</h4>
              <span
                className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                  autoSyncEnabled && currentUser
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-slate-800 text-slate-400 border border-slate-700"
                }`}
              >
                {autoSyncEnabled && currentUser ? "OTOMATIS AKTIF" : "NONAKTIF"}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {syncState.status === "syncing" ? (
                <span className="text-indigo-400 animate-pulse font-medium">{syncState.message || "Menyinkronkan data..."}</span>
              ) : syncState.lastSyncedAt ? (
                <span>Terakhir tersinkronisasi otomatis: {new Date(syncState.lastSyncedAt).toLocaleString("id-ID")}</span>
              ) : (
                <span>Otomatis mencadangkan paket soal & riwayat saat terjadi perubahan.</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autoSyncEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                setAutoSyncEnabled(next);
                setDriveAutoSyncEnabled(next);
                if (next && driveToken) {
                  triggerFullBackupAutoSyncToDrive(500);
                  setDriveSuccessMsg("Otomatisasi sinkronisasi diaktifkan.");
                } else {
                  setDriveSuccessMsg("Otomatisasi sinkronisasi dinonaktifkan.");
                }
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>
      </div>

      {/* Notifications */}
      {driveSuccessMsg && (
        <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400 text-xs flex items-center justify-between gap-2 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{driveSuccessMsg}</span>
          </div>
          <button onClick={() => setDriveSuccessMsg(null)} className="text-emerald-400 hover:text-white text-xs font-bold">✕</button>
        </div>
      )}

      {driveError && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-400 text-xs flex items-center justify-between gap-2 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{driveError}</span>
          </div>
          <button onClick={() => setDriveError(null)} className="text-rose-400 hover:text-white text-xs font-bold">✕</button>
        </div>
      )}

      {/* Informasi Arsitektur Bebas Google Cloud & Bebas Firebase */}
      <div className="bg-[#121214] border border-slate-800 rounded-3xl p-6 sm:p-7 text-white shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Folder className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>100% Bebas Google Cloud &amp; Bebas Firebase</span>
              </div>
              <h3 className="text-xl font-bold tracking-wide text-white">
                Folder Database Google Drive &amp; Spreadsheet
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-medium flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>DriveApp &amp; Sheets Siap Pakai</span>
            </span>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
          Aplikasi ini tidak memerlukan setup Google Cloud Console (OAuth 2.0) atau Firebase. Semua sinkronisasi naskah soal, nilai siswa, dan pencadangan Google Drive dikelola langsung oleh <strong>Google Apps Script (Web App)</strong> di akun Google Anda sendiri secara aman tanpa risiko <em>Error 400: origin_mismatch</em>.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
            <div className="text-xs font-bold text-slate-200">1. Data Soal</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Naskah JSON &amp; Sheet Paket_Ujian tersimpan otomatis di Google Drive guru.</div>
          </div>
          <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
            <div className="text-xs font-bold text-slate-200">2. Nilai &amp; AI Diagnosis</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Lembar nilai siswa dan diagnosis pengayaan/remidi dicatat di Google Sheets.</div>
          </div>
          <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
            <div className="text-xs font-bold text-slate-200">3. Cadangan Offline</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Snapshot data dapat diunduh ke file .json lokal kapan saja di bawah ini.</div>
          </div>
        </div>
      </div>

      {/* Action Grid: Local Backup vs Restore */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Backup Card */}
        <div className="bg-[#121214] rounded-2xl p-6 border border-slate-800 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <Database className="w-4 h-4 text-indigo-400" />
              <span>1. Ekspor Snapshot JSON Offline</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Membuat snapshot lengkap berisi seluruh paket soal ujian, profil sekolah, logo, kunci jawaban, dan histori nilai seluruh siswa dalam file JSON terenkripsi standar.
            </p>

            {backupSuccessMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{backupSuccessMsg}</span>
              </div>
            )}
          </div>

          <button
            onClick={handleDownloadBackupFile}
            disabled={isBackingUp}
            className="w-full py-3 bg-[#1a1a1c] hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-xl font-semibold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>{isBackingUp ? "Menyiapkan File..." : "Unduh Snapshot JSON (.json)"}</span>
          </button>
        </div>

        {/* Restore Card */}
        <div className="bg-[#121214] rounded-2xl p-6 border border-slate-800 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <Upload className="w-4 h-4 text-amber-400" />
              <span>2. Pulihkan (Restore) dari File JSON</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Unggah file cadangan JSON yang pernah diunduh sebelumnya untuk mengembalikan seluruh naskah soal dan data nilai siswa ke perangkat ini.
            </p>

            {restoreSuccessMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{restoreSuccessMsg}</span>
              </div>
            )}

            {restoreError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{restoreError}</span>
              </div>
            )}
          </div>

          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-xs shadow-lg shadow-amber-950/40 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              <span>Pilih File Backup JSON</span>
            </button>
          </div>
        </div>
      </div>

      {/* Danger Zone: Reset to Default */}
      <div className="p-5 bg-rose-950/20 border border-rose-500/20 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            <span>Zona Pengaturan Ulang Sistem</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Menghapus cache lokal dan mengembalikan aplikasi ke naskah soal & contoh bawaan.
          </p>
        </div>

        <button
          onClick={handleResetDefaults}
          className="px-4 py-2.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset ke Data Awal</span>
        </button>
      </div>

      {/* Panduan Data Siswa Roster_Siswa Modal */}
      {showRosterGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#121214] border border-slate-700/80 rounded-3xl max-w-2xl w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto shadow-2xl text-slate-100">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-white">
                    Panduan Memastikan atau Mengubah Data Siswa di Mode Siswa
                  </h3>
                  <p className="text-xs text-slate-400">
                    Sistem Roster_Siswa Google Sheets &amp; Cara Mengganti Data Dummy
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowRosterGuide(false)}
                className="p-2 text-slate-400 hover:text-white bg-[#1a1a1c] hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mengapa Muncul Data Dummy? */}
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Mengapa Muncul Data Dummy?</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Saat Mode Siswa dibuka pertama kali di perangkat baru/siswa, sistem CBT akan memuat data sample / dummy bawaan (seperti daftar nama kelas contoh) jika aplikasi belum mendeteksi data siswa asli dari Google Sheets.
              </p>
            </div>

            {/* Cara Memasang Data Siswa Asli */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Cara Memasang Data Siswa Asli:</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* Step 1 */}
                <div className="p-4 bg-[#1a1a1c] rounded-2xl border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-emerald-400 font-bold">
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">Langkah 1</span>
                    <span className="text-slate-500 font-mono text-sm">01</span>
                  </div>
                  <h5 className="font-bold text-white text-sm">Buka Spreadsheet Roster_Siswa</h5>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Di Google Drive Anda: Masuk ke folder <strong>Data Siswa dan Kelas</strong> di Google Drive Anda, lalu buka file spreadsheet <strong>Roster_Siswa</strong>.
                  </p>
                </div>

                {/* Step 2 */}
                <div className="p-4 bg-[#1a1a1c] rounded-2xl border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-indigo-400 font-bold">
                    <span className="text-[10px] px-2 py-0.5 bg-indigo-500/10 rounded-full border border-indigo-500/20">Langkah 2</span>
                    <span className="text-slate-500 font-mono text-sm">02</span>
                  </div>
                  <h5 className="font-bold text-white text-sm">Input Data Siswa (Format Kolom)</h5>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Isi daftar nama siswa, NIS/NISN, dan rombel/kelas sesuai dengan data sekolah Anda di sheet tersebut.
                  </p>
                </div>

                {/* Step 3 */}
                <div className="p-4 bg-[#1a1a1c] rounded-2xl border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-amber-400 font-bold">
                    <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 rounded-full border border-amber-500/20">Langkah 3</span>
                    <span className="text-slate-500 font-mono text-sm">03</span>
                  </div>
                  <h5 className="font-bold text-white text-sm">Sinkronkan Ke CBT</h5>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Kembali ke dashboard guru ini, pastikan status Database Utama Google Sheets sudah <em>"Terhubung ke Google Sheets"</em>. Jika belum, klik <strong>Uji Koneksi (Ping)</strong> di tab Sinkronisasi Cloud ini.
                  </p>
                </div>

                {/* Step 4 */}
                <div className="p-4 bg-[#1a1a1c] rounded-2xl border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-teal-400 font-bold">
                    <span className="text-[10px] px-2 py-0.5 bg-teal-500/10 rounded-full border border-teal-500/20">Langkah 4</span>
                    <span className="text-slate-500 font-mono text-sm">04</span>
                  </div>
                  <h5 className="font-bold text-white text-sm">Coba Buka Link Siswa (Verifikasi)</h5>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Buka kembali <strong>Mode Siswa (Tab Baru)</strong> atau bagikan Link Siswa. Pilihan nama yang muncul di dropdown login siswa akan otomatis mengacu pada data dari <strong>Roster_Siswa</strong>.
                  </p>
                </div>
              </div>
            </div>

            {/* Cara Verifikasi */}
            <div className="p-4 bg-emerald-950/30 border border-emerald-800/40 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Cara Verifikasi:</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Setelah menginput data di spreadsheet dan merefresh halaman siswa, periksa daftar drop-down nama saat siswa mau mulai ujian. Jika nama murid Anda sudah muncul (bukan nama contoh lagi), sinkronisasi berhasil.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowRosterGuide(false)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Tutup Panduan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
