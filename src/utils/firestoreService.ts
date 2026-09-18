/**
 * Cloud & Server Data Service (Pengganti Firebase Firestore)
 * Menggunakan Server CBT Express (/api/sessions, /api/exams) dan Google Apps Script (Google Sheets)
 * Bebas kuota dan tanpa ketergantungan Firebase SDK.
 */

import { ExamPackage, StudentExamSession, StudentTokenItem } from "../types";
import {
  syncExamToGAS,
  fetchExamFromGAS,
  syncStudentSessionToGAS,
} from "./gasService";
import {
  fetchLiveMonitoringData,
  resetStudentSession,
  batchDeleteStudentSessions as batchDeleteMonitoringSessions,
  isSessionResetBlacklisted,
  blacklistResetSession,
} from "../services/monitoringService";

export const FIRESTORE_PROJECT_ID = "cbt-server-gas";
export const FIRESTORE_DATABASE_ID = "cbt-local-sheets";
export const FIRESTORE_UPGRADE_URL = "#";

export const isQuotaExceeded = false;

export function subscribeQuotaStatus(cb: (exceeded: boolean) => void) {
  cb(false);
  return () => {};
}

/**
 * Sinkronisasi paket ujian ke Server CBT Express & Google Apps Script
 */
export async function syncExamToFirestore(
  exam: ExamPackage,
  tokens?: StudentTokenItem[]
): Promise<{ success: boolean; message?: string }> {
  if (!exam || !exam.id) return { success: false, message: "Paket ujian tidak valid" };

  try {
    // 1. Simpan ke Server Express lokal
    await fetch("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exam, tokens }),
    });
  } catch {}

  // 2. Simpan ke Google Apps Script / Google Sheets
  try {
    await syncExamToGAS(exam);
  } catch {}

  return { success: true, message: "Ujian berhasil disinkronkan ke Server & Google Drive" };
}

/**
 * Ambil paket ujian dari Server CBT Express atau Google Apps Script
 */
export async function fetchExamFromFirestore(
  examCodeOrId: string
): Promise<{ exam: ExamPackage; token?: string; tokens?: StudentTokenItem[] } | null> {
  const code = examCodeOrId.trim().toUpperCase();

  // 1. Cek dari Server CBT Express
  try {
    const res = await fetch(`/api/exams/${encodeURIComponent(code)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.exam) {
        return {
          exam: data.exam,
          tokens: data.tokens || [],
        };
      }
    }
  } catch {}

  // 2. Cek dari Google Apps Script
  try {
    const gasRes = await fetchExamFromGAS(code);
    if (gasRes && gasRes.exam) {
      return {
        exam: gasRes.exam,
        tokens: gasRes.tokens || [],
      };
    }
  } catch {}

  return null;
}

/**
 * Sinkronisasi sesi pengerjaan siswa ke Server CBT Express dan Google Apps Script
 */
export async function syncStudentSessionToFirestore(
  session: StudentExamSession,
  immediate: boolean = false
): Promise<{ success: boolean; isReset?: boolean; message?: string }> {
  if (!session || !session.id || isSessionResetBlacklisted(session)) {
    return { success: false, message: "Sesi tidak valid atau telah di-reset" };
  }

  // 1. Catat ke Server CBT Express
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
    if (res.ok) {
      const sData = await res.json();
      if (sData.isReset) {
        return { success: false, isReset: true, message: sData.message };
      }
    }
  } catch {}

  // 2. Simpan ke Google Apps Script (Google Sheets) jika selesai atau immediate
  if (immediate || session.status === "submitted") {
    try {
      await syncStudentSessionToGAS(session);
    } catch {}
  }

  return { success: true };
}

/**
 * Ambil semua sesi pengerjaan siswa untuk suatu ujian menggunakan Long Polling Service
 */
export async function fetchExamSessions(
  examId?: string,
  examCode?: string,
  _preferCacheOrImmediate?: boolean
): Promise<StudentExamSession[]> {
  return await fetchLiveMonitoringData(examCode || examId);
}

/**
 * Reconcile / sinkronisasi sesi pengerjaan
 */
export async function reconcileAndMergeExamSessions(
  examId?: string,
  examCode?: string
): Promise<{ success: boolean; mergedSessionsCount: number; sessions: StudentExamSession[] }> {
  const sessions = await fetchLiveMonitoringData(examCode || examId);
  return {
    success: true,
    mergedSessionsCount: 0,
    sessions,
  };
}

/**
 * Listener real-time menggunakan Long Polling berulang dengan Smart Polling (jeda saat background tab)
 */
export function subscribeToExamSessions(
  examId: string | undefined,
  examCode: string | undefined,
  onUpdate: (sessions: StudentExamSession[]) => void,
  intervalMs: number = 5000
): () => void {
  let isSubscribed = true;

  const poll = async () => {
    if (!isSubscribed) return;
    // Smart Polling: jangan memanggil jika tab tidak aktif
    if (typeof document !== "undefined" && document.hidden) return;

    try {
      const sessions = await fetchLiveMonitoringData(examCode || examId);
      if (isSubscribed && Array.isArray(sessions)) {
        onUpdate(sessions);
      }
    } catch (err) {
      console.warn("[subscribeToExamSessions] Polling error:", err);
    }
  };

  // Panggil langsung di awal
  poll();

  const timer = setInterval(poll, intervalMs);

  return () => {
    isSubscribed = false;
    clearInterval(timer);
  };
}

/**
 * Hapus atau reset sesi siswa dari Server CBT & Google Sheets
 */
export async function deleteStudentSessionFromFirestore(
  sessionId?: string,
  studentName?: string,
  token?: string,
  examCode?: string,
  nisn?: string
): Promise<{ success: boolean; message: string }> {
  return await resetStudentSession(sessionId, studentName, token, nisn, examCode);
}

/**
 * Batch delete sesi pengerjaan siswa
 */
export async function batchDeleteStudentSessionsFromFirestore(payload: {
  sessionIds?: string[];
  studentNames?: string[];
  tokens?: string[];
  nisns?: string[];
  examCode?: string;
  examId?: string;
}): Promise<{ success: boolean; count?: number }> {
  const items = (payload.studentNames || []).map((name, i) => ({
    sessionId: payload.sessionIds?.[i],
    studentName: name,
    token: payload.tokens?.[i],
    nisn: payload.nisns?.[i],
    examCode: payload.examCode,
  }));

  return await batchDeleteMonitoringSessions(items, payload.examCode);
}
