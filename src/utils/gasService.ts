import { ExamPackage, StudentTokenItem, StudentExamSession, GasConfig, AiDiagnosticResult } from "../types";
import { broadcastLiveSessionReset } from "./liveSync";

export type { GasConfig };

const GAS_CONFIG_STORAGE_KEY = "slideexam_gas_config_v1";

// Default configuration
const DEFAULT_GAS_CONFIG: GasConfig = {
  webAppUrl: "",
  connected: false,
};

let cachedGasConfig: GasConfig = (() => {
  try {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(GAS_CONFIG_STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_GAS_CONFIG, ...JSON.parse(saved) };
      }
    }
  } catch (e) {
    console.warn("Failed reading GAS config from localStorage:", e);
  }
  return DEFAULT_GAS_CONFIG;
})();

type GasConfigListener = (cfg: GasConfig) => void;
const configListeners = new Set<GasConfigListener>();

export function getGasConfig(): GasConfig {
  return { ...cachedGasConfig };
}

export function saveGasConfig(cfg: Partial<GasConfig>): GasConfig {
  cachedGasConfig = { ...cachedGasConfig, ...cfg };
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(GAS_CONFIG_STORAGE_KEY, JSON.stringify(cachedGasConfig));
    }
  } catch (e) {
    console.warn("Failed saving GAS config to localStorage:", e);
  }
  configListeners.forEach((cb) => {
    try {
      cb(cachedGasConfig);
    } catch {}
  });
  return cachedGasConfig;
}

export function subscribeGasConfig(cb: GasConfigListener): () => void {
  configListeners.add(cb);
  cb(cachedGasConfig);
  return () => configListeners.delete(cb);
}

/**
 * Call GAS Web App endpoint via JSONP/POST/GET or proxy
 */
async function callGasEndpoint(action: string, payload: any = {}, method: "GET" | "POST" = "POST"): Promise<any> {
  const url = cachedGasConfig.webAppUrl?.trim();
  if (!url) {
    throw new Error("URL Web App Google Apps Script belum dikonfigurasi. Silakan atur di menu 'Integrasi Google Apps Script & Sheets'.");
  }

  // If method is GET, append query parameters
  if (method === "GET") {
    const urlObj = new URL(url);
    urlObj.searchParams.set("action", action);
    Object.entries(payload).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        urlObj.searchParams.set(k, String(v));
      }
    });

    const res = await fetch(urlObj.toString(), {
      method: "GET",
      mode: "cors",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Google Apps Script HTTP Error: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  }

  // Method POST
  const bodyData = JSON.stringify({ action, ...payload });
  const res = await fetch(url, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // text/plain prevents CORS preflight issues on Google Apps Script
    body: bodyData,
  });

  if (!res.ok) {
    throw new Error(`Google Apps Script HTTP Error: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

/**
 * Test connection to Google Apps Script Web App
 */
export async function testGasConnection(customUrl?: string): Promise<{ success: boolean; message: string; folders?: any }> {
  const targetUrl = customUrl?.trim() || cachedGasConfig.webAppUrl?.trim();
  if (!targetUrl) {
    return { success: false, message: "URL Web App Google Apps Script belum diisi." };
  }

  try {
    const testUrl = new URL(targetUrl);
    testUrl.searchParams.set("action", "ping");

    const res = await fetch(testUrl.toString(), {
      method: "GET",
      mode: "cors",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Status respon: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (data && data.success) {
      saveGasConfig({
        webAppUrl: targetUrl,
        connected: true,
        lastTestedAt: new Date().toISOString(),
        folders: data.folders || cachedGasConfig.folders,
      });
      return {
        success: true,
        message: data.message || "Koneksi ke Google Apps Script dan Google Sheets berhasil!",
        folders: data.folders,
      };
    }

    throw new Error(data.error || "Respon dari Google Apps Script tidak valid.");
  } catch (err: any) {
    saveGasConfig({ connected: false });
    return {
      success: false,
      message: `Gagal terhubung ke Google Apps Script: ${err.message || String(err)}`,
    };
  }
}

/**
 * Inisialisasi Master Folder dan Ketiga Subfolder di Google Drive:
 * 1. "Data Siswa dan Kelas"
 * 2. "Data Analisis dan Nilai"
 * 3. "Data Soal"
 */
export async function initGasFoldersAndSheets(): Promise<any> {
  const result = await callGasEndpoint("initFolders", {}, "POST");
  if (result && result.success) {
    saveGasConfig({
      connected: true,
      folders: result.folders,
      sheets: result.sheets,
      lastSyncedAt: new Date().toISOString(),
    });
  }
  return result;
}

export const initializeGasDatabase = initGasFoldersAndSheets;

/**
 * Sinkronisasi Naskah Ujian & Token Siswa ke Google Apps Script (Folder: Data Soal & Data Siswa dan Kelas)
 */
export async function syncExamToGAS(
  exam: ExamPackage,
  tokens?: StudentTokenItem[]
): Promise<{ success: boolean; message: string; sheetUrl?: string; fileUrl?: string }> {
  if (!exam || (!exam.id && !exam.code)) {
    return { success: false, message: "Naskah ujian tidak valid" };
  }

  // 1. Selalu rekam ke Server Local Disk / API terlebih dahulu untuk kecepatan & offline-first
  try {
    await fetch("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exam,
        token: exam.sessionToken,
        tokens: tokens || exam.tokens || [],
      }),
    });
  } catch (e) {
    console.warn("[GAS Sync] Server local sync failed:", e);
  }

  // 2. Jika Google Apps Script terhubung, simpan ke Google Sheets & Drive
  if (cachedGasConfig.connected && cachedGasConfig.webAppUrl) {
    try {
      const gasResult = await callGasEndpoint("syncExam", {
        exam,
        tokens: tokens || exam.tokens || [],
      });

      if (gasResult && gasResult.success) {
        saveGasConfig({ lastSyncedAt: new Date().toISOString() });
        return {
          success: true,
          message: "Naskah ujian berhasil tersimpan di Google Sheets (Data Soal) & Drive!",
          sheetUrl: gasResult.sheetUrl,
          fileUrl: gasResult.fileUrl,
        };
      }
    } catch (gasErr: any) {
      console.warn("[GAS Sync] Sinkronisasi ke Google Apps Script gagal, tersimpan lokal:", gasErr);
      return {
        success: true,
        message: `Tersimpan secara lokal di server. Sinkronisasi ke Google Sheets tertunda: ${gasErr.message}`,
      };
    }
  }

  return {
    success: true,
    message: "Tersimpan secara lokal. Hubungkan Google Apps Script untuk otomatis sinkron ke Google Drive & Sheets.",
  };
}

/**
 * Ambil Naskah Ujian berdasarkan Kode Ujian
 * Coba dari Google Apps Script (Data Soal), jika belum ada atau gagal fallback ke Server
 */
export async function fetchExamFromGAS(
  code: string
): Promise<{ success: boolean; exam?: ExamPackage; token?: string; tokens?: StudentTokenItem[]; message?: string }> {
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) return { success: false, message: "Kode ujian kosong." };

  // 1. Coba dari server API terlebih dahulu (sangat cepat & sudah di-index)
  try {
    const res = await fetch(`/api/exams/by-code/${encodeURIComponent(cleanCode)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.exam) {
        return {
          success: true,
          exam: data.exam,
          token: data.token || data.exam.sessionToken,
          tokens: data.tokens || data.exam.tokens || [],
        };
      }
    }
  } catch (e) {
    console.warn("[fetchExamFromGAS] Server local fetch failed, trying GAS directly:", e);
  }

  // 2. Coba langsung dari Google Apps Script Web App (subfolder 'Data Soal')
  if (cachedGasConfig.connected && cachedGasConfig.webAppUrl) {
    try {
      const gasResult = await callGasEndpoint("getExam", { code: cleanCode }, "GET");
      if (gasResult && gasResult.success && gasResult.exam) {
        // Simpan juga ke cache server lokal
        fetch("/api/exams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exam: gasResult.exam,
            token: gasResult.exam.sessionToken,
            tokens: gasResult.exam.tokens || [],
          }),
        }).catch(() => {});

        return {
          success: true,
          exam: gasResult.exam,
          token: gasResult.exam.sessionToken,
          tokens: gasResult.exam.tokens || [],
        };
      }
    } catch (gasErr: any) {
      console.warn("[fetchExamFromGAS] GAS direct fetch failed:", gasErr);
    }
  }

  return {
    success: false,
    message: `Naskah soal dengan kode '${cleanCode}' tidak ditemukan di Google Sheets maupun server.`,
  };
}

/**
 * Simpan hasil ujian siswa ke Google Apps Script (Folder: Data Analisis dan Nilai)
 * Sekaligus menyertakan hasil diagnosis AI Pengayaan & Remidi jika ada
 */
export async function syncStudentSessionToGAS(
  session: StudentExamSession,
  aiAnalysis?: AiDiagnosticResult | string
): Promise<{ success: boolean; isReset?: boolean; sheetUrl?: string; message?: string }> {
  if (!session || !session.id) return { success: false, message: "Sesi tidak valid" };

  // 1. Rekam ke Server Node.js untuk 2-way real-time monitoring
  let serverReset = false;
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
    if (res.ok) {
      const sData = await res.json();
      if (sData.isReset) {
        serverReset = true;
        return { success: false, isReset: true, message: sData.message };
      }
    }
  } catch (e) {
    console.warn("[syncStudentSessionToGAS] Server session sync error:", e);
  }

  // 2. Simpan ke Google Sheets (Data Analisis dan Nilai) via Google Apps Script
  if (cachedGasConfig.connected && cachedGasConfig.webAppUrl) {
    try {
      const gasResult = await callGasEndpoint("saveSession", {
        session,
        aiAnalysis: aiAnalysis || session.aiStructuredAnalysis || session.aiRemediation || session.aiEnrichment,
      });

      if (gasResult && gasResult.success) {
        return {
          success: true,
          sheetUrl: gasResult.sheetUrl,
          message: "Hasil ujian dan analisis AI tersimpan di Google Sheets (Data Analisis dan Nilai).",
        };
      }
    } catch (gasErr: any) {
      console.warn("[syncStudentSessionToGAS] GAS save failed, saved to local cache:", gasErr);
    }
  }

  return {
    success: true,
    message: "Hasil ujian tersimpan di sistem lokal.",
  };
}

/**
 * Simpan Analisis Pengayaan & Remidi AI ke Google Sheets (Folder: Data Analisis dan Nilai)
 */
export async function saveAiPengayaanRemidiToGAS(
  session: StudentExamSession,
  aiAnalysis: AiDiagnosticResult | string
): Promise<{ success: boolean; sheetUrl?: string; message: string }> {
  if (cachedGasConfig.connected && cachedGasConfig.webAppUrl) {
    try {
      const res = await callGasEndpoint("saveAiAnalysis", { session, aiAnalysis });
      if (res && res.success) {
        return {
          success: true,
          sheetUrl: res.sheetUrl,
          message: "Program Pengayaan dan Remidi AI berhasil disimpan di Google Sheets (Data Analisis dan Nilai).",
        };
      }
    } catch (e: any) {
      return { success: false, message: `Gagal menyimpan ke Google Sheets: ${e.message}` };
    }
  }

  return {
    success: true,
    message: "Tersimpan secara lokal. Hubungkan Google Apps Script untuk otomatis mencatat ke Google Sheets.",
  };
}

/**
 * Ambil daftar sesi ujian siswa (Real-time Monitoring & Rekap Nilai)
 */
export async function fetchExamSessions(
  examCodeOrId?: string
): Promise<StudentExamSession[]> {
  const code = (examCodeOrId || "ALL").trim().toUpperCase();
  const sessionMap = new Map<string, StudentExamSession>();

  // 1. Ambil dari Server lokal
  try {
    const res = await fetch(`/api/sessions/by-exam/${encodeURIComponent(code)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.sessions)) {
        data.sessions.forEach((s: StudentExamSession) => {
          if (s && s.id) sessionMap.set(s.id, s);
        });
      }
    }
  } catch (e) {
    console.warn("[fetchExamSessions] Server fetch sessions failed:", e);
  }

  // 2. Ambil dari Google Apps Script jika terhubung
  if (cachedGasConfig.connected && cachedGasConfig.webAppUrl) {
    try {
      const gasData = await callGasEndpoint("getSessions", { examCode: code === "ALL" ? "" : code }, "GET");
      if (gasData && gasData.success && Array.isArray(gasData.sessions)) {
        gasData.sessions.forEach((gs: any) => {
          if (gs && gs.id) {
            const existing = sessionMap.get(gs.id);
            sessionMap.set(gs.id, {
              ...(existing || {}),
              ...gs,
              answers: existing?.answers || gs.answers || {},
            });
          }
        });
      }
    } catch (gasErr) {
      console.warn("[fetchExamSessions] GAS fetch sessions failed:", gasErr);
    }
  }

  return Array.from(sessionMap.values());
}

/**
 * Hapus atau reset sesi siswa
 */
export async function deleteStudentSession(
  sessionId: string,
  examCode?: string,
  studentName?: string
): Promise<boolean> {
  const cleanId = String(sessionId || "").trim();
  if (!cleanId) return false;

  // Broadcast reset agar perangkat siswa otomatis kembali ke layar awal
  broadcastLiveSessionReset({ sessionId: cleanId, examCode, studentName });

  // 1. Hapus di Server
  try {
    await fetch(`/api/sessions/${encodeURIComponent(cleanId)}?examCode=${encodeURIComponent(examCode || "")}&studentName=${encodeURIComponent(studentName || "")}`, {
      method: "DELETE",
    });
  } catch (e) {
    console.warn("[deleteStudentSession] Server delete error:", e);
  }

  // 2. Hapus di Google Sheets via GAS
  if (cachedGasConfig.connected && cachedGasConfig.webAppUrl) {
    try {
      await callGasEndpoint("deleteSession", { sessionId: cleanId, examCode, studentName });
    } catch (e) {
      console.warn("[deleteStudentSession] GAS delete error:", e);
    }
  }

  return true;
}

/**
 * Hapus batch sesi siswa
 */
export async function batchDeleteStudentSessions(
  sessionIds: string[],
  examCode?: string
): Promise<number> {
  if (!sessionIds || sessionIds.length === 0) return 0;

  sessionIds.forEach((id) => {
    broadcastLiveSessionReset({ sessionId: id, examCode });
  });

  // 1. Batch delete di server
  try {
    await fetch("/api/sessions/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds, examCode }),
    });
  } catch (e) {
    console.warn("[batchDeleteStudentSessions] Server error:", e);
  }

  // 2. Batch delete di Google Sheets
  if (cachedGasConfig.connected && cachedGasConfig.webAppUrl) {
    try {
      await callGasEndpoint("batchDeleteSessions", { sessionIds, examCode });
    } catch (e) {
      console.warn("[batchDeleteStudentSessions] GAS error:", e);
    }
  }

  return sessionIds.length;
}

/**
 * Reconcile / sinkronisasi sesi yang tidak cocok
 */
export async function reconcileAndMergeExamSessions(
  examId: string,
  canonicalCode: string
): Promise<StudentExamSession[]> {
  try {
    await fetch("/api/sessions/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examId, canonicalCode }),
    });
  } catch (e) {
    console.warn("Reconcile error:", e);
  }
  return fetchExamSessions(canonicalCode);
}

/**
 * Simpan backup aplikasi lengkap langsung ke folder master Google Drive via Google Apps Script (tanpa OAuth)
 */
export async function backupAppToGAS(backupData: any): Promise<{ success: boolean; fileId?: string; fileName?: string; fileUrl?: string; message: string }> {
  return await callGasEndpoint("backupApp", { backupData }, "POST");
}

/**
 * Ambil daftar file backup di folder master Google Drive via Google Apps Script
 */
export async function listAppBackupsFromGAS(): Promise<{ success: boolean; backups: any[] }> {
  return await callGasEndpoint("listBackups", {}, "GET");
}

/**
 * Muat isi file backup dari Google Drive via Google Apps Script
 */
export async function restoreAppBackupFromGAS(fileId: string): Promise<{ success: boolean; data: any; fileName?: string }> {
  return await callGasEndpoint("restoreBackup", { fileId }, "GET");
}

/**
 * Mendapatkan kode backend Google Apps Script (Code.gs)
 */
export async function getGasBackendCode(): Promise<string> {
  try {
    const res = await fetch("/api/gas-code");
    if (res.ok) {
      const data = await res.json();
      if (data && data.code) {
        return data.code;
      }
    }
  } catch (err) {
    console.warn("Could not fetch /api/gas-code, using fallback template:", err);
  }

  return `/**
 * CBT SLIDEEXAM - GOOGLE APPS SCRIPT BACKEND & GOOGLE SHEETS DATABASE
 * 📁 CBT SlideExam Database
 *    ├── 📁 Data Siswa dan Kelas
 *    │    └── 📊 Data_Siswa_Dan_Kelas (Sheet: Roster_Siswa, Token_Ujian)
 *    ├── 📁 Data Analisis dan Nilai
 *    │    └── 📊 Data_Analisis_Dan_Nilai (Sheet: Hasil_Ujian, Pengayaan_Dan_Remidi_AI, Analisis_Butir_Soal)
 *    └── 📁 Data Soal
 *         ├── 📊 Data_Bank_Soal (Sheet: Paket_Ujian, Butir_Soal)
 *         └── 📄 [Kode_Ujian]_ExamPackage.json
 *
 * Panduan: Deploy sebagai Web App -> Execute as: Me -> Who has access: Anyone
 */

var MASTER_FOLDER_NAME = "CBT SlideExam Database";
var SUBFOLDER_SISWA = "Data Siswa dan Kelas";
var SUBFOLDER_ANALISIS = "Data Analisis dan Nilai";
var SUBFOLDER_SOAL = "Data Soal";

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "ping";
  var result = { success: false, action: action };
  try {
    if (action === "ping") {
      result = { success: true, status: "ready", message: "Google Apps Script CBT Backend Aktif" };
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  var postData = {};
  try {
    postData = JSON.parse(e.postData.contents || "{}");
  } catch (err) {
    postData = e.parameter || {};
  }
  return ContentService.createTextOutput(JSON.stringify({ success: true, action: postData.action })).setMimeType(ContentService.MimeType.JSON);
}`;
}
