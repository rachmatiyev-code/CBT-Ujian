import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Eye,
  ShieldAlert,
  ShieldCheck,
  GraduationCap,
  Sparkles,
  TrendingUp,
  Award,
  FileDown,
  Printer,
  Bell,
  BellRing,
  X,
  UserPlus,
  Send,
  Edit3,
  Trash2,
  CheckSquare,
  Square,
  Check,
  RotateCcw,
  AlertTriangle,
  FolderSync
} from "lucide-react";
import { ExamPackage, SchoolProfile, StudentExamSession, StudentTokenItem } from "../types";
import { exportGradebookToExcel, exportItemAnalysisToExcel } from "../utils/sheetExport";
import { generateStudentExamPdfReport, generateBatchStudentsPdfReport } from "../utils/studentPdfReport";
import { deduplicateStudentTokens } from "../utils/tokenValidator";
import { fetchExamSessions, reconcileAndMergeExamSessions, subscribeToExamSessions } from "../utils/firestoreService";
import { getStudentTokens } from "../utils/storage";
import { subscribeToLiveSessions } from "../utils/liveSync";
import { LiveStudentEditModal, StudentRowItem } from "./LiveStudentEditModal";

interface ToastNotification {
  id: string;
  type: "start" | "submit" | "violation" | "info" | "action";
  title: string;
  message: string;
  studentName?: string;
  className?: string;
  time: string;
}

interface LiveMonitoringDashboardProps {
  exam: ExamPackage;
  school: SchoolProfile;
  history: StudentExamSession[];
  tokens: StudentTokenItem[];
  onForceSubmitStudent: (sessionId: string) => void;
  onResetStudentSession: (sessionId?: string, studentName?: string, token?: string, nisn?: string) => void;
  onDeleteStudent?: (payload: {
    sessionId?: string;
    tokenId?: string;
    studentName: string;
    token?: string;
    nisn?: string;
  }) => void;
  onBatchDeleteStudents?: (
    students: Array<{
      sessionId?: string;
      tokenId?: string;
      studentName: string;
      token?: string;
      nisn?: string;
    }>
  ) => void;
  onBatchResetSessions?: (
    students: Array<{
      sessionId?: string;
      studentName: string;
      token?: string;
      nisn?: string;
    }>
  ) => void;
  onUpdateHistory?: (updatedHistory: StudentExamSession[]) => void;
  onUpdateTokens?: (updatedTokens: StudentTokenItem[]) => void;
  onUpdateExam?: (updatedExam: ExamPackage) => void;
}

export const LiveMonitoringDashboard: React.FC<LiveMonitoringDashboardProps> = ({
  exam,
  school,
  history,
  tokens,
  onForceSubmitStudent,
  onResetStudentSession,
  onDeleteStudent,
  onBatchDeleteStudents,
  onBatchResetSessions,
  onUpdateHistory,
  onUpdateTokens,
  onUpdateExam,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterClass, setFilterClass] = useState("all");
  const [selectedStudentSession, setSelectedStudentSession] = useState<StudentExamSession | null>(null);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const [showToastHistory, setShowToastHistory] = useState(false);
  const previousHistoryRef = useRef<StudentExamSession[]>(history);

  // Selection & Supervisor Editing States
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingStudentRow, setEditingStudentRow] = useState<StudentRowItem | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);

  // Detect any student sessions that share this exam's ID but have disparate/mismatched exam codes
  const disparateCodeSessions = useMemo(() => {
    const cleanId = (exam.id || "").trim();
    const cleanCode = (exam.code || "").trim().toUpperCase();
    return history.filter(
      (s) =>
        s &&
        (s.examId || "").trim() === cleanId &&
        (s.examCode || "").trim().toUpperCase() !== cleanCode
    );
  }, [history, exam.id, exam.code]);

  const handleReconcileCodes = async () => {
    setIsReconciling(true);
    try {
      const res = await reconcileAndMergeExamSessions(exam.id, exam.code);
      const remoteSessions = await fetchExamSessions(exam.id, exam.code);
      if (remoteSessions && remoteSessions.length > 0 && onUpdateHistory) {
        onUpdateHistory(remoteSessions);
      } else if (onUpdateHistory) {
        // Apply locally if remote is offline
        const cleanId = (exam.id || "").trim();
        const cleanCode = (exam.code || "").trim().toUpperCase();
        const updated = history.map((s) =>
          s && (s.examId || "").trim() === cleanId
            ? { ...s, examCode: cleanCode }
            : s
        );
        onUpdateHistory(updated);
      }

      showActionFeedback(
        `Penyatuan Berhasil: ${res.mergedSessionsCount} sesi dari kode berbeda telah digabungkan ke kode resmi "${exam.code}".`
      );
    } catch (err: any) {
      showActionFeedback("Gagal menyatukan kode soal: " + (err?.message || "Koneksi terputus"));
    } finally {
      setIsReconciling(false);
    }
  };

  const handleSyncCloud = async () => {
    setIsSyncing(true);
    try {
      // Reconcile and unify any fragmented codes during sync
      const reconcileRes = await reconcileAndMergeExamSessions(exam.id, exam.code);
      const remoteSessions = await fetchExamSessions(exam.id, exam.code);
      if (remoteSessions && remoteSessions.length > 0 && onUpdateHistory) {
        onUpdateHistory(remoteSessions);
        if (reconcileRes.mergedSessionsCount > 0) {
          showActionFeedback(`Sinkronisasi & Penyatuan Berhasil: ${remoteSessions.length} data termuat, ${reconcileRes.mergedSessionsCount} sesi kode berbeda berhasil digabungkan.`);
        } else {
          showActionFeedback(`Sinkronisasi berhasil: ${remoteSessions.length} data pengerjaan siswa terdeteksi.`);
        }
      } else {
        showActionFeedback("Sinkronisasi selesai: Data sudah mutakhir.");
      }
    } catch (err: any) {
      showActionFeedback("Gagal sinkronisasi cloud: " + (err?.message || "Koneksi terputus"));
    } finally {
      setIsSyncing(false);
    }
  };

  const addToast = (toast: Omit<ToastNotification, "id" | "time">) => {
    const newToast: ToastNotification = {
      ...toast,
      id: `toast-${Date.now()}-${Math.random()}`,
      time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };

    setToasts((prev) => [newToast, ...prev.slice(0, 15)]);

    // Auto dismiss after 6 seconds
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== newToast.id));
    }, 6000);
  };

  const showActionFeedback = (msg: string) => {
    setActionNotice(msg);
    addToast({
      type: "action",
      title: "Aksi Pengawas Berhasil",
      message: msg,
    });
    setTimeout(() => setActionNotice(null), 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Auto-sync heartbeat & real-time LiveSync channel listener
  useEffect(() => {
    // 1. Subscribe to BroadcastChannel for instant cross-tab updates (0ms)
    const unsubscribeLive = subscribeToLiveSessions((incomingSession) => {
      if (!incomingSession) return;
      const sId = (incomingSession.examId || "").trim();
      const sCode = (incomingSession.examCode || "").trim().toUpperCase();
      const targetId = (exam.id || "").trim();
      const targetCode = (exam.code || "").trim().toUpperCase();

      if (
        (targetId && sId === targetId) ||
        (targetCode && sCode === targetCode) ||
        !incomingSession.examCode
      ) {
        if (onUpdateHistory) {
          const existing = [...history];
          const idx = existing.findIndex((h) => h.id === incomingSession.id);
          if (idx >= 0) {
            existing[idx] = incomingSession;
          } else {
            existing.unshift(incomingSession);
          }
          onUpdateHistory(existing);
        }
      }
    });

    // 2. Initial immediate sync from cloud / server
    handleSyncCloud();

    // 3. Realtime Firestore snapshot listener
    const unsubscribeFirestore = subscribeToExamSessions(exam.code || exam.id, (remoteSessions) => {
      if (remoteSessions && remoteSessions.length > 0 && onUpdateHistory) {
        onUpdateHistory(remoteSessions);
      }
    });

    // 4. Periodic fallback poll every 4 seconds
    const interval = setInterval(() => {
      fetchExamSessions(exam.id, exam.code)
        .then((remoteSessions) => {
          if (remoteSessions && remoteSessions.length > 0 && onUpdateHistory) {
            onUpdateHistory(remoteSessions);
          }
        })
        .catch(() => {});
    }, 4000);

    return () => {
      unsubscribeLive();
      unsubscribeFirestore();
      clearInterval(interval);
    };
  }, [exam.id, exam.code]);

  // Monitor changes in history to trigger live toasts
  useEffect(() => {
    const prevHistory = previousHistoryRef.current;
    
    // Check for newly started sessions
    history.forEach((currSession) => {
      if (currSession.examCode !== exam.code && currSession.examId !== exam.id) return;

      const prevSession = prevHistory.find((p) => p.id === currSession.id);

      if (!prevSession && currSession.status === "in_progress") {
        addToast({
          type: "start",
          title: "Siswa Baru Mulai Ujian",
          message: `${currSession.studentName} (${currSession.className}) baru saja login dan mulai mengerjakan ujian.`,
          studentName: currSession.studentName,
          className: currSession.className,
        });
      } else if (prevSession && prevSession.status === "in_progress" && currSession.status === "submitted") {
        addToast({
          type: "submit",
          title: "Siswa Selesai Submit Ujian",
          message: `${currSession.studentName} (${currSession.className}) berhasil mengumpulkan jawaban. Skor: ${currSession.totalScoreEarned} Poin.`,
          studentName: currSession.studentName,
          className: currSession.className,
        });
      } else if (
        prevSession &&
        (currSession.violationCount || 0) > (prevSession.violationCount || 0)
      ) {
        addToast({
          type: "violation",
          title: "Peringatan Integritas Terdeteksi",
          message: `${currSession.studentName} terdeteksi berpindah jendela/tab aplikasi (${currSession.violationCount}x).`,
          studentName: currSession.studentName,
          className: currSession.className,
        });
      }
    });

    previousHistoryRef.current = history;
  }, [history, exam.id, exam.code]);

  const cleanExamId = (exam.id || "").trim();
  const cleanExamCode = (exam.code || "").trim().toUpperCase();

  const examSessions = history.filter((s) => {
    if (!s) return false;
    const sId = (s.examId || "").trim();
    const sCode = (s.examCode || "").trim().toUpperCase();
    const matchId = cleanExamId && sId === cleanExamId;
    const matchCode = cleanExamCode && sCode === cleanExamCode;
    return matchId || matchCode || (!cleanExamId && !cleanExamCode);
  });

  // Group tokens and active sessions (deduplicated by student name)
  const tokenSource =
    tokens && tokens.length > 0
      ? tokens
      : exam.tokens && exam.tokens.length > 0
      ? exam.tokens
      : getStudentTokens();

  const uniqueExamTokens = deduplicateStudentTokens(
    tokenSource,
    exam.code,
    exam.teacherProfile?.gradeLevel,
    exam.id
  );

  const studentRows: StudentRowItem[] = uniqueExamTokens.map((tokenItem) => {
    const activeSession = examSessions.find(
      (s) =>
        s.token === tokenItem.token ||
        s.nisn === tokenItem.nisn ||
        s.studentName.toLowerCase().trim() === tokenItem.studentName.toLowerCase().trim()
    );

    const effectiveStatus: "belum_mulai" | "sedang_mengerjakan" | "selesai" = activeSession
      ? activeSession.status === "submitted"
        ? "selesai"
        : "sedang_mengerjakan"
      : "belum_mulai";

    return {
      tokenItem: {
        ...tokenItem,
        status: effectiveStatus,
      },
      session: activeSession || null,
    };
  });

  // Also include any sessions not in pre-generated token list (e.g. dynamic/manual student inputs)
  examSessions.forEach((s) => {
    const isAlreadyListed = studentRows.some(
      (row) =>
        row.session?.id === s.id ||
        row.tokenItem.studentName.toLowerCase().trim() === s.studentName.toLowerCase().trim()
    );
    if (!isAlreadyListed) {
      studentRows.push({
        tokenItem: {
          id: `dyn-${s.id}`,
          examCode: s.examCode || exam.code,
          token: s.token,
          studentName: s.studentName,
          nisn: s.nisn,
          className: s.className,
          status: s.status === "submitted" ? "selesai" : "sedang_mengerjakan",
          generatedAt: s.startTime,
        },
        session: s,
      });
    }
  });

  const filteredRows = studentRows.filter(({ tokenItem }) => {
    const nameMatch =
      tokenItem.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (tokenItem.nisn || "").includes(searchQuery);
    const itemClass = (tokenItem.className || "").trim();
    const classMatch = filterClass === "all" || itemClass === filterClass;
    return nameMatch && classMatch;
  });

  const totalRegistered = studentRows.length;
  const completedCount = studentRows.filter((r) => r.session?.status === "submitted").length;
  const inProgressCount = studentRows.filter((r) => r.session?.status === "in_progress").length;
  const notStartedCount = totalRegistered - completedCount - inProgressCount;

  const completedSessions = examSessions.filter((s) => s.status === "submitted");
  const averageScore = completedSessions.length > 0
    ? Math.round(completedSessions.reduce((acc, s) => acc + s.percentage, 0) / completedSessions.length)
    : 0;
  const passedCount = completedSessions.filter((s) => s.passed).length;
  const passRate = completedSessions.length > 0 ? Math.round((passedCount / completedSessions.length) * 100) : 0;

  const uniqueClasses = useMemo(() => {
    const classes = new Set<string>();
    studentRows.forEach((r) => {
      const cls = (r.tokenItem?.className || "").trim();
      if (cls) {
        classes.add(cls);
      }
    });
    return Array.from(classes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [studentRows]);

  // --- SELECTION LOGIC ---
  const isAllSelected = filteredRows.length > 0 && filteredRows.every((r) => selectedIds.has(r.tokenItem.id));
  const isSomeSelected = selectedIds.size > 0;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set<string>();
      filteredRows.forEach((r) => next.add(r.tokenItem.id));
      setSelectedIds(next);
    }
  };

  const handleToggleSelectRow = (rowId: string) => {
    const next = new Set(selectedIds);
    if (next.has(rowId)) {
      next.delete(rowId);
    } else {
      next.add(rowId);
    }
    setSelectedIds(next);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  // --- SUPERVISOR ACTIONS: EDIT ---
  const handleOpenEditModal = (row: StudentRowItem) => {
    setEditingStudentRow(row);
    setIsEditModalOpen(true);
  };

  const handleSaveStudentEdit = (updatedToken: StudentTokenItem, updatedSession: StudentExamSession | null) => {
    // 1. Update token list if present
    if (tokens.some((t) => t.id === updatedToken.id)) {
      const updatedTokens = tokens.map((t) => (t.id === updatedToken.id ? updatedToken : t));
      onUpdateTokens?.(updatedTokens);
    } else if (!updatedToken.id.startsWith("dyn-")) {
      // Add if new
      onUpdateTokens?.([...tokens, updatedToken]);
    }

    // 2. Update exam history
    if (updatedSession) {
      const existingIdx = history.findIndex((h) => h.id === updatedSession.id);
      let updatedHistory: StudentExamSession[];
      if (existingIdx >= 0) {
        updatedHistory = [...history];
        updatedHistory[existingIdx] = updatedSession;
      } else {
        updatedHistory = [updatedSession, ...history];
      }
      onUpdateHistory?.(updatedHistory);
    } else {
      // If session was cleared (set to not started)
      onResetStudentSession(
        editingStudentRow?.session?.id,
        updatedToken.studentName,
        updatedToken.token,
        updatedToken.nisn
      );
    }

    showActionFeedback(`Data dan status pengerjaan siswa "${updatedToken.studentName}" berhasil diperbarui.`);
  };

  // --- SUPERVISOR ACTIONS: DELETE ---
  const handleDeleteSingleStudent = (row: StudentRowItem) => {
    const studentName = row.session?.studentName || row.tokenItem.studentName;
    const token = row.session?.token || row.tokenItem.token;
    const nisn = row.session?.nisn || row.tokenItem.nisn;
    const sessionId = row.session?.id;
    const tokenId = row.tokenItem.id;

    if (confirm(`Apakah Anda yakin ingin menghapus data siswa "${studentName}"? Riwayat sesi pengerjaan, jawaban, dan token ujian terkait akan dihapus secara permanen.`)) {
      if (onDeleteStudent) {
        onDeleteStudent({
          sessionId,
          tokenId,
          studentName,
          token,
          nisn,
        });
      } else {
        // Fallback:
        onResetStudentSession(sessionId, studentName, token, nisn);
        if (tokens.some((t) => t.id === tokenId)) {
          const updatedTokens = tokens.filter((t) => t.id !== tokenId);
          onUpdateTokens?.(updatedTokens);
        }
      }

      if (selectedIds.has(tokenId)) {
        const next = new Set(selectedIds);
        next.delete(tokenId);
        setSelectedIds(next);
      }

      showActionFeedback(`Data siswa "${studentName}" berhasil dihapus dari sistem pengawas.`);
    }
  };

  // --- BATCH ACTIONS ---
  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    const selectedRows = studentRows.filter((r) => selectedIds.has(r.tokenItem.id));
    if (confirm(`Hapus ${selectedRows.length} data siswa terpilih? Seluruh riwayat pengerjaan, jawaban, dan token ujian terkait akan dibersihkan dari server & database.`)) {
      if (onBatchDeleteStudents) {
        onBatchDeleteStudents(
          selectedRows.map((r) => ({
            sessionId: r.session?.id,
            tokenId: r.tokenItem.id,
            studentName: r.session?.studentName || r.tokenItem.studentName,
            token: r.session?.token || r.tokenItem.token,
            nisn: r.session?.nisn || r.tokenItem.nisn,
          }))
        );
      } else {
        const sessionIdsToDelete = new Set(selectedRows.map((r) => r.session?.id).filter(Boolean));
        const tokenIdsToDelete = new Set(selectedRows.map((r) => r.tokenItem.id));

        if (sessionIdsToDelete.size > 0) {
          const updatedHistory = history.filter((h) => !sessionIdsToDelete.has(h.id));
          onUpdateHistory?.(updatedHistory);
        }

        const updatedTokens = tokens.filter((t) => !tokenIdsToDelete.has(t.id));
        onUpdateTokens?.(updatedTokens);
      }

      setSelectedIds(new Set());
      showActionFeedback(`Berhasil menghapus ${selectedRows.length} data siswa terpilih.`);
    }
  };

  const handleBatchForceSubmit = () => {
    const inProgressRows = studentRows.filter(
      (r) => selectedIds.has(r.tokenItem.id) && r.session?.status === "in_progress"
    );

    if (inProgressRows.length === 0) {
      alert("Tidak ada siswa dengan status 'Sedang Mengerjakan' di antara pilihan yang dicentang.");
      return;
    }

    if (confirm(`Kumpulkan paksa lembar jawaban untuk ${inProgressRows.length} siswa terpilih sekarang?`)) {
      inProgressRows.forEach((r) => {
        if (r.session) {
          onForceSubmitStudent(r.session.id);
        }
      });
      showActionFeedback(`Berhasil mengumpulkan jawaban untuk ${inProgressRows.length} siswa.`);
    }
  };

  const handleBatchResetSessions = () => {
    const targetRows = studentRows.filter(
      (r) => selectedIds.has(r.tokenItem.id) && (r.session !== null || r.tokenItem.status !== "belum_mulai")
    );

    if (targetRows.length === 0) {
      alert("Tidak ada siswa dengan sesi aktif atau status ujian berjalan di antara pilihan yang dicentang.");
      return;
    }

    if (confirm(`Reset sesi pengerjaan untuk ${targetRows.length} siswa terpilih? Jawaban tersimpan akan dikosongkan dan status diubah ke 'Belum Mulai' agar siswa dapat memulai tes dari awal.`)) {
      if (onBatchResetSessions) {
        onBatchResetSessions(
          targetRows.map((r) => ({
            sessionId: r.session?.id,
            studentName: r.session?.studentName || r.tokenItem.studentName,
            token: r.session?.token || r.tokenItem.token,
            nisn: r.session?.nisn || r.tokenItem.nisn,
          }))
        );
      } else {
        targetRows.forEach((r) => {
          onResetStudentSession(
            r.session?.id,
            r.session?.studentName || r.tokenItem.studentName,
            r.session?.token || r.tokenItem.token,
            r.session?.nisn || r.tokenItem.nisn
          );
        });
      }
      setSelectedIds(new Set());
      showActionFeedback(`Sesi pengerjaan ${targetRows.length} siswa berhasil di-reset menjadi Belum Mulai.`);
    }
  };

  const handleBatchPrintPdf = async () => {
    const completedSelected = studentRows
      .filter((r) => selectedIds.has(r.tokenItem.id) && r.session?.status === "submitted")
      .map((r) => r.session as StudentExamSession);

    if (completedSelected.length === 0) {
      alert("Tidak ada siswa yang berstatus 'Selesai' di antara pilihan untuk dicetak PDF.");
      return;
    }

    try {
      if (completedSelected.length === 1) {
        await generateStudentExamPdfReport(completedSelected[0], exam, school);
        showActionFeedback(`Rapor siswa "${completedSelected[0].studentName}" berhasil diunduh (1 file PDF).`);
      } else {
        await generateBatchStudentsPdfReport(
          completedSelected,
          exam,
          school,
          filterClass !== "all" ? filterClass : undefined
        );
        showActionFeedback(`Berhasil mengunduh 1 berkas PDF rapor gabungan untuk ${completedSelected.length} siswa terpilih.`);
      }
    } catch (err: any) {
      alert("Gagal mengunduh rapor PDF: " + err.message);
    }
  };

  return (
    <div id="live-monitoring-dashboard" className="space-y-6">
      {/* Header Info */}
      <div className="bg-[#121214] rounded-2xl p-6 border border-slate-800 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 font-medium text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Real-time Monitoring & Evaluasi CBT</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">{exam.title}</h2>
          <p className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2">
            <span>Kode Soal: <span className="font-mono font-semibold bg-[#1a1a1c] border border-slate-800 text-indigo-300 px-2 py-0.5 rounded">{exam.code}</span></span>
            <span>•</span>
            <span>Token Sesi: <span className="font-mono font-semibold bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded">{exam.sessionToken}</span></span>
            <span>•</span>
            <span>KKM: <span className="font-semibold text-slate-300">{exam.teacherProfile?.passingGrade || 75}</span></span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Realtime Cloud Sync Button */}
          <button
            id="sync-cloud-btn"
            onClick={handleSyncCloud}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/50 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer disabled:opacity-50"
            title="Sinkronkan data pengerjaan siswa langsung dari cloud database & server"
          >
            <RefreshCw className={`w-4 h-4 text-indigo-400 ${isSyncing ? "animate-spin" : ""}`} />
            <span>{isSyncing ? "Menyinkronkan..." : "Sinkronkan Cloud"}</span>
          </button>

          {/* Notification Center Button */}
          <button
            id="toggle-toast-history-btn"
            onClick={() => setShowToastHistory(!showToastHistory)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-[#1a1a1c] hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer relative"
            title="Riwayat Notifikasi Ujian Langsung"
          >
            <Bell className="w-4 h-4 text-amber-400" />
            <span>Notifikasi Live</span>
            {toasts.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping absolute -top-1 -right-1" />
            )}
          </button>

          <button
            onClick={() => exportGradebookToExcel(exam, history, school)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950 transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Unduh Rekap Google Sheets</span>
          </button>
          <button
            onClick={() => exportItemAnalysisToExcel(exam, history, school)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[#1a1a1c] hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
          >
            <TrendingUp className="w-4 h-4 text-indigo-400" />
            <span>Unduh Analisis Butir Soal</span>
          </button>
          {completedSessions.length > 0 && (
            <button
              onClick={async () => {
                try {
                  await generateBatchStudentsPdfReport(
                    completedSessions,
                    exam,
                    school,
                    filterClass !== "all" ? filterClass : undefined
                  );
                  showActionFeedback(`Berhasil mengunduh 1 berkas PDF rapor gabungan untuk ${completedSessions.length} siswa.`);
                } catch (err: any) {
                  alert("Gagal mengunduh rapor PDF: " + err.message);
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-950 transition-all cursor-pointer"
              title="Unduh seluruh rapor siswa yang sudah selesai mengerjakan dalam 1 file PDF"
            >
              <FileDown className="w-4 h-4" />
              <span>Unduh Semua Rapor PDF ({completedSessions.length} Siswa, 1 File)</span>
            </button>
          )}
        </div>
      </div>

      {/* Disparate Exam Codes Reconciliation Banner */}
      {disparateCodeSessions.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-500/40 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-amber-200 animate-in fade-in shadow-lg shadow-amber-950/20">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-bold text-amber-300 flex items-center gap-2">
                <span>Terdeteksi {disparateCodeSessions.length} Data Sesi Siswa dengan Kode Berbeda</span>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-[10px] font-mono font-bold text-amber-300 border border-amber-500/30">
                  ID: {exam.id}
                </span>
              </div>
              <p className="text-xs text-amber-200/90 leading-relaxed max-w-3xl">
                Siswa mengerjakan soal dari naskah ujian yang sama (ID naskah identik), namun tercatat di Firestore/server dengan kode:{" "}
                <span className="font-mono font-bold text-amber-100 bg-amber-900/60 px-1.5 py-0.5 rounded">
                  {[...new Set(disparateCodeSessions.map((s) => s.examCode))].join(", ")}
                </span>.
                Seluruh data jawaban siswa aman. Klik tombol di samping untuk menyatukan dan menyeragamkan semua rekaman ke kode resmi{" "}
                <span className="font-mono font-bold text-amber-100 bg-amber-900/60 px-1.5 py-0.5 rounded">{exam.code}</span>.
              </p>
            </div>
          </div>
          <button
            onClick={handleReconcileCodes}
            disabled={isReconciling}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-2 transition-all cursor-pointer shrink-0 shadow-md"
            title="Satukan seluruh sesi siswa yang berbeda kode ke kode resmi naskah ini"
          >
            <FolderSync className={`w-4 h-4 ${isReconciling ? "animate-spin" : ""}`} />
            <span>{isReconciling ? "Menyatukan Data..." : "Satukan ke Kode Resmi"}</span>
          </button>
        </div>
      )}

      {/* Summary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#121214] rounded-2xl p-5 border border-slate-800 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>Total Peserta Terdaftar</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">{totalRegistered} Siswa</div>
          <div className="text-[11px] text-slate-500">
            {completedCount} Selesai • {inProgressCount} Mengerjakan • {notStartedCount} Belum
          </div>
        </div>

        <div className="bg-[#121214] rounded-2xl p-5 border border-slate-800 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>Rata-Rata Nilai Sementara</span>
            <Award className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">{averageScore} <span className="text-sm font-normal text-slate-500">/ 100</span></div>
          <div className="text-[11px] text-slate-500">
            Berdasarkan {completedCount} siswa yang sudah submit
          </div>
        </div>

        <div className="bg-[#121214] rounded-2xl p-5 border border-slate-800 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>Tingkat Ketuntasan (KKM)</span>
            <GraduationCap className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">{passRate}%</div>
          <div className="text-[11px] text-slate-500">
            {passedCount} Tuntas • {completedCount - passedCount} Remedial
          </div>
        </div>

        <div className="bg-[#121214] rounded-2xl p-5 border border-slate-800 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <span>Status Sesi & Token</span>
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xl font-bold text-indigo-300 font-mono">{exam.sessionToken}</div>
          <div className="text-[11px] text-emerald-400 font-medium flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Permanen (Aktif Tanpa Batas Waktu)
          </div>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionNotice && (
        <div className="p-3.5 bg-indigo-950/60 border border-indigo-500/40 rounded-2xl flex items-center justify-between text-xs text-indigo-200 animate-in fade-in">
          <div className="flex items-center gap-2 font-medium">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{actionNotice}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Bulk Action Bar (When 1 or more items are selected) */}
      {isSomeSelected && (
        <div className="bg-indigo-950/80 border-2 border-indigo-500/60 rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-sm">
              {selectedIds.size}
            </span>
            <div>
              <div className="text-xs font-bold text-white">
                {selectedIds.size} Siswa Terpilih
              </div>
              <div className="text-[11px] text-indigo-300">
                Pilih aksi pengawas serentak untuk seluruh peserta yang ditandai:
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleBatchForceSubmit}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
              title="Paksa kumpulkan seluruh siswa terpilih yang sedang mengerjakan"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit Terpilih</span>
            </button>

            <button
              onClick={handleBatchResetSessions}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Reset sesi pengerjaan siswa yang dipilih agar bisa mulai tes ulang"
            >
              <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
              <span>Reset Sesi</span>
            </button>

            <button
              onClick={handleBatchPrintPdf}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
              title="Unduh rapor PDF untuk siswa yang sudah selesai"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Unduh Rapor PDF</span>
            </button>

            <button
              onClick={handleBatchDelete}
              className="px-3 py-1.5 bg-rose-600/30 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-500/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Hapus seluruh data siswa dan sesi yang dipilih"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Hapus Terpilih</span>
            </button>

            <button
              onClick={handleClearSelection}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Batal Pilih
            </button>
          </div>
        </div>
      )}

      {/* Filter & Student Table */}
      <div className="bg-[#121214] rounded-2xl border border-slate-800 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#1a1a1c] border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              placeholder="Cari nama siswa atau NISN..."
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleSelectAll}
              className="px-3 py-2 bg-[#1a1a1c] hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {isAllSelected ? <CheckSquare className="w-4 h-4 text-indigo-400" /> : <Square className="w-4 h-4 text-slate-500" />}
              <span>{isAllSelected ? "Lepas Semua" : "Pilih Semua"}</span>
            </button>

            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              className="px-3 py-2 bg-[#1a1a1c] border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option key="all-classes" value="all" className="bg-[#121214]">
                Semua Kelas
              </option>
              {uniqueClasses.map((c) => (
                <option key={`class-filter-${c}`} value={c} className="bg-[#121214]">
                  Kelas {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#1a1a1c] text-slate-400 font-semibold uppercase tracking-wider">
                <th className="py-3 px-3 w-10 text-center">
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    className="p-1 rounded hover:bg-slate-800 cursor-pointer inline-flex items-center justify-center text-slate-400 hover:text-white"
                    title={isAllSelected ? "Batalkan pilihan semua" : "Pilih semua baris"}
                  >
                    {isAllSelected ? <CheckSquare className="w-4 h-4 text-indigo-400" /> : <Square className="w-4 h-4 text-slate-500" />}
                  </button>
                </th>
                <th className="py-3 px-3">No</th>
                <th className="py-3 px-4">Nama Siswa</th>
                <th className="py-3 px-4">NISN & Kelas</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Progres Soal</th>
                <th className="py-3 px-4">Nilai Akhir</th>
                <th className="py-3 px-4 text-right min-w-[200px]">Aksi Pengawas (Pilih, Edit, Hapus)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-normal text-slate-300">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 text-xs">
                    Tidak ada data peserta ujian yang sesuai filter.
                  </td>
                </tr>
              ) : (
                filteredRows.map(({ tokenItem, session }, idx) => {
                  const isSelected = selectedIds.has(tokenItem.id);
                  const isFinished = session?.status === "submitted";
                  const isInProgress = session?.status === "in_progress";
                  const answeredCount = session ? Object.keys(session.answers).length : 0;
                  const totalQ = exam.questions.length;
                  const progressPct = totalQ > 0 ? Math.round((answeredCount / totalQ) * 100) : 0;

                  return (
                    <tr
                      key={tokenItem.id}
                      className={`transition-colors ${
                        isSelected ? "bg-indigo-950/30 hover:bg-indigo-950/40" : "hover:bg-[#1a1a1c]/80"
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleSelectRow(tokenItem.id)}
                          className="p-1 rounded hover:bg-slate-800 cursor-pointer inline-flex items-center justify-center"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-400" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-600 hover:text-slate-400" />
                          )}
                        </button>
                      </td>

                      <td className="py-3.5 px-3 font-mono text-slate-500">{idx + 1}</td>
                      <td className="py-3.5 px-4 font-medium text-white">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{tokenItem.studentName}</span>
                          {(session?.violationCount || session?.cheatViolations?.length || 0) > 0 && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded text-[10px] font-bold"
                              title={`${session?.violationCount || session?.cheatViolations?.length}x terdeteksi berpindah tab / blur window`}
                            >
                              <ShieldAlert className="w-3 h-3 text-rose-400" />
                              <span>{session?.violationCount || session?.cheatViolations?.length}x Tab Switch</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-slate-400">{tokenItem.nisn}</span> •{" "}
                        <span className="font-semibold text-slate-300">{tokenItem.className}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        {isFinished ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-medium text-[11px]">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Selesai</span>
                          </span>
                        ) : isInProgress ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-medium text-[11px] animate-pulse">
                            <Clock className="w-3 h-3" />
                            <span>Sedang Mengerjakan</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-[#1a1a1c] text-slate-400 border border-slate-800 rounded-full font-normal text-[11px]">
                            Belum Mulai
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 min-w-[140px]">
                        {session ? (
                          <div className="space-y-1">
                            <div className="flex justify-between text-[11px]">
                              <span className="text-slate-400">{answeredCount}/{totalQ} Soal</span>
                              <span className="font-semibold text-slate-200">{progressPct}%</span>
                            </div>
                            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  isFinished ? "bg-emerald-500" : "bg-indigo-500"
                                }`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {isFinished ? (
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-white font-mono">
                              {session.percentage}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                session.passed
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              }`}
                            >
                              {session.passed ? "TUNTAS" : "REMEDIAL"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">Menunggu submit</span>
                        )}
                      </td>

                      {/* Supervisor Action Toolbar */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* 1. EDIT BUTTON: Available for all rows */}
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal({ tokenItem, session })}
                            className="p-1.5 bg-[#1e1e24] hover:bg-indigo-600 hover:text-white text-indigo-400 border border-indigo-500/30 rounded-lg transition-all cursor-pointer"
                            title="Edit Data Siswa, Token, Nilai, Status, dan Pelanggaran"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {/* 2. VIEW DETAIL BUTTON: If session exists */}
                          {session && (
                            <button
                              type="button"
                              onClick={() => setSelectedStudentSession(session)}
                              className="p-1.5 text-slate-300 hover:text-white hover:bg-[#1a1a1c] border border-slate-700/60 rounded-lg transition-colors cursor-pointer"
                              title="Lihat Detail Jawaban & Log Integritas"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          )}

                          {/* 3. DOWNLOAD PDF BUTTON: If submitted */}
                          {session && isFinished && (
                            <button
                              type="button"
                              onClick={() => generateStudentExamPdfReport(session, exam, school)}
                              className="p-1.5 text-emerald-400 hover:text-white hover:bg-emerald-600/20 border border-emerald-500/30 rounded-lg transition-colors cursor-pointer"
                              title="Unduh Rapor Hasil Ujian (PDF)"
                            >
                              <FileDown className="w-4 h-4" />
                            </button>
                          )}

                          {/* 4. FORCE SUBMIT: If in progress */}
                          {isInProgress && session && (
                            <button
                              type="button"
                              onClick={() => onForceSubmitStudent(session.id)}
                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[11px] font-semibold cursor-pointer shadow-xs transition-colors flex items-center gap-1"
                              title="Paksa Kumpulkan Lembar Jawaban Siswa Ini"
                            >
                              <Send className="w-3 h-3" />
                              <span>Submit</span>
                            </button>
                          )}

                          {/* 5. RESET SESSION: If session exists or status is not belum_mulai */}
                          {(session || tokenItem.status !== "belum_mulai") && (
                            <button
                              type="button"
                              onClick={() => {
                                const sName = tokenItem.studentName;
                                if (confirm(`Reset sesi pengerjaan siswa "${sName}"? Seluruh jawaban tersimpan akan dikosongkan dan status diubah ke 'Belum Mulai' agar siswa dapat mengulang ujian dari awal.`)) {
                                  onResetStudentSession(session?.id, sName, tokenItem.token, tokenItem.nisn);
                                  showActionFeedback(`Sesi ujian "${sName}" berhasil di-reset menjadi Belum Mulai.`);
                                }
                              }}
                              className="p-1.5 text-amber-400 hover:text-white hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors cursor-pointer"
                              title="Reset Sesi Siswa (Mulai Ulang dari Awal)"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* 6. DELETE BUTTON: Available for all rows */}
                          <button
                            type="button"
                            onClick={() => handleDeleteSingleStudent({ tokenItem, session })}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 border border-slate-800 hover:border-rose-500/30 rounded-lg transition-colors cursor-pointer"
                            title="Hapus Data Siswa & Sesi Ujian"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Student Modal (Live Student Edit) */}
      <LiveStudentEditModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingStudentRow(null);
        }}
        exam={exam}
        studentRow={editingStudentRow}
        onSave={handleSaveStudentEdit}
      />

      {/* Student Detail Modal */}
      {selectedStudentSession && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#121214] rounded-2xl p-6 max-w-2xl w-full border border-slate-800 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white">{selectedStudentSession.studentName}</h3>
                <p className="text-xs text-slate-400 font-mono">
                  {selectedStudentSession.className} • NISN: {selectedStudentSession.nisn}
                </p>
              </div>
              <button
                onClick={() => setSelectedStudentSession(null)}
                className="text-slate-400 hover:text-white font-bold text-base cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3 bg-[#1a1a1c] border border-slate-800 rounded-xl text-center">
              <div>
                <div className="text-[11px] text-slate-400">Nilai Akhir</div>
                <div className="text-xl font-extrabold text-white">{selectedStudentSession.percentage}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Status</div>
                <div className={`text-xs font-semibold mt-1 ${selectedStudentSession.passed ? "text-emerald-400" : "text-rose-400"}`}>
                  {selectedStudentSession.passed ? "TUNTAS (KKM)" : "REMEDIAL"}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Waktu Mulai</div>
                <div className="text-xs font-semibold text-slate-300 mt-1">
                  {new Date(selectedStudentSession.startTime).toLocaleTimeString("id-ID")}
                </div>
              </div>
            </div>

            {/* Integrity / Anti-Cheating Logs */}
            <div className="p-3.5 bg-[#161618] rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  {(selectedStudentSession.violationCount || selectedStudentSession.cheatViolations?.length || 0) > 0 ? (
                    <>
                      <ShieldAlert className="w-4 h-4 text-rose-400" />
                      <span className="text-rose-300">Catatan Pelanggaran Integritas Ujian</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-300">Integritas Pengerjaan: Tertib</span>
                    </>
                  )}
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    (selectedStudentSession.violationCount || selectedStudentSession.cheatViolations?.length || 0) > 0
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                      : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  }`}
                >
                  {(selectedStudentSession.violationCount || selectedStudentSession.cheatViolations?.length || 0)} Pelanggaran
                </span>
              </div>

              {(selectedStudentSession.cheatViolations && selectedStudentSession.cheatViolations.length > 0) ? (
                <div className="space-y-1.5 max-h-32 overflow-y-auto pt-1">
                  {selectedStudentSession.cheatViolations.map((v, i) => (
                    <div
                      key={i}
                      className="p-2 bg-rose-950/30 border border-rose-900/40 rounded-lg text-[11px] flex items-center justify-between text-rose-200"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                        <span>{v.message}</span>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400">
                        {new Date(v.timestamp).toLocaleTimeString("id-ID")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Tidak terdeteksi aktivitas mencurigakan seperti perpindahan tab atau keluar dari mode fokus.
                </p>
              )}
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-xs text-slate-300">Rincian Jawaban per Butir Soal:</h4>
              <div className="space-y-2">
                {exam.questions.map((q, idx) => {
                  const ans = selectedStudentSession.answers[q.id];
                  const isCorrect = ans?.isCorrect || ans?.selectedOption === q.correctAnswer;
                  return (
                    <div
                      key={q.id}
                      className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                        isCorrect ? "bg-emerald-500/5 border-emerald-500/20" : "bg-rose-500/5 border-rose-500/20"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold font-mono text-slate-300">Soal #{idx + 1}:</span>
                        <span className="text-slate-300 line-clamp-1 max-w-sm">{q.questionText}</span>
                      </div>

                      <div className="flex items-center gap-3 font-mono">
                        <span className="text-slate-400 text-[11px]">Jawaban: {ans?.selectedOption || "-"}</span>
                        <span className="text-indigo-400 text-[11px]">Kunci: {q.correctAnswer}</span>
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${isCorrect ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                          {isCorrect ? `+${q.score}` : "0"} Poin
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => generateStudentExamPdfReport(selectedStudentSession, exam, school)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-950 cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Unduh Rapor PDF</span>
                </button>
                <button
                  onClick={() => {
                    const row = studentRows.find((r) => r.session?.id === selectedStudentSession.id);
                    if (row) {
                      setSelectedStudentSession(null);
                      handleOpenEditModal(row);
                    }
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-950 cursor-pointer"
                >
                  <Edit3 className="w-4 h-4" />
                  <span>Edit Nilai & Data</span>
                </button>
              </div>

              <button
                onClick={() => setSelectedStudentSession(null)}
                className="px-5 py-2 bg-[#1a1a1c] hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING TOAST NOTIFICATIONS STACK */}
      <div
        id="monitoring-toast-container"
        className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none"
      >
        {toasts.map((t) => {
          let badgeStyle = "bg-indigo-500/20 text-indigo-300 border-indigo-500/30";
          let icon = <BellRing className="w-4 h-4 text-indigo-400" />;
          let borderStyle = "border-indigo-500/40";

          if (t.type === "start") {
            badgeStyle = "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
            icon = <UserPlus className="w-4 h-4 text-emerald-400" />;
            borderStyle = "border-emerald-500/40";
          } else if (t.type === "submit") {
            badgeStyle = "bg-indigo-500/20 text-indigo-300 border-indigo-500/30";
            icon = <Send className="w-4 h-4 text-indigo-400" />;
            borderStyle = "border-indigo-500/40";
          } else if (t.type === "violation") {
            badgeStyle = "bg-rose-500/20 text-rose-300 border-rose-500/30";
            icon = <ShieldAlert className="w-4 h-4 text-rose-400" />;
            borderStyle = "border-rose-500/50";
          } else if (t.type === "action") {
            badgeStyle = "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
            icon = <Check className="w-4 h-4 text-emerald-400" />;
            borderStyle = "border-emerald-500/40";
          }

          return (
            <div
              key={t.id}
              className={`pointer-events-auto bg-[#161618]/95 backdrop-blur-md border ${borderStyle} rounded-2xl p-4 shadow-2xl space-y-1.5 animate-in slide-in-from-bottom-3 duration-200 transition-all`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg border ${badgeStyle}`}>
                    {icon}
                  </div>
                  <span className="font-bold text-xs text-white">{t.title}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 font-mono">{t.time}</span>
                  <button
                    onClick={() => removeToast(t.id)}
                    className="text-slate-500 hover:text-white p-1 rounded-md hover:bg-slate-800 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{t.message}</p>
            </div>
          );
        })}
      </div>

      {/* Live Notification Event History Drawer */}
      {showToastHistory && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#121214] border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Bell className="w-4 h-4 text-amber-400" />
                <span>Log Aktivitas & Notifikasi Ujian</span>
              </div>
              <button
                onClick={() => setShowToastHistory(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
              {toasts.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs space-y-1">
                  <Bell className="w-8 h-8 mx-auto text-slate-700 mb-2" />
                  <p className="font-semibold text-slate-400">Belum Ada Notifikasi Baru</p>
                  <p>Notifikasi akan muncul saat siswa mulai mengerjakan, submit jawaban, atau terjadi peringatan.</p>
                </div>
              ) : (
                toasts.map((t) => (
                  <div
                    key={t.id}
                    className="p-3 bg-[#18181b] border border-slate-800 rounded-xl space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200">{t.title}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{t.time}</span>
                    </div>
                    <p className="text-slate-400">{t.message}</p>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  addToast({
                    type: "start",
                    title: "Simulasi: Siswa Mulai Ujian",
                    message: "Ahmad Rizki Maulana (X MIPA 1) baru saja login dan mulai mengerjakan ujian.",
                    studentName: "Ahmad Rizki Maulana",
                    className: "X MIPA 1",
                  });
                }}
                className="px-3 py-1.5 bg-[#1a1a1c] hover:bg-slate-800 text-indigo-400 border border-indigo-500/30 rounded-xl text-xs font-semibold cursor-pointer"
              >
                + Tes Simulasi Notifikasi
              </button>

              <button
                type="button"
                onClick={() => setShowToastHistory(false)}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer shadow-md shadow-indigo-950"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
