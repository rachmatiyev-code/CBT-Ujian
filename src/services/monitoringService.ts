import { StudentExamSession, StudentTokenItem } from "../types";
import { getGasConfig } from "../utils/gasService";
import { broadcastLiveSession } from "../utils/liveSync";

// In-memory and localStorage blacklist of recently reset/deleted sessions
// This guarantees that long polling or asynchronous cloud sync doesn't resurrect sessions that were just reset/deleted
const RESET_BLACKLIST_KEY = "cbt_reset_blacklist_sessions";

interface BlacklistEntry {
  expiresAt: number;
  sessionId?: string;
  studentName?: string;
  nisn?: string;
  examCode?: string;
}

function getStoredBlacklist(): BlacklistEntry[] {
  try {
    const raw = localStorage.getItem(RESET_BLACKLIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const now = Date.now();
    return Array.isArray(parsed) ? parsed.filter((item: BlacklistEntry) => item.expiresAt > now) : [];
  } catch {
    return [];
  }
}

function saveBlacklist(entries: BlacklistEntry[]) {
  try {
    const now = Date.now();
    const active = entries.filter((item) => item.expiresAt > now);
    localStorage.setItem(RESET_BLACKLIST_KEY, JSON.stringify(active));
  } catch {}
}

/**
 * Catat siswa / sesi yang baru direset atau dihapus ke blacklist
 */
export function blacklistResetSession(
  sessionId?: string,
  studentName?: string,
  token?: string,
  nisn?: string,
  examCode?: string,
  durationMs: number = 60000 // 60 detik perlindungan
) {
  const expiresAt = Date.now() + durationMs;
  const entries = getStoredBlacklist();
  entries.push({
    expiresAt,
    sessionId: sessionId ? sessionId.trim() : undefined,
    studentName: studentName ? studentName.trim().toLowerCase() : undefined,
    nisn: nisn ? nisn.trim() : undefined,
    examCode: examCode ? examCode.trim().toUpperCase() : undefined,
  });
  saveBlacklist(entries);
}

/**
 * Cek apakah sesi ini ada di daftar hitam (baru saja direset/dihapus)
 */
export function isSessionResetBlacklisted(
  session: Partial<StudentExamSession> | { id?: string; studentName?: string; nisn?: string; examCode?: string }
): boolean {
  if (!session) return false;
  const entries = getStoredBlacklist();
  if (entries.length === 0) return false;

  const sId = session.id ? session.id.trim() : "";
  const sName = session.studentName ? session.studentName.trim().toLowerCase() : "";
  const sNisn = session.nisn ? session.nisn.trim() : "";
  const sExamCode = session.examCode ? session.examCode.trim().toUpperCase() : "";

  return entries.some((entry) => {
    if (sId && entry.sessionId && entry.sessionId === sId) return true;
    if (sName && entry.studentName && entry.studentName === sName) {
      if (!entry.examCode || !sExamCode || entry.examCode === sExamCode) return true;
    }
    if (sNisn && entry.nisn && entry.nisn === sNisn) {
      if (!entry.examCode || !sExamCode || entry.examCode === sExamCode) return true;
    }
    return false;
  });
}

/**
 * Mengambil data live monitoring siswa dari Server CBT & Google Apps Script
 * Menggunakan Long Polling berulang dengan deduplikasi dan proteksi sesi reset.
 */
export const fetchLiveMonitoringData = async (
  examCode?: string
): Promise<StudentExamSession[]> => {
  const cleanCode = (examCode || "").trim().toUpperCase();
  const sessionsMap = new Map<string, StudentExamSession>();

  // 1. Ambil dari Server CBT Express Memory/Disk (/api/sessions)
  try {
    const url = cleanCode
      ? `/api/sessions/by-exam/${encodeURIComponent(cleanCode)}`
      : `/api/sessions`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.sessions)) {
        data.sessions.forEach((s: StudentExamSession) => {
          if (s && s.id && !isSessionResetBlacklisted(s)) {
            sessionsMap.set(s.id, s);
          }
        });
      }
    }
  } catch (err) {
    console.warn("[monitoringService] Gagal fetch dari server CBT:", err);
  }

  // 2. Ambil dari Google Apps Script Web App (Long Polling via doGet action=getMonitoring)
  const gasConfig = getGasConfig();
  if (gasConfig.webAppUrl && gasConfig.webAppUrl.trim()) {
    try {
      const gasUrl = new URL(gasConfig.webAppUrl.trim());
      gasUrl.searchParams.set("action", "getMonitoring");
      if (cleanCode) {
        gasUrl.searchParams.set("examCode", cleanCode);
      }

      // Prioritas panggil melalui Server Proxy (/api/gas/proxy) untuk menghindari kendala CORS & redirect
      let gasData: any = null;
      try {
        const proxyRes = await fetch("/api/gas/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: gasConfig.webAppUrl.trim(),
            action: "getMonitoring",
            payload: { examCode: cleanCode },
            method: "GET",
          }),
        });
        if (proxyRes.ok) {
          gasData = await proxyRes.json();
        }
      } catch {}

      // Fallback pemanggilan langsung jika server proxy tidak merespon
      if (!gasData || !gasData.success) {
        const directRes = await fetch(gasUrl.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (directRes.ok) {
          gasData = await directRes.json();
        }
      }

      if (gasData && gasData.success && Array.isArray(gasData.students)) {
        gasData.students.forEach((item: any) => {
          const sessId = item.sessionId || item.id || `gas-${item.studentId || item.name}`;
          if (isSessionResetBlacklisted({ id: sessId, studentName: item.name, nisn: item.studentId, examCode: cleanCode })) {
            return;
          }

          const existing = sessionsMap.get(sessId);
          if (!existing) {
            // Konversi record GAS Hasil_Ujian menjadi StudentExamSession
            const isFinished = String(item.status || "").toLowerCase().includes("selesai") || String(item.status || "").toLowerCase().includes("submitted");
            const parsedScore = Number(item.score || 0);
            const parsedPercentage = Number(item.percentage || item.score || 0);

            const sessionFromGas: StudentExamSession = {
              id: sessId,
              examId: item.examId || cleanCode,
              examCode: item.examCode || cleanCode,
              examTitle: item.examTitle || "",
              studentName: item.name || item.studentName || "",
              nisn: item.studentId || item.nisn || "",
              className: item.class || item.className || "",
              token: item.token || "",
              status: isFinished ? "submitted" : "in_progress",
              totalScoreEarned: parsedScore,
              maxScore: item.maxScore || 100,
              percentage: parsedPercentage,
              passed: item.passed !== undefined ? Boolean(item.passed) : parsedPercentage >= 70,
              timeSpentSeconds: item.timeSpentSeconds || (Number(item.timeSpentMinutes || 0) * 60) || 0,
              subject: item.subject || "",
              startTime: item.startTime || item.timestamp || new Date().toISOString(),
              submitTime: item.timestamp || item.submitTime || new Date().toISOString(),
              currentSlideIndex: item.currentSlideIndex || 0,
              answers: item.answers || {},
            };
            sessionsMap.set(sessId, sessionFromGas);
          } else {
            // Merge jika versi GAS memiliki update
            if (item.status === "submitted" && existing.status !== "submitted") {
              existing.status = "submitted";
              existing.percentage = Number(item.percentage || item.score || existing.percentage);
            }
          }
        });
      }
    } catch (err) {
      console.warn("[monitoringService] Gagal fetch getMonitoring dari GAS:", err);
    }
  }

  return Array.from(sessionsMap.values());
};

/**
 * Reset sesi pengerjaan siswa:
 * 1. Blacklist agar tidak ter-restore dari polling berikutnya
 * 2. Hapus dari Server CBT Express (/api/sessions/:id)
 * 3. Hapus baris dari Google Sheets (Hasil_Ujian, Analisis_Butir_Soal, Pengayaan_Dan_Remidi_AI) via GAS
 * 4. Broadcast event reset ke tab/perangkat siswa agar langsung tereset seketika
 */
export async function resetStudentSession(
  sessionId?: string,
  studentName?: string,
  token?: string,
  nisn?: string,
  examCode?: string
): Promise<{ success: boolean; message: string }> {
  const cleanId = sessionId ? sessionId.trim() : "";
  const cleanName = studentName ? studentName.trim() : "";
  const cleanToken = token ? token.trim() : "";
  const cleanNisn = nisn ? nisn.trim() : "";
  const cleanExamCode = examCode ? examCode.trim().toUpperCase() : "";

  // 1. Blacklist segera
  blacklistResetSession(cleanId, cleanName, cleanToken, cleanNisn, cleanExamCode, 90000);

  // 2. Broadcast ke perangkat siswa
  broadcastLiveSession({
    id: cleanId,
    studentName: cleanName,
    token: cleanToken,
    nisn: cleanNisn,
    examCode: cleanExamCode,
    isReset: true,
    resetAt: Date.now(),
  } as any);

  // 3. Panggil DELETE ke Server CBT Express
  try {
    const url = `/api/sessions/${encodeURIComponent(cleanId || "by-filter")}?examCode=${encodeURIComponent(cleanExamCode)}&studentName=${encodeURIComponent(cleanName)}&nisn=${encodeURIComponent(cleanNisn)}`;
    await fetch(url, { method: "DELETE" });
  } catch (err) {
    console.warn("[monitoringService] Server session delete error:", err);
  }

  // 4. Panggil Google Apps Script deleteSession
  const gasConfig = getGasConfig();
  if (gasConfig.webAppUrl && gasConfig.webAppUrl.trim()) {
    try {
      await fetch("/api/gas/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: gasConfig.webAppUrl.trim(),
          action: "deleteSession",
          payload: {
            sessionId: cleanId,
            examCode: cleanExamCode,
            studentName: cleanName,
            nisn: cleanNisn,
          },
        }),
      });
    } catch (gasErr) {
      console.warn("[monitoringService] GAS deleteSession error:", gasErr);
    }
  }

  return {
    success: true,
    message: `Sesi pengerjaan siswa "${cleanName || cleanId}" berhasil di-reset.`,
  };
}

/**
 * Hapus permanen data siswa (sesi, jawaban, dan token)
 */
export async function deleteStudentPermanently(payload: {
  sessionId?: string;
  tokenId?: string;
  studentName: string;
  token?: string;
  nisn?: string;
  examCode?: string;
}): Promise<{ success: boolean; message: string }> {
  // Jalankan reset sesi server & GAS
  await resetStudentSession(
    payload.sessionId,
    payload.studentName,
    payload.token,
    payload.nisn,
    payload.examCode
  );

  return {
    success: true,
    message: `Data siswa "${payload.studentName}" berhasil dihapus permanen.`,
  };
}

/**
 * Batch delete multiple student sessions
 */
export async function batchDeleteStudentSessions(
  items: Array<{
    sessionId?: string;
    tokenId?: string;
    studentName: string;
    token?: string;
    nisn?: string;
    examCode?: string;
  }>,
  examCode?: string
): Promise<{ success: boolean; count: number }> {
  const sessionIds: string[] = [];
  const studentNames: string[] = [];
  const nisns: string[] = [];

  items.forEach((it) => {
    if (it.sessionId) sessionIds.push(it.sessionId);
    if (it.studentName) studentNames.push(it.studentName);
    if (it.nisn) nisns.push(it.nisn);
    blacklistResetSession(it.sessionId, it.studentName, it.token, it.nisn, it.examCode || examCode, 90000);
  });

  // Broadcast resets
  items.forEach((it) => {
    broadcastLiveSession({
      id: it.sessionId,
      studentName: it.studentName,
      token: it.token,
      nisn: it.nisn,
      examCode: it.examCode || examCode,
      isReset: true,
      resetAt: Date.now(),
    } as any);
  });

  // Call Server batch delete
  try {
    await fetch("/api/sessions/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds, studentNames, nisns, examCode }),
    });
  } catch {}

  // Call GAS batch delete
  const gasConfig = getGasConfig();
  if (gasConfig.webAppUrl && gasConfig.webAppUrl.trim()) {
    try {
      await fetch("/api/gas/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: gasConfig.webAppUrl.trim(),
          action: "batchDeleteSessions",
          payload: { sessionIds, examCode, studentNames },
        }),
      });
    } catch {}
  }

  return { success: true, count: items.length };
}
