export interface SchoolProfile {
  schoolName: string;
  npsn: string;
  agencyName: string; // e.g. "PEMERINTAH PROVINSI JAWA TIMUR / DINAS PENDIDIKAN"
  address: string;
  postalCode: string;
  phone: string;
  email: string;
  website: string;
  principalName: string;
  principalNIP: string;
  logoLeftUrl?: string; // e.g. Logo Dinas / Tut Wuri Handayani
  logoRightUrl?: string; // e.g. Logo Sekolah
  kopSuratUrl?: string; // Banner kop surat lengkap resmi sekolah (menggantikan logo default & kop teks jika diunggah)
  motto?: string;
}

export interface TeacherProfile {
  teacherName: string;
  teacherNIP: string;
  email?: string;
  subject: string;
  subjectCode: string;
  gradeLevel: string;
  academicYear: string;
  semester: "Ganjil" | "Genap";
  passingGrade: number; // KKM (misal 75)
  durationMinutes: number;
}

export interface QuestionOption {
  key: string; // "A" | "B" | "C" | "D" | "E"
  text: string;
}

export interface MatchingPair {
  id: string;
  left: string; // e.g. "Mitokondria" atau "Revolusi Industri 1.0"
  right: string; // e.g. "Penghasil Energi Sel (ATP)" atau "Penemuan Mesin Uap"
}

export type QuestionType =
  | "pilihan_ganda"
  | "menjodohkan"
  | "isian_singkat"
  | "uraian"
  | "pilihan_ganda_kompleks"
  | "benar_salah";

export interface Question {
  id: string;
  questionNumber: number;
  stimulus?: string; // Teks bacaan/cerita/tabel pendukung
  imageUrl?: string; // Gambar pendukung (URL, Base64, atau AI Generated)
  imageCaption?: string; // Keterangan gambar (e.g. "Gambar 1.1 Struktur Organel Sel")
  imagePrompt?: string; // Prompt yang digunakan saat generate gambar dengan AI
  questionText: string;
  type: QuestionType;
  options: QuestionOption[]; // Digunakan untuk pilihan_ganda / benar_salah
  matchingPairs?: MatchingPair[]; // Digunakan untuk tipe soal menjodohkan
  correctAnswer: string; // "A", atau teks jawaban isian singkat, atau format pasangan menjodohkan
  score: number; // Bobot skor, misal 10
  explanation: string; // Pembahasan lengkap
  sampleAnswer?: string; // Rubrik / contoh jawaban ideal untuk soal uraian
  cognitiveLevel?: string; // e.g. "C4 - Menganalisis (HOTS)"
  topicTag?: string;
}

export interface ExamPackage {
  id: string;
  code: string; // Kode Soal e.g. "MAT-XII-2026"
  title: string;
  description?: string;
  schoolProfile: SchoolProfile;
  teacherProfile: TeacherProfile;
  questions: Question[];
  totalScore: number;
  durationMinutes: number;
  sessionToken: string; // e.g. "G8T9Q2"
  tokenCreatedAt: string;
  isTokenActive: boolean;
  allowReviewExplanation: boolean; // Tampilkan pembahasan setelah submit
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  tokens?: StudentTokenItem[];
  gdriveFileId?: string;
  gdriveFileName?: string;
  gdriveWebViewLink?: string;
  gdriveDownloadLink?: string;
  gdriveSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudentTokenItem {
  id: string;
  examCode: string;
  token: string;
  studentName: string;
  nisn: string;
  className: string;
  seatNumber?: string;
  status: "belum_mulai" | "sedang_mengerjakan" | "selesai";
  generatedAt: string;
}

export interface StudentAnswerItem {
  questionId: string;
  selectedOption: string; // e.g. "A"
  isFlagged: boolean; // Ragu-ragu
  isCorrect?: boolean;
  scoreEarned?: number;
  timeSpentSeconds?: number;
}

export interface CheatingViolationLog {
  id?: string;
  timestamp: string;
  type?: "tab_switch" | "window_blur" | "fullscreen_exit";
  violationType?: "tab_switch" | "window_blur" | "fullscreen_exit";
  message: string;
}

export interface StudentExamSession {
  id: string;
  examId: string;
  examCode: string;
  examTitle: string;
  subject: string;
  studentName: string;
  nisn: string;
  className: string;
  token: string;
  currentSlideIndex: number;
  answers: Record<string, StudentAnswerItem>; // key is questionId
  startTime: string;
  submitTime?: string;
  timeSpentSeconds: number;
  totalScoreEarned: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  status: "in_progress" | "submitted" | "timed_out";
  shuffledQuestions?: Question[];
  aiRemediation?: string;
  aiEnrichment?: string;
  aiDiagnosis?: string;
  aiStructuredAnalysis?: AiDiagnosticResult;
  deviceInfo?: string;
  cheatViolations?: CheatingViolationLog[];
  violationCount?: number;
  lastActiveAt?: string;
  updatedAt?: string;
}

export interface AiHotsChallenge {
  question: string;
  guidance: string;
}

export interface AiGuidedQuestion {
  question: string;
  hint: string;
  answer?: string;
}

export interface AiEnrichmentPlan {
  title: string;
  targetCompetencies: string[];
  advancedMaterials: string;
  creativeTask: string;
  hotsChallenges?: AiHotsChallenge[];
}

export interface AiRemediationPlan {
  title: string;
  targetDeficits: string[];
  conceptClarification: string;
  remedialSteps: string[];
  guidedQuestions?: AiGuidedQuestion[];
}

export interface AiDiagnosticResult {
  passed: boolean;
  score: number;
  maxScore: number;
  percentage: number;
  diagnosis: string;
  misconceptions: string[];
  recommendedTopics: string[];
  enrichment: AiEnrichmentPlan;
  remediation: AiRemediationPlan;
  motivation: string;
  generatedAt?: string;
}

export interface GasFolderItem {
  id?: string;
  name?: string;
  url: string;
}

export interface GasConfig {
  webAppUrl: string;
  connected: boolean;
  lastTestedAt?: string;
  lastSyncedAt?: string;
  folders?: {
    master?: GasFolderItem;
    siswaKelas?: GasFolderItem;
    analisisNilai?: GasFolderItem;
    soal?: GasFolderItem;
  };
  sheets?: {
    siswa?: GasFolderItem;
    analisis?: GasFolderItem;
    soal?: GasFolderItem;
  };
}

export interface ItemAnalysisSummary {
  questionId: string;
  questionNumber: number;
  topicTag: string;
  cognitiveLevel: string;
  questionText: string;
  correctAnswer: string;
  maxScore: number;
  totalResponses: number;
  correctResponses: number;
  incorrectResponses: number;
  percentageCorrect: number;
  difficultyCategory: "Sangat Mudah" | "Mudah" | "Sedang" | "Sukar" | "Sangat Sukar";
  distractorCounts: Record<string, number>;
  discriminationIndex: number;
}

export interface AppBackupData {
  version: string;
  appName: string;
  backupDate: string;
  schoolProfile: SchoolProfile;
  exams: ExamPackage[];
  history: StudentExamSession[];
  studentTokens: StudentTokenItem[];
}

export type AppStateBackup = AppBackupData;

export type NavigationTab =
  | "student_exam"
  | "monitoring"
  | "ai_generator"
  | "item_analysis"
  | "tokens"
  | "school_profile"
  | "backup_restore";
