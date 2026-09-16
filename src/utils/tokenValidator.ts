import { ExamPackage, StudentTokenItem } from "../types";
import { getExamPackages, getStudentTokens } from "./storage";

export interface TokenValidationResult {
  isValid: boolean;
  type?: "exam_master" | "student_personal" | "universal_bypass" | "open_access";
  matchedExam: ExamPackage;
  matchedStudent?: StudentTokenItem;
  errorMessage?: string;
  isSessionTokenRejected?: boolean;
}

/**
 * Normalizes tokens by trimming, uppercasing, and removing whitespace, dashes, underscores, and punctuation.
 * Examples: "SLIDE-7", "slide 7", "SLIDE 7", "slide_7" -> "SLIDE7"
 */
export function normalizeToken(raw?: string): string {
  if (!raw) return "";
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.:;,/\\#@!]/g, "");
}

/**
 * Validates entered token against:
 * 1. Current exam master token or code
 * 2. Current student token list
 * 3. All exam packages in system
 * 4. All student tokens in system
 * 5. Universal supervisor/bypass codes
 * 6. Open access if token is disabled
 */
export function validateExamToken(
  tokenInput: string,
  currentExam: ExamPackage,
  currentTokens: StudentTokenItem[] = [],
  allExamsList?: ExamPackage[]
): TokenValidationResult {
  const normInput = normalizeToken(tokenInput);

  // If token is disabled by teacher, allow entry
  if (currentExam.isTokenActive === false) {
    return {
      isValid: true,
      type: "open_access",
      matchedExam: currentExam,
    };
  }

  if (!normInput) {
    return {
      isValid: false,
      matchedExam: currentExam,
      errorMessage: "Silakan masukkan token ujian 5-6 karakter.",
    };
  }

  // 1. Universal Supervisor / Admin / Teacher bypass codes
  const universalBypass = ["GURU2026", "ADMIN", "SUPERVISOR", "PENGAWAS", "CBT2026", "DEMO", "TEST", "GURU"];
  if (universalBypass.includes(normInput)) {
    return {
      isValid: true,
      type: "universal_bypass",
      matchedExam: currentExam,
    };
  }

  // 2. Check current exam session token or exam code
  const currentExamNormToken = normalizeToken(currentExam.sessionToken);
  const currentExamNormCode = normalizeToken(currentExam.code);

  if (normInput === currentExamNormToken || normInput === currentExamNormCode) {
    return {
      isValid: true,
      type: "exam_master",
      matchedExam: currentExam,
    };
  }

  // 3. Check current exam's student token list
  const matchedInCurrentTokens = currentTokens.find(
    (t) => normalizeToken(t.token) === normInput && (!t.examCode || normalizeToken(t.examCode) === currentExamNormCode)
  );

  if (matchedInCurrentTokens) {
    return {
      isValid: true,
      type: "student_personal",
      matchedExam: currentExam,
      matchedStudent: matchedInCurrentTokens,
    };
  }

  // 4. Check across other exams in storage or props (excluding currentExam to prevent stale cache matching)
  const allExams = allExamsList && allExamsList.length > 0 ? allExamsList : getExamPackages();
  const otherExams = allExams.filter((e) => e.id !== currentExam.id);

  // 4a. Check other exams' master tokens or codes
  const matchedOtherExam = otherExams.find(
    (e) => normalizeToken(e.sessionToken) === normInput || normalizeToken(e.code) === normInput
  );

  if (matchedOtherExam) {
    return {
      isValid: true,
      type: "exam_master",
      matchedExam: matchedOtherExam,
    };
  }

  // 4b. Check all student tokens across all exams
  const allStoredTokens = getStudentTokens();
  const matchedInAllTokens = allStoredTokens.find((t) => normalizeToken(t.token) === normInput);

  if (matchedInAllTokens) {
    const isCurrentExamCode =
      normalizeToken(matchedInAllTokens.examCode) === currentExamNormCode ||
      matchedInAllTokens.examCode === currentExam.id;

    const targetExam = isCurrentExamCode
      ? currentExam
      : allExams.find(
          (e) =>
            normalizeToken(e.code) === normalizeToken(matchedInAllTokens.examCode) ||
            e.id === matchedInAllTokens.examCode
        ) || currentExam;

    return {
      isValid: true,
      type: "student_personal",
      matchedExam: targetExam,
      matchedStudent: matchedInAllTokens,
    };
  }

  // If no match found, formulate helpful error message
  const availableTokensHint = currentExamNormToken ? ` (Format token: ${currentExamNormToken.length} karakter)` : "";
  return {
    isValid: false,
    matchedExam: currentExam,
    errorMessage: `Token ujian "${tokenInput}" tidak sesuai. Pastikan huruf besar/kecil sesuai dan minta token aktif yang tertera di papan tulis atau kartu ujian pengawas${availableTokensHint}.`,
  };
}

/**
 * Validates token explicitly entered on the STUDENT login page.
 * MANDATORY REQUIREMENT: Students MUST enter their unique Student Login Token (from exam card),
 * NOT the shared Exam Session Token.
 */
export function validateStudentLoginToken(
  tokenInput: string,
  currentExam: ExamPackage,
  currentTokens: StudentTokenItem[] = [],
  selectedStudentName?: string,
  allExamsList?: ExamPackage[]
): TokenValidationResult {
  const normInput = normalizeToken(tokenInput);

  if (!normInput) {
    return {
      isValid: false,
      matchedExam: currentExam,
      errorMessage: "Silakan masukkan Token Login Siswa unik Anda.",
    };
  }

  // 1. Universal Supervisor / Admin / Teacher bypass codes (for teachers or trials)
  const universalBypass = ["GURU2026", "ADMIN", "SUPERVISOR", "PENGAWAS", "CBT2026", "DEMO", "TEST", "GURU"];
  if (universalBypass.includes(normInput)) {
    return {
      isValid: true,
      type: "universal_bypass",
      matchedExam: currentExam,
    };
  }

  // 2. REJECT Shared Session Tokens & Exam Codes explicitly
  const currentExamNormToken = normalizeToken(currentExam.sessionToken);
  const currentExamNormCode = normalizeToken(currentExam.code);

  if (normInput === currentExamNormToken || normInput === currentExamNormCode) {
    return {
      isValid: false,
      isSessionTokenRejected: true,
      matchedExam: currentExam,
      errorMessage: `Yang Anda masukkan ("${tokenInput}") adalah TOKEN SESI NASKAH, BUKAN Token Login Siswa. Silakan masukkan Token Login Siswa unik Anda yang tertera di Kartu Peserta Ujian / Daftar Siswa.`,
    };
  }

  // Also check if student entered a session token or code of other exams
  const allExams = allExamsList && allExamsList.length > 0 ? allExamsList : getExamPackages();
  const otherExamTokenMatch = allExams.find(
    (e) => normalizeToken(e.sessionToken) === normInput || normalizeToken(e.code) === normInput
  );
  if (otherExamTokenMatch) {
    return {
      isValid: false,
      isSessionTokenRejected: true,
      matchedExam: otherExamTokenMatch,
      errorMessage: `Yang Anda masukkan adalah TOKEN SESI NASKAH, BUKAN Token Login Siswa. Silakan gunakan Token Login Siswa unik pribadi Anda.`,
    };
  }

  // 3. Match against current exam student tokens
  const cleanSelectedName = selectedStudentName ? selectedStudentName.trim().toLowerCase() : "";

  // First search in currentTokens list
  let matchedStudent = currentTokens.find((t) => normalizeToken(t.token) === normInput);

  // Fallback: search across all stored student tokens
  if (!matchedStudent) {
    const allStoredTokens = getStudentTokens();
    matchedStudent = allStoredTokens.find((t) => normalizeToken(t.token) === normInput);
  }

  if (matchedStudent) {
    // If a specific student was selected in the form, verify token ownership
    if (cleanSelectedName && cleanSelectedName !== "__manual__") {
      const studentTokenOwner = matchedStudent.studentName.trim().toLowerCase();
      if (studentTokenOwner !== cleanSelectedName) {
        return {
          isValid: false,
          matchedExam: currentExam,
          matchedStudent,
          errorMessage: `Token login ini milik siswa "${matchedStudent.studentName}", bukan untuk "${selectedStudentName}". Harap masukkan token login pribadi Anda.`,
        };
      }
    }

    return {
      isValid: true,
      type: "student_personal",
      matchedExam: currentExam,
      matchedStudent,
    };
  }

  // 4. If current exam has student tokens registered, but no match was found:
  if (currentTokens.length > 0) {
    return {
      isValid: false,
      matchedExam: currentExam,
      errorMessage: `Token Login Siswa "${tokenInput}" tidak ditemukan dalam daftar peserta ujian. Periksa kembali token pada kartu ujian Anda.`,
    };
  }

  // 5. If no student tokens registered yet at all (e.g. self-registration or direct manual link):
  // Accept any non-session token with 3+ alphanumeric chars so manual students can still proceed
  if (normInput.length >= 3) {
    return {
      isValid: true,
      type: "student_personal",
      matchedExam: currentExam,
    };
  }

  return {
    isValid: false,
    matchedExam: currentExam,
    errorMessage: "Token Login Siswa minimal 3 karakter alfanumerik.",
  };
}

/**
 * Helper to check if two class/grade designations match or overlap in meaning.
 * Handles SD (Kelas 1-6, I-VI), SMP (7-9, VII-IX), SMA (10-12, X-XII),
 * and custom designations like "X MIPA 1" vs "Kelas X (Fase E)".
 */
function isGradeOrClassMatch(className1?: string, className2?: string): boolean {
  if (!className1 || !className2) return false;
  const c1 = className1.trim().toLowerCase();
  const c2 = className2.trim().toLowerCase();
  if (c1 === c2) return true;
  if (c1.includes(c2) || c2.includes(c1)) return true;

  // Extract digits and roman numerals
  const extractGradeKey = (str: string): string => {
    const romanMatch = str.match(/\b(xii|xi|x|ix|viii|vii|vi|iv|v|iii|ii|i)\b/i);
    if (romanMatch) {
      const r = romanMatch[1].toUpperCase();
      const map: Record<string, string> = {
        I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6",
        VII: "7", VIII: "8", IX: "9", X: "10", XI: "11", XII: "12"
      };
      if (map[r]) return map[r];
    }
    const numMatch = str.match(/\b([1-9]|1[0-2])\b/);
    if (numMatch) return numMatch[1];
    return "";
  };

  const k1 = extractGradeKey(c1);
  const k2 = extractGradeKey(c2);
  if (k1 && k2 && k1 === k2) return true;

  return false;
}

/**
 * Deduplicates and isolates student tokens strictly by exam code, exam ID, and/or class name.
 * Prevents student rosters from other classes or different exams from leaking or mixing,
 * while allowing tokens to remain stable if exam code has aliases or minor revisions.
 * If no specific tokens match, safely falls back to available tokens so student name dropdown never disappears.
 */
export function deduplicateStudentTokens(
  tokenList: StudentTokenItem[],
  targetExamCode?: string,
  targetClassName?: string,
  targetExamId?: string
): StudentTokenItem[] {
  if (!Array.isArray(tokenList) || tokenList.length === 0) return [];

  const targetCode = targetExamCode ? targetExamCode.trim().toUpperCase() : null;
  const targetClass = targetClassName ? targetClassName.trim() : null;
  const targetId = targetExamId ? targetExamId.trim() : null;

  let sourceList: StudentTokenItem[] = [];

  if (targetCode || targetClass || targetId) {
    // 1. First priority: match by exact examId or examCode
    const idOrCodeMatches = tokenList.filter((t) => {
      if (!t) return false;
      const c = (t.examCode || "").trim().toUpperCase();
      const tExamId = ((t as any).examId || "").trim();
      const matchId = targetId && (tExamId === targetId || t.id === targetId);
      const matchCode = targetCode && (c === targetCode || (t.id && t.id.toUpperCase() === targetCode));
      return matchId || matchCode;
    });

    if (idOrCodeMatches.length > 0) {
      sourceList = idOrCodeMatches;
    } else if (targetClass) {
      // 2. Second priority: if no exact exam match found, try matching by class name / grade level
      const classMatches = tokenList.filter((t) => {
        if (!t) return false;
        return isGradeOrClassMatch(t.className, targetClass);
      });
      if (classMatches.length > 0) {
        sourceList = classMatches;
      }
    }

    // 3. Third priority (Fallback): If neither exam code/id nor class matched,
    // do NOT return empty and break the dropdown! Use available tokens so students can select their names.
    if (sourceList.length === 0 && tokenList.length > 0) {
      sourceList = tokenList;
    }
  } else {
    // Global list (e.g. general token repository view)
    sourceList = tokenList;
  }

  if (sourceList.length === 0) return [];

  // Deduplicate unique students
  const uniqueMap = new Map<string, StudentTokenItem>();

  sourceList.forEach((item, idx) => {
    if (!item || !item.studentName) return;
    const cleanName = item.studentName.trim().toLowerCase();
    if (!cleanName) return;

    // When global list (no targetCode), include className and examCode in key so different classes are never merged
    const key = targetCode
      ? cleanName
      : `${cleanName}__${(item.className || "").trim().toLowerCase()}__${(item.examCode || "").trim().toUpperCase()}`;

    if (!uniqueMap.has(key)) {
      // Ensure each student has their own individual student login token
      let studentToken = item.token ? item.token.trim() : "";
      if (!studentToken || (targetCode && normalizeToken(studentToken) === normalizeToken(targetCode))) {
        studentToken = `TKN${String(idx + 1).padStart(2, "0")}`;
      }

      uniqueMap.set(key, {
        ...item,
        id: item.id || `tok-${idx + 1}-${cleanName.replace(/\s+/g, "")}`,
        token: studentToken,
        examCode: item.examCode || targetCode || undefined,
        className: item.className || targetClassName || undefined,
      });
    }
  });

  return Array.from(uniqueMap.values());
}

