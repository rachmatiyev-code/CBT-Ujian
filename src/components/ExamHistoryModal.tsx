import React, { useState } from "react";
import {
  History,
  Sparkles,
  BookOpen,
  FileText,
  FileSpreadsheet,
  Printer,
  Play,
  Copy,
  Trash2,
  CheckCircle2,
  Calendar,
  Clock,
  Award,
  Search,
  X,
  Plus,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  HelpCircle,
  CheckSquare,
  Filter,
  Share2,
  Cloud,
  CloudUpload,
  Check,
  ExternalLink,
  RefreshCw
} from "lucide-react";
import { ExamPackage, Question, QuestionType, SchoolProfile } from "../types";
import {
  exportQuestionsToExcel,
  exportQuestionsToWordDoc,
  printFormattedExamDocument,
  calculateBloomAndersonSummary
} from "../utils/sheetExport";
import { DirectStudentShareModal } from "./DirectStudentShareModal";
import { saveExamToGoogleDrive, formatExamDriveFileName } from "../utils/googleDrive";
import { getCachedAccessToken } from "../utils/googleAuth";
import { generateDriveStudentUrl, generateShortStudentUrl } from "../utils/examShareEncoder";
import { saveExamPackages } from "../utils/storage";
import { syncExamToGAS, isGasConfigured } from "../utils/gasService";

interface ExamHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  exams: ExamPackage[];
  activeExamId: string;
  onSelectAndApplyExam: (examId: string, targetTab?: "student_exam" | "ai_generator") => void;
  onDeleteExam: (examId: string) => void;
  onUpdateExam?: (updated: ExamPackage) => void;
  onDuplicateExam: (exam: ExamPackage) => void;
  onCreateNewExam: () => void;
  onClearAllExams?: () => void;
  school: SchoolProfile;
}

export const ExamHistoryModal: React.FC<ExamHistoryModalProps> = ({
  isOpen,
  onClose,
  exams,
  activeExamId,
  onSelectAndApplyExam,
  onDeleteExam,
  onUpdateExam,
  onDuplicateExam,
  onCreateNewExam,
  onClearAllExams,
  school,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSubject, setFilterSubject] = useState<string>("all");
  const [expandedExamId, setExpandedExamId] = useState<string | null>(null);
  const [questionSearch, setQuestionSearch] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [shareExamTarget, setShareExamTarget] = useState<ExamPackage | null>(null);
  const [uploadingExamId, setUploadingExamId] = useState<string | null>(null);
  const [isBatchUploading, setIsBatchUploading] = useState(false);
  const [copiedDriveExamId, setCopiedDriveExamId] = useState<string | null>(null);
  const [copiedStudentExamId, setCopiedStudentExamId] = useState<string | null>(null);

  if (!isOpen) return null;

  const showFeedback = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const handleUploadSingleExamToDrive = async (examItem: ExamPackage) => {
    setUploadingExamId(examItem.id);
    try {
      // 1. Prioritaskan Google Apps Script (100% Bebas Google Cloud & Bebas Firebase)
      if (isGasConfigured()) {
        const gasRes = await syncExamToGAS(examItem, examItem.tokens);
        if (gasRes && gasRes.success) {
          const updatedExam: ExamPackage = {
            ...examItem,
            gdriveSyncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...(gasRes.fileUrl ? { gdriveWebViewLink: gasRes.fileUrl } : {}),
          };
          if (onUpdateExam) {
            onUpdateExam(updatedExam);
          }
          const updatedAll = exams.map((e) => (e.id === updatedExam.id ? updatedExam : e));
          saveExamPackages(updatedAll);
          showFeedback(`✓ Naskah "${examItem.code}" berhasil disimpan di Google Drive (Folder Data Soal) & Sheets via Apps Script!`);
          return;
        }
      }

      // 2. Jika ada token Drive aktif yang tersimpan
      const tokenToUse = getCachedAccessToken();
      if (tokenToUse) {
        const res = await saveExamToGoogleDrive(tokenToUse, examItem);
        const updatedExam: ExamPackage = {
          ...examItem,
          gdriveFileId: res.fileId,
          gdriveFileName: res.fileName,
          gdriveWebViewLink: res.webViewLink,
          gdriveDownloadLink: res.downloadUrl,
          gdriveSyncedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        if (onUpdateExam) {
          onUpdateExam(updatedExam);
        }
        const updatedAll = exams.map((e) => (e.id === updatedExam.id ? updatedExam : e));
        saveExamPackages(updatedAll);
        showFeedback(`✓ Naskah "${examItem.code}" tersimpan di Drive (Folder SlideExam_CBT) dengan nama: ${res.fileName}`);
        return;
      }

      // 3. Jika belum terhubung ke Google Apps Script
      showFeedback("⚠️ URL Google Apps Script belum disetel. Atur Web App URL di menu 'Integrasi Google Apps Script & Sheets' (100% Bebas Google Cloud / OAuth) untuk menyimpan naskah ke Google Drive.");
    } catch (err: any) {
      console.warn("Upload to Google Drive error:", err);
      showFeedback(`❌ Gagal mengunggah naskah "${examItem.code}": ${err?.message || "Terjadi kesalahan"}`);
    } finally {
      setUploadingExamId(null);
    }
  };

  const handleCopyStudentLink = (examItem: ExamPackage) => {
    const currentUrl = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
    const baseUrl = currentUrl.endsWith("/") ? currentUrl.slice(0, -1) : currentUrl;
    const studentUrl = generateShortStudentUrl(baseUrl, examItem, examItem.sessionToken);
    navigator.clipboard.writeText(studentUrl);
    setCopiedStudentExamId(examItem.id);
    showFeedback(`✓ Link Mode Siswa (?mode=student&code=${examItem.code}) berhasil disalin!`);
    setTimeout(() => setCopiedStudentExamId(null), 3000);
  };

  const handleCopyDriveLink = (examItem: ExamPackage) => {
    const currentUrl = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
    const baseUrl = currentUrl.endsWith("/") ? currentUrl.slice(0, -1) : currentUrl;
    const driveUrl = generateDriveStudentUrl(baseUrl, examItem, examItem.sessionToken);
    navigator.clipboard.writeText(driveUrl);
    setCopiedDriveExamId(examItem.id);
    showFeedback(`✓ Link Google Drive untuk naskah "${examItem.code}" tersalin! Siswa otomatis me-load dari Drive.`);
    setTimeout(() => setCopiedDriveExamId(null), 3000);
  };

  const handleBatchUploadToDrive = async () => {
    if (exams.length === 0) return;
    setIsBatchUploading(true);
    try {
      if (!isGasConfigured() && !getCachedAccessToken()) {
        showFeedback("⚠️ URL Google Apps Script belum disetel. Atur Web App URL di menu 'Integrasi Google Apps Script & Sheets' (100% Bebas Google Cloud / OAuth) untuk menyimpan seluruh naskah ke Google Drive.");
        return;
      }

      let successCount = 0;
      let currentExamsList = [...exams];
      const tokenToUse = getCachedAccessToken();

      for (let i = 0; i < currentExamsList.length; i++) {
        const item = currentExamsList[i];
        try {
          showFeedback(`Menyimpan (${i + 1}/${currentExamsList.length}) ke Google Drive: ${item.code}...`);
          if (isGasConfigured()) {
            const gasRes = await syncExamToGAS(item, item.tokens);
            if (gasRes && gasRes.success) {
              const updated: ExamPackage = {
                ...item,
                gdriveSyncedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ...(gasRes.fileUrl ? { gdriveWebViewLink: gasRes.fileUrl } : {}),
              };
              currentExamsList[i] = updated;
              if (onUpdateExam) onUpdateExam(updated);
              successCount++;
              continue;
            }
          }

          if (tokenToUse) {
            const res = await saveExamToGoogleDrive(tokenToUse, item);
            const updated: ExamPackage = {
              ...item,
              gdriveFileId: res.fileId,
              gdriveFileName: res.fileName,
              gdriveWebViewLink: res.webViewLink,
              gdriveDownloadLink: res.downloadUrl,
              gdriveSyncedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            currentExamsList[i] = updated;
            if (onUpdateExam) onUpdateExam(updated);
            successCount++;
          }
        } catch (subErr) {
          console.warn("Failed item upload:", item.code, subErr);
        }
      }

      saveExamPackages(currentExamsList);
      showFeedback(`✓ Selesai! ${successCount} dari ${currentExamsList.length} naskah berhasil disimpan ke Google Drive!`);
    } catch (err: any) {
      showFeedback(`❌ Batch upload gagal: ${err?.message || "Terjadi kesalahan"}`);
    } finally {
      setIsBatchUploading(false);
    }
  };

  // Calculate total questions across all exams in bank
  const totalQuestionsInBank = exams.reduce((acc, e) => acc + (e.questions?.length || 0), 0);

  // Unique subjects
  const subjects = Array.from(new Set(exams.map((e) => e.teacherProfile?.subject).filter(Boolean)));

  const filteredExams = exams.filter((e) => {
    const matchesSearch =
      e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.teacherProfile?.subject || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.teacherProfile?.teacherName || "").toLowerCase().includes(searchQuery.toLowerCase());

    const matchesSubject = filterSubject === "all" || e.teacherProfile?.subject === filterSubject;

    return matchesSearch && matchesSubject;
  });

  // Handle deleting a single question from an exam package
  const handleDeleteQuestion = (
    examItem: ExamPackage,
    questionId: string,
    questionIndex: number,
    questionText: string
  ) => {
    const promptSnippet = questionText.length > 50 ? questionText.slice(0, 50) + "..." : questionText;
    if (
      !window.confirm(
        `Hapus butir soal No. ${questionIndex + 1} ("${promptSnippet}") dari naskah "${examItem.title}"?`
      )
    ) {
      return;
    }

    const updatedQuestions = examItem.questions.filter((q) => q.id !== questionId);
    const newTotalScore = updatedQuestions.reduce((sum, q) => sum + (q.score || 0), 0);

    const updatedExam: ExamPackage = {
      ...examItem,
      questions: updatedQuestions,
      totalScore: newTotalScore,
      updatedAt: new Date().toISOString(),
    };

    if (onUpdateExam) {
      onUpdateExam(updatedExam);
    }

    showFeedback(
      `✓ Soal No. ${questionIndex + 1} berhasil dihapus dari naskah ${examItem.code}. (Tersisa ${updatedQuestions.length} soal)`
    );
  };

  // Handle clearing all questions in an exam package
  const handleClearAllQuestions = (examItem: ExamPackage) => {
    if (examItem.questions.length === 0) return;

    if (
      !window.confirm(
        `PERINGATAN: Kosongkan seluruh ${examItem.questions.length} butir soal pada naskah "${examItem.title}" (${examItem.code})? Tindakan ini tidak dapat dibatalkan.`
      )
    ) {
      return;
    }

    const updatedExam: ExamPackage = {
      ...examItem,
      questions: [],
      totalScore: 0,
      updatedAt: new Date().toISOString(),
    };

    if (onUpdateExam) {
      onUpdateExam(updatedExam);
    }

    showFeedback(`✓ Seluruh butir soal dalam naskah ${examItem.code} telah dikosongkan.`);
  };

  // Handle deleting an exam package
  const handleDeleteExam = (examItem: ExamPackage) => {
    if (
      !window.confirm(
        `Hapus naskah ujian "${examItem.title}" (${examItem.code}) beserta seluruh ${examItem.questions.length} butir soalnya dari Bank Naskah?`
      )
    ) {
      return;
    }

    onDeleteExam(examItem.id);
    showFeedback(`✓ Naskah "${examItem.title}" (${examItem.code}) berhasil dihapus.`);
  };

  // Format question type badge label
  const getQuestionTypeLabel = (type: QuestionType) => {
    switch (type) {
      case "pilihan_ganda":
        return "Pilihan Ganda";
      case "pilihan_ganda_kompleks":
        return "PG Kompleks";
      case "benar_salah":
        return "Benar / Salah";
      case "isian_singkat":
        return "Isian Singkat";
      case "uraian":
        return "Uraian / Esai";
      case "menjodohkan":
        return "Menjodohkan";
      default:
        return "Soal";
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-[#121214] border border-slate-700 rounded-3xl max-w-5xl w-full flex flex-col shadow-2xl overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-[#161618]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-2xl">
              <History className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <span>Riwayat & Bank Naskah Soal Ujian</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
                  {exams.length} Naskah • {totalQuestionsInBank} Total Soal
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Kelola naskah, cetak dokumen Word ber-kisi-kisi / Excel / PDF, kelola & hapus butir soal, atau aktifkan ke Slide CBT.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Controls & Filters */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-[#141416] flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 w-full sm:w-auto flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari judul ujian, kode naskah, mapel, atau guru..."
                className="w-full bg-[#18181b] text-slate-200 text-xs rounded-xl pl-9 pr-3 py-2.5 border border-slate-700 focus:outline-none focus:border-indigo-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {subjects.length > 1 && (
              <select
                value={filterSubject}
                onChange={(e) => setFilterSubject(e.target.value)}
                className="bg-[#18181b] text-slate-200 text-xs rounded-xl px-3 py-2.5 border border-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer shrink-0"
              >
                <option key="all-subjects" value="all">Semua Mapel</option>
                {subjects.map((sub) => (
                  <option key={`sub-${sub}`} value={sub}>
                    {sub}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 flex-wrap">
            {exams.length > 0 && (
              <button
                type="button"
                disabled={isBatchUploading}
                onClick={handleBatchUploadToDrive}
                className="px-3.5 py-2.5 bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                title="Unggah seluruh naskah di riwayat ke Google Drive (Subfolder: SlideExam_CBT/Backup_Data_Aplikasi) dengan format nama: kelas_mata pelajaran_kode soal"
              >
                {isBatchUploading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                    <span>Mencadangkan ke Drive...</span>
                  </>
                ) : (
                  <>
                    <CloudUpload className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Unggah Semua ke Drive</span>
                  </>
                )}
              </button>
            )}

            {onClearAllExams && exams.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClearAllExams();
                  showFeedback("Seluruh riwayat dan bank naskah soal telah dikosongkan.");
                }}
                className="px-3 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/20 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                title="Kosongkan seluruh riwayat dan bank naskah soal"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Kosongkan Bank</span>
              </button>
            )}

            <button
              onClick={() => {
                onCreateNewExam();
                onClose();
              }}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-950 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Buat Naskah Baru</span>
            </button>
          </div>
        </div>

        {/* Feedback Toast */}
        {successMsg && (
          <div className="mx-6 mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in shadow-lg shadow-emerald-950/20">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Exam Cards List */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {filteredExams.length === 0 ? (
            <div className="text-center py-12 bg-[#161618] border border-slate-800 rounded-3xl p-6">
              <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-slate-300 mb-1">Tidak Ada Naskah Soal Ditemukan</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
                {searchQuery
                  ? "Tidak ada riwayat naskah soal yang cocok dengan kata kunci pencarian Anda."
                  : "Belum ada paket naskah soal tersimpan. Klik tombol Buat Naskah Baru untuk memulai."}
              </p>
              <button
                onClick={() => {
                  onCreateNewExam();
                  onClose();
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Buat Naskah Sekarang
              </button>
            </div>
          ) : (
            filteredExams.map((examItem) => {
              const isActive = examItem.id === activeExamId;
              const isExpanded = expandedExamId === examItem.id;
              const bloom = calculateBloomAndersonSummary(examItem.questions || []);

              // Filter questions inside expanded view
              const displayedQuestions = (examItem.questions || []).filter((q) => {
                if (!questionSearch.trim()) return true;
                return (
                  q.questionText.toLowerCase().includes(questionSearch.toLowerCase()) ||
                  q.options.some((opt) => opt.text.toLowerCase().includes(questionSearch.toLowerCase()))
                );
              });

              return (
                <div
                  key={examItem.id}
                  className={`rounded-2xl border transition-all overflow-hidden ${
                    isActive
                      ? "bg-[#141418] border-indigo-500/50 shadow-md shadow-indigo-950/40"
                      : "bg-[#161618] border-slate-800 hover:border-slate-700"
                  }`}
                >
                  {/* Card Header & Overview */}
                  <div className="p-5">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Info Column */}
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-black text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-md border border-emerald-500/20">
                            {examItem.code}
                          </span>
                          <h3 className="text-base font-black text-white flex items-center gap-2">
                            <span>{examItem.title}</span>
                          </h3>
                          {isActive && (
                            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-extrabold border border-emerald-500/30 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Sedang Aktif</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2.5 text-xs text-slate-400 flex-wrap">
                          <span className="font-semibold text-slate-200">
                            {examItem.teacherProfile?.subject || "Mata Pelajaran"}
                          </span>
                          <span>•</span>
                          <span className="text-cyan-300 font-semibold">{examItem.teacherProfile?.gradeLevel || "Kelas"}</span>
                          <span>•</span>
                          <span className="text-emerald-300 font-semibold">TP: {examItem.teacherProfile?.academicYear || "2025/2026"}</span>
                          <span>•</span>
                          <span className="text-amber-300 font-semibold">Sem: {examItem.teacherProfile?.semester || "Ganjil"}</span>
                          <span>•</span>
                          <span>Guru: {examItem.teacherProfile?.teacherName || "Pengampu"}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1 text-slate-300">
                            <Clock className="w-3.5 h-3.5 text-amber-400" />
                            {examItem.durationMinutes || 60} Menit
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1 text-slate-300">
                            <Award className="w-3.5 h-3.5 text-indigo-400" />
                            {examItem.questions?.length || 0} Soal ({examItem.totalScore || 0} Poin)
                          </span>
                        </div>

                        {/* Bloom Anderson Distribution Pills */}
                        <div className="flex items-center gap-2 text-[11px] pt-1 flex-wrap">
                          <span className="text-slate-500">Taksonomi:</span>
                          <span className="px-2 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded font-semibold">
                            HOTS {bloom.hotsPercent}%
                          </span>
                          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded font-semibold">
                            MOTS {bloom.motsPercent}%
                          </span>
                          <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded font-semibold">
                            LOTS {bloom.lotsPercent}%
                          </span>
                          <span className="text-[10px] text-slate-500 ml-auto">
                            Diperbarui:{" "}
                            {new Date(examItem.updatedAt || Date.now()).toLocaleDateString("id-ID", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>

                        {/* Student Mode Link Button & Google Drive Status */}
                        <div className="flex items-center gap-2 text-[11px] pt-1 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleCopyStudentLink(examItem)}
                            className="text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 cursor-pointer bg-amber-950/40 hover:bg-amber-900/50 px-2.5 py-1 rounded-md border border-amber-500/30 text-[10px] transition-colors"
                            title="Salin Link Mode Siswa Aplikasi (?mode=student&code=...)"
                          >
                            {copiedStudentExamId === examItem.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-300 font-bold">Link Siswa Tersalin!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Salin Link Mode Siswa</span>
                              </>
                            )}
                          </button>

                          {examItem.gdriveFileId ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 font-mono text-[10px]">
                                <Cloud className="w-3 h-3 text-cyan-400" />
                                <span>Drive: {examItem.gdriveFileName || formatExamDriveFileName(examItem)}</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyDriveLink(examItem)}
                                className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 cursor-pointer bg-cyan-950/40 hover:bg-cyan-900/50 px-2 py-0.5 rounded-md border border-cyan-500/20 text-[10px] transition-colors"
                                title="Salin Link Siswa yang langsung me-load dari Google Drive"
                              >
                                {copiedDriveExamId === examItem.id ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    <span className="text-emerald-300 font-bold">Link Drive Tersalin!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Salin Link Siswa Drive</span>
                                  </>
                                )}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
                              <span>Format File:</span>
                              <span className="font-mono text-cyan-400/90">{formatExamDriveFileName(examItem)}</span>
                              <span className="text-slate-500">(Subfolder: Backup_Data_Aplikasi)</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons Column */}
                      <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0 shrink-0">
                        {/* Apply & Launch to CBT Slides */}
                        <button
                          onClick={() => {
                            onSelectAndApplyExam(examItem.id, "student_exam");
                            showFeedback(`✓ Naskah "${examItem.title}" berhasil diaktifkan ke Slide CBT!`);
                            setTimeout(onClose, 600);
                          }}
                          className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm ${
                            isActive
                              ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950"
                              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-950"
                          }`}
                          title="Terapkan naskah ini langsung di Slide CBT Siswa"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Terapkan ke CBT</span>
                        </button>

                        {/* Upload / Sync to Google Drive */}
                        <button
                          type="button"
                          disabled={uploadingExamId === examItem.id || isBatchUploading}
                          onClick={() => handleUploadSingleExamToDrive(examItem)}
                          className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm disabled:opacity-50 ${
                            examItem.gdriveFileId
                              ? "bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-500/30"
                              : "bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/20"
                          }`}
                          title={`Unggah ke Google Drive (Subfolder Backup_Data_Aplikasi) dengan nama: ${formatExamDriveFileName(examItem)}`}
                        >
                          {uploadingExamId === examItem.id ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                              <span>Mengunggah...</span>
                            </>
                          ) : (
                            <>
                              <CloudUpload className="w-3.5 h-3.5 text-cyan-400" />
                              <span>{examItem.gdriveFileId ? "Perbarui di Drive" : "Unggah ke Drive"}</span>
                            </>
                          )}
                        </button>

                        {/* Edit in AI Generator */}
                        <button
                          onClick={() => {
                            onSelectAndApplyExam(examItem.id, "ai_generator");
                            onClose();
                          }}
                          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                          title="Buka dan edit butir soal di Editor Soal & AI Gemini"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Buka Editor</span>
                        </button>

                        {/* Direct Share Link to Students */}
                        <button
                          onClick={() => {
                            setShareExamTarget(examItem);
                          }}
                          className="px-3 py-2 bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
                          title="Buat dan bagikan link ujian / barcode QR langsung untuk siswa"
                        >
                          <Share2 className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Bagikan Link</span>
                        </button>

                        {/* Toggle Question List to Manage & Delete Questions */}
                        <button
                          onClick={() => {
                            setExpandedExamId(isExpanded ? null : examItem.id);
                            setQuestionSearch("");
                          }}
                          className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                            isExpanded
                              ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                              : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700"
                          }`}
                          title="Buka daftar butir soal untuk menghapus butir soal tertentu atau melihat rincian"
                        >
                          <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Kelola Butir Soal ({examItem.questions?.length || 0})</span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-indigo-300" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                          )}
                        </button>

                        {/* Export Word (.doc) */}
                        <button
                          onClick={() => {
                            exportQuestionsToWordDoc(examItem, school, true, true);
                            showFeedback(`✓ Naskah Word (.doc) "${examItem.title}" ber-kisi-kisi berhasil diunduh!`);
                          }}
                          className="p-2 bg-slate-800 hover:bg-slate-700 text-indigo-400 border border-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                          title="Download Dokumen Word (.doc) ber-kisi-kisi"
                        >
                          <FileText className="w-4 h-4" />
                        </button>

                        {/* Export Excel (.xlsx) */}
                        <button
                          onClick={() => {
                            exportQuestionsToExcel(examItem, school);
                            showFeedback(`✓ File Excel (.xlsx) "${examItem.title}" berhasil diunduh!`);
                          }}
                          className="p-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                          title="Download Spreadsheet Excel (.xlsx) 3 Sheet"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                        </button>

                        {/* Print PDF / Print Window */}
                        <button
                          onClick={() => {
                            printFormattedExamDocument(examItem, school, {
                              includeAnswerKey: true,
                              includeMatrix: true,
                            });
                          }}
                          className="p-2 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                          title="Cetak Naskah + Matriks Kisi-Kisi Bloom & Anderson"
                        >
                          <Printer className="w-4 h-4" />
                        </button>

                        {/* Duplicate Exam Package */}
                        <button
                          onClick={() => {
                            onDuplicateExam(examItem);
                            showFeedback(`✓ Naskah "${examItem.title}" berhasil diduplikat!`);
                          }}
                          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                          title="Duplikat Naskah Soal ini"
                        >
                          <Copy className="w-4 h-4" />
                        </button>

                        {/* Delete Exam Package Button */}
                        <button
                          onClick={() => handleDeleteExam(examItem)}
                          className="p-2 bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/40 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                          title="Hapus naskah soal ini dari Bank Naskah"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expandable Section: Detail & Delete Individual Questions */}
                  {isExpanded && (
                    <div className="border-t border-slate-800 bg-[#0d0d0f] p-5 space-y-4 animate-in fade-in">
                      {/* Top Bar for Questions Management */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[#161618] p-3.5 rounded-xl border border-slate-800">
                        <div className="flex items-center gap-2">
                          <CheckSquare className="w-4 h-4 text-indigo-400" />
                          <span className="text-xs font-bold text-white">
                            Daftar Butir Soal ({examItem.questions?.length || 0} Soal)
                          </span>
                          <span className="text-[11px] text-slate-400">
                            • Total Skor: {examItem.totalScore || 0} Poin
                          </span>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                          {/* Search within questions */}
                          {(examItem.questions?.length || 0) > 3 && (
                            <div className="relative flex-1 sm:w-56">
                              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                value={questionSearch}
                                onChange={(e) => setQuestionSearch(e.target.value)}
                                placeholder="Cari teks butir soal..."
                                className="w-full bg-[#1e1e24] text-slate-200 text-[11px] rounded-lg pl-8 pr-2.5 py-1.5 border border-slate-700 focus:outline-none focus:border-indigo-500"
                              />
                            </div>
                          )}

                          {/* Clear All Questions Button */}
                          {(examItem.questions?.length || 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => handleClearAllQuestions(examItem)}
                              className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                              title="Hapus / Kosongkan seluruh butir soal dalam naskah ini"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Hapus Semua Soal</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Question Items List */}
                      {displayedQuestions.length === 0 ? (
                        <div className="text-center py-8 bg-[#141416] border border-slate-800/80 rounded-xl p-4">
                          <p className="text-xs text-slate-400">
                            {(examItem.questions?.length || 0) === 0
                              ? "Naskah ini belum memiliki butir soal. Klik 'Buka Editor' untuk menambahkan soal atau buat dengan AI Gemini."
                              : "Tidak ada butir soal yang cocok dengan pencarian."}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                          {displayedQuestions.map((q, idx) => {
                            const originalIdx = (examItem.questions || []).findIndex((item) => item.id === q.id);
                            const actualIndex = originalIdx >= 0 ? originalIdx : idx;

                            return (
                              <div
                                key={q.id || idx}
                                className="p-3.5 bg-[#16161a] hover:bg-[#1a1a1f] border border-slate-800 rounded-xl transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                              >
                                <div className="space-y-1.5 flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                                    <span className="px-2 py-0.5 rounded font-black font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                      No. {actualIndex + 1}
                                    </span>
                                    <span className="px-2 py-0.5 rounded font-medium bg-slate-800 text-slate-300 border border-slate-700">
                                      {getQuestionTypeLabel(q.type)}
                                    </span>
                                    {q.bloomTaxonomy && (
                                      <span className="px-2 py-0.5 rounded font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                        {q.bloomTaxonomy}
                                      </span>
                                    )}
                                    <span className="px-2 py-0.5 rounded font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                                      {q.score || 10} Poin
                                    </span>
                                  </div>

                                  <p className="text-xs text-slate-200 line-clamp-2 leading-relaxed">
                                    {q.questionText}
                                  </p>

                                  {/* Quick options count or short preview */}
                                  {q.options && q.options.length > 0 && (
                                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-0.5">
                                      <span className="text-slate-500">Pilihan:</span>
                                      {q.options.map((opt) => (
                                        <span
                                          key={opt.key}
                                          className={`px-1.5 py-0.2 rounded font-mono text-[10px] ${
                                            opt.isCorrect
                                              ? "bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40"
                                              : "bg-slate-800 text-slate-400"
                                          }`}
                                        >
                                          {opt.key}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* Delete Question Button */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteQuestion(examItem, q.id, actualIndex, q.questionText)
                                  }
                                  className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 self-end sm:self-center"
                                  title={`Hapus butir soal nomor ${actualIndex + 1}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Hapus Soal</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-800 bg-[#161618] flex items-center justify-between">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>Total {exams.length} paket naskah tersimpan di penyimpanan browser.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* Direct Student Share Modal for Selected Exam */}
      {shareExamTarget && (
        <DirectStudentShareModal
          isOpen={!!shareExamTarget}
          onClose={() => setShareExamTarget(null)}
          exam={shareExamTarget}
          token={shareExamTarget.sessionToken}
          allExams={exams}
          onSelectExam={(e) => setShareExamTarget(e)}
        />
      )}
    </div>
  );
};
