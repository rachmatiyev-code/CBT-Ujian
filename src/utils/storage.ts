import { AppBackupData, AppStateBackup, ExamPackage, SchoolProfile, StudentExamSession, StudentTokenItem } from "../types";
import { defaultSchoolProfile, sampleInitialExam, sampleInitialHistory, sampleInitialTokens } from "../data/initialData";

const STORAGE_KEYS = {
  SCHOOL_PROFILE: "slide_exam_school_profile_v1",
  EXAMS: "slide_exam_packages_v1",
  ACTIVE_EXAM_ID: "slide_exam_active_id_v1",
  HISTORY: "slide_exam_history_v1",
  TOKENS: "slide_exam_tokens_v1",
  CURRENT_STUDENT_SESSION: "slide_exam_current_student_session_v1",
  BACKUP_HISTORY_LOG: "slide_exam_backup_logs_v1",
  GEMINI_API_KEY: "slide_exam_gemini_api_key_v1",
};

export const getCustomGeminiApiKey = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY) || "";
  } catch (e) {
    console.error("Failed to load custom Gemini API key", e);
    return "";
  }
};

export const saveCustomGeminiApiKey = (key: string): void => {
  try {
    if (!key.trim()) {
      localStorage.removeItem(STORAGE_KEYS.GEMINI_API_KEY);
    } else {
      localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, key.trim());
    }
  } catch (e) {
    console.error("Failed to save custom Gemini API key", e);
  }
};

export const removeCustomGeminiApiKey = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEYS.GEMINI_API_KEY);
  } catch (e) {
    console.error("Failed to remove custom Gemini API key", e);
  }
};

export const getGeminiRequestHeaders = (): Record<string, string> => {
  const customKey = getCustomGeminiApiKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (customKey) {
    headers["x-gemini-api-key"] = customKey;
  }
  return headers;
};

export const getSchoolProfile = (): SchoolProfile => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SCHOOL_PROFILE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.email || parsed.email.includes("belajar.id") || parsed.email.includes("sman-nusantaraunggul.sch.id")) {
        parsed.email = "rachmatiyev@gmail.com";
        localStorage.setItem(STORAGE_KEYS.SCHOOL_PROFILE, JSON.stringify(parsed));
      }
      return parsed;
    }
  } catch (e) {
    console.error("Failed to load school profile", e);
  }
  return defaultSchoolProfile;
};
export const getStoredSchoolProfile = getSchoolProfile;

export const saveSchoolProfile = (profile: SchoolProfile) => {
  if (profile.email && profile.email.includes("belajar.id")) {
    profile.email = "rachmatiyev@gmail.com";
  }
  localStorage.setItem(STORAGE_KEYS.SCHOOL_PROFILE, JSON.stringify(profile));
};

export const getExamPackages = (): ExamPackage[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.EXAMS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error("Failed to load exams", e);
  }
  return [sampleInitialExam];
};
export const getStoredExams = getExamPackages;

export const saveExamPackages = (exams: ExamPackage[]) => {
  localStorage.setItem(STORAGE_KEYS.EXAMS, JSON.stringify(exams));
};
export const saveExams = saveExamPackages;

export const getActiveExamId = (): string => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_EXAM_ID);
    if (saved) return saved;
  } catch (e) {
    console.error("Failed to load active exam id", e);
  }
  return sampleInitialExam.id;
};

export const saveActiveExamId = (id: string) => {
  localStorage.setItem(STORAGE_KEYS.ACTIVE_EXAM_ID, id);
};

export const createNewExamPackage = (title: string = "Ujian Baru"): ExamPackage => {
  const newId = `exam-${Date.now()}`;
  const code = "EXAM-" + Math.floor(100 + Math.random() * 900);
  const sessionToken = "TOKEN" + Math.floor(10 + Math.random() * 90);
  const existingExams = getExamPackages();
  const school = getSchoolProfile();
  const lastTeacher = existingExams[0]?.teacherProfile || sampleInitialExam.teacherProfile;

  // Inherit student roster from existing tokens so student dropdown is populated immediately
  const existingTokens = existingExams.find((e) => e.tokens && e.tokens.length > 0)?.tokens || getStudentTokens();
  const initialTokens = Array.isArray(existingTokens) && existingTokens.length > 0
    ? existingTokens.map((t, idx) => ({
        ...t,
        id: `tok-${newId}-${idx + 1}-${Math.random().toString(36).substr(2, 4)}`,
        examCode: code,
      }))
    : undefined;

  return {
    id: newId,
    code,
    title,
    schoolProfile: school,
    tokens: initialTokens,
    teacherProfile: {
      teacherName: lastTeacher.teacherName || "Guru Pengampu",
      teacherNIP: lastTeacher.teacherNIP || "-",
      email: lastTeacher.email || "rachmatiyev@gmail.com",
      subject: lastTeacher.subject || "Mata Pelajaran",
      subjectCode: lastTeacher.subjectCode || code,
      gradeLevel: lastTeacher.gradeLevel || "Kelas X",
      academicYear: lastTeacher.academicYear || "2025/2026",
      semester: lastTeacher.semester || "Ganjil",
      passingGrade: lastTeacher.passingGrade || 75,
      durationMinutes: lastTeacher.durationMinutes || 45,
    },
    questions: [
      {
        id: `q-${Date.now()}-1`,
        questionNumber: 1,
        stimulus: "Perhatikan stimulus kasus berikut untuk menjawab pertanyaan nomor 1.",
        questionText: "Pertanyaan pertama pada naskah ujian baru ini.",
        type: "pilihan_ganda",
        options: [
          { key: "A", text: "Pilihan A" },
          { key: "B", text: "Pilihan B" },
          { key: "C", text: "Pilihan C" },
          { key: "D", text: "Pilihan D" },
          { key: "E", text: "Pilihan E" },
        ],
        correctAnswer: "A",
        score: 20,
        explanation: "Pembahasan untuk pertanyaan nomor 1.",
        cognitiveLevel: "C3 - Aplikasi",
        topicTag: "Topik Pembahasan 1",
      },
    ],
    totalScore: 20,
    durationMinutes: 45,
    sessionToken,
    tokenCreatedAt: new Date().toISOString(),
    isTokenActive: true,
    allowReviewExplanation: true,
    shuffleQuestions: false,
    shuffleOptions: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const getExamHistory = (): StudentExamSession[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error("Failed to load history", e);
  }
  return sampleInitialHistory;
};
export const getStoredHistory = getExamHistory;

export const saveExamHistory = (history: StudentExamSession[]) => {
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
};
export const saveHistory = saveExamHistory;

export const addExamSessionResult = (session: StudentExamSession) => {
  const current = getExamHistory();
  const filtered = current.filter((s) => s.id !== session.id);
  const updated = [session, ...filtered];
  saveExamHistory(updated);
  return updated;
};

export const getStudentTokens = (): StudentTokenItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TOKENS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error("Failed to load tokens", e);
  }
  return sampleInitialTokens;
};
export const getStoredTokens = getStudentTokens;

export const saveStudentTokens = (tokens: StudentTokenItem[]) => {
  localStorage.setItem(STORAGE_KEYS.TOKENS, JSON.stringify(tokens));
};
export const saveTokens = saveStudentTokens;

export const getActiveStudentSession = (): StudentExamSession | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_STUDENT_SESSION);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to load active student session", e);
  }
  return null;
};
export const getStoredActiveStudentSession = getActiveStudentSession;

export const saveActiveStudentSession = (session: StudentExamSession | null) => {
  if (!session) {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_STUDENT_SESSION);
  } else {
    localStorage.setItem(STORAGE_KEYS.CURRENT_STUDENT_SESSION, JSON.stringify(session));
  }
};

export const createFullAppBackup = (): AppStateBackup => {
  return {
    version: "1.0.0",
    appName: "SlideExam CBT & AI Analyzer",
    backupDate: new Date().toISOString(),
    schoolProfile: getSchoolProfile(),
    exams: getExamPackages(),
    history: getExamHistory(),
    studentTokens: getStudentTokens(),
  };
};
export const generateBackupPackage = createFullAppBackup;

export const restoreFullAppBackup = (data: any): boolean => {
  if (!data || typeof data !== "object") return false;
  try {
    if (data.schoolProfile) saveSchoolProfile(data.schoolProfile);
    if (Array.isArray(data.exams) && data.exams.length > 0) saveExamPackages(data.exams);
    if (Array.isArray(data.history)) saveExamHistory(data.history);
    if (Array.isArray(data.studentTokens)) saveStudentTokens(data.studentTokens);
    return true;
  } catch (e) {
    console.error("Restore failed:", e);
    return false;
  }
};
export const restoreBackupPackage = restoreFullAppBackup;

export const resetToDefaultData = () => {
  saveSchoolProfile(defaultSchoolProfile);
  saveExamPackages([sampleInitialExam]);
  saveActiveExamId(sampleInitialExam.id);
  saveExamHistory(sampleInitialHistory);
  saveStudentTokens(sampleInitialTokens);
  saveActiveStudentSession(null);
};
