import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  CheckCircle2,
  AlertTriangle,
  BookOpen,
  UserCheck,
  Building2,
  GraduationCap,
  Sparkles,
  HelpCircle,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Layers,
  Key,
  ShieldCheck,
  ShieldAlert,
  Check,
  Send,
  Volume2,
  VolumeX,
  BellRing,
  X,
  Image as ImageIcon,
  ArrowRightLeft,
  FileEdit,
  AlignLeft,
  Search,
  FlaskConical,
  RotateCcw,
  Hash,
  IdCard,
  ListOrdered,
  Cloud,
  RefreshCw,
  FileSpreadsheet,
  Info,
  Play
} from "lucide-react";
import {
  ExamPackage,
  Question,
  StudentAnswerItem,
  StudentExamSession,
  StudentTokenItem,
  CheatingViolationLog,
  MatchingPair
} from "../types";
import { StudentResultView } from "./StudentResultView";
import { prepareStudentExamQuestions } from "../utils/shuffle";
import { validateStudentLoginToken, validateExamToken, normalizeToken, deduplicateStudentTokens } from "../utils/tokenValidator";
import { getStudentTokens, saveActiveStudentSession, getActiveStudentSession, getExamHistory } from "../utils/storage";
import { broadcastLiveSession, subscribeToSessionResets } from "../utils/liveSync";
import { syncStudentSessionToGAS, fetchStudentRosterFromGAS, getGasConfig } from "../utils/gasService";
import { syncStudentSessionToFirestore } from "../utils/firestoreService";
import {
  playExamTimeWarningSound,
  isSoundNotificationEnabled,
  setSoundNotificationEnabled,
} from "../utils/audioAlert";

interface StudentSlideExamProps {
  exam: ExamPackage;
  tokens: StudentTokenItem[];
  currentSession: StudentExamSession | null;
  onSaveSession: (session: StudentExamSession) => void;
  onSubmitExam: (session: StudentExamSession) => void;
  onExit: () => void;
  initialToken?: string;
  isDirectLink?: boolean;
  isTeacherTrial?: boolean;
  allExams?: ExamPackage[];
  onSwitchExam?: (exam: ExamPackage) => void;
  requestedExamCode?: string | null;
}

export const StudentSlideExam: React.FC<StudentSlideExamProps> = ({
  exam,
  tokens,
  currentSession,
  onSaveSession,
  onSubmitExam,
  onExit,
  initialToken,
  isDirectLink = false,
  isTeacherTrial = false,
  allExams,
  onSwitchExam,
  requestedExamCode,
}) => {
  // State for live roster loaded from Google Sheets (Roster_Siswa)
  const [cloudRosterStudents, setCloudRosterStudents] = useState<StudentTokenItem[] | null>(null);
  const [isLoadingRoster, setIsLoadingRoster] = useState<boolean>(false);
  const [rosterSyncMsg, setRosterSyncMsg] = useState<string | null>(null);
  const [showRosterGuideModal, setShowRosterGuideModal] = useState<boolean>(false);

  // Available registered students roster from profile data (strictly deduplicated & isolated to current exam code and grade level)
  const availableStudents = React.useMemo(() => {
    // Priority 0: Live roster loaded from Google Sheets (Roster_Siswa) via Google Apps Script
    if (cloudRosterStudents && cloudRosterStudents.length > 0) {
      return deduplicateStudentTokens(cloudRosterStudents, exam.code, exam.teacherProfile?.gradeLevel, exam.id);
    }

    let list: StudentTokenItem[] = [];

    // Priority 1: Tokens explicitly saved on the exam package
    if (exam.tokens && exam.tokens.length > 0) {
      list = exam.tokens.map((t) => ({
        ...t,
        examCode: exam.code,
      }));
      return deduplicateStudentTokens(list, exam.code, exam.teacherProfile?.gradeLevel, exam.id);
    }

    // Priority 2: Tokens passed via prop from global app state
    if (tokens && tokens.length > 0) {
      list = tokens;
    } else {
      // Priority 3: LocalStorage tokens repository
      list = getStudentTokens();
    }

    // Priority 4: Draft roster if available in localStorage
    if (!list || list.length === 0) {
      try {
        const draftRoster = localStorage.getItem("slideexam_draft_student_roster");
        if (draftRoster) {
          const parsed = JSON.parse(draftRoster);
          if (parsed.studentNames) {
            const rawNames = parsed.studentNames.split("\n").map((s: string) => s.trim()).filter(Boolean);
            if (rawNames.length > 0) {
              list = rawNames.map((name: string, idx: number) => ({
                id: `tok-draft-${idx + 1}-${name.toLowerCase().replace(/\s+/g, "")}`,
                studentName: name,
                className: parsed.className || exam.teacherProfile?.gradeLevel || "Kelas Siswa",
                nisn: String(idx + 1).padStart(2, "0"),
                examCode: exam.code,
                status: "belum_mulai" as const,
                generatedAt: new Date().toISOString(),
              }));
            }
          }
        }
      } catch {}
    }

    return deduplicateStudentTokens(list, exam.code, exam.teacherProfile?.gradeLevel, exam.id);
  }, [tokens, exam.tokens, exam.code, exam.teacherProfile?.gradeLevel, exam.id]);

  // Login Gate State (if no session active)
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(!!currentSession);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [isManualInput, setIsManualInput] = useState<boolean>(false);
  const [loginStudentName, setLoginStudentName] = useState("");
  const [loginNisn, setLoginNisn] = useState("");
  const [loginClass, setLoginClass] = useState(() => exam.teacherProfile.gradeLevel || "");
  const [loginExamCode, setLoginExamCode] = useState(() => exam.code);
  // Student Login Token: Students MUST enter their own student login token, NOT session token!
  const [loginToken, setLoginToken] = useState<string>(() => {
    if (initialToken && initialToken !== exam.sessionToken && initialToken !== exam.code) {
      return initialToken.trim().toUpperCase();
    }
    return "";
  });
  const [loginError, setLoginError] = useState<string | null>(null);

  // Dialog / Modal for choosing session action: Mulai Ulang, Lanjutkan Sesi, Kumpulkan
  const [sessionActionPrompt, setSessionActionPrompt] = useState<{
    show: boolean;
    existingSession: StudentExamSession;
    targetExam: ExamPackage;
  } | null>(null);

  // Confirmation modal to restart exam while inside the slide exam
  const [showResetConfirmModal, setShowResetConfirmModal] = useState<boolean>(false);

  // Sync login fields when exam code or grade level change
  useEffect(() => {
    setLoginExamCode(exam.code);
    setLoginClass((prev) => (!prev ? exam.teacherProfile.gradeLevel || "" : prev));
    if (initialToken && initialToken !== exam.sessionToken && initialToken !== exam.code && !loginToken) {
      setLoginToken(initialToken.trim().toUpperCase());
    }
  }, [exam.code, exam.teacherProfile.gradeLevel, initialToken, exam.sessionToken]);

  // Automatically maintain dropdown mode when availableStudents roster is loaded
  useEffect(() => {
    if (availableStudents.length > 0) {
      if (selectedStudentId !== "__manual__") {
        setIsManualInput(false);
      }
    } else {
      setIsManualInput(true);
      setSelectedStudentId("__manual__");
    }
  }, [availableStudents.length, selectedStudentId]);

  // Auto-fetch student roster from Google Sheets via GAS if configured
  useEffect(() => {
    const gasCfg = getGasConfig();
    if (gasCfg.webAppUrl) {
      setIsLoadingRoster(true);
      fetchStudentRosterFromGAS(exam.code, exam.teacherProfile?.gradeLevel)
        .then((res) => {
          if (res && res.success && Array.isArray(res.roster) && res.roster.length > 0) {
            setCloudRosterStudents(res.roster);
            setRosterSyncMsg(`✓ ${res.roster.length} data siswa terhubung dari Google Sheets (Roster_Siswa)`);
          }
        })
        .catch(() => {})
        .finally(() => setIsLoadingRoster(false));
    }
  }, [exam.code, exam.teacherProfile?.gradeLevel]);

  // Manual refresh student roster from Google Sheets
  const handleManualRefreshRoster = async () => {
    setIsLoadingRoster(true);
    setRosterSyncMsg(null);
    try {
      const res = await fetchStudentRosterFromGAS(exam.code, exam.teacherProfile?.gradeLevel);
      if (res && res.success && Array.isArray(res.roster) && res.roster.length > 0) {
        setCloudRosterStudents(res.roster);
        setRosterSyncMsg(`✓ Berhasil memuat ${res.roster.length} siswa asli dari spreadsheet Roster_Siswa!`);
        setTimeout(() => setRosterSyncMsg(null), 5000);
      } else {
        setRosterSyncMsg("Belum ada data siswa ditemukan di spreadsheet Roster_Siswa Google Drive.");
        setShowRosterGuideModal(true);
      }
    } catch {
      setRosterSyncMsg("Gagal menghubungi Google Apps Script.");
      setShowRosterGuideModal(true);
    } finally {
      setIsLoadingRoster(false);
    }
  };

  // Check if current displayed students are dummy/sample data
  const isUsingSampleData = React.useMemo(() => {
    if (cloudRosterStudents && cloudRosterStudents.length > 0) return false;
    if (exam.tokens && exam.tokens.length > 0) return false;
    return availableStudents.some((st) =>
      st.studentName === "Aditya Pratama Putra" ||
      st.studentName === "Bella Safitri Anggraini" ||
      st.studentName === "Citra Lestari" ||
      st.studentName === "Dimas Arya Wijaya"
    );
  }, [availableStudents, cloudRosterStudents, exam.tokens]);

  // Student dropdown selector handler
  const handleSelectStudent = (studentId: string) => {
    setSelectedStudentId(studentId);

    if (studentId === "__manual__") {
      setIsManualInput(true);
      setLoginStudentName("");
      setLoginNisn("");
      setLoginClass(exam.teacherProfile.gradeLevel || "Kelas X");
      return;
    }

    setIsManualInput(false);

    if (!studentId) {
      setLoginStudentName("");
      setLoginNisn("");
      return;
    }

    const foundIdx = availableStudents.findIndex((st) => st.id === studentId || st.studentName === studentId);
    if (foundIdx !== -1) {
      const student = availableStudents[foundIdx];
      const noUrut = String(foundIdx + 1).padStart(2, "0");

      // 1. Set nama siswa
      setLoginStudentName(student.studentName);

      // 2. Set nomor peserta sesuai nomor urut nama siswa di data profil
      setLoginNisn(noUrut);

      // 3. Set kelas otomatis sesuai data profil
      setLoginClass(student.className || exam.teacherProfile.gradeLevel || "Kelas X");

      // 4. Do NOT auto-fill token when selecting name - student must enter their own Student Login Token!
      // This enforces requirement #1 (siswa harus memasukkan token login siswa)
      if (loginError) setLoginError(null);
    }
  };

  // Real-time Token Validator strictly verifying student login token (rejecting session token)
  const tokenValidation = React.useMemo(() => {
    if (!loginToken.trim()) return null;
    return validateStudentLoginToken(loginToken, exam, tokens, loginStudentName, allExams);
  }, [loginToken, exam, tokens, loginStudentName, allExams]);

  // Handle token input change with auto-fill matching personal student token
  const handleTokenChange = (newToken: string) => {
    setLoginToken(newToken);
    if (loginError) setLoginError(null);

    const validation = validateStudentLoginToken(newToken, exam, tokens, loginStudentName, allExams);
    if (validation.isValid && validation.matchedStudent) {
      const matched = validation.matchedStudent;
      const foundIdx = availableStudents.findIndex(
        (st) =>
          st.id === matched.id ||
          st.studentName.toLowerCase().trim() === matched.studentName.toLowerCase().trim()
      );
      if (foundIdx !== -1) {
        setSelectedStudentId(availableStudents[foundIdx].id);
        setIsManualInput(false);
        const noUrut = String(foundIdx + 1).padStart(2, "0");
        setLoginStudentName(availableStudents[foundIdx].studentName);
        setLoginNisn(noUrut);
        setLoginClass(availableStudents[foundIdx].className || exam.teacherProfile.gradeLevel || "Kelas X");
      } else {
        setLoginStudentName(matched.studentName);
        setLoginNisn(matched.seatNumber || matched.nisn || "01");
        setLoginClass(matched.className || exam.teacherProfile.gradeLevel || "Kelas X");
      }
    }
  };

  // Auto-fill student if initial token matches student token (NOT session token)
  useEffect(() => {
    if (initialToken && initialToken !== exam.sessionToken && initialToken !== exam.code) {
      handleTokenChange(initialToken.trim().toUpperCase());
    }
  }, [initialToken, exam.sessionToken, exam.code, availableStudents]);

  // Active Session State
  const [session, setSession] = useState<StudentExamSession | null>(currentSession);
  const sessionRef = useRef<StudentExamSession | null>(session);
  sessionRef.current = session;

  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(currentSession?.currentSlideIndex || 0);
  const [fontSize, setFontSize] = useState<"normal" | "large" | "xlarge">("normal");
  const [showSummaryModal, setShowSummaryModal] = useState<boolean>(false);
  const [showMatrixDrawer, setShowMatrixDrawer] = useState<boolean>(false);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(currentSession?.status === "submitted");

  // Keep internal session state strictly synchronized with parent currentSession prop
  useEffect(() => {
    if (!currentSession) {
      if (!isTeacherTrial) {
        setSession(null);
        setIsLoggedIn(false);
        setCurrentSlideIndex(0);
        setIsSubmitted(false);
      }
    } else {
      setSession(currentSession);
      setIsLoggedIn(true);
      setCurrentSlideIndex(currentSession.currentSlideIndex || 0);
      setIsSubmitted(currentSession.status === "submitted");
    }
  }, [currentSession?.id, currentSession?.status, currentSession?.currentSlideIndex, isTeacherTrial]);

  // Lightbox Image Zoom Modal
  const [zoomImageSrc, setZoomImageSrc] = useState<string | null>(null);

  // Sound Warning & Alert Banner State
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => isSoundNotificationEnabled());
  const [dismissedWarningBanner, setDismissedWarningBanner] = useState<boolean>(false);
  const hasAlerted5Min = useRef<boolean>(false);
  const hasAlerted1Min = useRef<boolean>(false);

  // Anti-Cheating & Fullscreen State
  const [isFullscreenActive, setIsFullscreenActive] = useState<boolean>(
    typeof document !== "undefined" ? !!document.fullscreenElement : false
  );
  const [violationAlertModal, setViolationAlertModal] = useState<{
    show: boolean;
    type: string;
    message: string;
    count: number;
  }>({
    show: false,
    type: "",
    message: "",
    count: 0,
  });

  // Session Reset Alert State (when proctor resets session)
  const [resetAlertMessage, setResetAlertMessage] = useState<string | null>(null);

  const handleSessionResetByTeacher = (reason?: string) => {
    saveActiveStudentSession(null);
    setSession(null);
    setIsLoggedIn(false);
    setIsSubmitted(false);
    setCurrentSlideIndex(0);
    setResetAlertMessage(
      reason || "Sesi ujian ini telah di-reset oleh Guru / Pengawas. Silakan masuk kembali."
    );
  };

  // Listen to live session reset events across tabs/devices
  useEffect(() => {
    const unsub = subscribeToSessionResets((payload) => {
      if (!payload || !sessionRef.current) return;
      const cur = sessionRef.current;
      const matchId = payload.sessionId && cur.id === payload.sessionId;
      const matchName =
        payload.studentName &&
        cur.studentName.trim().toLowerCase() === payload.studentName.trim().toLowerCase();
      const matchNisn = payload.nisn && cur.nisn && cur.nisn.trim() === payload.nisn.trim();

      if (matchId || matchName || matchNisn) {
        handleSessionResetByTeacher("Sesi ujian Anda telah di-reset oleh Guru / Pengawas.");
      }
    });
    return () => unsub();
  }, []);

  // Timer Calculation
  const totalDurationSeconds = exam.durationMinutes * 60;
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    if (currentSession && currentSession.startTime) {
      const elapsed = Math.floor(
        (Date.now() - new Date(currentSession.startTime).getTime()) / 1000
      );
      return Math.max(0, totalDurationSeconds - elapsed);
    }
    return totalDurationSeconds;
  });
  const secondsRemainingRef = useRef<number>(secondsRemaining);
  secondsRemainingRef.current = secondsRemaining;

  // Track violation count in ref to prevent stale closures
  const violationCountRef = useRef<number>(currentSession?.violationCount || 0);

  // Active questions (using shuffled questions if exists in session, else exam questions)
  const activeQuestions: Question[] = session?.shuffledQuestions || exam.questions;

  // Per-Question Timer Tracking State & Ref (seconds spent per question)
  const [timeSpentPerQuestion, setTimeSpentPerQuestion] = useState<Record<string, number>>(() => {
    const initialMap: Record<string, number> = {};
    if (currentSession?.answers) {
      Object.entries(currentSession.answers).forEach(([qId, ans]: [string, any]) => {
        if (ans && typeof ans.timeSpentSeconds === "number") {
          initialMap[qId] = ans.timeSpentSeconds;
        }
      });
    }
    return initialMap;
  });
  const timeSpentPerQuestionRef = useRef<Record<string, number>>(timeSpentPerQuestion);
  timeSpentPerQuestionRef.current = timeSpentPerQuestion;

  // Slides configuration:
  // Slide 0: Profil Sekolah & Header Instansi
  // Slide 1: Profil Guru & Mata Pelajaran
  // Slide 2: Tata Tertib & Petunjuk Ujian
  // Slide 3 .. (3 + activeQuestions.length - 1): Question Slides
  // Slide (3 + activeQuestions.length): Lembar Ringkasan & Konfirmasi Selesai
  const totalIntroSlides = 3;
  const totalSlides = totalIntroSlides + activeQuestions.length + 1;

  const isIntroSlide = currentSlideIndex < totalIntroSlides;
  const isFinalSlide = currentSlideIndex === totalSlides - 1;
  const currentQuestionIndex = isIntroSlide || isFinalSlide ? -1 : currentSlideIndex - totalIntroSlides;
  const currentQuestion = currentQuestionIndex >= 0 ? activeQuestions[currentQuestionIndex] : null;

  // Sync initial token from props if provided
  useEffect(() => {
    if (initialToken) {
      setLoginToken(initialToken);
    }
  }, [initialToken]);

  // Auto-init trial session for Teacher Sandbox mode
  useEffect(() => {
    if (isTeacherTrial && !session) {
      const trialSession: StudentExamSession = {
        id: `trial-${Date.now()}`,
        examId: exam.id,
        examCode: exam.code,
        examTitle: exam.title,
        subject: exam.teacherProfile.subject,
        studentName: "Guru Penguji (Simulasi Uji Coba)",
        nisn: "0000000000",
        className: "Simulasi Guru",
        token: "UJI-COBA",
        currentSlideIndex: 0,
        answers: {},
        startTime: new Date().toISOString(),
        timeSpentSeconds: 0,
        totalScoreEarned: 0,
        maxScore: exam.totalScore,
        percentage: 0,
        passed: false,
        status: "in_progress",
        shuffledQuestions: exam.questions,
        cheatViolations: [],
        violationCount: 0,
      };
      setSession(trialSession);
      setIsLoggedIn(true);
      setCurrentSlideIndex(0);
      setSecondsRemaining(totalDurationSeconds);
    }
  }, [isTeacherTrial, exam]);

  // Fullscreen toggle helper
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreenActive(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
        setIsFullscreenActive(false);
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreenActive(isFs);
      if (!isFs && isLoggedIn && !isSubmitted) {
        recordCheatViolation(
          "fullscreen_exit",
          "Siswa keluar dari mode layar penuh (Fullscreen) saat ujian berlangsung."
        );
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [isLoggedIn, isSubmitted]);

  // Timer Tick Interval (Main Exam Countdown & Active Question Duration)
  useEffect(() => {
    if (!isLoggedIn || isSubmitted) return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });

      // Increment per-question timer if currently on a question slide
      if (currentQuestionIndex >= 0 && activeQuestions[currentQuestionIndex]) {
        const activeQId = activeQuestions[currentQuestionIndex].id;
        setTimeSpentPerQuestion((prev) => {
          const currentCount = prev[activeQId] || 0;
          return {
            ...prev,
            [activeQId]: currentCount + 1,
          };
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isLoggedIn, isSubmitted, currentQuestionIndex, activeQuestions]);

  // Ref and helper for throttled real-time sync to server and cloud
  const syncDebounceTimerRef = useRef<any>(null);
  const queueSessionLiveSync = (targetSession: StudentExamSession, immediate = false) => {
    if (isTeacherTrial || !targetSession || !targetSession.id) return;

    const sessionWithTimestamps: StudentExamSession = {
      ...targetSession,
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };

    // 1. Broadcast locally (cross-tab 0ms)
    broadcastLiveSession(sessionWithTimestamps);

    // 2. Always immediately push to Express Server /api/sessions (free, persistent to disk, zero quota impact)
    try {
      fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionWithTimestamps),
      }).catch(() => {});
    } catch {}

    // 3. Debounce cloud sync (Firestore & GAS)
    if (syncDebounceTimerRef.current) {
      clearTimeout(syncDebounceTimerRef.current);
      syncDebounceTimerRef.current = null;
    }

    if (immediate) {
      syncStudentSessionToFirestore(sessionWithTimestamps).catch(() => {});
      syncStudentSessionToGAS(sessionWithTimestamps).catch(() => {});
      return;
    }

    // Debounce rapid typing/clicking by 1.5 seconds for cloud
    syncDebounceTimerRef.current = setTimeout(() => {
      syncStudentSessionToFirestore(sessionWithTimestamps).catch(() => {});
      syncStudentSessionToGAS(sessionWithTimestamps).catch(() => {});
    }, 1500);
  };

  // Heartbeat to proctor dashboard every 3.5 seconds (updates online status, elapsed time, current slide)
  useEffect(() => {
    if (!isLoggedIn || isSubmitted || !session || isTeacherTrial) return;

    const interval = setInterval(() => {
      const activeSess = sessionRef.current || session;
      if (!activeSess || activeSess.status !== "in_progress") return;

      const elapsed = Math.max(0, exam.durationMinutes * 60 - secondsRemaining);
      const nowIso = new Date().toISOString();
      const updatedHeartbeat: StudentExamSession = {
        ...activeSess,
        currentSlideIndex,
        timeSpentSeconds: elapsed,
        updatedAt: nowIso,
        lastActiveAt: nowIso,
      };

      // Heartbeat updates live server session registry directly (0 quota cost, fast)
      try {
        fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedHeartbeat),
        })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              if (data.isReset) {
                handleSessionResetByTeacher(
                  data.message || "Sesi ujian ini telah di-reset oleh Guru / Pengawas."
                );
              }
            }
          })
          .catch(() => {});
      } catch {}

      // Cross-tab broadcast for instant local monitoring
      broadcastLiveSession(updatedHeartbeat);
    }, 3500);

    return () => clearInterval(interval);
  }, [isLoggedIn, isSubmitted, session?.id, currentSlideIndex, secondsRemaining, isTeacherTrial, exam.durationMinutes]);

  // Handle Timeout Auto-submit
  useEffect(() => {
    if (!isLoggedIn || isSubmitted) return;

    if (secondsRemaining <= 0) {
      handleFinalSubmit("timed_out");
    }
  }, [secondsRemaining, isLoggedIn, isSubmitted]);

  // Audio Alerts at 5 min and 1 min thresholds
  useEffect(() => {
    if (!isLoggedIn || isSubmitted) return;

    // 5-Minute Audio Alert (at exactly 300 seconds)
    if (secondsRemaining === 300 && !hasAlerted5Min.current) {
      hasAlerted5Min.current = true;
      setDismissedWarningBanner(false);
      if (isSoundNotificationEnabled()) {
        playExamTimeWarningSound("5min");
      }
    }

    // 1-Minute Critical Audio Alert (at exactly 60 seconds)
    if (secondsRemaining === 60 && !hasAlerted1Min.current) {
      hasAlerted1Min.current = true;
      setDismissedWarningBanner(false);
      if (isSoundNotificationEnabled()) {
        playExamTimeWarningSound("1min");
      }
    }
  }, [secondsRemaining, isLoggedIn, isSubmitted]);

  // Record Cheating Violation
  const recordCheatViolation = (
    type: "tab_switch" | "window_blur" | "fullscreen_exit",
    message: string
  ) => {
    if (!session || isSubmitted) return;

    const newViolation: CheatingViolationLog = {
      timestamp: new Date().toISOString(),
      violationType: type,
      message: message,
    };

    const newCount = (session.violationCount || 0) + 1;
    violationCountRef.current = newCount;

    const updatedSession: StudentExamSession = {
      ...session,
      violationCount: newCount,
      cheatViolations: [...(session.cheatViolations || []), newViolation],
    };

    setSession(updatedSession);
    onSaveSession(updatedSession);
    queueSessionLiveSync(updatedSession, true);

    // Show warning alert modal
    setViolationAlertModal({
      show: true,
      type,
      message,
      count: newCount,
    });
  };

  // Visibility & Blur Anti-Cheating Listeners
  useEffect(() => {
    if (!isLoggedIn || isSubmitted) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        recordCheatViolation(
          "tab_switch",
          "Siswa berpindah tab browser atau meminimalkan jendela ujian."
        );
      }
    };

    const handleWindowBlur = () => {
      recordCheatViolation(
        "window_blur",
        "Jendela ujian kehilangan fokus (membuka aplikasi lain atau split screen)."
      );
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [isLoggedIn, isSubmitted, session]);

  // Keyboard Shortcuts (A, B, C, D, E for Multiple Choice, Arrow Keys for Nav, R for Flag)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isLoggedIn || isSubmitted) return;

      // Disable keyboard shortcuts if typing inside an input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      const key = e.key.toUpperCase();

      // Navigation: Arrow Left / Arrow Right
      if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNextSlide();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrevSlide();
      }

      // Flag Shortcut: 'R'
      if (key === "R" && currentQuestion) {
        e.preventDefault();
        handleToggleFlag(currentQuestion.id);
      }

      // Multiple Choice Select: 'A', 'B', 'C', 'D', 'E'
      if (
        currentQuestion &&
        (currentQuestion.type === "pilihan_ganda" || !currentQuestion.type) &&
        ["A", "B", "C", "D", "E"].includes(key)
      ) {
        const optionExists = currentQuestion.options.some(
          (opt) => opt.key.toUpperCase() === key
        );
        if (optionExists) {
          e.preventDefault();
          handleSelectOption(currentQuestion.id, key);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLoggedIn, isSubmitted, currentSlideIndex, currentQuestion, session]);

  // Check if student arrived via a specific exam code that does not match this loaded exam
  const isExamCodeMismatch = Boolean(
    requestedExamCode &&
    requestedExamCode.trim().toUpperCase() !== exam.code.trim().toUpperCase() &&
    requestedExamCode.trim() !== exam.id
  );

  // Helper to start fresh session
  const startFreshSession = (activeTargetExam: ExamPackage) => {
    const preparedQuestions = prepareStudentExamQuestions(activeTargetExam);

    const newSession: StudentExamSession = {
      id: `sess-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      examId: activeTargetExam.id,
      examCode: activeTargetExam.code,
      examTitle: activeTargetExam.title,
      subject: activeTargetExam.teacherProfile.subject,
      studentName: loginStudentName.trim() || "Siswa Mandiri",
      nisn: loginNisn.trim() || "0078" + Math.floor(100000 + Math.random() * 900000),
      className: loginClass,
      token: loginToken.trim().toUpperCase(),
      currentSlideIndex: 0,
      answers: {},
      startTime: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      timeSpentSeconds: 0,
      totalScoreEarned: 0,
      maxScore: activeTargetExam.totalScore,
      percentage: 0,
      passed: false,
      status: "in_progress",
      shuffledQuestions: preparedQuestions,
      cheatViolations: [],
      violationCount: 0,
    };

    setSession(newSession);
    setIsLoggedIn(true);
    setIsSubmitted(false);
    setCurrentSlideIndex(0);
    setSecondsRemaining(activeTargetExam.durationMinutes * 60);
    onSaveSession(newSession);
    broadcastLiveSession(newSession);
    queueSessionLiveSync(newSession, true);
  };

  // 3 Choices: Mulai Ulang, Lanjutkan Sesi, Kumpulkan
  const handleOptionMulaiUlang = (targetExam: ExamPackage, oldSession: StudentExamSession) => {
    const preparedQuestions = prepareStudentExamQuestions(targetExam);
    const freshSession: StudentExamSession = {
      ...oldSession,
      id: `sess-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      examId: targetExam.id,
      examCode: targetExam.code,
      currentSlideIndex: 0,
      answers: {},
      startTime: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      timeSpentSeconds: 0,
      totalScoreEarned: 0,
      maxScore: targetExam.totalScore,
      percentage: 0,
      passed: false,
      status: "in_progress",
      shuffledQuestions: preparedQuestions,
      cheatViolations: [],
      violationCount: 0,
    };

    setSession(freshSession);
    setIsLoggedIn(true);
    setIsSubmitted(false);
    setCurrentSlideIndex(0);
    setSecondsRemaining(targetExam.durationMinutes * 60);
    onSaveSession(freshSession);
    broadcastLiveSession(freshSession);
    queueSessionLiveSync(freshSession, true);
    setSessionActionPrompt(null);
  };

  const handleOptionLanjutkan = (targetExam: ExamPackage, existingSession: StudentExamSession) => {
    const elapsed = existingSession.timeSpentSeconds || Math.floor((Date.now() - new Date(existingSession.startTime).getTime()) / 1000);
    const rem = Math.max(0, targetExam.durationMinutes * 60 - elapsed);
    setSecondsRemaining(rem > 0 ? rem : targetExam.durationMinutes * 60);

    const continuedSession: StudentExamSession = {
      ...existingSession,
      status: "in_progress",
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };

    setSession(continuedSession);
    setIsLoggedIn(true);
    setIsSubmitted(false);
    setCurrentSlideIndex(existingSession.currentSlideIndex || 0);
    onSaveSession(continuedSession);
    broadcastLiveSession(continuedSession);
    queueSessionLiveSync(continuedSession, true);
    setSessionActionPrompt(null);
  };

  const handleOptionKumpulkan = (targetExam: ExamPackage, existingSession: StudentExamSession) => {
    setSessionActionPrompt(null);
    setSession(existingSession);
    setIsLoggedIn(true);
    handleFinalSubmit("submitted", existingSession);
  };

  // Login Validator
  const executeStartExam = (forceAdmin = false) => {
    let activeTargetExam = exam;

    if (!forceAdmin) {
      if (isExamCodeMismatch) {
        setLoginError(
          `Kode soal pada link Anda ("${requestedExamCode}") tidak cocok dengan naskah aktif ("${exam.code}"). Pengerjaan dikunci agar data nilai tidak tercampur.`
        );
        return;
      }

      if (!loginStudentName.trim()) {
        setLoginError("Silakan masukkan nama lengkap Anda.");
        return;
      }

      const validation = validateStudentLoginToken(loginToken, exam, tokens, loginStudentName, allExams);
      if (!validation.isValid) {
        setLoginError(
          validation.errorMessage ||
            "Token Login Siswa tidak sesuai. Masukkan Token Login Siswa unik Anda dari Kartu Peserta Ujian."
        );
        return;
      }

      if (validation.matchedExam && validation.matchedExam.id !== exam.id) {
        activeTargetExam = validation.matchedExam;
        onSwitchExam?.(validation.matchedExam);
      }
    }

    setLoginError(null);

    // Check if an existing session already exists for this student with prior progress
    const activeLocal = getActiveStudentSession();
    const historyList = getExamHistory();
    const allCandidates = [activeLocal, ...historyList].filter(Boolean) as StudentExamSession[];

    const cleanName = loginStudentName.trim().toLowerCase();
    const cleanToken = loginToken.trim().toUpperCase();
    const cleanNisn = loginNisn.trim();
    const cleanCode = activeTargetExam.code.trim().toUpperCase();
    const cleanId = activeTargetExam.id.trim();

    const existingMatch = allCandidates.find((s) => {
      const matchExam = s.examId === cleanId || (s.examCode && s.examCode.trim().toUpperCase() === cleanCode);
      if (!matchExam) return false;
      const matchToken = s.token && s.token.trim().toUpperCase() === cleanToken;
      const matchName = s.studentName && s.studentName.trim().toLowerCase() === cleanName;
      const matchNisn = cleanNisn && s.nisn && s.nisn.trim() === cleanNisn;
      return matchToken || (matchName && matchNisn) || (matchName && cleanName.length > 3);
    });

    if (existingMatch && (Object.keys(existingMatch.answers || {}).length > 0 || (existingMatch.currentSlideIndex || 0) > 0 || existingMatch.status === "submitted")) {
      setSessionActionPrompt({
        show: true,
        existingSession: existingMatch,
        targetExam: activeTargetExam,
      });
      return;
    }

    // No existing session, start fresh directly
    startFreshSession(activeTargetExam);
  };

  const handleStartExamLogin = (e: React.FormEvent) => {
    e.preventDefault();
    executeStartExam(false);
  };

  // Generic answer selector for Pilihan Ganda
  const handleSelectOption = (questionId: string, optionKey: string) => {
    if (!session || isSubmitted) return;

    const q = activeQuestions.find((item) => item.id === questionId);
    const isCorrect = q ? q.correctAnswer.toUpperCase() === optionKey.toUpperCase() : false;
    const scoreEarned = isCorrect ? (q?.score || 0) : 0;

    const currentAnswer = session.answers[questionId] || {
      questionId,
      selectedOption: "",
      isFlagged: false,
    };

    const updatedAnswer: StudentAnswerItem = {
      ...currentAnswer,
      selectedOption: optionKey,
      isCorrect,
      scoreEarned,
      answeredAt: new Date().toISOString(),
      timeSpentSeconds: timeSpentPerQuestionRef.current[questionId] || 0,
    } as any;

    const updatedAnswers = {
      ...session.answers,
      [questionId]: updatedAnswer,
    };

    const updatedSession: StudentExamSession = {
      ...session,
      answers: updatedAnswers,
    };

    setSession(updatedSession);
    onSaveSession(updatedSession);
    queueSessionLiveSync(updatedSession, false);
  };

  // Text Answer Handler (for isian_singkat and uraian)
  const handleTextAnswerChange = (questionId: string, text: string) => {
    if (!session || isSubmitted) return;

    const q = activeQuestions.find((item) => item.id === questionId);
    let isCorrect = false;
    let scoreEarned = 0;

    if (q?.type === "isian_singkat") {
      // Check normalized keywords
      const acceptable = (q.correctAnswer || "")
        .split(/[,|/]/)
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      const studentInput = text.trim().toLowerCase();
      isCorrect = acceptable.includes(studentInput);
      scoreEarned = isCorrect ? q.score : 0;
    } else if (q?.type === "uraian") {
      // For essay, if non-empty, provide baseline score or mark answered
      isCorrect = text.trim().length > 10;
      scoreEarned = isCorrect ? q.score : 0;
    }

    const currentAnswer = session.answers[questionId] || {
      questionId,
      selectedOption: "",
      isFlagged: false,
    };

    const updatedAnswer: StudentAnswerItem = {
      ...currentAnswer,
      selectedOption: text,
      isCorrect,
      scoreEarned,
      answeredAt: new Date().toISOString(),
      timeSpentSeconds: timeSpentPerQuestionRef.current[questionId] || 0,
    } as any;

    const updatedAnswers = {
      ...session.answers,
      [questionId]: updatedAnswer,
    };

    const updatedSession: StudentExamSession = {
      ...session,
      answers: updatedAnswers,
    };

    setSession(updatedSession);
    onSaveSession(updatedSession);
    queueSessionLiveSync(updatedSession, false);
  };

  // Matching Pair Answer Handler (for menjodohkan)
  const handleMatchingAnswerChange = (questionId: string, pairId: string, rightTarget: string) => {
    if (!session || isSubmitted) return;

    const q = activeQuestions.find((item) => item.id === questionId);
    const currentAnswer = session.answers[questionId] || {
      questionId,
      selectedOption: "{}",
      isFlagged: false,
    };

    let currentMap: Record<string, string> = {};
    try {
      currentMap = JSON.parse(currentAnswer.selectedOption || "{}");
    } catch {
      currentMap = {};
    }

    currentMap[pairId] = rightTarget;
    const jsonString = JSON.stringify(currentMap);

    // Score calculation: check each pair
    let matchedCorrectCount = 0;
    const pairs = q?.matchingPairs || [];
    pairs.forEach((p) => {
      if (currentMap[p.id] === p.right) {
        matchedCorrectCount++;
      }
    });

    const isFullyCorrect = pairs.length > 0 && matchedCorrectCount === pairs.length;
    const partialScore = pairs.length > 0 ? (matchedCorrectCount / pairs.length) * (q?.score || 0) : 0;

    const updatedAnswer: StudentAnswerItem = {
      ...currentAnswer,
      selectedOption: jsonString,
      isCorrect: isFullyCorrect,
      scoreEarned: Math.round(partialScore * 10) / 10,
      answeredAt: new Date().toISOString(),
      timeSpentSeconds: timeSpentPerQuestionRef.current[questionId] || 0,
    } as any;

    const updatedAnswers = {
      ...session.answers,
      [questionId]: updatedAnswer,
    };

    const updatedSession: StudentExamSession = {
      ...session,
      answers: updatedAnswers,
    };

    setSession(updatedSession);
    onSaveSession(updatedSession);
    queueSessionLiveSync(updatedSession, false);
  };

  const handleToggleFlag = (questionId: string) => {
    if (!session || isSubmitted) return;

    const currentAnswer = session.answers[questionId] || {
      questionId,
      selectedOption: "",
      isFlagged: false,
    };

    const updatedAnswer: StudentAnswerItem = {
      ...currentAnswer,
      isFlagged: !currentAnswer.isFlagged,
    };

    const updatedAnswers = {
      ...session.answers,
      [questionId]: updatedAnswer,
    };

    const updatedSession: StudentExamSession = {
      ...session,
      answers: updatedAnswers,
    };

    setSession(updatedSession);
    onSaveSession(updatedSession);
  };

  const handleNextSlide = () => {
    if (currentSlideIndex < totalSlides - 1) {
      const nextIdx = currentSlideIndex + 1;
      setCurrentSlideIndex(nextIdx);
      if (session) {
        onSaveSession({ ...session, currentSlideIndex: nextIdx });
      }
    }
  };

  const handlePrevSlide = () => {
    if (currentSlideIndex > 0) {
      const prevIdx = currentSlideIndex - 1;
      setCurrentSlideIndex(prevIdx);
      if (session) {
        onSaveSession({ ...session, currentSlideIndex: prevIdx });
      }
    }
  };

  const handleJumpToSlide = (slideIdx: number) => {
    setCurrentSlideIndex(slideIdx);
    setShowMatrixDrawer(false);
    if (session) {
      onSaveSession({ ...session, currentSlideIndex: slideIdx });
    }
  };

  const handleFinalSubmit = (status: "submitted" | "timed_out" = "submitted", sessionToSubmit?: StudentExamSession) => {
    const currentActiveSession = sessionToSubmit || sessionRef.current || session;
    if (!currentActiveSession) return;

    let totalScoreEarned = 0;
    activeQuestions.forEach((q) => {
      const ans = currentActiveSession.answers[q.id];
      if (!ans) return;

      if (q.type === "menjodohkan") {
        let currentMap: Record<string, string> = {};
        try {
          currentMap = JSON.parse(ans.selectedOption || "{}");
        } catch {
          currentMap = {};
        }
        const pairs = q.matchingPairs || [];
        let matched = 0;
        pairs.forEach((p) => {
          if (currentMap[p.id] === p.right) matched++;
        });
        if (pairs.length > 0) {
          totalScoreEarned += (matched / pairs.length) * q.score;
        }
      } else if (q.type === "isian_singkat") {
        const acceptable = (q.correctAnswer || "")
          .split(/[,|/]/)
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
        const studentInput = (ans.selectedOption || "").trim().toLowerCase();
        if (acceptable.includes(studentInput)) {
          totalScoreEarned += q.score;
        }
      } else if (q.type === "uraian") {
        if ((ans.selectedOption || "").trim().length > 10) {
          totalScoreEarned += q.score;
        }
      } else {
        // Pilihan ganda
        if (ans.selectedOption.toUpperCase() === q.correctAnswer.toUpperCase()) {
          totalScoreEarned += q.score;
        }
      }
    });

    totalScoreEarned = Math.round(totalScoreEarned * 10) / 10;
    const maxScore = exam.totalScore > 0 ? exam.totalScore : 100;
    const percentage = Math.round((totalScoreEarned / maxScore) * 100);
    const passed = percentage >= (exam.teacherProfile.passingGrade || 75);
    const timeSpentSeconds = Math.max(0, totalDurationSeconds - secondsRemainingRef.current);

    // Merge latest per-question time spent into all answers
    const mergedAnswers = { ...currentActiveSession.answers };
    activeQuestions.forEach((q) => {
      const existing = mergedAnswers[q.id];
      const qTime = timeSpentPerQuestionRef.current[q.id] || 0;
      if (existing) {
        mergedAnswers[q.id] = {
          ...existing,
          timeSpentSeconds: qTime,
        };
      } else if (qTime > 0) {
        mergedAnswers[q.id] = {
          questionId: q.id,
          selectedOption: "",
          isFlagged: false,
          isCorrect: false,
          scoreEarned: 0,
          timeSpentSeconds: qTime,
          answeredAt: new Date().toISOString(),
        } as any;
      }
    });

    const finalizedSession: StudentExamSession = {
      ...currentActiveSession,
      answers: mergedAnswers,
      status,
      submitTime: new Date().toISOString(),
      timeSpentSeconds,
      totalScoreEarned,
      maxScore,
      percentage,
      passed,
    };

    setSession(finalizedSession);
    setIsSubmitted(true);
    setShowSummaryModal(false);
    // Push immediately to Express server
    try {
      fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalizedSession),
      }).catch(() => {});
    } catch {}
    if (!isTeacherTrial) {
      onSubmitExam(finalizedSession);
      broadcastLiveSession(finalizedSession);
      syncStudentSessionToFirestore(finalizedSession, true).catch(() => {});
      syncStudentSessionToGAS(finalizedSession).catch(() => {});
    }
  };

  // Handler to restart/retry trial for Teacher without limit
  const handleRetryTeacherTrial = () => {
    const freshTrialSession: StudentExamSession = {
      id: `trial-${Date.now()}`,
      examId: exam.id,
      examCode: exam.code,
      examTitle: exam.title,
      subject: exam.teacherProfile.subject,
      studentName: "Guru Penguji (Simulasi Uji Coba)",
      nisn: "0000000000",
      className: "Simulasi Guru",
      token: "UJI-COBA",
      currentSlideIndex: 0,
      answers: {},
      startTime: new Date().toISOString(),
      timeSpentSeconds: 0,
      totalScoreEarned: 0,
      maxScore: exam.totalScore,
      percentage: 0,
      passed: false,
      status: "in_progress",
      shuffledQuestions: exam.questions,
      cheatViolations: [],
      violationCount: 0,
    };
    setSession(freshTrialSession);
    setIsLoggedIn(true);
    setIsSubmitted(false);
    setShowSummaryModal(false);
    setCurrentSlideIndex(0);
    setSecondsRemaining(totalDurationSeconds);
    hasAlerted5Min.current = false;
    hasAlerted1Min.current = false;
    violationCountRef.current = 0;
  };

  // Format Timer
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  };

  const isLowTime = secondsRemaining <= 300; // < 5 minutes

  // If exam completed and submitted, show Result View
  if (isSubmitted && session) {
    return (
      <StudentResultView
        session={session}
        exam={exam}
        onExit={onExit}
        isTeacherTrial={isTeacherTrial}
        isDirectLink={isDirectLink}
        onRetryTrial={handleRetryTeacherTrial}
      />
    );
  }

  // LOGIN GATE / TOKEN AUTH VIEW
  if (!isLoggedIn) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center p-4">
        <div className="bg-[#121214] rounded-3xl border border-slate-800 shadow-2xl max-w-lg w-full p-6 sm:p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-indigo-600/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center mx-auto text-indigo-400 mb-3 shadow-lg shadow-indigo-950">
              <GraduationCap className="w-8 h-8 text-indigo-400" />
            </div>
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20">
              SlideExam Computer-Based Test
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-white">{exam.title}</h1>
            <p className="text-xs text-slate-400">
              {exam.teacherProfile.subject} • {exam.schoolProfile.schoolName}
            </p>

            {exam.gdriveSyncedAt && (
              <div className="pt-1 flex items-center justify-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 rounded-full text-[11px] text-indigo-300 font-medium">
                  <Cloud className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Naskah Ujian Terhubung via Google Drive</span>
                </span>
              </div>
            )}

            {/* Warning if requested exam from short link is not found in this browser */}
            {requestedExamCode &&
              requestedExamCode.trim().toUpperCase() !== exam.code.trim().toUpperCase() &&
              requestedExamCode.trim() !== exam.id && (
                <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-2xl text-left space-y-1.5 text-xs text-amber-200 animate-in fade-in">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Perhatian: Kode "{requestedExamCode}" Belum Tersimpan</span>
                  </div>
                  <p className="text-[11px] text-amber-200/90 leading-relaxed">
                    Tautan yang dibuka adalah link ringkas. Perangkat ini sedang membuka paket: <strong>{exam.title} ({exam.code})</strong>.
                  </p>
                  <p className="text-[10px] text-amber-300/80 font-medium">
                    💡 <em>Untuk siswa: Minta guru membagikan <strong>Link Lengkap WhatsApp</strong> (yang berisi &pkg=...) agar naskah Bahasa Indonesia langsung terbuka otomatis di HP Anda.</em>
                  </p>
                </div>
              )}

            {/* Multi-Exam Switcher (allow switching exams so user can select any loaded exam) */}
            {allExams && allExams.length > 1 && (
              <div className="pt-2">
                <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                  Mata Pelajaran / Paket Ujian:
                </label>
                <select
                  value={exam.id}
                  onChange={(e) => {
                    const target = allExams.find((ex) => ex.id === e.target.value);
                    if (target) {
                      onSwitchExam?.(target);
                      setLoginToken(target.sessionToken);
                      setLoginError(null);
                    }
                  }}
                  className="w-full px-3 py-2 bg-[#1a1a1c] hover:bg-slate-800 border border-slate-700 rounded-xl text-xs text-indigo-300 font-semibold focus:border-indigo-500 focus:outline-none cursor-pointer max-w-full truncate"
                  title="Ganti paket soal / mata pelajaran ujian"
                >
                  {allExams.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      📖 {ex.title} ({ex.teacherProfile.subject} - {ex.code})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleStartExamLogin} className="space-y-4">
            {/* 1. NAMA SISWA DROPDOWN */}
            <div>
              <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                <label
                  htmlFor={!isManualInput ? "student-name-dropdown" : "student-name-manual-input"}
                  className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"
                >
                  <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Nama Lengkap Siswa</span>
                  <span className="text-rose-400">*</span>
                  {cloudRosterStudents && cloudRosterStudents.length > 0 && (
                    <span className="px-1.5 py-0.5 text-[9px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-md font-semibold">
                      Google Sheets ({cloudRosterStudents.length})
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleManualRefreshRoster}
                    disabled={isLoadingRoster}
                    title="Segarkan nama murid dari file spreadsheet Roster_Siswa di Google Drive"
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingRoster ? "animate-spin" : ""}`} />
                    <span>{isLoadingRoster ? "Memuat..." : "Segarkan"}</span>
                  </button>

                  {availableStudents.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        const nextMode = !isManualInput;
                        setIsManualInput(nextMode);
                        if (nextMode) {
                          setSelectedStudentId("__manual__");
                        } else {
                          setSelectedStudentId("");
                          setLoginStudentName("");
                          setLoginNisn("");
                        }
                      }}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium underline cursor-pointer"
                    >
                      {isManualInput ? `📋 Pilih dari Daftar (${availableStudents.length} Siswa)` : "✏️ Input Manual"}
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-400">
                      Input Manual Mandiri
                    </span>
                  )}
                </div>
              </div>

              {!isManualInput ? (
                <div className="relative">
                  <select
                    id="student-name-dropdown"
                    required
                    value={selectedStudentId}
                    onChange={(e) => handleSelectStudent(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 bg-[#1a1a1c] border border-slate-800 focus:border-indigo-500 rounded-xl text-slate-100 text-sm font-semibold focus:outline-none appearance-none cursor-pointer"
                  >
                    <option key="select-student-placeholder" value="">
                      -- Pilih Nama Siswa ({availableStudents.length} Siswa Terdaftar) --
                    </option>
                    {availableStudents.map((st, idx) => {
                      const noUrut = String(idx + 1).padStart(2, "0");
                      return (
                        <option key={st.id || `st-${idx}`} value={st.id || st.studentName}>
                          {noUrut}. {st.studentName} ({st.className || exam.teacherProfile.gradeLevel})
                        </option>
                      );
                    })}
                    <option value="__manual__">✏️ Tulis Nama Siswa Lainnya (Ketik Manual)...</option>
                  </select>
                  <UserCheck className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
                  <ChevronRight className="w-4 h-4 text-slate-500 rotate-90 absolute right-3.5 top-3.5 pointer-events-none" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="relative">
                    <input
                      id="student-name-manual-input"
                      type="text"
                      required
                      value={loginStudentName}
                      onChange={(e) => {
                        setLoginStudentName(e.target.value);
                        if (loginError) setLoginError(null);
                      }}
                      placeholder="Ketik Nama Lengkap Siswa..."
                      className="w-full pl-10 pr-4 py-3 bg-[#1a1a1c] border border-indigo-500/50 rounded-xl text-slate-100 text-sm font-semibold focus:border-indigo-500 focus:outline-none"
                    />
                    <UserCheck className="w-4 h-4 text-indigo-400 absolute left-3.5 top-3.5" />
                  </div>
                  {availableStudents.length === 0 && (
                    <p className="text-[10px] text-slate-400">
                      ℹ️ Belum ada token nama tersimpan untuk naskah ini. Silakan ketik nama secara manual.
                    </p>
                  )}
                </div>
              )}

              {rosterSyncMsg && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium animate-in fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{rosterSyncMsg}</span>
                </div>
              )}

              {/* Sample Data Alert with Guide Modal Trigger */}
              {isUsingSampleData && (
                <div className="mt-2.5 p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl text-xs space-y-1.5 animate-in fade-in">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-amber-300">
                      <Info className="w-3.5 h-3.5 shrink-0" />
                      <span>Mengapa Muncul Data Dummy / Contoh?</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowRosterGuideModal(true)}
                      className="text-[11px] font-bold text-amber-400 hover:text-amber-200 underline cursor-pointer shrink-0"
                    >
                      Cara Pasang Data Asli ↗
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Saat Mode Siswa dibuka pertama kali di perangkat baru, sistem memuat data sample bawaan jika belum mendeteksi data siswa asli dari Google Sheets (<em>Roster_Siswa</em>). Anda juga dapat klik <strong>Input Manual</strong> untuk mengetik nama mandiri.
                  </p>
                </div>
              )}

              {selectedStudentId && !isManualInput && selectedStudentId !== "__manual__" && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium animate-in fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Siswa terverifikasi di profil: <strong>{loginStudentName}</strong> (No. Urut: {loginNisn})</span>
                </div>
              )}
            </div>

            {/* 2 & 3. NOMOR PESERTA & KELAS */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                    <Hash className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Nomor Peserta</span>
                  </label>
                  <span className="text-[10px] text-indigo-400 font-semibold bg-indigo-500/10 px-1.5 py-0.5 rounded">
                    No. Urut
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    required
                    readOnly={!isManualInput}
                    value={loginNisn}
                    onChange={(e) => setLoginNisn(e.target.value)}
                    placeholder="01"
                    className={`w-full pl-9 pr-3 py-3 rounded-xl text-sm font-mono font-bold focus:outline-none ${
                      !isManualInput
                        ? "bg-[#161618] border border-slate-800 text-indigo-300 cursor-not-allowed"
                        : "bg-[#1a1a1c] border border-slate-800 text-slate-200 focus:border-indigo-500"
                    }`}
                  />
                  <Hash className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Otomatis nomor urut di data profil.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Rombel / Kelas</span>
                  </label>
                  <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                    Otomatis
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    required
                    readOnly={!isManualInput}
                    value={loginClass}
                    onChange={(e) => setLoginClass(e.target.value)}
                    placeholder="X MIPA 1"
                    className={`w-full pl-9 pr-3 py-3 rounded-xl text-sm font-semibold focus:outline-none ${
                      !isManualInput
                        ? "bg-[#161618] border border-slate-800 text-emerald-300 cursor-not-allowed"
                        : "bg-[#1a1a1c] border border-slate-800 text-slate-200 focus:border-indigo-500"
                    }`}
                  />
                  <Building2 className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Otomatis mengisi dari data profil.
                </p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Token Login Siswa</span>
                  <span className="text-rose-400">*</span>
                </label>
                <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full font-medium">
                  Bukan Token Sesi
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={loginToken}
                  onChange={(e) => handleTokenChange(e.target.value.toUpperCase())}
                  placeholder="Masukkan Token Login Siswa Anda..."
                  className="w-full pl-10 pr-4 py-3 bg-[#1a1a1c] border border-indigo-500/40 rounded-xl text-indigo-300 font-mono font-bold tracking-widest text-base focus:border-indigo-500 focus:outline-none uppercase"
                />
                <Key className="w-5 h-5 text-indigo-400 absolute left-3 top-3.5" />
              </div>

              {/* Real-time Token Verification Feedback */}
              {tokenValidation?.isValid ? (
                <div className="mt-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="font-semibold">
                    {tokenValidation.matchedStudent
                      ? `✓ Token Login Siswa Valid: ${tokenValidation.matchedStudent.studentName} (${tokenValidation.matchedStudent.className || loginClass})`
                      : "✓ Token Login Siswa Terverifikasi"}
                  </span>
                </div>
              ) : tokenValidation && !tokenValidation.isValid && loginToken.trim() ? (
                <div className="mt-2 p-2.5 bg-rose-950/40 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-start gap-2 animate-in fade-in">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span className="leading-snug">{tokenValidation.errorMessage}</span>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 mt-1">
                  Masukkan Token Login Siswa unik Anda dari Kartu Peserta Ujian. Token Sesi Naskah Guru tidak dapat digunakan untuk memulai ujian.
                </p>
              )}
            </div>

            {isExamCodeMismatch && (
              <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-2xl text-left space-y-1.5 text-xs text-rose-200 animate-in fade-in">
                <div className="flex items-center gap-1.5 font-bold text-rose-300">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Pengerjaan Dikunci: Kode Soal Berbeda</span>
                </div>
                <p className="text-[11px] text-rose-200/90 leading-relaxed">
                  Tautan Anda meminta kode <span className="font-mono font-bold bg-rose-900/60 px-1.5 py-0.5 rounded">{requestedExamCode}</span>, namun naskah yang termuat di perangkat ini adalah <span className="font-mono font-bold bg-slate-800 px-1.5 py-0.5 rounded">{exam.code}</span> ({exam.title}).
                </p>
                <p className="text-[10px] text-rose-300/80 font-medium">
                  💡 <em>Pilih mata pelajaran yang cocok pada dropdown di atas atau minta Guru mengirim link lengkap paket soal (&pkg=...).</em>
                </p>
              </div>
            )}

            {loginError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div className="font-semibold">{loginError}</div>
                  <div className="text-[11px] text-rose-300/80">
                    Pastikan nama dan Token Login Siswa yang dimasukkan sesuai dengan Kartu Peserta Ujian Anda.
                  </div>
                </div>
              </div>
            )}

            <button
              id="start-student-exam-btn"
              type="submit"
              disabled={isExamCodeMismatch}
              className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-950 hover:shadow-indigo-900 cursor-pointer flex items-center justify-center gap-2"
            >
              <span>{isExamCodeMismatch ? "Kode Soal Tidak Cocok (Terkunci)" : "Mulai Pengerjaan Ujian"}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* 3-CHOICE PROMPT MODAL FOR RETURNING STUDENTS */}
        {sessionActionPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
            <div className="bg-[#18181b] border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-6">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Clock className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-white">Sesi Pengerjaan Ditemukan</h3>
                <p className="text-xs text-slate-400">
                  Ditemukan riwayat pengerjaan sebelumnya untuk peserta ini. Silakan pilih tindakan yang ingin dilakukan:
                </p>
              </div>

              {/* Student Session Details */}
              <div className="p-4 rounded-2xl bg-[#121214] border border-slate-800 space-y-2 text-xs">
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">Nama Siswa:</span>
                  <strong className="text-white text-sm">{sessionActionPrompt.existingSession.studentName}</strong>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">Kelas / No. Urut:</span>
                  <span>{sessionActionPrompt.existingSession.className} • No. {sessionActionPrompt.existingSession.nisn}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">Naskah Soal:</span>
                  <span className="font-mono text-indigo-300 font-semibold">{sessionActionPrompt.targetExam.title} ({sessionActionPrompt.targetExam.code})</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">Progres Jawaban:</span>
                  <span className="font-semibold text-emerald-400">
                    {Object.values(sessionActionPrompt.existingSession.answers || {}).filter((a: any) => a?.selectedOption && a?.selectedOption !== "{}").length} dari {sessionActionPrompt.targetExam.questions.length} Soal Dijawab
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">Status Sesi:</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${sessionActionPrompt.existingSession.status === "submitted" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-amber-500/20 text-amber-300 border border-amber-500/30"}`}>
                    {sessionActionPrompt.existingSession.status === "submitted" ? "Sudah Dikumpulkan" : "Sedang Dikerjakan"}
                  </span>
                </div>
              </div>

              {/* 3 Action Buttons */}
              <div className="space-y-2.5">
                {/* 1. Lanjutkan Sesi Terakhir */}
                <button
                  type="button"
                  id="btn-lanjutkan-sesi"
                  onClick={() => handleOptionLanjutkan(sessionActionPrompt.targetExam, sessionActionPrompt.existingSession)}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-between shadow-lg shadow-indigo-950 transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <Play className="w-5 h-5 text-indigo-200 group-hover:scale-110 transition-transform" />
                    <div className="text-left">
                      <div className="font-bold">Lanjutkan Sesi Terakhir</div>
                      <div className="text-[11px] text-indigo-200 font-normal">Lanjutkan menjawab soal dari slide terakhir</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-indigo-300" />
                </button>

                {/* 2. Mulai Ulang (Reset dari Awal) */}
                <button
                  type="button"
                  id="btn-mulai-ulang-sesi"
                  onClick={() => handleOptionMulaiUlang(sessionActionPrompt.targetExam, sessionActionPrompt.existingSession)}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 flex items-center justify-between transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <RotateCcw className="w-5 h-5 text-amber-400 group-hover:rotate-180 transition-transform duration-300" />
                    <div className="text-left">
                      <div className="font-bold">Mulai Ulang (Reset dari Awal)</div>
                      <div className="text-[11px] text-amber-400/80 font-normal">Kosongkan semua jawaban dan mulai ujian dari nomor 1</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-amber-400" />
                </button>

                {/* 3. Kumpulkan Lembar Jawaban */}
                <button
                  type="button"
                  id="btn-kumpulkan-lembar-jawaban"
                  onClick={() => handleOptionKumpulkan(sessionActionPrompt.targetExam, sessionActionPrompt.existingSession)}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 flex items-center justify-between transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <Send className="w-5 h-5 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
                    <div className="text-left">
                      <div className="font-bold">Kumpulkan Lembar Jawaban</div>
                      <div className="text-[11px] text-emerald-400/80 font-normal">Selesaikan dan kirim jawaban saat ini untuk dinilai</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-emerald-400" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSessionActionPrompt(null)}
                className="w-full py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
              >
                Batal & Kembali ke Formulir Login
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // PRESENTATION SLIDE CBT EXAM CANVAS
  // =========================================================================
  const answeredCount = Object.values(session?.answers || {}).filter(
    (a: any) => a?.selectedOption !== "" && a?.selectedOption !== "{}"
  ).length;

  const progressPercent = Math.round(((currentSlideIndex + 1) / totalSlides) * 100);

  // For Menjodohkan answer mapping
  let currentMatchingMap: Record<string, string> = {};
  if (currentQuestion && currentQuestion.type === "menjodohkan") {
    try {
      currentMatchingMap = JSON.parse(session?.answers[currentQuestion.id]?.selectedOption || "{}");
    } catch {
      currentMatchingMap = {};
    }
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* TEACHER TRIAL SANDBOX BANNER */}
      {isTeacherTrial && (
        <div className="bg-amber-500/15 border border-amber-500/40 rounded-2xl p-4 text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
                <span>Mode Uji Coba / Simulasi Naskah Soal Guru</span>
                <span className="bg-amber-500/30 text-amber-100 text-[10px] px-2 py-0.5 rounded-full font-bold">
                  Percobaan Bebas & Tidak Terbatas
                </span>
              </div>
              <div className="text-[11px] text-amber-200/80">
                Uji coba mandiri tampilan slide, audio timer, dan kunci jawaban CBT. Anda dapat mengulang pengerjaan tanpa batas. Hasil simulasi ini <strong>TIDAK dimasukkan</strong> ke rekap penilaian/analisis butir siswa.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <button
              onClick={handleRetryTeacherTrial}
              className="px-3.5 py-2 bg-amber-700/80 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
              title="Reset dan mulai ulang simulasi dari slide pertama"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Ulangi dari Awal</span>
            </button>
            <button
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.close();
                }
                onExit?.();
              }}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
              title="Tutup tab simulasi ini"
            >
              Tutup Tab Simulasi
            </button>
          </div>
        </div>
      )}

      {/* TOP CONTROL BAR: TIMER, PROGRESS, ANTI-CHEAT STATUS */}
      <div className="bg-[#121214] rounded-2xl p-4 border border-slate-800 shadow-lg flex flex-wrap items-center justify-between gap-4">
        {/* Left: Exam Info & Slide Counter */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 font-bold text-xs flex items-center gap-1.5 border border-indigo-500/20">
            <Layers className="w-4 h-4" />
            <span>
              Slide {currentSlideIndex + 1} / {totalSlides}
            </span>
          </div>

          <div className="hidden sm:block">
            <div className="text-xs font-bold text-white truncate max-w-xs flex items-center gap-2">
              <span className="truncate">{exam.title}</span>
              <span className="font-mono text-[10px] bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded shrink-0">
                Sesi: {session?.token || exam.sessionToken}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              Siswa: <strong className="text-slate-300">{session?.studentName}</strong> ({session?.className}) • Kode: <strong className="font-mono text-slate-300">{exam.code}</strong>
            </div>
          </div>
        </div>

        {/* Center: Live Countdown Timer & Audio Warning */}
        <div className="flex items-center gap-3">
          <div
            id="student-exam-timer-pill"
            className={`flex items-center gap-2 px-4 py-2 rounded-2xl border font-mono font-bold text-sm transition-all shadow-md ${
              secondsRemaining <= 60
                ? "bg-rose-950/60 border-rose-500 text-rose-200 animate-pulse ring-2 ring-rose-500/40 shadow-rose-950"
                : isLowTime
                ? "bg-amber-950/50 border-amber-500/70 text-amber-300 shadow-amber-950"
                : "bg-[#1a1a1c] border-slate-700 text-emerald-400 shadow-black/40"
            }`}
          >
            <Clock
              className={`w-4 h-4 ${
                secondsRemaining <= 60
                  ? "text-rose-400 animate-spin"
                  : isLowTime
                  ? "text-amber-400 animate-pulse"
                  : "text-emerald-400"
              }`}
            />
            <span>{formatTime(secondsRemaining)}</span>
          </div>

          {/* Sound Toggle */}
          <button
            onClick={() => {
              const nextVal = !soundEnabled;
              setSoundEnabled(nextVal);
              setSoundNotificationEnabled(nextVal);
            }}
            className="p-2 bg-[#1a1a1c] hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-800 transition-colors cursor-pointer"
            title={soundEnabled ? "Peringatan suara aktif (Klik matikan)" : "Peringatan suara non-aktif"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-indigo-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </button>
        </div>

        {/* Right: Mulai Ulang, Kumpulkan, Matrix Drawer & Fullscreen Toggle */}
        <div className="flex items-center gap-2">
          <button
            id="open-reset-confirm-btn"
            onClick={() => setShowResetConfirmModal(true)}
            className="px-2.5 py-2 bg-[#1a1a1c] hover:bg-rose-950/40 hover:text-rose-300 text-slate-400 rounded-xl text-xs font-semibold border border-slate-800 flex items-center gap-1.5 transition-all cursor-pointer"
            title="Mulai Ulang Ujian dari awal (Nomor 1)"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
            <span className="hidden sm:inline">Mulai Ulang</span>
          </button>

          <button
            id="open-kumpulkan-btn"
            onClick={() => setShowSummaryModal(true)}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
            title="Kumpulkan Jawaban Ujian"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Kumpulkan</span>
          </button>

          <button
            id="open-slide-matrix-btn"
            onClick={() => setShowMatrixDrawer(true)}
            className="px-3 py-2 bg-[#1a1a1c] hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-semibold border border-slate-800 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <BookOpen className="w-4 h-4 text-indigo-400" />
            <span>Kisi Soal ({answeredCount}/{activeQuestions.length})</span>
          </button>

          <button
            onClick={handleToggleFullscreen}
            className="p-2 bg-[#1a1a1c] hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-800 transition-colors cursor-pointer"
            title={isFullscreenActive ? "Keluar Layar Penuh" : "Mode Layar Penuh (Fullscreen)"}
          >
            {isFullscreenActive ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 5-Minute or 1-Minute Warning Banner */}
      {isLowTime && !dismissedWarningBanner && (
        <div
          id="five-minute-warning-banner"
          className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
            secondsRemaining <= 60
              ? "bg-rose-950/50 border-rose-500/60 text-rose-200 shadow-xl shadow-rose-950/50 ring-1 ring-rose-500/40"
              : "bg-amber-950/40 border-amber-500/50 text-amber-200 shadow-lg shadow-amber-950/30"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                secondsRemaining <= 60
                  ? "bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse"
                  : "bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse"
              }`}
            >
              {secondsRemaining <= 60 ? (
                <BellRing className="w-5 h-5 text-rose-400 animate-bounce" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-white">
                  {secondsRemaining <= 60
                    ? "🚨 Peringatan Kritis: Waktu Ujian Hampir Habis!"
                    : "⚠️ Peringatan Sisa Waktu Ujian Kurang dari 5 Menit!"}
                </span>
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-black/40 border border-white/10 text-white">
                  Tersisa {formatTime(secondsRemaining)}
                </span>
              </div>
              <p className="text-[11px] opacity-90 truncate sm:whitespace-normal mt-0.5">
                {secondsRemaining <= 60
                  ? "Waktu pengerjaan tersisa kurang dari 1 menit! Sistem akan otomatis menyimpan dan mengumpulkan jawaban."
                  : `Waktu pengerjaan tersisa ${formatTime(secondsRemaining)}. Periksa lembar ringkasan dan pastikan seluruh ${activeQuestions.length} soal telah terjawab.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowMatrixDrawer(true)}
              className="hidden sm:inline-flex px-3 py-1.5 bg-black/40 hover:bg-black/60 border border-white/20 rounded-xl text-xs font-semibold text-white transition-all cursor-pointer"
            >
              Periksa Kisi Soal
            </button>
            <button
              onClick={() => setDismissedWarningBanner(true)}
              className="p-1.5 text-white/70 hover:text-white rounded-lg hover:bg-black/30 cursor-pointer"
              title="Tutup banner peringatan"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Slide Progress Line */}
      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            secondsRemaining <= 60
              ? "bg-rose-500 animate-pulse"
              : isLowTime
              ? "bg-amber-500"
              : "bg-indigo-500"
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* PRESENTATION SLIDE CARD (16:9 Cinema / Canvas Slide Aesthetic) */}
      <div
        className={`bg-[#121214] rounded-3xl border border-slate-800 shadow-2xl min-h-[520px] flex flex-col justify-between p-6 sm:p-10 relative overflow-hidden transition-all duration-200 text-slate-200 ${
          fontSize === "large" ? "text-base" : fontSize === "xlarge" ? "text-lg" : "text-sm"
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentSlideIndex}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -18 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="flex-1 flex flex-col justify-between"
          >
            {/* ========================================================================= */}
            {/* SLIDE 0: PROFIL SEKOLAH & IDENTITAS UJIAN */}
            {/* ========================================================================= */}
            {currentSlideIndex === 0 && (
              <div className="space-y-6 my-auto text-center">
                {/* Kop Surat Header Logos / Custom Kop Surat Image */}
                {exam.schoolProfile.kopSuratUrl ? (
                  <div className="flex justify-center pb-4 border-b border-slate-800 max-w-3xl mx-auto">
                    <img
                      src={exam.schoolProfile.kopSuratUrl}
                      alt="Kop Surat Resmi Sekolah"
                      className="max-h-24 sm:max-h-28 object-contain rounded-lg shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-6 pb-4 border-b border-slate-800 max-w-2xl mx-auto">
                    {exam.schoolProfile.logoLeftUrl && (
                      <img
                        src={exam.schoolProfile.logoLeftUrl}
                        alt="Logo Instansi"
                        className="w-16 h-16 object-contain"
                      />
                    )}
                    <div className="space-y-1">
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {exam.schoolProfile.agencyName}
                      </div>
                      <h1 className="text-2xl sm:text-3xl font-extrabold text-white uppercase tracking-tight">
                        {exam.schoolProfile.schoolName}
                      </h1>
                      <p className="text-xs text-slate-400 italic">{exam.schoolProfile.address}</p>
                    </div>
                    {exam.schoolProfile.logoRightUrl && (
                      <img
                        src={exam.schoolProfile.logoRightUrl}
                        alt="Logo Sekolah"
                        className="w-16 h-16 object-contain rounded-full shadow-sm"
                      />
                    )}
                  </div>
                )}

            <div className="space-y-2 py-4">
              <span className="px-4 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full font-bold text-xs uppercase tracking-wider inline-block">
                SLIDE 1 • PROFIL SEKOLAH & NASKAH UJIAN
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">{exam.title}</h2>
              <div className="flex items-center justify-center gap-2 pt-1">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 rounded-xl text-xs font-mono font-bold">
                  <Key className="w-3.5 h-3.5" />
                  TOKEN: {session?.token || exam.sessionToken}
                </span>
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-xs font-mono font-semibold">
                  KODE: {exam.code}
                </span>
              </div>
              <p className="text-slate-400 text-sm max-w-xl mx-auto">
                Tahun Ajaran {exam.teacherProfile.academicYear} • Semester {exam.teacherProfile.semester}
              </p>
            </div>

            {exam.schoolProfile.motto && (
              <div className="p-3 bg-[#161618] rounded-2xl border border-slate-800 max-w-lg mx-auto text-xs text-slate-400 italic">
                "{exam.schoolProfile.motto}"
              </div>
            )}

            <div className="pt-4">
              <button
                onClick={handleNextSlide}
                className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-sm shadow-lg shadow-indigo-950 hover:shadow-indigo-900 transition-all cursor-pointer inline-flex items-center gap-2"
              >
                <span>Buka Profil Mata Pelajaran & Guru</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SLIDE 1: PROFIL MATA PELAJARAN & GURU PENGAMPU */}
        {/* ========================================================================= */}
        {currentSlideIndex === 1 && (
          <div className="space-y-6 my-auto max-w-3xl mx-auto w-full animate-in fade-in duration-300">
            <div className="text-center space-y-2">
              <span className="px-4 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full font-bold text-xs uppercase tracking-wider inline-block">
                SLIDE 2 • IDENTITAS MATA PELAJARAN & PENGAMPU
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                {exam.teacherProfile.subject}
              </h2>
              <p className="text-xs text-slate-400 font-mono">Kode Mata Pelajaran: {exam.teacherProfile.subjectCode}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-[#161618] rounded-2xl p-5 border border-slate-800 space-y-3">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-indigo-400" />
                  <span>Guru Pengampu Ujian</span>
                </div>
                <div className="text-base font-extrabold text-white">{exam.teacherProfile.teacherName}</div>
                <div className="text-xs text-slate-400 font-mono">NIP: {exam.teacherProfile.teacherNIP || "-"}</div>
              </div>

              <div className="bg-[#161618] rounded-2xl p-5 border border-slate-800 space-y-3">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                  <GraduationCap className="w-4 h-4 text-emerald-400" />
                  <span>Kriteria Penilaian</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Batas Kelulusan (KKM):</span>
                  <span className="px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold rounded text-xs">
                    {exam.teacherProfile.passingGrade} Poin
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Alokasi Waktu:</span>
                  <span className="font-semibold text-slate-200 text-xs">{exam.durationMinutes} Menit</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Total Butir Soal:</span>
                  <span className="font-semibold text-slate-200 text-xs">{activeQuestions.length} Butir ({exam.totalScore} Poin)</span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-xs text-indigo-300 leading-relaxed text-center">
              "Kerjakanlah soal dengan jujur, teliti, dan penuh percaya diri. Kemampuan berpikir kritis Anda adalah kunci keberhasilan."
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={handlePrevSlide}
                className="px-5 py-2.5 bg-[#1a1a1c] hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Slide Sebelumnya</span>
              </button>

              <button
                onClick={handleNextSlide}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-xs shadow-lg shadow-indigo-950 transition-all cursor-pointer inline-flex items-center gap-2"
              >
                <span>Buka Petunjuk & Tata Tertib</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SLIDE 2: TATA TERTIB & PANDUAN MENJAWAB */}
        {/* ========================================================================= */}
        {currentSlideIndex === 2 && (
          <div className="space-y-6 my-auto max-w-3xl mx-auto w-full animate-in fade-in duration-300">
            <div className="text-center space-y-2">
              <span className="px-4 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-full font-bold text-xs uppercase tracking-wider inline-block">
                SLIDE 3 • PETUNJUK PENGERJAAN UJIAN
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">Tata Tertib & Panduan</h2>
              <p className="text-xs text-slate-400">Harap baca petunjuk berikut sebelum memulai slide pertanyaan.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-4 bg-[#161618] rounded-2xl border border-slate-800 space-y-2">
                <div className="font-bold text-indigo-400 flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-indigo-400" />
                  <span>Ragam Jenis Soal</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Soal terdiri dari Pilihan Ganda (opsi A-E), Mencocokkan Pasangan, Isian Pendek, atau Uraian.
                </p>
              </div>

              <div className="p-4 bg-[#161618] rounded-2xl border border-slate-800 space-y-2">
                <div className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Flag className="w-4 h-4 text-amber-400" />
                  <span>Tandai Ragu-Ragu</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Jika belum yakin dengan jawaban, aktifkan tombol <strong>Ragu-Ragu</strong> untuk ditinjau nanti.
                </p>
              </div>

              <div className="p-4 bg-[#161618] rounded-2xl border border-slate-800 space-y-2">
                <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-emerald-400" />
                  <span>Auto-Save Otomatis</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Jawaban tersimpan otomatis setiap kali Anda memilih atau mengetikkan jawaban.
                </p>
              </div>
            </div>

            <div className="flex justify-between items-center pt-4">
              <button
                onClick={handlePrevSlide}
                className="px-5 py-2.5 bg-[#1a1a1c] hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Kembali</span>
              </button>

              <button
                id="start-question-slides-btn"
                onClick={handleNextSlide}
                className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-sm shadow-lg shadow-indigo-950 transition-all cursor-pointer inline-flex items-center gap-2"
              >
                <span>Mulai Kerjakan Soal #1</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SLIDE 3 to N: INTERACTIVE QUESTION SLIDES */}
        {/* ========================================================================= */}
        {!isIntroSlide && !isFinalSlide && currentQuestion && (
          <div className="space-y-6 animate-in fade-in duration-200 flex-1 flex flex-col justify-between">
            <div className="space-y-4">
              {/* Question Slide Meta Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-3 py-1 bg-indigo-600 text-white rounded-xl font-bold text-xs">
                    Nomor Soal {currentQuestionIndex + 1}
                  </span>
                  <span className="text-xs font-semibold text-slate-300 bg-[#1a1a1c] border border-slate-700 px-2.5 py-0.5 rounded">
                    {currentQuestion.type === "menjodohkan"
                      ? "Mencocokkan / Menjodohkan"
                      : currentQuestion.type === "isian_singkat"
                      ? "Isian Singkat"
                      : currentQuestion.type === "uraian"
                      ? "Uraian / Esai"
                      : "Pilihan Ganda"}
                  </span>
                  {currentQuestion.topicTag && (
                    <span className="text-xs font-medium text-slate-400 bg-[#161618] px-2 py-0.5 rounded border border-slate-800">
                      {currentQuestion.topicTag}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Live Per-Question Timer Badge */}
                  <div
                    className="flex items-center gap-1.5 px-3 py-1 bg-indigo-950/60 border border-indigo-500/30 text-indigo-300 rounded-xl text-xs font-mono font-bold shadow-xs"
                    title="Durasi waktu yang dihabiskan pada butir soal ini"
                  >
                    <Clock className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                    <span>Waktu Soal: <strong className="text-white font-mono">{formatTime(timeSpentPerQuestion[currentQuestion.id] || 0)}</strong></span>
                  </div>

                  <span className="text-xs font-bold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-xl">
                    Bobot: {currentQuestion.score} Poin
                  </span>
                  <button
                    onClick={() => handleToggleFlag(currentQuestion.id)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                      session?.answers[currentQuestion.id]?.isFlagged
                        ? "bg-amber-400 text-amber-950 border-amber-500 shadow-sm"
                        : "bg-[#1a1a1c] text-slate-400 border-slate-700 hover:bg-slate-800"
                    }`}
                  >
                    <Flag className="w-3.5 h-3.5" />
                    <span>{session?.answers[currentQuestion.id]?.isFlagged ? "Ragu-Ragu" : "Tandai Ragu"}</span>
                  </button>
                </div>
              </div>

              {/* Stimulus Context Box (If available) */}
              {currentQuestion.stimulus && (
                <div className="p-4 bg-[#161618] rounded-2xl border border-slate-800 text-xs text-slate-300 leading-relaxed italic space-y-1">
                  <span className="font-semibold text-slate-200 not-italic block text-[11px] uppercase tracking-wide">
                    Stimulus / Bacaan Kasus:
                  </span>
                  <p className="whitespace-pre-line">{currentQuestion.stimulus}</p>
                </div>
              )}

              {/* Question Image Attachment (If available) */}
              {currentQuestion.imageUrl && (
                <div className="space-y-1.5">
                  <div
                    onClick={() => setZoomImageSrc(currentQuestion.imageUrl || null)}
                    className="p-2 bg-black/60 rounded-2xl border border-slate-800 flex flex-col items-center justify-center max-h-72 cursor-zoom-in group hover:border-indigo-500/50 transition-all relative overflow-hidden"
                  >
                    <img
                      src={currentQuestion.imageUrl}
                      alt={currentQuestion.imageCaption || "Gambar Soal"}
                      className="max-h-64 object-contain rounded-xl"
                    />
                    <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-xs px-2.5 py-1 rounded-lg text-[10px] text-white flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                      <ZoomIn className="w-3.5 h-3.5" />
                      <span>Klik untuk Perbesar</span>
                    </div>
                  </div>
                  {currentQuestion.imageCaption && (
                    <div className="text-[11px] text-slate-400 text-center italic">
                      {currentQuestion.imageCaption}
                    </div>
                  )}
                </div>
              )}

              {/* Main Question Text */}
              <div className="font-bold text-white text-base sm:text-lg leading-relaxed py-1">
                {currentQuestion.questionText}
              </div>

              {/* ========================================================================= */}
              {/* INTERACTIVE QUESTION ANSWER INPUTS (PER TYPE) */}
              {/* ========================================================================= */}

              {/* 1. TYPE: PILIHAN GANDA (A-E) */}
              {(currentQuestion.type === "pilihan_ganda" ||
                currentQuestion.type === "pilihan_ganda_kompleks" ||
                currentQuestion.type === "benar_salah" ||
                !currentQuestion.type) && (
                <div className="space-y-3 pt-2">
                  {currentQuestion.options.map((opt) => {
                    const isSelected = session?.answers[currentQuestion.id]?.selectedOption === opt.key;
                    return (
                      <div
                        key={opt.key}
                        id={`option-card-${currentQuestion.id}-${opt.key}`}
                        onClick={() => handleSelectOption(currentQuestion.id, opt.key)}
                        className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-3.5 ${
                          isSelected
                            ? "bg-indigo-950/40 border-indigo-500 shadow-md ring-1 ring-indigo-500/40"
                            : "bg-[#161618] border-slate-800 hover:border-slate-700 hover:bg-[#1a1a1c]"
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-xl font-bold text-xs flex items-center justify-center shrink-0 transition-all ${
                            isSelected
                              ? "bg-indigo-600 text-white shadow-sm"
                              : "bg-[#222226] text-slate-300 border border-slate-700"
                          }`}
                        >
                          {opt.key}
                        </div>

                        <div className="flex-1 font-medium text-slate-200 text-xs sm:text-sm pt-0.5">
                          {opt.text}
                        </div>

                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 2. TYPE: MENCOCOKKAN / MENJODOHKAN */}
              {currentQuestion.type === "menjodohkan" && (
                <div className="space-y-3 pt-2">
                  <div className="p-3 bg-indigo-950/30 border border-indigo-500/30 rounded-2xl text-xs text-indigo-300 flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4 shrink-0 text-indigo-400" />
                    <span>
                      Pasangkan setiap pernyataan di kolom kiri dengan pilihan yang sesuai di kolom kanan.
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {(currentQuestion.matchingPairs || []).map((pair, pIdx) => {
                      const selectedRight = currentMatchingMap[pair.id] || "";
                      const allRightOptions = Array.from(
                        new Set((currentQuestion.matchingPairs || []).map((p) => p.right))
                      );

                      return (
                        <div
                          key={pair.id || pIdx}
                          className="p-4 bg-[#161618] rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 sm:w-1/2">
                            <span className="w-6 h-6 rounded-lg bg-indigo-600/30 text-indigo-300 font-bold text-xs flex items-center justify-center shrink-0">
                              {pIdx + 1}
                            </span>
                            <span className="text-xs sm:text-sm font-semibold text-slate-200">
                              {pair.left}
                            </span>
                          </div>

                          <div className="sm:w-1/2 flex items-center gap-2">
                            <ArrowRightLeft className="w-3.5 h-3.5 text-slate-500 shrink-0 hidden sm:block" />
                            <select
                              value={selectedRight}
                              onChange={(e) =>
                                handleMatchingAnswerChange(currentQuestion.id, pair.id, e.target.value)
                              }
                              className={`w-full p-2.5 rounded-xl text-xs font-semibold border transition-all ${
                                selectedRight
                                  ? "bg-indigo-950/50 border-indigo-500 text-white"
                                  : "bg-[#1a1a1c] border-slate-700 text-slate-400"
                              }`}
                            >
                              <option key="select-pair-placeholder" value="">-- Pilih Pasangan yang Cocok --</option>
                              {allRightOptions.map((optVal, optIdx) => (
                                <option key={optIdx} value={optVal} className="bg-[#121214] text-slate-200">
                                  {optVal}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. TYPE: ISIAN PENDEK / SINGKAT */}
              {currentQuestion.type === "isian_singkat" && (
                <div className="space-y-3 pt-2">
                  <div className="p-3 bg-[#161618] rounded-2xl border border-slate-800 space-y-2">
                    <label className="text-xs font-bold text-slate-300 block flex items-center gap-1.5">
                      <FileEdit className="w-4 h-4 text-indigo-400" />
                      <span>Lembar Jawaban Isian Pendek / Singkat:</span>
                    </label>
                    <input
                      type="text"
                      value={session?.answers[currentQuestion.id]?.selectedOption || ""}
                      onChange={(e) => handleTextAnswerChange(currentQuestion.id, e.target.value)}
                      placeholder="Ketikkan jawaban singkat Anda di sini..."
                      className="w-full px-4 py-3 bg-[#1a1a1c] border border-indigo-500/50 rounded-xl text-white font-medium text-sm focus:border-indigo-400 focus:outline-none placeholder-slate-500"
                    />
                    <p className="text-[11px] text-slate-400">
                      Jawaban tersimpan otomatis saat Anda mengetik.
                    </p>
                  </div>
                </div>
              )}

              {/* 4. TYPE: URAIAN / ESAI */}
              {currentQuestion.type === "uraian" && (
                <div className="space-y-3 pt-2">
                  <div className="p-4 bg-[#161618] rounded-2xl border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <AlignLeft className="w-4 h-4 text-indigo-400" />
                        <span>Lembar Jawaban Uraian / Esai Komprehensif:</span>
                      </label>
                      <span className="text-[11px] text-slate-400">
                        {(session?.answers[currentQuestion.id]?.selectedOption || "").length} Karakter
                      </span>
                    </div>
                    <textarea
                      rows={5}
                      value={session?.answers[currentQuestion.id]?.selectedOption || ""}
                      onChange={(e) => handleTextAnswerChange(currentQuestion.id, e.target.value)}
                      placeholder="Uraikan penjelasan, analisis, atau langkah-langkah jawaban Anda secara lengkap dan runtut..."
                      className="w-full p-4 bg-[#1a1a1c] border border-indigo-500/50 rounded-xl text-white font-normal text-xs sm:text-sm focus:border-indigo-400 focus:outline-none placeholder-slate-500 leading-relaxed"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Slide Action Navigation Footer */}
            <div className="flex items-center justify-between pt-6 border-t border-slate-800 mt-6">
              <button
                onClick={handlePrevSlide}
                className="px-5 py-2.5 bg-[#1a1a1c] hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Sebelumnya</span>
              </button>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-medium hidden sm:inline">
                  {currentQuestionIndex + 1} dari {activeQuestions.length} Soal
                </span>
              </div>

              <button
                onClick={handleNextSlide}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs cursor-pointer inline-flex items-center gap-2 transition-all shadow-md shadow-indigo-950"
              >
                <span>{currentQuestionIndex === activeQuestions.length - 1 ? "Lembar Ringkasan" : "Selanjutnya"}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SLIDE AKHIR: RINGKASAN & KONFIRMASI SUBMIT */}
        {/* ========================================================================= */}
        {isFinalSlide && (
          <div className="space-y-6 my-auto max-w-3xl mx-auto w-full animate-in fade-in duration-300">
            <div className="text-center space-y-2">
              <span className="px-4 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-full font-bold text-xs uppercase tracking-wider inline-block">
                SLIDE AKHIR • RINGKASAN JAWABAN
              </span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">Konfirmasi Selesai Ujian</h2>
              <p className="text-xs text-slate-400">
                Periksalah kembali seluruh jawaban Anda. Klik pada nomor soal untuk meninjau kembali.
              </p>
            </div>

            {/* Answer Matrix Grid with Per-Question Timers */}
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2.5 p-4 sm:p-5 bg-[#161618] rounded-2xl border border-slate-800 max-h-[280px] overflow-y-auto">
              {activeQuestions.map((q, idx) => {
                const ans = session?.answers[q.id];
                const hasAnswer = !!ans?.selectedOption && ans.selectedOption !== "{}";
                const isFlagged = !!ans?.isFlagged;
                const qDuration = timeSpentPerQuestion[q.id] || ans?.timeSpentSeconds || 0;

                let badgeStyle = "bg-[#1a1a1c] border-slate-700 text-slate-400";
                if (isFlagged) {
                  badgeStyle = "bg-amber-400 border-amber-500 text-amber-950 font-bold";
                } else if (hasAnswer) {
                  badgeStyle = "bg-emerald-600 border-emerald-500 text-white font-bold";
                }

                return (
                  <button
                    key={q.id}
                    onClick={() => handleJumpToSlide(3 + idx)}
                    className={`py-2 px-1.5 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer hover:scale-105 ${badgeStyle}`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] opacity-80">Soal</span>
                      <span className="text-sm font-extrabold">{idx + 1}</span>
                    </div>
                    <span className="text-[9px] font-mono opacity-90 mt-0.5 px-1 py-0.2 rounded bg-black/20">
                      ⏱ {formatTime(qDuration)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Engagement Analytics Summary Card */}
            {(() => {
              const times = activeQuestions.map((q) => ({
                id: q.id,
                time: timeSpentPerQuestion[q.id] || session?.answers[q.id]?.timeSpentSeconds || 0,
              }));
              const totalSpent = times.reduce((acc, t) => acc + t.time, 0);
              const avgTime = activeQuestions.length > 0 ? Math.round(totalSpent / activeQuestions.length) : 0;
              const maxTime = Math.max(...times.map((t) => t.time), 0);
              const minTime = Math.min(...times.map((t) => t.time), 0);

              return (
                <div className="p-4 bg-[#141416] rounded-2xl border border-indigo-500/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Analisis Keterlibatan & Waktu per Soal</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Rata-rata: <strong className="text-white">{formatTime(avgTime)}</strong> / soal
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 bg-[#1a1a1c] rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-400">Total Waktu Soal</div>
                      <div className="font-mono font-bold text-white text-sm">{formatTime(totalSpent)}</div>
                    </div>
                    <div className="p-2 bg-[#1a1a1c] rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-400">Paling Lama</div>
                      <div className="font-mono font-bold text-amber-400 text-sm">{formatTime(maxTime)}</div>
                    </div>
                    <div className="p-2 bg-[#1a1a1c] rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-400">Paling Singkat</div>
                      <div className="font-mono font-bold text-emerald-400 text-sm">{formatTime(minTime)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-emerald-600" />
                <span className="text-slate-300">Sudah Dijawab ({answeredCount})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="text-slate-300">Ragu-Ragu ({Object.values(session?.answers || {}).filter((a: any) => a.isFlagged).length})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-slate-600" />
                <span className="text-slate-300">Belum Dijawab ({activeQuestions.length - answeredCount})</span>
              </div>
            </div>

            {/* Submit Action */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                onClick={handlePrevSlide}
                className="px-5 py-2.5 bg-[#1a1a1c] hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Kembali ke Soal Terakhir</span>
              </button>

              <button
                id="open-submit-modal-btn"
                onClick={() => setShowSummaryModal(true)}
                className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-extrabold text-sm shadow-lg shadow-emerald-950 transition-all cursor-pointer inline-flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                <span>Kumpulkan Jawaban Ujian</span>
              </button>
            </div>
          </div>
        )}
        </motion.div>
      </AnimatePresence>
      </div>

      {/* Quick Jump Matrix Modal / Drawer */}
      {showMatrixDrawer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#121214] rounded-3xl p-6 max-w-lg w-full border border-slate-800 shadow-2xl space-y-4 text-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base">Navigasi Butir Soal</h3>
              <button
                onClick={() => setShowMatrixDrawer(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2 max-h-[300px] overflow-y-auto p-1">
              {activeQuestions.map((q, idx) => {
                const ans = session?.answers[q.id];
                const hasAnswer = !!ans?.selectedOption && ans.selectedOption !== "{}";
                const isFlagged = !!ans?.isFlagged;
                const isCurrent = currentQuestionIndex === idx;
                const qDuration = timeSpentPerQuestion[q.id] || ans?.timeSpentSeconds || 0;

                let style = "bg-[#1a1a1c] border-slate-700 text-slate-400";
                if (isFlagged) {
                  style = "bg-amber-400 border-amber-500 text-amber-950 font-bold";
                } else if (hasAnswer) {
                  style = "bg-emerald-600 border-emerald-500 text-white font-bold";
                }

                if (isCurrent) {
                  style += " ring-2 ring-indigo-400 scale-105";
                }

                return (
                  <button
                    key={q.id}
                    onClick={() => handleJumpToSlide(3 + idx)}
                    className={`py-2 px-1.5 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${style}`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] opacity-80">Soal</span>
                      <span className="text-xs font-black">{idx + 1}</span>
                    </div>
                    <span className="text-[9px] font-mono opacity-85 mt-0.5 px-1 py-0.2 rounded bg-black/20">
                      ⏱ {formatTime(qDuration)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
              <span className="text-slate-400">
                Terjawab: <strong>{answeredCount}</strong> / {activeQuestions.length}
              </span>
              <button
                onClick={() => handleJumpToSlide(totalSlides - 1)}
                className="text-indigo-400 hover:text-indigo-300 font-bold underline cursor-pointer"
              >
                Ke Lembar Selesai →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Submit Modal */}
      {showSummaryModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#121214] rounded-3xl p-6 sm:p-8 max-w-md w-full border border-slate-800 shadow-2xl space-y-5 text-center text-slate-200">
            <div className="w-14 h-14 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-emerald-950">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-black text-white">Konfirmasi Pengumpulan</h3>
              <p className="text-xs text-slate-400">
                Apakah Anda yakin telah selesai mengerjakan seluruh soal ujian?
              </p>
            </div>

            <div className="p-4 bg-[#161618] rounded-2xl border border-slate-800 text-xs space-y-2 text-left">
              <div className="flex justify-between">
                <span className="text-slate-400">Total Butir Soal:</span>
                <span className="font-bold text-white">{activeQuestions.length} Butir</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Sudah Dijawab:</span>
                <span className="font-bold text-emerald-400">{answeredCount} Butir</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Belum Terjawab:</span>
                <span className="font-bold text-rose-400">{activeQuestions.length - answeredCount} Butir</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Sisa Waktu:</span>
                <span className="font-mono font-bold text-indigo-300">{formatTime(secondsRemaining)}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setShowSummaryModal(false)}
                className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                Periksa Lagi
              </button>
              <button
                id="confirm-final-submit-btn"
                onClick={() => handleFinalSubmit("submitted")}
                className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-950 cursor-pointer transition-all"
              >
                Ya, Kumpulkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal during active exam */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#121214] rounded-3xl p-6 sm:p-8 max-w-md w-full border border-rose-500/40 shadow-2xl space-y-5 text-center text-slate-200">
            <div className="w-14 h-14 bg-rose-600/20 border border-rose-500/30 text-rose-400 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-rose-950">
              <RotateCcw className="w-8 h-8 text-rose-400" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-white">Mulai Ulang Pengerjaan Ujian?</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Seluruh jawaban yang telah Anda pilih pada naskah ini akan dikosongkan dan ujian akan dimulai kembali dari nomor 1 dengan waktu penuh.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                className="flex-1 py-3 px-4 rounded-xl text-xs font-bold bg-[#1a1a1c] hover:bg-slate-800 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirmModal(false);
                  if (session) {
                    handleOptionMulaiUlang(exam, session);
                  }
                }}
                className="flex-1 py-3 px-4 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer shadow-lg shadow-rose-950"
              >
                Ya, Mulai Ulang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Zoom Modal */}
      {zoomImageSrc && (
        <div
          onClick={() => setZoomImageSrc(null)}
          className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-200"
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full flex flex-col items-center">
            <button
              onClick={() => setZoomImageSrc(null)}
              className="absolute -top-10 right-0 text-white hover:text-rose-400 text-xs font-bold flex items-center gap-1 bg-black/60 px-3 py-1 rounded-full border border-slate-700"
            >
              <X className="w-4 h-4" />
              <span>Tutup Gambar</span>
            </button>
            <img
              src={zoomImageSrc}
              alt="Visual Soal Diperbesar"
              className="max-h-[85vh] max-w-full object-contain rounded-2xl shadow-2xl border border-slate-800"
            />
          </div>
        </div>
      )}

      {/* Anti-Cheating Alert Modal */}
      {violationAlertModal.show && (
        <div className="fixed inset-0 bg-rose-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#141214] border-2 border-rose-500/80 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl shadow-rose-950/80 text-center space-y-4">
            <div className="w-14 h-14 bg-rose-600/20 border border-rose-500/40 text-rose-400 rounded-2xl flex items-center justify-center mx-auto animate-bounce">
              <ShieldAlert className="w-8 h-8 text-rose-400" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-black text-rose-300">Peringatan Integritas Ujian!</h3>
              <p className="text-xs text-rose-200/90 leading-relaxed">
                {violationAlertModal.message}
              </p>
            </div>

            <div className="p-3 bg-rose-950/40 rounded-xl border border-rose-500/30 text-xs text-rose-300 font-mono">
              Pelanggaran Tercatat: {violationAlertModal.count}x
            </div>

            <p className="text-[11px] text-slate-400">
              Setiap aktivitas perpindahan tab atau layar dicatat otomatis dan dilaporkan secara real-time ke Guru Pengawas.
            </p>

            <button
              onClick={() => setViolationAlertModal({ show: false, type: "", message: "", count: 0 })}
              className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold text-xs cursor-pointer shadow-lg shadow-rose-950 transition-all"
            >
              Saya Mengerti & Kembali ke Soal
            </button>
          </div>
        </div>
      )}

      {/* Session Reset by Teacher Alert Modal */}
      {resetAlertMessage && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#12131a] border-2 border-amber-500/60 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl shadow-black/80 text-center space-y-4">
            <div className="w-14 h-14 bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded-2xl flex items-center justify-center mx-auto">
              <RotateCcw className="w-8 h-8 text-amber-400" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-black text-amber-300">Sesi Ujian Telah Direset</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {resetAlertMessage}
              </p>
            </div>

            <div className="p-3 bg-amber-950/30 rounded-xl border border-amber-500/20 text-xs text-amber-200">
              Guru / Pengawas telah mereset sesi ujian Anda. Anda dapat memasukkan data atau token untuk memulai sesi ujian baru.
            </div>

            <button
              onClick={() => setResetAlertMessage(null)}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs cursor-pointer shadow-lg shadow-indigo-950 transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Kembali ke Halaman Masuk
            </button>
          </div>
        </div>
      )}

      {/* Panduan Data Siswa Asli (Roster_Siswa) Modal */}
      {showRosterGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#121214] border border-slate-700/80 rounded-3xl max-w-2xl w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto shadow-2xl text-slate-100">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-white">
                    Panduan Data Siswa Mode Siswa (Anti Data Dummy)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Cara memastikan atau mengubah data siswa yang tampil di mode siswa
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowRosterGuideModal(false)}
                className="p-2 text-slate-400 hover:text-white bg-[#1a1a1c] hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mengapa Muncul Data Dummy? */}
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <Info className="w-4 h-4 shrink-0" />
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
                    Kembali ke dashboard guru ini, pastikan status Database Utama Google Sheets sudah <em>"Terhubung ke Google Sheets"</em>. Jika belum, klik <strong>Uji Koneksi (Ping)</strong> di tab Sinkronisasi Cloud.
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

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowRosterGuideModal(false);
                  handleManualRefreshRoster();
                }}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Segarkan Nama Siswa Sekarang</span>
              </button>

              <button
                type="button"
                onClick={() => setShowRosterGuideModal(false)}
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
