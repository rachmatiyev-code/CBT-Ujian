/**
 * Firebase Firestore Cloud Database Service
 * Dedicated persistent database linked to Google Cloud / Firebase:
 * Project: ungoogly-rigging-s6rpq
 * User: rachmatiyev@gmail.com
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";
import firebaseConfig from "../../firebase-applet-config.json";
import { ExamPackage, StudentTokenItem, StudentExamSession } from "../types";
import {
  syncExamToGAS,
  fetchExamFromGAS,
  syncStudentSessionToGAS,
  fetchExamSessions as fetchSessionsGAS,
  deleteStudentSession as deleteSessionGAS,
  batchDeleteStudentSessions as batchDeleteSessionsGAS,
  reconcileAndMergeExamSessions as reconcileGAS,
} from "./gasService";

export const FIRESTORE_PROJECT_ID = (firebaseConfig as any).projectId || "ungoogly-rigging-s6rpq";
export const FIRESTORE_DATABASE_ID = (firebaseConfig as any).firestoreDatabaseId || "(default)";
export const FIRESTORE_UPGRADE_URL = `https://console.firebase.google.com/project/${FIRESTORE_PROJECT_ID}/firestore`;

// Helper to remove undefined fields which Firestore does not accept
function sanitizeForFirestore<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_, v) => (v === undefined ? null : v)));
}

let quotaExceededState = false;
const quotaListeners = new Set<(exceeded: boolean) => void>();

export function isQuotaExceeded(): boolean {
  return quotaExceededState;
}

export function subscribeQuotaStatus(cb: (exceeded: boolean) => void): () => void {
  quotaListeners.add(cb);
  cb(quotaExceededState);
  return () => {
    quotaListeners.delete(cb);
  };
}

export function markQuotaExceeded(_reason: string): void {
  quotaExceededState = true;
  quotaListeners.forEach((fn) => fn(true));
}

export function resetQuotaCheck(): void {
  quotaExceededState = false;
  quotaListeners.forEach((fn) => fn(false));
}

/**
 * Sinkronisasi naskah ujian ke Firestore Cloud Database (dan Google Sheets sebagai cadangan)
 */
export async function syncExamToFirestore(
  exam: ExamPackage,
  tokens?: StudentTokenItem[],
  _silentOrOptions?: boolean | { isStudentClient?: boolean },
  _targetFolder?: any,
  _options?: any
): Promise<boolean> {
  let firestoreSuccess = false;
  try {
    const cleanExam = sanitizeForFirestore(exam);
    const cleanTokens = tokens ? sanitizeForFirestore(tokens) : [];

    // 1. Simpan ke koleksi /exams/{examId}
    const examDocRef = doc(db, "exams", exam.id);
    await setDoc(examDocRef, {
      ...cleanExam,
      tokens: cleanTokens,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    // 2. Simpan index cepat ke koleksi /examCodes/{code}
    if (exam.code) {
      const codeDocRef = doc(db, "examCodes", exam.code.trim().toUpperCase());
      await setDoc(codeDocRef, {
        examId: exam.id,
        code: exam.code.trim().toUpperCase(),
        title: exam.title,
        sessionToken: exam.sessionToken || "",
        exam: cleanExam,
        tokens: cleanTokens,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }

    firestoreSuccess = true;
  } catch (err: any) {
    console.warn("[Firestore] Gagal menyimpan naskah ke Firestore:", err);
    if (err?.code === "resource-exhausted") {
      markQuotaExceeded("Firestore quota exceeded");
    }
  }

  // Backup sinkronisasi ke GAS & server
  try {
    syncExamToGAS(exam, tokens).catch(() => {});
  } catch {}

  return firestoreSuccess;
}

/**
 * Mengambil naskah ujian dari Firestore Cloud Database (fallback ke server / GAS)
 */
export async function fetchExamFromFirestore(
  examCodeOrId: string,
  _options?: any
): Promise<{ exam: ExamPackage; token?: string; tokens?: StudentTokenItem[] } | null> {
  const cleanKey = examCodeOrId ? examCodeOrId.trim() : "";
  if (!cleanKey) return null;

  // 1. Coba ambil dari Firestore koleksi /exams/{id}
  try {
    const examDocRef = doc(db, "exams", cleanKey);
    const snap = await getDoc(examDocRef);
    if (snap.exists()) {
      const data = snap.data() as any;
      if (data && Array.isArray(data.questions)) {
        return {
          exam: data as ExamPackage,
          token: data.sessionToken,
          tokens: data.tokens || [],
        };
      }
    }
  } catch (e) {
    console.warn("[Firestore] Gagal cek /exams doc:", e);
  }

  // 2. Coba ambil dari Firestore koleksi /examCodes/{code}
  try {
    const codeDocRef = doc(db, "examCodes", cleanKey.toUpperCase());
    const snap = await getDoc(codeDocRef);
    if (snap.exists()) {
      const data = snap.data() as any;
      if (data?.exam && Array.isArray(data.exam.questions)) {
        return {
          exam: data.exam as ExamPackage,
          token: data.sessionToken || data.exam.sessionToken,
          tokens: data.tokens || data.exam.tokens || [],
        };
      }
    }
  } catch (e) {
    console.warn("[Firestore] Gagal cek /examCodes doc:", e);
  }

  // 3. Coba query koleksi /exams dengan where code == cleanKey
  try {
    const q = query(collection(db, "exams"), where("code", "==", cleanKey.toUpperCase()));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const data = snap.docs[0].data() as any;
      if (data && Array.isArray(data.questions)) {
        return {
          exam: data as ExamPackage,
          token: data.sessionToken,
          tokens: data.tokens || [],
        };
      }
    }
  } catch (e) {
    console.warn("[Firestore] Gagal query exams by code:", e);
  }

  // 4. Fallback ke Google Apps Script & server local
  try {
    const gasRes = await fetchExamFromGAS(cleanKey);
    if (gasRes?.success && gasRes.exam) {
      // Auto-cache ke Firestore untuk request berikutnya
      syncExamToFirestore(gasRes.exam, gasRes.tokens).catch(() => {});
      return {
        exam: gasRes.exam,
        token: gasRes.token,
        tokens: gasRes.tokens,
      };
    }
  } catch (err) {
    console.warn("[Firestore] Fallback ke GAS gagal:", err);
  }

  return null;
}

export interface SessionSyncResult {
  success: boolean;
  isReset?: boolean;
  message?: string;
}

export async function syncStudentSessionToServer(
  session: StudentExamSession
): Promise<SessionSyncResult> {
  return await syncStudentSessionToFirestore(session, false);
}

/**
 * Sinkronisasi hasil sesi siswa ke Firestore Cloud Database (Folder 'sessions')
 */
export async function syncStudentSessionToFirestore(
  session: StudentExamSession,
  _finalSubmit = false
): Promise<SessionSyncResult> {
  if (!session || !session.id) {
    return { success: false, message: "ID Sesi tidak valid." };
  }

  let firestoreOk = false;
  try {
    const cleanSession = sanitizeForFirestore(session);
    const sessionDocRef = doc(db, "sessions", session.id);
    await setDoc(sessionDocRef, {
      ...cleanSession,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    firestoreOk = true;
  } catch (err: any) {
    console.warn("[Firestore] Gagal menyimpan sesi ke Firestore:", err);
  }

  // Cadangan ke Google Sheets via GAS
  try {
    syncStudentSessionToGAS(session).catch(() => {});
  } catch {}

  return { success: firestoreOk || true };
}

/**
 * Mengambil seluruh sesi ujian dari Firestore
 */
export async function fetchExamSessions(
  arg1?: string,
  arg2?: string | any,
  _optionsOrIncludeDeleted?: any
): Promise<StudentExamSession[]> {
  const sessionsMap = new Map<string, StudentExamSession>();

  let targetId: string | undefined;
  let targetCode: string | undefined;

  if (typeof arg2 === "string") {
    targetId = arg1?.trim();
    targetCode = arg2?.trim();
  } else if (arg1 && arg1.trim()) {
    const clean = arg1.trim();
    if (clean.length <= 15) {
      targetCode = clean;
    } else {
      targetId = clean;
    }
  }

  // 1. Ambil dari Firestore
  try {
    if (targetCode || targetId) {
      const queries = [];
      if (targetCode) {
        queries.push(getDocs(query(collection(db, "sessions"), where("examCode", "==", targetCode.toUpperCase()))));
      }
      if (targetId) {
        queries.push(getDocs(query(collection(db, "sessions"), where("examId", "==", targetId))));
      }
      const snaps = await Promise.all(queries);
      snaps.forEach((snap) => {
        snap.forEach((d) => {
          const s = d.data() as StudentExamSession;
          if (s && s.id) sessionsMap.set(s.id, s);
        });
      });
    } else {
      const snap = await getDocs(query(collection(db, "sessions")));
      snap.forEach((d) => {
        const s = d.data() as StudentExamSession;
        if (s && s.id) sessionsMap.set(s.id, s);
      });
    }
  } catch (err) {
    console.warn("[Firestore] Error fetching sessions from Firestore:", err);
  }

  // 2. Ambil dari GAS untuk memastikan tidak ada sesi yang tertinggal
  try {
    const gasSessions = await fetchSessionsGAS(targetCode || targetId);
    if (Array.isArray(gasSessions)) {
      gasSessions.forEach((s) => {
        if (s && s.id && !sessionsMap.has(s.id)) {
          sessionsMap.set(s.id, s);
        }
      });
    }
  } catch {}

  return Array.from(sessionsMap.values());
}

/**
 * Berlangganan sesi realtime menggunakan Firestore onSnapshot (sub-detik monitoring)
 * Mendukung fleksibel:
 * - subscribeToExamSessions(examCodeOrId, onUpdate)
 * - subscribeToExamSessions(examId, examCode, onUpdate)
 */
export function subscribeToExamSessions(
  arg1?: string,
  arg2?: string | ((sessions: StudentExamSession[]) => void),
  arg3?: ((sessions: StudentExamSession[]) => void) | ((error: any) => void)
): () => void {
  let examId: string | undefined;
  let examCode: string | undefined;
  let onUpdate: ((sessions: StudentExamSession[]) => void) | undefined;

  if (typeof arg2 === "function") {
    examId = arg1;
    examCode = arg1;
    onUpdate = arg2;
  } else {
    examId = arg1;
    examCode = typeof arg2 === "string" ? arg2 : undefined;
    if (typeof arg3 === "function") {
      onUpdate = arg3 as (sessions: StudentExamSession[]) => void;
    }
  }

  if (!onUpdate || typeof onUpdate !== "function") {
    console.warn("[Firestore] subscribeToExamSessions dipanggil tanpa fungsi onUpdate yang valid.");
    return () => {};
  }

  let active = true;
  const sessionsMap = new Map<string, StudentExamSession>();

  const emitSessions = () => {
    if (!active || typeof onUpdate !== "function") return;
    onUpdate(Array.from(sessionsMap.values()));
  };

  const targetCode = examCode?.trim().toUpperCase();
  const targetId = examId?.trim();

  // Firestore Realtime Listener
  let unsubscribeFirestore: (() => void) | null = null;
  try {
    let q = query(collection(db, "sessions"));
    if (targetCode && targetCode.length <= 15) {
      q = query(collection(db, "sessions"), where("examCode", "==", targetCode));
    } else if (targetId) {
      q = query(collection(db, "sessions"), where("examId", "==", targetId));
    }

    unsubscribeFirestore = onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const session = change.doc.data() as StudentExamSession;
          if (change.type === "removed") {
            sessionsMap.delete(change.doc.id);
          } else if (session && session.id) {
            sessionsMap.set(session.id, session);
          }
        });
        emitSessions();
      },
      (err) => {
        console.warn("[Firestore] onSnapshot error:", err);
      }
    );
  } catch (e) {
    console.warn("[Firestore] Listener setup error:", e);
  }

  // Polling fallback berkala untuk sinkronisasi data dari GAS & local storage
  const pollInterval = setInterval(async () => {
    if (!active) return;
    try {
      const remote = await fetchSessionsGAS(targetCode || targetId);
      let hasNew = false;
      if (Array.isArray(remote)) {
        remote.forEach((s) => {
          if (s && s.id && !sessionsMap.has(s.id)) {
            sessionsMap.set(s.id, s);
            hasNew = true;
          }
        });
      }
      if (hasNew) emitSessions();
    } catch {}
  }, 5000);

  return () => {
    active = false;
    clearInterval(pollInterval);
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Hapus sesi siswa dari Firestore
 */
export async function deleteStudentSessionFromFirestore(
  sessionId: string,
  studentNameOrExamCode?: string,
  tokenOrStudentName?: string,
  examCode?: string,
  _nisn?: string
): Promise<boolean> {
  let ok = false;
  try {
    const docRef = doc(db, "sessions", sessionId);
    await deleteDoc(docRef);
    ok = true;
  } catch (e) {
    console.warn("[Firestore] Gagal menghapus sesi doc:", e);
  }

  const actualExamCode = examCode || (studentNameOrExamCode && studentNameOrExamCode.length <= 10 ? studentNameOrExamCode : undefined);
  const actualStudentName = tokenOrStudentName || (studentNameOrExamCode && studentNameOrExamCode.length > 10 ? studentNameOrExamCode : undefined);

  try {
    await deleteSessionGAS(sessionId, actualExamCode, actualStudentName);
    ok = true;
  } catch {}

  return ok;
}

export interface BatchDeleteOptions {
  sessionIds: string[];
  studentNames?: string[];
  tokens?: string[];
  nisns?: string[];
  examCode?: string;
  examId?: string;
}

export async function batchDeleteStudentSessionsFromFirestore(
  options: BatchDeleteOptions
): Promise<boolean> {
  let ok = false;
  try {
    const batch = writeBatch(db);
    options.sessionIds.forEach((id) => {
      batch.delete(doc(db, "sessions", id));
    });
    await batch.commit();
    ok = true;
  } catch (e) {
    console.warn("[Firestore] Batch delete error:", e);
  }

  try {
    const count = await batchDeleteSessionsGAS(options.sessionIds, options.examCode);
    if (count > 0) ok = true;
  } catch {}

  return ok;
}

export interface ReconcileResult {
  success: boolean;
  mergedSessionsCount: number;
  sessions: StudentExamSession[];
}

export async function reconcileAndMergeExamSessions(
  examId: string,
  canonicalCode: string
): Promise<ReconcileResult> {
  try {
    const firestoreSessions = await fetchExamSessions(canonicalCode || examId);
    const gasSessions = await reconcileGAS(examId, canonicalCode);

    const mergedMap = new Map<string, StudentExamSession>();
    firestoreSessions.forEach((s) => mergedMap.set(s.id, s));
    gasSessions.forEach((s) => {
      const existing = mergedMap.get(s.id);
      if (!existing || (s.submitTime && !existing.submitTime)) {
        mergedMap.set(s.id, s);
      }
    });

    const sessions = Array.from(mergedMap.values());
    return {
      success: true,
      mergedSessionsCount: sessions.length,
      sessions,
    };
  } catch (e) {
    console.warn("Reconcile error:", e);
    return {
      success: false,
      mergedSessionsCount: 0,
      sessions: [],
    };
  }
}
