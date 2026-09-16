import { ExamPackage, StudentTokenItem, StudentExamSession, GasConfig, AiDiagnosticResult } from "../types";
import { broadcastLiveSessionReset } from "./liveSync";
import { getStudentTokens } from "./storage";

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

export function isGasConfigured(): boolean {
  return Boolean(cachedGasConfig.webAppUrl && cachedGasConfig.webAppUrl.trim().length > 0);
}

export function subscribeGasConfig(cb: GasConfigListener): () => void {
  configListeners.add(cb);
  cb(cachedGasConfig);
  return () => configListeners.delete(cb);
}

/**
 * Call GAS Web App endpoint via Server-Side Proxy (/api/gas/proxy) with direct fallback
 * This eliminates all browser CORS preflight restrictions, cross-origin 302 redirects, and iframe blocks.
 */
async function callGasEndpoint(
  action: string,
  payload: any = {},
  method: "GET" | "POST" = "POST",
  overrideUrl?: string
): Promise<any> {
  const url = (overrideUrl || cachedGasConfig.webAppUrl)?.trim();
  if (!url) {
    throw new Error("URL Web App Google Apps Script belum dikonfigurasi. Silakan atur di menu 'Integrasi Google Apps Script & Sheets'.");
  }

  // 1. Prioritaskan pemanggilan melalui Server Proxy (/api/gas/proxy)
  // Server-side call tidak terhalang oleh CORS browser, redirect cross-origin 302, maupun batasan iframe
  try {
    const proxyRes = await fetch("/api/gas/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, action, payload, method }),
    });

    const data = await proxyRes.json().catch(() => null);
    if (proxyRes.ok && data) {
      return data;
    }

    if (data && data.error) {
      throw new Error(data.error);
    }
  } catch (proxyErr: any) {
    // Jika error spesifik seperti hak akses / login dibutuhkan, langsung teruskan pesannya ke user
    if (proxyErr.message && !proxyErr.message.includes("Failed to fetch")) {
      throw proxyErr;
    }
    console.warn("[GAS] Proxy server tidak dapat diakses, mencoba direct fetch fallback:", proxyErr);
  }

  // 2. Fallback direct browser fetch (jika server proxy offline / static host)
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
    headers: { "Content-Type": "text/plain;charset=utf-8" },
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
    const data = await callGasEndpoint("ping", {}, "GET", targetUrl);

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

    throw new Error(data?.error || "Respon dari Google Apps Script tidak valid.");
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
): Promise<{
  success: boolean;
  message: string;
  sheetUrl?: string;
  sheetSoalUrl?: string;
  sheetSiswaUrl?: string;
  fileUrl?: string;
  questionsCount?: number;
  studentsCount?: number;
}> {
  if (!exam || (!exam.id && !exam.code)) {
    return { success: false, message: "Naskah ujian tidak valid" };
  }

  // Tentukan daftar siswa & token yang efektif (tidak boleh kosong saat sync)
  let effectiveTokens: StudentTokenItem[] = [];
  if (tokens && tokens.length > 0) {
    effectiveTokens = tokens;
  } else if (exam.tokens && exam.tokens.length > 0) {
    effectiveTokens = exam.tokens;
  } else {
    try {
      effectiveTokens = getStudentTokens();
    } catch {
      effectiveTokens = [];
    }
  }

  // Lengkapi examCode pada token jika belum ada
  if (effectiveTokens.length > 0) {
    effectiveTokens = effectiveTokens.map((t) => ({
      ...t,
      examCode: t.examCode || exam.code,
    }));
  }

  // 1. Selalu rekam ke Server Local Disk / API terlebih dahulu untuk kecepatan & offline-first
  try {
    await fetch("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exam,
        token: exam.sessionToken,
        tokens: effectiveTokens,
      }),
    });
  } catch (e) {
    console.warn("[GAS Sync] Server local sync failed:", e);
  }

  // 2. Jika Google Apps Script terhubung, simpan ke Google Sheets & Drive
  if (isGasConfigured()) {
    try {
      const gasResult = await callGasEndpoint("syncExam", {
        exam,
        tokens: effectiveTokens,
      });

      if (gasResult && gasResult.success) {
        saveGasConfig({
          connected: true,
          lastSyncedAt: new Date().toISOString(),
          sheets: {
            ...cachedGasConfig.sheets,
            ...(gasResult.sheetSoalUrl ? { soal: { url: gasResult.sheetSoalUrl } } : {}),
            ...(gasResult.sheetSiswaUrl ? { siswa: { url: gasResult.sheetSiswaUrl } } : {}),
          },
        });
        return {
          success: true,
          message:
            gasResult.message ||
            `Naskah ujian (${gasResult.questionsCount || exam.questions?.length || 0} butir) & data siswa (${gasResult.studentsCount ?? effectiveTokens.length} siswa) berhasil tersimpan di Google Sheets & Drive!`,
          sheetUrl: gasResult.sheetSoalUrl || gasResult.sheetUrl,
          sheetSoalUrl: gasResult.sheetSoalUrl || gasResult.sheetUrl,
          sheetSiswaUrl: gasResult.sheetSiswaUrl,
          fileUrl: gasResult.fileUrl,
          questionsCount: gasResult.questionsCount || exam.questions?.length || 0,
          studentsCount: gasResult.studentsCount !== undefined ? gasResult.studentsCount : effectiveTokens.length,
        };
      }
    } catch (gasErr: any) {
      console.warn("[GAS Sync] Sinkronisasi ke Google Apps Script gagal, tersimpan lokal:", gasErr);
      return {
        success: true,
        message: `Tersimpan secara lokal di server. Sinkronisasi ke Google Sheets tertunda: ${gasErr.message}`,
        questionsCount: exam.questions?.length || 0,
        studentsCount: effectiveTokens.length,
      };
    }
  }

  return {
    success: true,
    message: "Tersimpan secara lokal. Hubungkan Google Apps Script untuk otomatis sinkron ke Google Drive & Sheets.",
    questionsCount: exam.questions?.length || 0,
    studentsCount: effectiveTokens.length,
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
  if (isGasConfigured()) {
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
 * Ambil daftar seluruh Naskah Ujian yang tersimpan di Google Apps Script (Folder: Data Soal)
 */
export async function listExamsFromGAS(): Promise<{ success: boolean; exams?: any[]; message?: string }> {
  if (!isGasConfigured()) {
    return { success: false, message: "URL Web App Google Apps Script belum dikonfigurasi." };
  }
  try {
    const res = await callGasEndpoint("listExams", {}, "GET");
    if (res && res.success) {
      return { success: true, exams: res.exams || [] };
    }
    return { success: false, message: res?.error || "Gagal mengambil daftar naskah dari Google Apps Script." };
  } catch (err: any) {
    return { success: false, message: err?.message || "Gagal memuat naskah dari Google Apps Script." };
  }
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
 * Ambil daftar nama siswa asli (Roster_Siswa) dari Spreadsheet 'Data_Siswa_Dan_Kelas' via Google Apps Script
 */
export async function fetchStudentRosterFromGAS(
  examCode?: string,
  className?: string
): Promise<{ success: boolean; roster: StudentTokenItem[]; count: number; spreadsheetUrl?: string; message?: string }> {
  try {
    const res = await callGasEndpoint("getRoster", { examCode, className }, "GET");
    if (res && res.success && Array.isArray(res.roster)) {
      return {
        success: true,
        roster: res.roster,
        count: res.roster.length,
        spreadsheetUrl: res.spreadsheetUrl,
      };
    }
    return {
      success: false,
      roster: [],
      count: 0,
      message: res?.error || "Gagal memuat data roster siswa dari Google Sheets.",
    };
  } catch (err: any) {
    return {
      success: false,
      roster: [],
      count: 0,
      message: err?.message || String(err),
    };
  }
}

/**
 * Simpan atau perbarui daftar siswa (Roster_Siswa) ke Spreadsheet 'Data_Siswa_Dan_Kelas' via Google Apps Script
 */
export async function saveStudentRosterToGAS(
  roster: StudentTokenItem[],
  examCode?: string
): Promise<{ success: boolean; count?: number; sheetUrl?: string; message?: string }> {
  return await callGasEndpoint("saveRoster", { roster, examCode }, "POST");
}

/**
 * Mendapatkan kode backend Google Apps Script (Code.gs)
 */
export async function getGasBackendCode(spreadsheetId?: string): Promise<string> {
  const targetId = spreadsheetId || "1jgREm74oAftju7CWA0mv4fBq0Cz-sar3E7GvbgljUJg";
  try {
    const query = targetId ? `?spreadsheetId=${encodeURIComponent(targetId)}` : "";
    const res = await fetch(`/api/gas-code${query}`);
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

var SPREADSHEET_ID = "${targetId}";
var MASTER_FOLDER_NAME = "CBT SlideExam Database";
var SUBFOLDER_SISWA = "Data Siswa dan Kelas";
var SUBFOLDER_ANALISIS = "Data Analisis dan Nilai";
var SUBFOLDER_SOAL = "Data Soal";

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "ping";
  var result = { success: false, action: action };
  try {
    if (action === "ping") {
      var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      result = {
        success: true,
        status: "ready",
        message: "Google Apps Script CBT Backend Aktif",
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl()
      };
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  var data = {};
  try {
    data = JSON.parse(e.postData.contents || "{}");
  } catch (err) {
    data = e.parameter || {};
  }

  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (data.targetSheet) {
      var targetSheetName = String(data.targetSheet).trim();
      var sheet = ss.getSheetByName(targetSheetName);

      // Error handling jika sheet tujuan tidak ditemukan
      if (!sheet) {
        var available = ss.getSheets().map(function(s) { return s.getName(); });
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          error: "Sheet '" + targetSheetName + "' tidak ditemukan di spreadsheet.",
          missingSheet: targetSheetName,
          availableSheets: available
        })).setMimeType(ContentService.MimeType.JSON);
      }

      // Tulis baris data
      if (data.rowValues && Array.isArray(data.rowValues)) {
        sheet.appendRow(data.rowValues);
      } else if (data.row && Array.isArray(data.row)) {
        sheet.appendRow(data.row);
      }

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: "Data berhasil ditulis ke sheet '" + targetSheetName + "'",
        targetSheet: targetSheetName,
        spreadsheetUrl: ss.getUrl()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      action: data.action,
      spreadsheetId: ss.getId()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}`;
}
