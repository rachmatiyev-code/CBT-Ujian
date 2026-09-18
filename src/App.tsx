import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  GraduationCap,
  Sparkles,
  BarChart3,
  Users,
  Key,
  Building2,
  Cloud,
  FileSpreadsheet,
  Printer,
  ChevronDown,
  Plus,
  Play,
  Monitor,
  CheckCircle,
  Menu,
  X,
  Share2,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  FileUp,
  Search,
  ArrowLeft,
  Link2,
  FlaskConical,
  Info,
  ShieldCheck
} from "lucide-react";
import {
  ExamPackage,
  SchoolProfile,
  StudentExamSession,
  StudentTokenItem,
  NavigationTab
} from "./types";
import {
  getSchoolProfile,
  saveSchoolProfile,
  getExamPackages,
  saveExamPackages,
  getActiveExamId,
  saveActiveExamId,
  getStudentTokens,
  saveStudentTokens,
  getExamHistory,
  saveExamHistory,
  getActiveStudentSession,
  saveActiveStudentSession,
  createNewExamPackage
} from "./utils/storage";

// Sub-components
import { StudentSlideExam } from "./components/StudentSlideExam";
import { LiveMonitoringDashboard } from "./components/LiveMonitoringDashboard";
import { AIGeneratorAndEditor } from "./components/AIGeneratorAndEditor";
import { ItemAnalysisAndHistory } from "./components/ItemAnalysisAndHistory";
import { TokenManager } from "./components/TokenManager";
import { SchoolProfileAndPrintView } from "./components/SchoolProfileAndPrintView";
import { BackupRestoreView } from "./components/BackupRestoreView";
import { GeminiApiKeyModal } from "./components/GeminiApiKeyModal";
import { DirectStudentShareModal } from "./components/DirectStudentShareModal";
import { getGeminiRequestHeaders } from "./utils/storage";
import { normalizeToken, deduplicateStudentTokens } from "./utils/tokenValidator";
import { decodeExamFromCurrentUrl, decodeExamFromUrlString } from "./utils/examShareEncoder";
import { broadcastLiveSession, subscribeToLiveSessions, subscribeToSessionResets } from "./utils/liveSync";
import { loadExamFromGoogleDrive, findAndLoadExamFromDriveByCode, extractGoogleDriveFileId } from "./utils/googleDrive";
import { fetchExamFromGAS, syncExamToGAS, syncStudentSessionToGAS } from "./utils/gasService";
import {
  subscribeToExamSessions,
  fetchExamSessions,
  deleteStudentSessionFromFirestore,
  batchDeleteStudentSessionsFromFirestore,
  reconcileAndMergeExamSessions,
  syncExamToFirestore,
  fetchExamFromFirestore,
  syncStudentSessionToFirestore,
} from "./utils/firestoreService";
import { blacklistResetSession, isSessionResetBlacklisted } from "./services/monitoringService";

export default function App() {
  // Decode any packed exam payload from URL
  const sharedPayload = useMemo(() => {
    return decodeExamFromCurrentUrl();
  }, []);

  // Direct Student Link Detection (Auto-detect mode=student, code, examId, driveId, pkg, or token)
  const [isDirectStudentMode, setIsDirectStudentMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    const hasStudentParam =
      params.get("mode") === "student" ||
      !!sharedPayload ||
      !!params.get("code") ||
      !!params.get("examId") ||
      !!params.get("driveId") ||
      !!params.get("gdriveId") ||
      !!params.get("pkg") ||
      !!params.get("examData") ||
      !!params.get("token");
    return hasStudentParam;
  });

  const [urlToken, setUrlToken] = useState<string>(() => {
    if (sharedPayload?.token) return sharedPayload.token;
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  });

  // Navigation & View State (Default to Teacher Monitoring, Student mode is isolated in dedicated tab)
  const [activeTab, setActiveTab] = useState<NavigationTab>("monitoring");
  const [isTeacherTrial, setIsTeacherTrial] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("trial") === "true" || params.get("mode") === "trial";
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isGeminiModalOpen, setIsGeminiModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<{ configured: boolean; source: string } | null>(null);

  // App Data State
  const [schoolProfile, setSchoolProfileState] = useState<SchoolProfile>(getSchoolProfile);
  const [exams, setExamsState] = useState<ExamPackage[]>(() => {
    const existing = getExamPackages();
    if (sharedPayload?.exam) {
      const idx = existing.findIndex(
        (e) => e.id === sharedPayload.exam.id || e.code.toUpperCase() === sharedPayload.exam.code.toUpperCase()
      );
      let updated: ExamPackage[];
      if (idx >= 0) {
        updated = [...existing];
        updated[idx] = sharedPayload.exam;
      } else {
        updated = [sharedPayload.exam, ...existing];
      }
      saveExamPackages(updated);
      return updated;
    }
    return existing;
  });

  const [requestedDriveId, setRequestedDriveId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const directId = params.get("driveId") || params.get("gdriveId") || params.get("fileId");
    if (directId) return directId;
    const linkParam = params.get("driveUrl") || params.get("link") || params.get("url") || params.get("gdrive");
    if (linkParam) {
      const parsed = extractGoogleDriveFileId(linkParam);
      if (parsed.fileId) return parsed.fileId;
    }
    const codeParam = params.get("code") || params.get("examId");
    if (codeParam && (codeParam.includes("drive.google.com") || codeParam.includes("/file/d/") || codeParam.length >= 25)) {
      const parsed = extractGoogleDriveFileId(codeParam);
      if (parsed.fileId) return parsed.fileId;
    }
    return null;
  });

  const [requestedExamCode, setRequestedExamCode] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("code") || params.get("examId") || null;
  });

  const [activeExamId, setActiveExamIdState] = useState<string>(() => {
    if (sharedPayload?.exam) {
      saveActiveExamId(sharedPayload.exam.id);
      return sharedPayload.exam.id;
    }
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const driveParam = params.get("driveId") || params.get("gdriveId");
      const examParam = params.get("examId") || params.get("code");
      const tokenParam = params.get("token");
      const all = getExamPackages();

      if (driveParam) {
        const found = all.find((e) => e.gdriveFileId === driveParam);
        if (found) return found.id;
      }

      if (examParam) {
        const found = all.find((e) => e.id === examParam || e.code.toUpperCase() === examParam.toUpperCase());
        if (found) return found.id;
      }

      if (tokenParam) {
        const norm = normalizeToken(tokenParam);
        const matchBySession = all.find((e) => normalizeToken(e.sessionToken) === norm || normalizeToken(e.code) === norm);
        if (matchBySession) return matchBySession.id;

        const allTokens = getStudentTokens();
        const matchByStudentToken = allTokens.find((t) => normalizeToken(t.token) === norm);
        if (matchByStudentToken && matchByStudentToken.examCode) {
          const matchExam = all.find((e) => normalizeToken(e.code) === normalizeToken(matchByStudentToken.examCode) || e.id === matchByStudentToken.examCode);
          if (matchExam) return matchExam.id;
        }
      }
    }
    const saved = getActiveExamId();
    const all = getExamPackages();
    return all.some((e) => e.id === saved) ? saved : all[0]?.id || "";
  });

  const [tokens, setTokensState] = useState<StudentTokenItem[]>(() => {
    const existingTokens = getStudentTokens();
    if (sharedPayload?.tokens && sharedPayload.tokens.length > 0) {
      const merged = deduplicateStudentTokens([...sharedPayload.tokens, ...existingTokens]);
      saveStudentTokens(merged);
      return merged;
    }
    const deduplicatedExisting = deduplicateStudentTokens(existingTokens);
    saveStudentTokens(deduplicatedExisting);
    return deduplicatedExisting;
  });

  const [history, setHistoryState] = useState<StudentExamSession[]>(getExamHistory);
  const [activeSession, setActiveSessionState] = useState<StudentExamSession | null>(getActiveStudentSession);

  // Keep track of recently deleted session keys to prevent momentary race-condition re-additions from Firestore
  const recentlyDeletedKeysRef = useRef<Map<string, number>>(new Map());

  const markRecentlyDeleted = (id?: string, name?: string, token?: string, nisn?: string) => {
    const expiresAt = Date.now() + 20000;
    if (id) recentlyDeletedKeysRef.current.set(id, expiresAt);
    if (name) recentlyDeletedKeysRef.current.set(name.trim().toLowerCase(), expiresAt);
    if (nisn) recentlyDeletedKeysRef.current.set(nisn.trim(), expiresAt);
    // Note: NEVER set token alone in recentlyDeletedKeysRef because multiple students often share the same exam token
  };

  const [isFetchingRemoteExam, setIsFetchingRemoteExam] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    if (sharedPayload) return false;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || params.get("examId");
    const driveId = params.get("driveId") || params.get("gdriveId");
    if (!code && !driveId) return false;
    const all = getExamPackages();
    return !all.some((e) =>
      (code && (e.id === code || e.code.toUpperCase() === code.toUpperCase())) ||
      (driveId && e.gdriveFileId === driveId)
    );
  });
  const [remoteFetchError, setRemoteFetchError] = useState<string | null>(null);
  const [manualStudentCode, setManualStudentCode] = useState<string>("");

  const applyLoadedRemoteExam = (loadedExam: ExamPackage, token?: string, tokensList?: StudentTokenItem[]) => {
    setExamsState((prev) => {
      const idx = prev.findIndex(
        (e) => e.id === loadedExam.id || e.code.toUpperCase() === loadedExam.code.toUpperCase()
      );
      let updated: ExamPackage[];
      if (idx >= 0) {
        updated = [...prev];
        updated[idx] = loadedExam;
      } else {
        updated = [loadedExam, ...prev];
      }
      saveExamPackages(updated);
      return updated;
    });
    setActiveExamIdState(loadedExam.id);
    saveActiveExamId(loadedExam.id);
    if (token) setUrlToken(token);
    const effectiveTokens = (tokensList && tokensList.length > 0) ? tokensList : (loadedExam.tokens || []);
    if (effectiveTokens.length > 0) {
      setTokensState((prev) => {
        const merged = deduplicateStudentTokens([...effectiveTokens, ...prev]);
        saveStudentTokens(merged);
        return merged;
      });
    }
    setIsFetchingRemoteExam(false);
    setRemoteFetchError(null);
  };

  const executeRemoteExamFetch = async (targetCode?: string | null, targetDriveId?: string | null) => {
    let code = (targetCode ?? requestedExamCode ?? "").trim();
    let driveId = (targetDriveId ?? requestedDriveId ?? "").trim();

    // Check if code input is actually a Google Drive link or file ID
    if (code && !driveId) {
      const extracted = extractGoogleDriveFileId(code);
      if (extracted.fileId) {
        driveId = extracted.fileId;
        // Keep code only if it's not a raw link
        if (code.includes("drive.google.com") || code.includes("/file/d/")) {
          code = "";
        }
      }
    }

    if (!code && !driveId) {
      setIsFetchingRemoteExam(false);
      return;
    }

    setIsFetchingRemoteExam(true);
    setRemoteFetchError(null);

    let lastDriveError: string | null = null;
    let isDomainRestricted = false;

    try {
      // 1. Direct check in current state or localStorage
      const allLocal = getExamPackages();
      const localMatch = allLocal.find((e) =>
        (code && (e.id === code || e.code.toUpperCase() === code.toUpperCase())) ||
        (driveId && e.gdriveFileId === driveId)
      );
      if (localMatch && Array.isArray(localMatch.questions) && localMatch.questions.length > 0) {
        applyLoadedRemoteExam(localMatch, localMatch.sessionToken);
        return;
      }

      // 2. If driveId provided, load via multi-tier Google Drive loader
      if (driveId) {
        try {
          const driveExam = await loadExamFromGoogleDrive(null, driveId);
          if (driveExam && Array.isArray(driveExam.questions) && driveExam.questions.length > 0) {
            applyLoadedRemoteExam(driveExam, driveExam.sessionToken);
            return;
          }
        } catch (driveErr: any) {
          console.warn("Direct Drive ID load attempt:", driveErr);
          lastDriveError = driveErr?.message || null;
          if (
            driveErr?.isDomainRestricted ||
            driveErr?.name === "GoogleDrivePermissionError" ||
            driveErr?.message?.toLowerCase().includes("belajar.id") ||
            driveErr?.message?.toLowerCase().includes("403") ||
            driveErr?.message?.toLowerCase().includes("ditolak")
          ) {
            isDomainRestricted = true;
          }
        }
      }

      // 2. Query Google Apps Script / Google Sheets (Folder 'Data Soal' - 100% Bebas Firebase/OAuth)
      if (code) {
        try {
          const gasResult = await fetchExamFromGAS(code);
          if (gasResult.success && gasResult.exam && Array.isArray(gasResult.exam.questions) && gasResult.exam.questions.length > 0) {
            applyLoadedRemoteExam(gasResult.exam, gasResult.token, gasResult.tokens);
            return;
          }
        } catch (gasErr) {
          console.warn("GAS remote exam fetch:", gasErr);
        }
      }

      // 3. Query Express backend registry (Server CBT Aplikasi)
      if (code) {
        let res = await fetch(`/api/exams/by-code/${encodeURIComponent(code)}`);
        if (!res.ok) {
          res = await fetch(`/api/exams/share/${encodeURIComponent(code)}`);
        }
        if (!res.ok) {
          res = await fetch(`/api/exams/${encodeURIComponent(code)}`);
        }

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.exam && Array.isArray(data.exam.questions) && data.exam.questions.length > 0) {
            applyLoadedRemoteExam(data.exam, data.token, data.tokens);
            return;
          }
        }
      }

      // 4. Query Firebase Firestore Cloud Database (project ungoogly-rigging-s6rpq)
      if (code || driveId) {
        try {
          const firestoreResult = await fetchExamFromFirestore(code || driveId);
          if (
            firestoreResult &&
            firestoreResult.exam &&
            Array.isArray(firestoreResult.exam.questions) &&
            firestoreResult.exam.questions.length > 0
          ) {
            applyLoadedRemoteExam(firestoreResult.exam, firestoreResult.token, firestoreResult.tokens);
            return;
          }
        } catch (fErr) {
          console.warn("Firestore remote exam fetch attempt:", fErr);
        }
      }

      // 4. If driveId provided, load via multi-tier Google Drive loader
      if (driveId) {
        try {
          const driveExam = await loadExamFromGoogleDrive(null, driveId);
          if (driveExam && Array.isArray(driveExam.questions) && driveExam.questions.length > 0) {
            applyLoadedRemoteExam(driveExam, driveExam.sessionToken);
            return;
          }
        } catch (driveErr: any) {
          console.warn("Direct Drive ID load attempt (second attempt):", driveErr);
          if (driveErr?.isDomainRestricted || driveErr?.name === "GoogleDrivePermissionError") {
            isDomainRestricted = true;
            lastDriveError = driveErr.message;
          }
        }
      }

      // 5. Search Google Drive by Code / Filename (Backup_Data_Aplikasi)
      if (code) {
        try {
          const driveResult = await findAndLoadExamFromDriveByCode(code);
          if (driveResult && Array.isArray(driveResult.questions) && driveResult.questions.length > 0) {
            applyLoadedRemoteExam(driveResult, driveResult.sessionToken);
            return;
          }
        } catch (codeDriveErr: any) {
          if (codeDriveErr?.isDomainRestricted || codeDriveErr?.name === "GoogleDrivePermissionError") {
            isDomainRestricted = true;
            lastDriveError = codeDriveErr.message;
          }
        }
      }

      if (isDomainRestricted && lastDriveError) {
        setRemoteFetchError(lastDriveError);
      } else {
        setRemoteFetchError(
          `Naskah soal dengan kode "${code || driveId}" tidak ditemukan di server CBT aplikasi atau Google Drive. Silakan periksa kembali kode soal atau minta guru membagikan file/link naskah.`
        );
      }
    } catch (err: any) {
      console.warn("Could not fetch remote exam:", err);
      setRemoteFetchError("Gagal menghubungi server ujian. Pastikan perangkat Anda terhubung ke internet.");
    } finally {
      setIsFetchingRemoteExam(false);
    }
  };

  // If URL specified an exam code/ID or drive ID, attempt to fetch from Google Drive, Firestore, or Express registry
  useEffect(() => {
    if (!requestedExamCode && !requestedDriveId) {
      setIsFetchingRemoteExam(false);
      return;
    }

    const isAlreadyLoaded = exams.find((e) =>
      (requestedExamCode && (e.id === requestedExamCode || e.code.toUpperCase() === requestedExamCode.toUpperCase())) ||
      (requestedDriveId && e.gdriveFileId === requestedDriveId)
    );

    if (isAlreadyLoaded) {
      if (activeExamId !== isAlreadyLoaded.id) {
        setActiveExamIdState(isAlreadyLoaded.id);
        saveActiveExamId(isAlreadyLoaded.id);
      }
      setIsFetchingRemoteExam(false);
      return;
    }

    executeRemoteExamFetch(requestedExamCode, requestedDriveId);
  }, [requestedExamCode, requestedDriveId]);

  const handleStudentUploadExamJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          const validatedExam: ExamPackage = {
            ...parsed,
            id: parsed.id || `exam-${Date.now()}`,
            code: parsed.code || "SOAL-CBT",
            title: parsed.title || "Naskah Soal CBT",
            updatedAt: new Date().toISOString(),
          };
          applyLoadedRemoteExam(validatedExam, validatedExam.sessionToken, parsed.tokens);
          setRequestedExamCode(validatedExam.code);
        } else {
          setRemoteFetchError("File JSON yang dipilih bukan format naskah soal CBT yang valid.");
        }
      } catch {
        setRemoteFetchError("Gagal membaca file JSON naskah soal. Pastikan file tidak rusak.");
      }
    };
    reader.readAsText(file);
  };

  // Check Gemini API Key Status
  const checkGeminiStatus = async () => {
    try {
      const headers = getGeminiRequestHeaders();
      const res = await fetch("/api/gemini/status", { headers });
      const data = await res.json();
      setGeminiStatus(data);
    } catch {
      setGeminiStatus({ configured: false, source: "none" });
    }
  };

  useEffect(() => {
    checkGeminiStatus();
  }, []);

  // Listen to popstate / url changes
  useEffect(() => {
    const handleUrlCheck = () => {
      const sharedFromUrl = decodeExamFromCurrentUrl();
      if (sharedFromUrl?.exam) {
        setExamsState((prev) => {
          const idx = prev.findIndex(
            (e) => e.id === sharedFromUrl.exam.id || e.code.toUpperCase() === sharedFromUrl.exam.code.toUpperCase()
          );
          let updated: ExamPackage[];
          if (idx >= 0) {
            updated = [...prev];
            updated[idx] = sharedFromUrl.exam;
          } else {
            updated = [sharedFromUrl.exam, ...prev];
          }
          saveExamPackages(updated);
          return updated;
        });
        setActiveExamIdState(sharedFromUrl.exam.id);
        saveActiveExamId(sharedFromUrl.exam.id);
        if (sharedFromUrl.token) setUrlToken(sharedFromUrl.token);
        if (sharedFromUrl.tokens && sharedFromUrl.tokens.length > 0) {
          setTokensState((prev) => {
            const merged = deduplicateStudentTokens([...sharedFromUrl.tokens!, ...prev]);
            saveStudentTokens(merged);
            return merged;
          });
        }
        setIsDirectStudentMode(true);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const isStudent = params.get("mode") === "student";
      setIsDirectStudentMode(isStudent);
      const token = params.get("token");
      if (token) setUrlToken(token);
      const examParam = params.get("examId") || params.get("code");
      if (examParam) {
        setRequestedExamCode(examParam);
        const found = exams.find((e) => e.id === examParam || e.code.toUpperCase() === examParam.toUpperCase());
        if (found) {
          setActiveExamIdState(found.id);
          saveActiveExamId(found.id);
          return;
        }
      }
      if (token) {
        const norm = normalizeToken(token);
        const matchBySession = exams.find((e) => normalizeToken(e.sessionToken) === norm || normalizeToken(e.code) === norm);
        if (matchBySession) {
          setActiveExamIdState(matchBySession.id);
          saveActiveExamId(matchBySession.id);
          return;
        }
        const allTokens = getStudentTokens();
        const matchByStudentToken = allTokens.find((t) => normalizeToken(t.token) === norm);
        if (matchByStudentToken && matchByStudentToken.examCode) {
          const matchExam = exams.find((e) => normalizeToken(e.code) === normalizeToken(matchByStudentToken.examCode) || e.id === matchByStudentToken.examCode);
          if (matchExam) {
            setActiveExamIdState(matchExam.id);
            saveActiveExamId(matchExam.id);
          }
        }
      }
    };
    window.addEventListener("popstate", handleUrlCheck);
    return () => window.removeEventListener("popstate", handleUrlCheck);
  }, [exams]);

  // Active Exam
  const activeExam = exams.find((e) => e.id === activeExamId) || exams[0] || createNewExamPackage("Ujian Standar");

  // Strictly filter student exam history records by activeExamId / activeExam.code
  // so students and sessions from other exams don't leak, while merging any disparate codes sharing the same examId
  const activeExamHistory = useMemo(() => {
    if (!activeExam) return [];
    const currentId = (activeExam.id || "").trim();
    const currentCode = (activeExam.code || "").trim().toUpperCase();

    return history.filter((session) => {
      if (!session) return false;
      const sId = (session.examId || "").trim();
      const sCode = (session.examCode || "").trim().toUpperCase();
      const matchId = Boolean(currentId && sId && sId === currentId);
      const matchCode = Boolean(currentCode && sCode && sCode === currentCode);
      return matchId || matchCode;
    });
  }, [history, activeExam]);

  // Isolate tokens strictly for the active exam, matching both code and examId
  const activeExamTokens = useMemo(() => {
    const baseList = (activeExam.tokens && activeExam.tokens.length > 0)
      ? activeExam.tokens
      : tokens;
    return deduplicateStudentTokens(
      baseList,
      activeExam.code,
      activeExam.teacherProfile?.gradeLevel,
      activeExam.id
    );
  }, [tokens, activeExam.tokens, activeExam.code, activeExam.teacherProfile?.gradeLevel, activeExam.id]);

  // Auto-reconcile student sessions when teacher views an exam with disparate codes
  useEffect(() => {
    if (isDirectStudentMode || !activeExam?.id || !activeExam?.code) return;
    const cleanId = activeExam.id.trim();
    const cleanCode = activeExam.code.trim().toUpperCase();

    const hasDisparate = history.some(
      (s) =>
        s &&
        (s.examId || "").trim() === cleanId &&
        (s.examCode || "").trim().toUpperCase() !== cleanCode
    );

    if (hasDisparate) {
      reconcileAndMergeExamSessions(cleanId, cleanCode)
        .then((res) => {
          if (res.mergedSessionsCount > 0) {
            setHistoryState((prev) =>
              prev.map((s) =>
                s && (s.examId || "").trim() === cleanId
                  ? { ...s, examCode: cleanCode }
                  : s
              )
            );
          }
        })
        .catch(() => {});
    }
  }, [isDirectStudentMode, activeExam?.id, activeExam?.code, history.length]);

  // Active student session isolated to current active exam
  const examActiveSession = useMemo(() => {
    if (!activeSession) return null;
    const matchId = activeSession.examId === activeExam.id;
    const matchCode = activeExam.code && activeSession.examCode?.trim().toUpperCase() === activeExam.code.trim().toUpperCase();
    return matchId || matchCode ? activeSession : null;
  }, [activeSession, activeExam]);

  // Dynamically update document title based on mode (Student Exam vs Teacher Dashboard)
  useEffect(() => {
    if (isDirectStudentMode) {
      const code = requestedExamCode || activeExam?.code || "";
      if (isTeacherTrial) {
        document.title = code ? `[Uji Coba Guru] ${code} - Slide CBT` : "[Uji Coba Guru] Slide CBT";
      } else {
        document.title = code ? `Lembar Ujian Siswa (${code}) - CBT` : "Lembar Ujian Siswa - Slide CBT";
      }
    } else if (activeExam?.title) {
      document.title = `${activeExam.title} - SlideExam CBT Guru & Monitoring`;
    } else {
      document.title = "SlideExam CBT - Guru & Monitoring";
    }
  }, [isDirectStudentMode, isTeacherTrial, activeExam?.title, activeExam?.code, requestedExamCode]);

  // Automatic redirect if activeTab ever switches to student_exam: open in isolated new tab and keep teacher dashboard on monitoring
  useEffect(() => {
    if (activeTab === "student_exam") {
      const examCode = activeExam?.code || "";
      const url = `${window.location.origin}${window.location.pathname}?mode=student&code=${encodeURIComponent(examCode)}${isTeacherTrial ? "&trial=true" : ""}`;
      window.open(url, "_blank");
      setActiveTab("monitoring");
    }
  }, [activeTab, activeExam?.code, isTeacherTrial]);

  // Automatically broadcast and sync active exam to Firestore, server & Google Sheets for 2-way multi-device discovery
  // CRITICAL SECURITY RULE: Only run for teacher workspace! NEVER for student devices!
  useEffect(() => {
    if (isDirectStudentMode) return;
    if (activeExam?.id && activeExam?.code) {
      syncExamToFirestore(activeExam, activeExamTokens).catch(() => {});
      syncExamToGAS(activeExam, activeExamTokens).catch(() => {});
      fetch("/api/exams/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam: activeExam,
          token: activeExam.sessionToken,
          tokens: activeExamTokens || [],
        }),
      }).catch(() => {});
    }
  }, [isDirectStudentMode, activeExam?.id, activeExam?.code, activeExam?.updatedAt, activeExamTokens]);

  // Broadcast all teacher exams to Local Server Share Registry on teacher dashboard load (0 quota cost)
  useEffect(() => {
    if (isDirectStudentMode || exams.length === 0) return;
    exams.forEach((ex) => {
      if (ex && ex.id && Array.isArray(ex.questions) && ex.questions.length > 0) {
        fetch("/api/exams/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exam: ex,
            token: ex.sessionToken,
            tokens: ex.tokens || tokens || [],
          }),
        }).catch(() => {});
      }
    });
  }, [isDirectStudentMode, exams.length]);

  // Real-time synchronization for student sessions from LiveSync (BroadcastChannel), Firestore & Server
  useEffect(() => {
    if (!activeExam?.id && !activeExam?.code) return;

    const currentId = activeExam.id;
    const currentCode = activeExam.code;

    const mergeIncomingSessions = (remoteSessions: StudentExamSession[]) => {
      if (!remoteSessions || remoteSessions.length === 0) return;
      const now = Date.now();
      // Clean expired
      for (const [key, exp] of recentlyDeletedKeysRef.current.entries()) {
        if (now > exp) recentlyDeletedKeysRef.current.delete(key);
      }

      // Filter out any sessions that were recently deleted/reset
      const validRemote = remoteSessions.filter((rs) => {
        if (!rs) return false;
        if (rs.id && recentlyDeletedKeysRef.current.has(rs.id)) return false;
        if (rs.studentName && recentlyDeletedKeysRef.current.has(rs.studentName.trim().toLowerCase())) return false;
        if (rs.nisn && recentlyDeletedKeysRef.current.has(rs.nisn.trim())) return false;
        return true;
      });

      setHistoryState((prevHistory) => {
        const sessionMap = new Map<string, StudentExamSession>();
        prevHistory.forEach((h) => {
          if (h && h.id) {
            const isDeleted =
              recentlyDeletedKeysRef.current.has(h.id) ||
              (h.studentName && recentlyDeletedKeysRef.current.has(h.studentName.trim().toLowerCase())) ||
              (h.nisn && recentlyDeletedKeysRef.current.has(h.nisn.trim()));
            if (!isDeleted) sessionMap.set(h.id, h);
          }
        });
        validRemote.forEach((rs) => {
          if (rs && rs.id) sessionMap.set(rs.id, rs);
        });
        const merged = Array.from(sessionMap.values());
        saveExamHistory(merged);
        return merged;
      });
    };

    // 1. Initial immediate fetch (attempts Firestore if quota available, plus server)
    fetchExamSessions(currentId, currentCode, true).then(mergeIncomingSessions).catch(() => {});

    // 2. Real-time BroadcastChannel subscription for instant same-browser cross-tab sync (0ms)
    const unsubscribeLive = subscribeToLiveSessions((incomingSession) => {
      if (!incomingSession) return;
      const sId = (incomingSession.examId || "").trim();
      const sCode = (incomingSession.examCode || "").trim().toUpperCase();
      const matchId = currentId && sId === currentId;
      const matchCode = currentCode && sCode === currentCode.toUpperCase();
      if (matchId || matchCode || !incomingSession.examCode) {
        mergeIncomingSessions([incomingSession]);
      }
    });

    // 3. Real-time Firestore subscription (onSnapshot)
    const unsubscribeFirestore = subscribeToExamSessions(currentId, currentCode, mergeIncomingSessions);

    // 4. Listen to live session resets/deletions so student views and teacher views clear immediately
    const unsubscribeReset = subscribeToSessionResets((payload) => {
      if (!payload) return;
      const cleanId = payload.sessionId;
      const cleanName = payload.studentName?.trim().toLowerCase();
      const cleanNisn = payload.nisn?.trim();

      markRecentlyDeleted(cleanId, payload.studentName, payload.token, payload.nisn);

      setHistoryState((prevHistory) => {
        const updated = prevHistory.filter((item) => {
          const matchId = cleanId && item.id === cleanId;
          const matchName = cleanName && item.studentName.trim().toLowerCase() === cleanName;
          const matchNisn = cleanNisn && item.nisn && item.nisn.trim() === cleanNisn;
          return !(matchId || matchName || matchNisn);
        });
        saveExamHistory(updated);
        return updated;
      });

      // Clear active student session if this student was reset
      setActiveSessionState((prevActive) => {
        if (!prevActive) return null;
        const matchId = cleanId && prevActive.id === cleanId;
        const matchName = cleanName && prevActive.studentName.trim().toLowerCase() === cleanName;
        const matchNisn = cleanNisn && prevActive.nisn && prevActive.nisn.trim() === cleanNisn;
        if (matchId || matchName || matchNisn) {
          saveActiveStudentSession(null);
          return null;
        }
        return prevActive;
      });
    });

    // 5. Periodic fallback poll every 3 seconds for remote multi-device sync (server registry, zero quota cost)
    const pollInterval = setInterval(() => {
      fetchExamSessions(currentId, currentCode, false).then(mergeIncomingSessions).catch(() => {});
    }, 3000);

    // 6. Cross-tab storage listener
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "slide_exam_history_v1" && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) {
            setHistoryState(parsed);
          }
        } catch {}
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      unsubscribeLive();
      unsubscribeFirestore();
      unsubscribeReset();
      clearInterval(pollInterval);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [activeExam?.id, activeExam?.code]);

  // Handlers for Data Updates
  const handleUpdateSchool = (updated: SchoolProfile) => {
    setSchoolProfileState(updated);
    saveSchoolProfile(updated);
    // Automatically propagate updated school profile (including principalName and principalNIP) to all exam packages
    const updatedExams = exams.map((e) => ({
      ...e,
      schoolProfile: updated,
    }));
    setExamsState(updatedExams);
    saveExamPackages(updatedExams);
  };

  const handleUpdateActiveExam = (updated: ExamPackage) => {
    const exists = exams.some((e) => e.id === updated.id);
    const updatedExams = exists
      ? exams.map((e) => (e.id === updated.id ? updated : e))
      : [updated, ...exams];
    setExamsState(updatedExams);
    saveExamPackages(updatedExams);
    syncExamToFirestore(updated, tokens).catch((err) =>
      console.warn("Firestore sync error:", err)
    );
    syncExamToGAS(updated, tokens).catch((err) =>
      console.warn("GAS sync error:", err)
    );
    // If the exam package contains an updated schoolProfile, sync it globally as well
    if (updated.schoolProfile) {
      setSchoolProfileState(updated.schoolProfile);
      saveSchoolProfile(updated.schoolProfile);
    }
  };

  const handleCreateNewExam = () => {
    const title = prompt("Masukkan Judul Naskah Ujian Baru:", "Ujian Penilaian Tengah Semester");
    if (!title) return;
    const newPkg = createNewExamPackage(title);
    const updated = [newPkg, ...exams];
    setExamsState(updated);
    saveExamPackages(updated);
    setActiveExamIdState(newPkg.id);
    saveActiveExamId(newPkg.id);
    setActiveTab("ai_generator");
  };

  const handleDeleteExamPackage = (id: string) => {
    if (confirm("Apakah Anda yakin ingin menghapus naskah soal ini dari database?")) {
      let updated = exams.filter((e) => e.id !== id);
      if (updated.length === 0) {
        const fresh = createNewExamPackage("Naskah Ujian Baru");
        updated = [fresh];
      }
      setExamsState(updated);
      saveExamPackages(updated);
      if (activeExamId === id || !updated.some((e) => e.id === activeExamId)) {
        setActiveExamIdState(updated[0].id);
        saveActiveExamId(updated[0].id);
      }
    }
  };

  const handleClearAllExams = () => {
    if (confirm("Apakah Anda yakin ingin mengosongkan seluruh riwayat dan bank naskah soal ujian?")) {
      const fresh = createNewExamPackage("Naskah Ujian Baru");
      const updated = [fresh];
      setExamsState(updated);
      saveExamPackages(updated);
      setActiveExamIdState(fresh.id);
      saveActiveExamId(fresh.id);
    }
  };

  const handleDuplicateExamPackage = (examToDup: ExamPackage) => {
    const newPkg: ExamPackage = {
      ...examToDup,
      id: `exam-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      code: `${examToDup.code}-SALIN`,
      title: `${examToDup.title} (Salinan)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [newPkg, ...exams];
    setExamsState(updated);
    saveExamPackages(updated);
    setActiveExamIdState(newPkg.id);
    saveActiveExamId(newPkg.id);
  };

  const handleSelectExamId = (id: string) => {
    setActiveExamIdState(id);
    saveActiveExamId(id);
    // Clear student session if switching exam
    if (activeSession && activeSession.examId !== id) {
      setActiveSessionState(null);
      saveActiveStudentSession(null);
    }
  };

  const handleUpdateTokens = (newTokens: StudentTokenItem[]) => {
    setTokensState(newTokens);
    saveStudentTokens(newTokens);
  };

  const handleUpdateExamToken = (newToken: string) => {
    const updated = { ...activeExam, sessionToken: newToken, updatedAt: new Date().toISOString() };
    handleUpdateActiveExam(updated);
    setUrlToken(newToken);
    if (typeof window !== "undefined" && window.location.search.includes("token=")) {
      const url = new URL(window.location.href);
      url.searchParams.set("token", newToken);
      window.history.replaceState({}, "", url.toString());
    }
    // Clear active session to ensure new session uses the updated token and fresh questions
    setActiveSessionState(null);
    saveActiveStudentSession(null);
  };

  const handleSaveStudentSession = (session: StudentExamSession) => {
    setActiveSessionState(session);
    saveActiveStudentSession(session);
    broadcastLiveSession(session);
    syncStudentSessionToFirestore(session).catch((err) =>
      console.warn("Firestore session sync error:", err)
    );
    syncStudentSessionToGAS(session).catch((err) =>
      console.warn("GAS session sync error:", err)
    );

    // If already exists in history, update; else add
    const existingIdx = history.findIndex((h) => h.id === session.id);
    let updatedHistory: StudentExamSession[];
    if (existingIdx >= 0) {
      updatedHistory = [...history];
      updatedHistory[existingIdx] = session;
    } else {
      updatedHistory = [session, ...history];
    }
    setHistoryState(updatedHistory);
    saveExamHistory(updatedHistory);
  };

  const handleSubmitStudentExam = (finalizedSession: StudentExamSession) => {
    setActiveSessionState(finalizedSession);
    saveActiveStudentSession(finalizedSession);
    broadcastLiveSession(finalizedSession);
    syncStudentSessionToFirestore(finalizedSession, true).catch((err) =>
      console.warn("Firestore session submit sync error:", err)
    );
    syncStudentSessionToGAS(finalizedSession).catch((err) =>
      console.warn("GAS session submit sync error:", err)
    );

    const existingIdx = history.findIndex((h) => h.id === finalizedSession.id);
    let updatedHistory: StudentExamSession[];
    if (existingIdx >= 0) {
      updatedHistory = [...history];
      updatedHistory[existingIdx] = finalizedSession;
    } else {
      updatedHistory = [finalizedSession, ...history];
    }
    setHistoryState(updatedHistory);
    saveExamHistory(updatedHistory);
  };

  const handleForceSubmitStudent = (sessionId: string) => {
    const s = history.find((item) => item.id === sessionId);
    if (!s) return;

    let totalScoreEarned = 0;
    activeExam.questions.forEach((q) => {
      const ans = s.answers[q.id];
      if (ans && ans.selectedOption.toUpperCase() === q.correctAnswer.toUpperCase()) {
        totalScoreEarned += q.score;
      }
    });

    const maxScore = activeExam.totalScore > 0 ? activeExam.totalScore : 100;
    const percentage = Math.round((totalScoreEarned / maxScore) * 100);
    const passed = percentage >= (activeExam.teacherProfile.passingGrade || 75);

    const finalized: StudentExamSession = {
      ...s,
      status: "submitted",
      submitTime: new Date().toISOString(),
      totalScoreEarned,
      maxScore,
      percentage,
      passed,
    };

    handleSubmitStudentExam(finalized);
  };

  const handleResetStudentSession = (
    sessionId?: string,
    studentName?: string,
    token?: string,
    nisn?: string
  ) => {
    const cleanId = (sessionId || "").trim();
    const cleanName = (studentName || "").trim().toLowerCase();
    const cleanToken = (token || "").trim().toLowerCase();
    const cleanNisn = (nisn || "").trim();

    markRecentlyDeleted(cleanId, studentName, token, nisn);
    blacklistResetSession(cleanId, studentName, token, nisn, activeExam.code);

    // 1. Remove from historyState
    setHistoryState((prevHistory) => {
      const updatedHistory = prevHistory.filter((item) => {
        const matchId = cleanId && item.id === cleanId;
        const matchName = cleanName && item.studentName.trim().toLowerCase() === cleanName;
        const matchToken = cleanToken && item.token && item.token.trim().toLowerCase() === cleanToken;
        const matchNisn = cleanNisn && item.nisn && item.nisn.trim() === cleanNisn;
        return !(matchId || matchName || matchToken || matchNisn);
      });
      saveExamHistory(updatedHistory);
      return updatedHistory;
    });

    // 2. Delete on Firestore & Express server + broadcast reset to student devices
    deleteStudentSessionFromFirestore(cleanId, studentName, token, activeExam.code, nisn).catch(() => {});

    // 3. Reset token status in global tokens list to "belum_mulai"
    setTokensState((prevTokens) => {
      const updatedTokens = prevTokens.map((t) => {
        const matchId = cleanId && t.id === cleanId;
        const matchName = cleanName && t.studentName.trim().toLowerCase() === cleanName;
        const matchToken = cleanToken && t.token && t.token.trim().toLowerCase() === cleanToken;
        const matchNisn = cleanNisn && t.nisn && t.nisn.trim() === cleanNisn;
        if (matchId || matchName || matchToken || matchNisn) {
          return { ...t, status: "belum_mulai" as const };
        }
        return t;
      });
      saveStudentTokens(updatedTokens);
      return updatedTokens;
    });

    // 4. Also reset in activeExam.tokens if present
    if (activeExam.tokens && activeExam.tokens.length > 0) {
      const updatedExamTokens = activeExam.tokens.map((t) => {
        const matchName = cleanName && t.studentName.trim().toLowerCase() === cleanName;
        const matchToken = cleanToken && t.token && t.token.trim().toLowerCase() === cleanToken;
        const matchNisn = cleanNisn && t.nisn && t.nisn.trim() === cleanNisn;
        if (matchName || matchToken || matchNisn) {
          return { ...t, status: "belum_mulai" as const };
        }
        return t;
      });
      handleUpdateActiveExam({ ...activeExam, tokens: updatedExamTokens });
    }

    // 5. Clear active student session if matching
    if (
      activeSession &&
      (activeSession.id === cleanId ||
        (cleanName && activeSession.studentName.trim().toLowerCase() === cleanName) ||
        (cleanNisn && activeSession.nisn && activeSession.nisn.trim() === cleanNisn))
    ) {
      setActiveSessionState(null);
      saveActiveStudentSession(null);
    }
  };

  const handleDeleteStudent = (payload: {
    sessionId?: string;
    tokenId?: string;
    studentName: string;
    token?: string;
    nisn?: string;
  }) => {
    const cleanId = (payload.sessionId || "").trim();
    const cleanTokenId = (payload.tokenId || "").trim();
    const cleanName = (payload.studentName || "").trim().toLowerCase();
    const cleanToken = (payload.token || "").trim().toLowerCase();
    const cleanNisn = (payload.nisn || "").trim();

    markRecentlyDeleted(cleanId, payload.studentName, payload.token, payload.nisn);
    blacklistResetSession(cleanId, payload.studentName, payload.token, payload.nisn, activeExam.code);

    // 1. Remove from history
    setHistoryState((prevHistory) => {
      const updatedHistory = prevHistory.filter((item) => {
        const matchId = cleanId && item.id === cleanId;
        const matchName = cleanName && item.studentName.trim().toLowerCase() === cleanName;
        const matchToken = cleanToken && item.token && item.token.trim().toLowerCase() === cleanToken;
        const matchNisn = cleanNisn && item.nisn && item.nisn.trim() === cleanNisn;
        return !(matchId || matchName || matchToken || matchNisn);
      });
      saveExamHistory(updatedHistory);
      return updatedHistory;
    });

    // 2. Delete on Firestore & Express server + broadcast
    deleteStudentSessionFromFirestore(cleanId, payload.studentName, payload.token, activeExam.code, payload.nisn).catch(() => {});

    // 3. Remove token from tokensState
    setTokensState((prevTokens) => {
      const updatedTokens = prevTokens.filter((t) => {
        const matchTokenId = cleanTokenId && t.id === cleanTokenId;
        const matchName = cleanName && t.studentName.trim().toLowerCase() === cleanName;
        const matchToken = cleanToken && t.token.trim().toLowerCase() === cleanToken;
        const matchNisn = cleanNisn && t.nisn && t.nisn.trim() === cleanNisn;
        return !(matchTokenId || matchName || matchToken || matchNisn);
      });
      saveStudentTokens(updatedTokens);
      return updatedTokens;
    });

    // 4. Remove from activeExam.tokens if present
    if (activeExam.tokens && activeExam.tokens.length > 0) {
      const updatedExamTokens = activeExam.tokens.filter((t) => {
        const matchTokenId = cleanTokenId && t.id === cleanTokenId;
        const matchName = cleanName && t.studentName.trim().toLowerCase() === cleanName;
        const matchToken = cleanToken && t.token.trim().toLowerCase() === cleanToken;
        const matchNisn = cleanNisn && t.nisn && t.nisn.trim() === cleanNisn;
        return !(matchTokenId || matchName || matchToken || matchNisn);
      });
      handleUpdateActiveExam({ ...activeExam, tokens: updatedExamTokens });
    }

    // 5. Clear active session if matching
    if (
      activeSession &&
      (activeSession.id === cleanId ||
        (cleanName && activeSession.studentName.trim().toLowerCase() === cleanName) ||
        (cleanToken && activeSession.token.trim().toLowerCase() === cleanToken))
    ) {
      setActiveSessionState(null);
      saveActiveStudentSession(null);
    }
  };

  const handleBatchDeleteStudents = (
    students: Array<{
      sessionId?: string;
      tokenId?: string;
      studentName: string;
      token?: string;
      nisn?: string;
    }>
  ) => {
    if (!students || students.length === 0) return;

    students.forEach((s) => {
      markRecentlyDeleted(s.sessionId, s.studentName, s.token, s.nisn);
    });

    const sessionIdsToDelete = new Set(students.map((s) => (s.sessionId || "").trim()).filter(Boolean));
    const tokenIdsToDelete = new Set(students.map((s) => (s.tokenId || "").trim()).filter(Boolean));
    const namesToDelete = new Set(students.map((s) => (s.studentName || "").trim().toLowerCase()).filter(Boolean));
    const tokensToDelete = new Set(students.map((s) => (s.token || "").trim().toLowerCase()).filter(Boolean));
    const nisnsToDelete = new Set(students.map((s) => (s.nisn || "").trim()).filter(Boolean));

    // 1. Remove from history
    setHistoryState((prevHistory) => {
      const updatedHistory = prevHistory.filter((item) => {
        const matchId = sessionIdsToDelete.has(item.id);
        const matchName = namesToDelete.has(item.studentName.trim().toLowerCase());
        const matchToken = tokensToDelete.has(item.token.trim().toLowerCase());
        const matchNisn = item.nisn && nisnsToDelete.has(item.nisn.trim());
        return !(matchId || matchName || matchToken || matchNisn);
      });
      saveExamHistory(updatedHistory);
      return updatedHistory;
    });

    // 2. Batch delete on Firestore and server
    batchDeleteStudentSessionsFromFirestore({
      sessionIds: Array.from(sessionIdsToDelete),
      studentNames: students.map((s) => s.studentName),
      tokens: Array.from(tokensToDelete),
      nisns: Array.from(nisnsToDelete),
      examCode: activeExam.code,
      examId: activeExam.id,
    }).catch(() => {});

    // 3. Remove from tokensState
    setTokensState((prevTokens) => {
      const updatedTokens = prevTokens.filter((t) => {
        const matchId = tokenIdsToDelete.has(t.id);
        const matchName = namesToDelete.has(t.studentName.trim().toLowerCase());
        const matchToken = tokensToDelete.has(t.token.trim().toLowerCase());
        const matchNisn = t.nisn && nisnsToDelete.has(t.nisn.trim());
        return !(matchId || matchName || matchToken || matchNisn);
      });
      saveStudentTokens(updatedTokens);
      return updatedTokens;
    });

    // 4. Remove from activeExam.tokens
    if (activeExam.tokens && activeExam.tokens.length > 0) {
      const updatedExamTokens = activeExam.tokens.filter((t) => {
        const matchId = tokenIdsToDelete.has(t.id);
        const matchName = namesToDelete.has(t.studentName.trim().toLowerCase());
        const matchToken = tokensToDelete.has(t.token.trim().toLowerCase());
        const matchNisn = t.nisn && nisnsToDelete.has(t.nisn.trim());
        return !(matchId || matchName || matchToken || matchNisn);
      });
      handleUpdateActiveExam({ ...activeExam, tokens: updatedExamTokens });
    }
  };

  const handleBatchResetSessions = (
    students: Array<{
      sessionId?: string;
      studentName: string;
      token?: string;
      nisn?: string;
    }>
  ) => {
    if (!students || students.length === 0) return;

    students.forEach((s) => {
      markRecentlyDeleted(s.sessionId, s.studentName, s.token, s.nisn);
      blacklistResetSession(s.sessionId, s.studentName, s.token, s.nisn, activeExam.code);
    });

    const sessionIdsToReset = new Set(students.map((s) => (s.sessionId || "").trim()).filter(Boolean));
    const namesToReset = new Set(students.map((s) => (s.studentName || "").trim().toLowerCase()).filter(Boolean));
    const tokensToReset = new Set(students.map((s) => (s.token || "").trim().toLowerCase()).filter(Boolean));
    const nisnsToReset = new Set(students.map((s) => (s.nisn || "").trim()).filter(Boolean));

    // 1. Remove from history
    setHistoryState((prevHistory) => {
      const updatedHistory = prevHistory.filter((item) => {
        const matchId = sessionIdsToReset.has(item.id);
        const matchName = namesToReset.has(item.studentName.trim().toLowerCase());
        const matchToken = tokensToReset.has(item.token.trim().toLowerCase());
        const matchNisn = item.nisn && nisnsToReset.has(item.nisn.trim());
        return !(matchId || matchName || matchToken || matchNisn);
      });
      saveExamHistory(updatedHistory);
      return updatedHistory;
    });

    // 2. Batch delete on Firestore and server
    batchDeleteStudentSessionsFromFirestore({
      sessionIds: Array.from(sessionIdsToReset),
      studentNames: students.map((s) => s.studentName),
      tokens: Array.from(tokensToReset),
      nisns: Array.from(nisnsToReset),
      examCode: activeExam.code,
      examId: activeExam.id,
    }).catch(() => {});

    // 3. Reset tokens status to "belum_mulai"
    setTokensState((prevTokens) => {
      const updatedTokens = prevTokens.map((t) => {
        const matchName = namesToReset.has(t.studentName.trim().toLowerCase());
        const matchToken = tokensToReset.has(t.token.trim().toLowerCase());
        const matchNisn = t.nisn && nisnsToReset.has(t.nisn.trim());
        if (matchName || matchToken || matchNisn) {
          return { ...t, status: "belum_mulai" as const };
        }
        return t;
      });
      saveStudentTokens(updatedTokens);
      return updatedTokens;
    });

    // 4. Also in activeExam.tokens
    if (activeExam.tokens && activeExam.tokens.length > 0) {
      const updatedExamTokens = activeExam.tokens.map((t) => {
        const matchName = namesToReset.has(t.studentName.trim().toLowerCase());
        const matchToken = tokensToReset.has(t.token.trim().toLowerCase());
        const matchNisn = t.nisn && nisnsToReset.has(t.nisn.trim());
        if (matchName || matchToken || matchNisn) {
          return { ...t, status: "belum_mulai" as const };
        }
        return t;
      });
      handleUpdateActiveExam({ ...activeExam, tokens: updatedExamTokens });
    }
  };

  const handleUpdateActiveExamHistory = (updatedActiveHistory: StudentExamSession[]) => {
    // Preserve records from all other exams
    const otherExamsHistory = history.filter((h) => {
      const isCurrentExam =
        (activeExam.id && h.examId === activeExam.id) ||
        (activeExam.code && h.examCode && h.examCode.trim().toUpperCase() === activeExam.code.trim().toUpperCase());
      return !isCurrentExam;
    });
    const newFullHistory = [...otherExamsHistory, ...updatedActiveHistory];
    setHistoryState(newFullHistory);
    saveExamHistory(newFullHistory);
  };

  const handleReloadAllData = () => {
    setSchoolProfileState(getSchoolProfile());
    const allExams = getExamPackages();
    setExamsState(allExams);
    setActiveExamIdState(getActiveExamId() || allExams[0]?.id || "");
    setTokensState(getStudentTokens());
    setHistoryState(getExamHistory());
    setActiveSessionState(getActiveStudentSession());
  };

  // Navigation Items (Teacher Mode: Pure Management & AI Tools)
  const navTabs = [
    { id: "monitoring" as NavigationTab, label: "Live Monitoring Guru", icon: Monitor },
    { id: "ai_generator" as NavigationTab, label: "Editor Soal & AI Gemini", icon: Sparkles },
    { id: "item_analysis" as NavigationTab, label: "Analisis Butir & Nilai", icon: BarChart3 },
    { id: "tokens" as NavigationTab, label: "Token & Kode Akses", icon: Key },
    { id: "school_profile" as NavigationTab, label: "Profil & Cetak Naskah", icon: Building2 },
    { id: "backup_restore" as NavigationTab, label: "Sinkronisasi Cloud", icon: Cloud },
  ];

  // =========================================================================
  // STANDALONE DIRECT STUDENT LINK VIEW (NO TEACHER NAVIGATION / DISTRACTIONS)
  // =========================================================================
  if (isDirectStudentMode) {
    const targetExam = (requestedExamCode || requestedDriveId)
      ? exams.find((e) =>
          (requestedExamCode && (e.id === requestedExamCode || e.code.toUpperCase() === requestedExamCode.toUpperCase())) ||
          (requestedDriveId && e.gdriveFileId === requestedDriveId)
        )
      : (exams.length > 0 && exams[0].id !== "exam-demo-01" ? exams[0] : null);

    // 1. Loading State
    if (isFetchingRemoteExam || ((requestedExamCode || requestedDriveId) && !targetExam && !remoteFetchError)) {
      return (
        <div className="min-h-screen bg-[#09090b] text-slate-100 flex flex-col items-center justify-center p-4">
          <div className="bg-[#121214] border border-slate-800 rounded-3xl p-8 max-w-md w-full text-center space-y-6 shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mx-auto animate-pulse">
              <Cloud className="w-8 h-8 animate-bounce" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-black text-white tracking-tight">Memuat Naskah Soal Ujian</h2>
              <p className="text-sm text-slate-400">
                Mencari dan mengunduh naskah dari Google Drive / Server CBT:
              </p>
              <div className="inline-block px-4 py-1.5 rounded-xl bg-indigo-950/60 border border-indigo-500/40 text-indigo-300 font-mono font-bold text-sm">
                {requestedExamCode || requestedDriveId || "Paket Soal"}
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
              Sinkronisasi Google Drive (Backup_Data_Aplikasi) & Server...
            </div>
          </div>
        </div>
      );
    }

    // 2. Exam Not Found State: Show clear student recovery card (NEVER leak demo preview questions!)
    if (!targetExam) {
      return (
        <div className="min-h-screen bg-[#09090b] text-slate-100 flex flex-col items-center justify-center p-4">
          <div className="bg-[#121214] border border-amber-500/30 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-6 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Naskah Soal Belum Ditemukan</h2>
                <p className="text-xs text-slate-400">
                  {remoteFetchError || `Naskah soal "${requestedExamCode || requestedDriveId || "Ujian"}" belum tersedia di server atau Google Drive.`}
                </p>
              </div>
            </div>

            {/* Diagnostic Alert Khusus Akun Belajar.id & Izin Google Drive */}
            {remoteFetchError &&
              (remoteFetchError.toLowerCase().includes("belajar.id") ||
                remoteFetchError.toLowerCase().includes("403") ||
                remoteFetchError.toLowerCase().includes("ditolak") ||
                remoteFetchError.toLowerCase().includes("restricted")) && (
                <div className="p-4 bg-rose-950/40 border border-rose-500/40 rounded-2xl text-xs space-y-2.5 animate-in fade-in">
                  <div className="flex items-center gap-2 font-bold text-rose-300">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>Kendala Izin Akun @belajar.id & Google Drive</span>
                  </div>
                  <p className="text-[11px] text-rose-200 leading-relaxed">
                    Google Drive dari akun <strong>@belajar.id</strong> secara default membatasi akses file hanya untuk pengguna di dalam domain organisasi (Domain Access Control). Server publik atau siswa umum akan menerima pesan <em>403 Forbidden</em> atau <em>Soal tidak ditemukan</em>.
                  </p>
                  <div className="p-3 bg-black/40 rounded-xl border border-rose-900/50 space-y-1.5 text-[11px] text-slate-300">
                    <strong className="text-white block font-semibold">Langkah Perbaikan untuk Guru:</strong>
                    <div>
                      1. <strong className="text-emerald-300">Gunakan Akun Gmail Biasa (@gmail.com):</strong> Pindahkan file naskah soal ke akun Gmail pribadi, lalu ubah izin akses menjadi <em>"Siapa saja yang memiliki link"</em> &rarr; <em>"Pelihat"</em>.
                    </div>
                    <div>
                      2. <strong className="text-cyan-300">Gunakan Format Direct Download Link:</strong> Salin format link langsung: <code className="text-amber-300 font-mono text-[10px]">https://drive.google.com/uc?export=download&id=ID_FILE</code>.
                    </div>
                    <div>
                      3. <strong className="text-amber-300">Solusi Terbaik (Paket Anti-Gagal):</strong> Buka menu <em>Bagikan Ujian</em> di aplikasi guru, lalu pilih tab <em>"Paket Anti-Gagal"</em>. Link ini 100% langsung memuat soal tanpa memerlukan Google Drive.
                    </div>
                  </div>
                </div>
              )}

            {/* Input Manual Kode Soal atau Link Google Drive */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-2.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Masukkan Kode Soal atau Link Google Drive</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Kode / URL</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={manualStudentCode}
                  onChange={(e) => setManualStudentCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && manualStudentCode.trim()) {
                      const trimmed = manualStudentCode.trim();
                      const decoded = decodeExamFromUrlString(trimmed);
                      if (decoded?.exam && Array.isArray(decoded.exam.questions) && decoded.exam.questions.length > 0) {
                        applyLoadedRemoteExam(decoded.exam, decoded.token, decoded.tokens);
                        setManualStudentCode("");
                        return;
                      }
                      const extracted = extractGoogleDriveFileId(trimmed);
                      if (extracted.fileId) {
                        setRequestedDriveId(extracted.fileId);
                        executeRemoteExamFetch(null, extracted.fileId);
                      } else {
                        setRequestedExamCode(trimmed.toUpperCase());
                        executeRemoteExamFetch(trimmed.toUpperCase(), null);
                      }
                    }
                  }}
                  placeholder="Contoh: PP-01, link ujian, atau link Google Drive"
                  className="flex-1 px-3.5 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!manualStudentCode.trim()) return;
                    const trimmed = manualStudentCode.trim();
                    const decoded = decodeExamFromUrlString(trimmed);
                    if (decoded?.exam && Array.isArray(decoded.exam.questions) && decoded.exam.questions.length > 0) {
                      applyLoadedRemoteExam(decoded.exam, decoded.token, decoded.tokens);
                      setManualStudentCode("");
                      return;
                    }
                    const extracted = extractGoogleDriveFileId(trimmed);
                    if (extracted.fileId) {
                      setRequestedDriveId(extracted.fileId);
                      executeRemoteExamFetch(null, extracted.fileId);
                    } else {
                      setRequestedExamCode(trimmed.toUpperCase());
                      executeRemoteExamFetch(trimmed.toUpperCase(), null);
                    }
                  }}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0 shadow-md shadow-indigo-950"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Muat Soal</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                💡 Anda dapat mengetik kode ujian (misal: <code>PP-01</code>), menempel link paket anti-gagal, atau link direct download Google Drive.
              </p>
            </div>

            {/* Unggah File Naskah (.json) */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Buka File Naskah (.json) Langsung</h4>
                  <p className="text-[11px] text-slate-400">Jika guru mengirimkan file soal via WhatsApp / Flashdisk</p>
                </div>
              </div>
              <label className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 border border-dashed border-slate-600 rounded-xl text-xs font-semibold text-slate-300 flex items-center justify-center gap-2 cursor-pointer transition-all">
                <FileUp className="w-4 h-4 text-cyan-400" />
                <span>Pilih File Naskah (.json) dari Perangkat</span>
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleStudentUploadExamJson(file);
                  }}
                />
              </label>
            </div>

            {/* Info untuk Guru */}
            <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/20 text-[11px] text-slate-300 space-y-1.5">
              <strong className="text-indigo-300 flex items-center gap-1.5 font-semibold">
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                <span>Petunjuk untuk Guru & Pengawas:</span>
              </strong>
              <p className="text-slate-400 leading-relaxed">
                Jika naskah soal belum muncul otomatis di perangkat siswa, Anda dapat membagikan <strong>"Paket Anti-Gagal"</strong> dari menu <strong>Bagikan Ujian</strong>. Tautan tersebut bebas dari kendala izin Google Drive atau akun @belajar.id.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => {
                  executeRemoteExamFetch(requestedExamCode, requestedDriveId);
                }}
                className="w-full py-2.5 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Coba Cari Ulang di Google Drive & Server</span>
              </button>
              <button
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.close();
                  }
                }}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-xl text-xs font-medium cursor-pointer transition-all flex items-center justify-center gap-1.5"
                title="Tutup tab pengerjaan ujian ini"
              >
                <X className="w-3.5 h-3.5" />
                <span>Tutup Halaman Ujian</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // 3. Target Exam Found: Render isolated StudentSlideExam
    const examToRender = targetExam;
    const baseList = (examToRender.tokens && examToRender.tokens.length > 0)
      ? examToRender.tokens
      : tokens;
    const targetExamTokens = deduplicateStudentTokens(
      baseList,
      examToRender.code,
      examToRender.teacherProfile?.gradeLevel,
      examToRender.id
    );
    const targetExamSession = activeSession &&
      (activeSession.examId === examToRender.id ||
       (examToRender.code && activeSession.examCode?.trim().toUpperCase() === examToRender.code.trim().toUpperCase()))
        ? activeSession
        : null;

    return (
      <div className="min-h-screen bg-[#09090b] text-slate-100 flex flex-col justify-between selection:bg-indigo-600 selection:text-white">
        <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 lg:p-8">
          <StudentSlideExam
            exam={examToRender}
            tokens={targetExamTokens}
            currentSession={targetExamSession}
            onSaveSession={handleSaveStudentSession}
            onSubmitExam={handleSubmitStudentExam}
            onExit={() => {
              if (typeof window !== "undefined") {
                window.close();
              }
            }}
            schoolProfile={schoolProfile}
            initialToken={urlToken}
            isDirectLink={true}
            isTeacherTrial={isTeacherTrial}
            allExams={exams}
            onSwitchExam={(target) => handleSelectExamId(target.id)}
            requestedExamCode={requestedExamCode}
          />
        </main>

        <footer className="bg-[#0c0c0e] border-t border-slate-800/80 py-3 px-4 text-center text-xs text-slate-500">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="text-[11px] text-slate-400">
              {examToRender.schoolProfile?.schoolName || schoolProfile.schoolName} • Slide CBT Siswa Mandiri
            </div>
            <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Mode Pengerjaan Siswa (Slide CBT) • Dilindungi Sistem Anti-Kecurangan
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // =========================================================================
  // TEACHER / ADMIN WORKSPACE VIEW
  // =========================================================================
  return (
    <div className="min-h-screen bg-[#09090b] text-slate-100 flex flex-col selection:bg-indigo-600 selection:text-white">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 bg-[#0c0c0e]/95 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Logo & School Name */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-950 shrink-0">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div className="hidden sm:block">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm text-white tracking-tight">SlideExam AI CBT</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                  v2.6 Multi-Format
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate max-w-[200px] lg:max-w-xs">
                {schoolProfile.schoolName}
              </p>
            </div>
          </div>

          {/* Active Exam Selector Dropdown & Direct Share */}
          <div className="flex items-center gap-2">
            <div className="relative flex items-center">
              <select
                id="active-exam-selector"
                value={activeExamId}
                onChange={(e) => handleSelectExamId(e.target.value)}
                className="bg-[#161618] text-slate-200 text-xs font-semibold rounded-xl pl-3 pr-8 py-2 border border-slate-700 hover:border-slate-600 focus:outline-none focus:border-indigo-500 appearance-none cursor-pointer max-w-[170px] sm:max-w-[240px] truncate"
              >
                {exams.map((e) => (
                  <option key={e.id} value={e.id} className="bg-[#121214] text-slate-200">
                    {e.title} ({e.questions.length} Soal)
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 pointer-events-none" />
            </div>

            {/* Quick Share Link Modal Trigger */}
            <button
              onClick={() => setIsShareModalOpen(true)}
              className="p-2 sm:px-3 sm:py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm shrink-0"
              title="Bagikan Tautan Ujian Siswa Langsung"
            >
              <Share2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden md:inline">Bagikan Link Siswa</span>
            </button>

            {/* Buka Mode Siswa di Tab Baru (Terisolasi Sepenuhnya dari Guru) */}
            <button
              onClick={() => {
                const url = `${window.location.origin}${window.location.pathname}?mode=student&code=${encodeURIComponent(activeExam.code)}`;
                window.open(url, "_blank");
              }}
              className="p-2 sm:px-3 sm:py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-md shadow-indigo-950 shrink-0"
              title="Buka Mode Siswa di Tab Baru (Terpisah Sepenuhnya dari Mode Guru)"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span className="hidden md:inline">Mode Siswa (Tab Baru)</span>
              <ExternalLink className="w-3 h-3 text-indigo-200" />
            </button>

            <button
              onClick={handleCreateNewExam}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer shrink-0"
              title="Buat Paket Naskah Ujian Baru"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Gemini API Key Status Badge */}
          <div className="hidden lg:flex items-center gap-2">
            <button
              onClick={() => setIsGeminiModalOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                geminiStatus?.configured
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              <span>{geminiStatus?.configured ? "Gemini AI Aktif" : "Set Kunci Gemini"}</span>
            </button>
          </div>

          {/* Mobile Menu Toggle */}
          <div className="flex md:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 rounded-xl bg-[#161618] text-slate-300 border border-slate-700 cursor-pointer"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Desktop Navigation Tabs */}
        <div className="hidden md:flex items-center justify-between border-t border-slate-800/80 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto overflow-x-auto scrollbar-none">
          <nav className="flex space-x-1 py-1.5 min-w-max">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-950"
                      : "text-slate-400 hover:text-slate-200 hover:bg-[#161618]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Quick Sandbox Trial Launcher in New Tab */}
          <button
            onClick={() => {
              const url = `${window.location.origin}${window.location.pathname}?mode=student&code=${encodeURIComponent(activeExam.code)}&trial=true`;
              window.open(url, "_blank");
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-all cursor-pointer ml-3 shrink-0"
            title="Simulasi Pengerjaan Guru di Tab Terpisah (Hasil tidak masuk rekap nilai siswa)"
          >
            <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
            <span>Simulasi Guru (Tab Baru)</span>
            <ExternalLink className="w-3 h-3 text-amber-400" />
          </button>
        </div>

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-slate-800 bg-[#0c0c0e] p-4 space-y-3 animate-in slide-in-from-top-2">
            <div className="space-y-1">
              {navTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      isActive ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-[#1a1a1c]"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Quick Isolated Mode Buttons for Mobile */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <button
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?mode=student&code=${encodeURIComponent(activeExam.code)}`;
                  window.open(url, "_blank");
                  setIsMobileMenuOpen(false);
                }}
                className="w-full py-2.5 px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Buka Mode Siswa (Tab Baru)</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?mode=student&code=${encodeURIComponent(activeExam.code)}&trial=true`;
                  window.open(url, "_blank");
                  setIsMobileMenuOpen(false);
                }}
                className="w-full py-2 px-3.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
                <span>Simulasi Guru (Tab Baru)</span>
                <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* TAB 1: Mode Ujian Siswa (Auto-redirect ke Tab Terpisah) */}
        {activeTab === "student_exam" && (
          <div className="p-8 text-center bg-[#161618] border border-slate-800 rounded-2xl max-w-md mx-auto space-y-4 my-12 shadow-xl">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center mx-auto border border-indigo-500/30">
              <Play className="w-6 h-6 fill-indigo-400" />
            </div>
            <h3 className="font-bold text-white text-base">Mode Siswa Telah Diisolasi di Tab Baru</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Mode pengerjaan siswa terpisah sepenuhnya dari dashboard guru demi keamanan ujian dan integritas kunci jawaban.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?mode=student&code=${encodeURIComponent(activeExam.code)}`;
                  window.open(url, "_blank");
                }}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Buka Ulang Tab Siswa</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setActiveTab("monitoring")}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium cursor-pointer transition-all"
              >
                Kembali ke Live Monitoring Guru
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: Live Monitoring & Real-Time Grading Dashboard */}
        {activeTab === "monitoring" && (
          <LiveMonitoringDashboard
            exam={activeExam}
            school={schoolProfile}
            history={activeExamHistory}
            tokens={activeExamTokens}
            onForceSubmitStudent={handleForceSubmitStudent}
            onResetStudentSession={handleResetStudentSession}
            onDeleteStudent={handleDeleteStudent}
            onBatchDeleteStudents={handleBatchDeleteStudents}
            onBatchResetSessions={handleBatchResetSessions}
            onUpdateHistory={handleUpdateActiveExamHistory}
            onUpdateTokens={handleUpdateTokens}
            onUpdateExam={handleUpdateActiveExam}
          />
        )}

        {/* TAB 3: Gemini AI Question Generator & Slide Editor */}
        {activeTab === "ai_generator" && (
          <AIGeneratorAndEditor
            activeExam={activeExam}
            onUpdateExam={handleUpdateActiveExam}
            onPreviewSlides={() => {
              const url = `${window.location.origin}${window.location.pathname}?mode=student&code=${encodeURIComponent(activeExam.code)}`;
              window.open(url, "_blank");
            }}
            onStartTeacherTrial={() => {
              const url = `${window.location.origin}${window.location.pathname}?mode=student&code=${encodeURIComponent(activeExam.code)}&trial=true`;
              window.open(url, "_blank");
            }}
            onOpenGeminiModal={() => setIsGeminiModalOpen(true)}
            activeToken={activeExam.sessionToken}
            school={schoolProfile}
            exams={exams}
            onSelectExamId={(id) => handleSelectExamId(id)}
            onDeleteExam={(id) => handleDeleteExamPackage(id)}
            onDuplicateExam={(exam) => handleDuplicateExamPackage(exam)}
            onCreateNewExam={handleCreateNewExam}
            onClearAllExams={handleClearAllExams}
          />
        )}

        {/* TAB 4: Item Analysis & History with Bulk Sheets Download */}
        {activeTab === "item_analysis" && (
          <ItemAnalysisAndHistory
            exam={activeExam}
            school={schoolProfile}
            history={activeExamHistory}
            onUpdateHistory={handleUpdateActiveExamHistory}
          />
        )}

        {/* TAB 5: Exam Codes & Token Manager */}
        {activeTab === "tokens" && (
          <TokenManager
            exam={activeExam}
            school={schoolProfile}
            tokens={tokens}
            allExams={exams}
            onUpdateExamToken={handleUpdateExamToken}
            onUpdateTokens={handleUpdateTokens}
            onUpdateExam={handleUpdateActiveExam}
            onSelectExam={(e) => handleSelectExamId(e.id)}
          />
        )}

        {/* TAB 6: School Profile & Formal Docs Print */}
        {activeTab === "school_profile" && (
          <SchoolProfileAndPrintView
            school={schoolProfile}
            activeExam={activeExam}
            onUpdateSchool={handleUpdateSchool}
            onUpdateExam={handleUpdateActiveExam}
          />
        )}

        {/* TAB 7: Backup & Restore (Google Drive Sync Folder) */}
        {activeTab === "backup_restore" && (
          <BackupRestoreView onDataRestored={handleReloadAllData} />
        )}
      </main>

      {/* Direct Student Share Modal */}
      <DirectStudentShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        exam={activeExam}
        token={activeExam.sessionToken}
        tokens={activeExamTokens}
        allExams={exams}
        onSelectExam={(e) => handleSelectExamId(e.id)}
      />

      {/* Gemini API Key Configuration Modal */}
      <GeminiApiKeyModal
        isOpen={isGeminiModalOpen}
        onClose={() => setIsGeminiModalOpen(false)}
        onKeyUpdated={checkGeminiStatus}
      />

      {/* Modern Compact Footer */}
      <footer className="bg-[#0c0c0e] border-t border-slate-800 py-4 px-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">SlideExam CBT</span>
            <span>•</span>
            <span className="text-slate-400">{schoolProfile.schoolName}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            Didukung oleh Google Gemini AI • Auto-Grading CBT Engine
          </div>
        </div>
      </footer>
    </div>
  );
}
