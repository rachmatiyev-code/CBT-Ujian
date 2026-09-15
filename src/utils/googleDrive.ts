import { AppStateBackup, ExamPackage } from "../types";
import {
  getCachedAccessToken,
  clearAuthSession,
  notifyAuthExpired,
  isAuthExpiredError,
  formatGoogleAuthErrorMessage,
} from "./googleAuth";
import { syncExamToGAS, fetchExamFromGAS } from "./gasService";

export const GOOGLE_DRIVE_BACKUP_FOLDER_NAME = "SlideExam_CBT";
export const GOOGLE_DRIVE_BACKUP_SUBFOLDER_NAME = "Backup_Data_Aplikasi";
export const GOOGLE_DRIVE_EXAMS_FOLDER_NAME = "Naskah_Soal"; // legacy compatibility

export class GoogleDriveAuthError extends Error {
  code = "AUTH_EXPIRED";
  constructor(
    message = "Sesi login Google Drive telah berakhir atau token akses kedaluwarsa. Silakan hubungkan ulang akun Google Anda untuk memperbarui izin akses."
  ) {
    super(message);
    this.name = "GoogleDriveAuthError";
  }
}

export class GoogleDrivePermissionError extends Error {
  isDomainRestricted = true;
  constructor(
    message = "Akses file naskah soal ditolak oleh Google Drive (403 Forbidden / Belajar.id Domain Restricted). Kebijakan akun @belajar.id membatasi akses file di luar domain organisasi."
  ) {
    super(message);
    this.name = "GoogleDrivePermissionError";
  }
}

/**
 * Formats a direct Google Drive download link for a file ID.
 * Standard format: https://drive.google.com/uc?export=download&id=FILE_ID
 */
export function formatGoogleDriveDirectDownloadUrl(fileId: string): string {
  if (!fileId) return "";
  const cleanId = fileId.trim();
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(cleanId)}`;
}

/**
 * Parses a failed Response from Google Drive API into a user-friendly Error.
 * Automatically clears expired sessions and dispatches auth-expired events.
 */
export async function parseGoogleDriveError(res: Response, fallbackMsg: string): Promise<Error> {
  let rawMsg = "";
  try {
    const data = await res.json();
    rawMsg = data?.error?.message || data?.message || "";
  } catch {
    try {
      rawMsg = await res.text();
    } catch {}
  }

  if (
    res.status === 401 ||
    rawMsg.toLowerCase().includes("invalid authentication credentials") ||
    rawMsg.toLowerCase().includes("oauth 2 access token") ||
    rawMsg.toLowerCase().includes("unauthenticated") ||
    rawMsg.toLowerCase().includes("invalid_token") ||
    rawMsg.toLowerCase().includes("login cookie")
  ) {
    notifyAuthExpired();
    return new GoogleDriveAuthError(
      "Sesi login Google Drive Anda telah berakhir (token kedaluwarsa). Silakan klik 'Hubungkan Akun Google' untuk masuk kembali dan memperbarui izin akses."
    );
  }

  if (res.status === 403) {
    if (rawMsg.toLowerCase().includes("quota") || rawMsg.toLowerCase().includes("rate")) {
      return new Error("Batas kuota akses Google Drive tercapai sementara. Silakan tunggu beberapa saat lagi.");
    }
    return new GoogleDrivePermissionError(
      "Akses ditolak oleh Google Drive (403 Forbidden / Akun Belajar.id). Jika Anda menggunakan akun @belajar.id, izin file biasanya dibatasi untuk internal organisasi sekolah. Harap pindahkan file ke akun Gmail pribadi (@gmail.com) atau bagikan dengan Link Paket Mandiri (Anti-Gagal)."
    );
  }

  if (res.status === 404) {
    return new Error("File atau folder tidak ditemukan di Google Drive.");
  }

  return new Error(rawMsg || fallbackMsg);
}

export interface GoogleDriveFileItem {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
}

export interface GoogleDriveExamItem extends GoogleDriveFileItem {
  examCode?: string;
  examTitle?: string;
  subject?: string;
  gradeLevel?: string;
  questionCount?: number;
  totalScore?: number;
  durationMinutes?: number;
  sessionToken?: string;
}

/**
 * Generates standard Google Drive filename format:
 * kelas_mata pelajaran_kode soal.json
 * Contoh: "Kelas VI_Pendidikan Pancasila_PP-01.json"
 */
export function formatExamDriveFileName(exam: ExamPackage): string {
  const cleanKelas = (exam.teacherProfile?.gradeLevel || "Kelas VI")
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ");

  const cleanMapel = (exam.teacherProfile?.subject || exam.title || "Mata Pelajaran")
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ");

  const cleanKode = (exam.code || "SOAL")
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();

  return `${cleanKelas}_${cleanMapel}_${cleanKode}.json`;
}

/**
 * Parses grade, subject, and exam code from a Google Drive file name
 */
export function parseExamInfoFromDriveFileName(fileName: string): {
  gradeLevel?: string;
  subject?: string;
  examCode?: string;
  examTitle?: string;
} {
  const cleanName = fileName.replace(/\.json$/i, "").trim();

  // Pattern 1: kelas_mata pelajaran_kode soal (e.g. Kelas VI_Pendidikan Pancasila_PP-01)
  const parts = cleanName.split("_");
  if (parts.length >= 3) {
    const gradeLevel = parts[0].trim();
    const subject = parts.slice(1, -1).join(" ").trim();
    const examCode = parts[parts.length - 1].trim().toUpperCase();
    return {
      gradeLevel,
      subject,
      examCode,
      examTitle: `${subject} (${examCode})`,
    };
  }

  // Pattern 2: Legacy SOAL_[CODE]_[TITLE]
  if (cleanName.startsWith("SOAL_")) {
    const afterPrefix = cleanName.replace(/^SOAL_/i, "");
    const legacyParts = afterPrefix.split("_");
    const examCode = legacyParts[0] || "";
    const examTitle = legacyParts.slice(1).join(" ") || afterPrefix;
    return { examCode, examTitle };
  }

  return { examTitle: cleanName };
}

/**
 * Extracts Google Drive File ID from various link formats or raw ID.
 * Handles:
 * - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 * - https://drive.google.com/file/d/FILE_ID/edit
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/uc?id=FILE_ID&export=download
 * - https://docs.google.com/file/d/FILE_ID/...
 * - https://drive.google.com/uc?export=download&id=FILE_ID
 * - https://drive.usercontent.google.com/download?id=FILE_ID
 * - Raw alphanumeric file ID (20-70 chars)
 * - Identifies if a folder link was mistakenly pasted
 */
export function extractGoogleDriveFileId(input: string): {
  fileId: string | null;
  isFolder: boolean;
  error?: string;
} {
  if (!input) {
    return { fileId: null, isFolder: false, error: "Link atau ID Google Drive tidak boleh kosong." };
  }
  const trimmed = input.trim();

  // Check if user accidentally pasted a Google Drive folder link
  if (trimmed.includes("/folders/") || trimmed.includes("folder/")) {
    return {
      fileId: null,
      isFolder: true,
      error: "Tautan yang Anda tempel adalah link FOLDER Google Drive. Silakan buka file naskah soal (.json), klik Bagikan/Dapatkan Link, lalu tempelkan link FILE tersebut.",
    };
  }

  // 1. Match /file/d/FILE_ID
  const matchFileD = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{20,70})/i);
  if (matchFileD && matchFileD[1]) {
    return { fileId: matchFileD[1], isFolder: false };
  }

  // 2. Match [?&]id=FILE_ID
  const matchIdParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{20,70})/i);
  if (matchIdParam && matchIdParam[1]) {
    return { fileId: matchIdParam[1], isFolder: false };
  }

  // 3. Match /d/FILE_ID
  const matchD = trimmed.match(/\/d\/([a-zA-Z0-9_-]{20,70})/i);
  if (matchD && matchD[1]) {
    return { fileId: matchD[1], isFolder: false };
  }

  // 4. Raw file ID (alphanumeric, underscores, hyphens)
  if (/^[a-zA-Z0-9_-]{20,70}$/.test(trimmed)) {
    return { fileId: trimmed, isFolder: false };
  }

  return {
    fileId: null,
    isFolder: false,
    error: "Format link Google Drive tidak dikenali. Pastikan link memiliki format https://drive.google.com/file/d/... atau ID file Google Drive yang valid.",
  };
}

const ROOT_FOLDER_CACHE_KEY = "slideexam_gdrive_root_folder_id";
const BACKUP_SUBFOLDER_CACHE_KEY = "slideexam_gdrive_backup_subfolder_id";

let cachedRootFolderId: string | null = null;
let rootFolderPromise: Promise<string> | null = null;

let cachedBackupSubfolderId: string | null = null;
let backupSubfolderPromise: Promise<string> | null = null;

/**
 * Searches for or reuses the dedicated backup folder on the user's Google Drive.
 * Caches folder ID in memory and localStorage to strictly prevent creating duplicate folders on changes.
 */
export async function getOrCreateSlideExamFolder(accessToken: string): Promise<string> {
  if (rootFolderPromise) {
    return rootFolderPromise;
  }

  rootFolderPromise = (async () => {
    try {
      // 1. Check in-memory or localStorage cache first
      let storedId = cachedRootFolderId;
      if (!storedId && typeof window !== "undefined") {
        storedId = localStorage.getItem(ROOT_FOLDER_CACHE_KEY);
      }

      if (storedId) {
        try {
          const verifyRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${storedId}?fields=id,name,trashed&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (verifyRes.ok) {
            const fileData = await verifyRes.json();
            if (fileData && fileData.id && !fileData.trashed) {
              cachedRootFolderId = fileData.id;
              if (typeof window !== "undefined") {
                localStorage.setItem(ROOT_FOLDER_CACHE_KEY, fileData.id);
              }
              return fileData.id;
            }
          }
        } catch {
          // Verification failed, proceed to search
        }
      }

      // 2. Search for existing folder named 'SlideExam_CBT' or containing 'SlideExam'
      const query = `mimeType='application/vnd.google-apps.folder' and (name='${GOOGLE_DRIVE_BACKUP_FOLDER_NAME}' or name contains 'SlideExam') and trashed=false`;
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        query
      )}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

      const searchRes = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (searchRes.ok) {
        const data = await searchRes.json();
        if (data.files && data.files.length > 0) {
          const exact = data.files.find((f: any) => f.name === GOOGLE_DRIVE_BACKUP_FOLDER_NAME);
          const foundId = exact ? exact.id : data.files[0].id;
          cachedRootFolderId = foundId;
          if (typeof window !== "undefined") {
            localStorage.setItem(ROOT_FOLDER_CACHE_KEY, foundId);
          }
          return foundId;
        }
      }

      // 3. Create folder only if truly none exists
      const createUrl = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true";
      const createRes = await fetch(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: GOOGLE_DRIVE_BACKUP_FOLDER_NAME,
          mimeType: "application/vnd.google-apps.folder",
          description: "Folder Arsip dan Cadangan Data Naskah Soal & CBT SlideExam",
        }),
      });

      if (!createRes.ok) {
        throw await parseGoogleDriveError(
          createRes,
          `Gagal membuat folder ${GOOGLE_DRIVE_BACKUP_FOLDER_NAME} di Google Drive.`
        );
      }

      const created = await createRes.json();
      cachedRootFolderId = created.id;
      if (typeof window !== "undefined") {
        localStorage.setItem(ROOT_FOLDER_CACHE_KEY, created.id);
      }
      return created.id;
    } finally {
      rootFolderPromise = null;
    }
  })();

  return rootFolderPromise;
}

/**
 * Searches for or reuses the 'Backup_Data_Aplikasi' subfolder inside the root folder.
 * Caches folder ID to prevent duplicate subfolder creation.
 */
export async function getOrCreateBackupDataSubfolder(accessToken: string): Promise<string> {
  if (backupSubfolderPromise) {
    return backupSubfolderPromise;
  }

  backupSubfolderPromise = (async () => {
    try {
      // 1. Check in-memory or localStorage cache first
      let storedSubId = cachedBackupSubfolderId;
      if (!storedSubId && typeof window !== "undefined") {
        storedSubId = localStorage.getItem(BACKUP_SUBFOLDER_CACHE_KEY);
      }

      if (storedSubId) {
        try {
          const verifyRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${storedSubId}?fields=id,name,trashed&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (verifyRes.ok) {
            const fileData = await verifyRes.json();
            if (fileData && fileData.id && !fileData.trashed) {
              cachedBackupSubfolderId = fileData.id;
              if (typeof window !== "undefined") {
                localStorage.setItem(BACKUP_SUBFOLDER_CACHE_KEY, fileData.id);
              }
              return fileData.id;
            }
          }
        } catch {}
      }

      const rootFolderId = await getOrCreateSlideExamFolder(accessToken);

      // 2. Search for existing subfolder inside root folder
      const query = `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and (name='${GOOGLE_DRIVE_BACKUP_SUBFOLDER_NAME}' or name='${GOOGLE_DRIVE_EXAMS_FOLDER_NAME}' or name contains 'Backup') and trashed=false`;
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        query
      )}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

      const searchRes = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (searchRes.ok) {
        const data = await searchRes.json();
        if (data.files && data.files.length > 0) {
          const exactMatch = data.files.find((f: any) => f.name === GOOGLE_DRIVE_BACKUP_SUBFOLDER_NAME);
          const foundId = exactMatch ? exactMatch.id : data.files[0].id;
          cachedBackupSubfolderId = foundId;
          if (typeof window !== "undefined") {
            localStorage.setItem(BACKUP_SUBFOLDER_CACHE_KEY, foundId);
          }
          return foundId;
        }
      }

      // 3. Create subfolder 'Backup_Data_Aplikasi'
      const createUrl = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true";
      const createRes = await fetch(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: GOOGLE_DRIVE_BACKUP_SUBFOLDER_NAME,
          parents: [rootFolderId],
          mimeType: "application/vnd.google-apps.folder",
          description: "Sub folder backup data aplikasi untuk naskah soal dan cadangan data SlideExam CBT",
        }),
      });

      if (!createRes.ok) {
        return rootFolderId; // fallback to root if subfolder creation fails
      }

      const created = await createRes.json();
      cachedBackupSubfolderId = created.id;
      if (typeof window !== "undefined") {
        localStorage.setItem(BACKUP_SUBFOLDER_CACHE_KEY, created.id);
      }
      return created.id;
    } finally {
      backupSubfolderPromise = null;
    }
  })();

  return backupSubfolderPromise;
}

/**
 * Legacy alias for backwards compatibility
 */
export async function getOrCreateExamsSubfolder(accessToken: string): Promise<string> {
  return getOrCreateBackupDataSubfolder(accessToken);
}

/**
 * Make file readable to anyone with link (for student access without requiring student login)
 */
export async function makeFilePubliclyReadable(accessToken: string, fileId: string): Promise<boolean> {
  try {
    const permUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`;
    const res = await fetch(permUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "reader",
        type: "anyone",
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn("Could not set public permission on Drive file:", err);
    return false;
  }
}

/**
 * Saves or updates a single ExamPackage to Google Drive.
 * Format nama file: kelas_mata pelajaran_kode soal.json
 * Folder: sub folder backup data aplikasi (SlideExam_CBT/Backup_Data_Aplikasi)
 */
export async function saveExamToGoogleDrive(
  accessToken: string,
  exam: ExamPackage
): Promise<{ fileId: string; fileName: string; webViewLink?: string; downloadUrl: string }> {
  const folderId = await getOrCreateBackupDataSubfolder(accessToken);
  const fileName = formatExamDriveFileName(exam);

  const examToSave: ExamPackage = {
    ...exam,
    gdriveFileName: fileName,
    gdriveSyncedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const fileContent = JSON.stringify(examToSave, null, 2);

  const boundary = "-------314159265358979323846";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelim = "\r\n--" + boundary + "--";

  // Check if we can update an existing file (by exam.gdriveFileId or by filename in folder)
  let targetFileId = exam.gdriveFileId;

  if (!targetFileId) {
    // Check if a file with same name exists in folder
    try {
      const q = `'${folderId}' in parents and name='${fileName}' and trashed=false`;
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (searchRes.ok) {
        const data = await searchRes.json();
        if (data.files && data.files.length > 0) {
          targetFileId = data.files[0].id;
        }
      }
    } catch (e) {
      console.warn("Drive search by filename skipped", e);
    }
  }

  let finalFileId = "";
  let webViewLink = "";

  if (targetFileId) {
    // Update existing file content & metadata
    const metadata = {
      name: fileName,
      description: `Naskah Soal SlideExam: ${exam.title} (${exam.code}) - ${exam.questions.length} butir - Disimpan: ${new Date().toLocaleString("id-ID")}`,
    };

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      fileContent +
      closeDelim;

    const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${targetFileId}?uploadType=multipart&fields=id,name,webViewLink`;
    const res = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    });

    if (res.ok) {
      const data = await res.json();
      finalFileId = data.id;
      webViewLink = data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;
    }
  }

  if (!finalFileId) {
    // Create new file in sub folder backup data aplikasi
    const metadata = {
      name: fileName,
      parents: [folderId],
      mimeType: "application/json",
      description: `Naskah Soal SlideExam: ${exam.title} (${exam.code}) - ${exam.questions.length} butir - Disimpan: ${new Date().toLocaleString("id-ID")}`,
    };

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      fileContent +
      closeDelim;

    const uploadUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    });

    if (!res.ok) {
      throw await parseGoogleDriveError(res, "Gagal menyimpan naskah soal ke Google Drive.");
    }

    const created = await res.json();
    finalFileId = created.id;
    webViewLink = created.webViewLink || `https://drive.google.com/file/d/${created.id}/view`;
  }

  // Ensure public read permission for seamless student loading without login
  await makeFilePubliclyReadable(accessToken, finalFileId);

  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${finalFileId}?alt=media`;

  const examComplete: ExamPackage = {
    ...examToSave,
    gdriveFileId: finalFileId,
    gdriveFileName: fileName,
    gdriveWebViewLink: webViewLink,
  };

  // Cache in localStorage immediately for instant offline/reload resolution
  try {
    localStorage.setItem(`gdrive_cache_${finalFileId}`, JSON.stringify(examComplete));
    if (exam.code) {
      localStorage.setItem(`gdrive_code_${exam.code.toUpperCase()}`, JSON.stringify(examComplete));
    }
  } catch {}

  // 1. Dual-sync to Google Apps Script & Sheets for reliable multi-device student access
  try {
    await syncExamToGAS(examComplete, exam.tokens);
  } catch (syncErr) {
    console.warn("GAS sync during Drive save:", syncErr);
  }

  // 2. Register in local server Drive index & share registry so student short links resolve without Google sign-in
  try {
    await fetch("/api/gdrive/register-exam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: exam.code,
        fileId: finalFileId,
        fileName,
        webViewLink,
        downloadUrl,
        exam: examComplete,
        accessToken,
      }),
    });
  } catch (e) {
    console.warn("Background Drive registration skipped:", e);
  }

  try {
    await fetch("/api/exams/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exam: examComplete,
        token: exam.sessionToken,
        tokens: exam.tokens || [],
      }),
    });
  } catch {}

  return {
    fileId: finalFileId,
    fileName,
    webViewLink,
    downloadUrl,
  };
}

/**
 * Lists all individual exam packages from Google Drive.
 * Searches across Backup_Data_Aplikasi, Naskah_Soal, and root folder.
 */
export async function listExamsFromGoogleDrive(accessToken: string): Promise<GoogleDriveExamItem[]> {
  const rootFolderId = await getOrCreateSlideExamFolder(accessToken);
  const backupFolderId = await getOrCreateBackupDataSubfolder(accessToken);

  // Search across backup subfolder, root folder, and Data_Soal folder for .json files
  const query = `('${backupFolderId}' in parents or '${rootFolderId}' in parents) and trashed=false and mimeType='application/json'`;
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&orderBy=modifiedTime desc&fields=files(id,name,createdTime,modifiedTime,size,webViewLink,description)`;

  const res = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw await parseGoogleDriveError(res, "Gagal memuat daftar naskah soal dari Google Drive.");
  }

  const data = await res.json();
  const rawFiles: any[] = data.files || [];

  // Also check if there are files in Data_Soal folder if exists
  try {
    const dataSoalQuery = `'${rootFolderId}' in parents and name='Data_Soal' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const dataSoalSearch = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(dataSoalQuery)}&fields=files(id)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (dataSoalSearch.ok) {
      const dsData = await dataSoalSearch.json();
      if (dsData.files && dsData.files.length > 0) {
        const dsFolderId = dsData.files[0].id;
        const dsFilesRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${dsFolderId}' in parents and trashed=false and mimeType='application/json'`)}&orderBy=modifiedTime desc&fields=files(id,name,createdTime,modifiedTime,size,webViewLink,description)`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (dsFilesRes.ok) {
          const dsFilesData = await dsFilesRes.json();
          if (dsFilesData.files) {
            for (const f of dsFilesData.files) {
              if (!rawFiles.some((rf) => rf.id === f.id)) {
                rawFiles.push(f);
              }
            }
          }
        }
      }
    }
  } catch (dsErr) {
    console.warn("Data_Soal scan optional error:", dsErr);
  }

  return rawFiles
    .filter((f) => !f.name.startsWith("SlideExam_CBT_Backup_")) // exclude full app backups
    .map((f) => {
      const parsedInfo = parseExamInfoFromDriveFileName(f.name);

      return {
        id: f.id,
        name: f.name,
        createdTime: f.createdTime,
        modifiedTime: f.modifiedTime,
        size: f.size,
        webViewLink: f.webViewLink,
        examCode: parsedInfo.examCode || "",
        examTitle: parsedInfo.examTitle || f.name,
        subject: parsedInfo.subject,
        gradeLevel: parsedInfo.gradeLevel,
      };
    });
}

/**
 * Loads an ExamPackage from Google Drive by file ID.
 * Resilient multi-tier strategy: Local cache -> Server proxy -> Firestore -> Direct fetch.
 */
export async function loadExamFromGoogleDrive(
  accessTokenOrNull: string | null,
  fileId: string
): Promise<ExamPackage> {
  if (!fileId) {
    throw new Error("ID File Google Drive tidak valid.");
  }

  // Tier 1: Check browser local cache
  try {
    const cached = localStorage.getItem(`gdrive_cache_${fileId}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        return parsed;
      }
    }
  } catch {}

  let lastPermissionError: string | null = null;

  // Tier 2: Try server-side proxy (bypasses CORS, cookie, and Google Workspace restrictions)
  try {
    const proxyHeaders: Record<string, string> = {};
    if (accessTokenOrNull) {
      proxyHeaders.Authorization = `Bearer ${accessTokenOrNull}`;
    }
    let proxyRes = await fetch(`/api/gdrive/exam/${encodeURIComponent(fileId)}`, {
      headers: proxyHeaders,
    });

    if (proxyRes.status === 403) {
      try {
        const errData = await proxyRes.json();
        if (errData?.message) lastPermissionError = errData.message;
      } catch {}
    }

    // If failed with token, retry proxy without token (public link access)
    if (!proxyRes.ok && accessTokenOrNull) {
      proxyRes = await fetch(`/api/gdrive/exam/${encodeURIComponent(fileId)}`);
      if (proxyRes.status === 403) {
        try {
          const errData = await proxyRes.json();
          if (errData?.message) lastPermissionError = errData.message;
        } catch {}
      }
    }
    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (data.success && data.exam && Array.isArray(data.exam.questions)) {
        const result: ExamPackage = {
          ...data.exam,
          gdriveFileId: fileId,
          gdriveSyncedAt: data.exam.gdriveSyncedAt || new Date().toISOString(),
        };
        try {
          localStorage.setItem(`gdrive_cache_${fileId}`, JSON.stringify(result));
          if (result.code) {
            localStorage.setItem(`gdrive_code_${result.code.toUpperCase()}`, JSON.stringify(result));
          }
        } catch {}
        return result;
      }
    }
  } catch (err) {
    console.warn("Server proxy download failed, trying Firestore and direct:", err);
  }

  // Tier 3: Try Google Apps Script / Sheets lookup
  try {
    const gasResult = await fetchExamFromGAS(fileId);
    if (gasResult.exam && Array.isArray(gasResult.exam.questions)) {
      const result: ExamPackage = {
        ...gasResult.exam,
        gdriveFileId: fileId,
      };
      try {
        localStorage.setItem(`gdrive_cache_${fileId}`, JSON.stringify(result));
      } catch {}
      return result;
    }
  } catch {}

  // Tier 4: Direct fetch with token (if valid) or fallback to public proxy
  let json: any = null;
  if (accessTokenOrNull) {
    try {
      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      const res = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessTokenOrNull}` },
      });
      if (res.ok) {
        json = await res.json();
      } else if (res.status === 401) {
        notifyAuthExpired();
      } else if (res.status === 403) {
        lastPermissionError =
          "Akses ditolak oleh Google Drive (403 Forbidden). Akun @belajar.id kemungkinan membatasi pembagian file di luar domain.";
      }
    } catch (e) {
      console.warn("Direct Drive API fetch error:", e);
    }
  }

  // If not retrieved yet, try server proxy without token one more time
  if (!json || !Array.isArray(json.questions)) {
    try {
      const fallbackProxy = await fetch(`/api/gdrive/exam/${encodeURIComponent(fileId)}`);
      if (fallbackProxy.status === 403) {
        try {
          const errData = await fallbackProxy.json();
          if (errData?.message) lastPermissionError = errData.message;
        } catch {}
      }
      if (fallbackProxy.ok) {
        const proxyData = await fallbackProxy.json();
        if (proxyData.success && proxyData.exam && Array.isArray(proxyData.exam.questions)) {
          json = proxyData.exam;
        }
      }
    } catch {}
  }

  if (!json || !Array.isArray(json.questions)) {
    if (lastPermissionError) {
      throw new GoogleDrivePermissionError(lastPermissionError);
    }
    throw new Error(
      "Gagal memuat naskah soal dari Google Drive. Pastikan file dibagikan dengan akses 'Siapa saja yang memiliki link' atau gunakan akun Gmail biasa (@gmail.com) jika akun @belajar.id dibatasi oleh kebijakan sekolah."
    );
  }

  const exam: ExamPackage = {
    ...json,
    gdriveFileId: fileId,
    gdriveSyncedAt: json.gdriveSyncedAt || new Date().toISOString(),
  };

  try {
    localStorage.setItem(`gdrive_cache_${fileId}`, JSON.stringify(exam));
    if (exam.code) {
      localStorage.setItem(`gdrive_code_${exam.code.toUpperCase()}`, JSON.stringify(exam));
    }
  } catch {}

  return exam;
}

/**
 * Loads an exam directly using a pasted Google Drive link or file ID.
 * Parses the link, validates that it's not a folder, and downloads the exam package.
 */
export async function loadExamFromGoogleDriveUrlOrId(
  urlOrId: string,
  accessTokenOrNull?: string | null
): Promise<ExamPackage> {
  const extracted = extractGoogleDriveFileId(urlOrId);
  if (extracted.error || !extracted.fileId) {
    throw new Error(extracted.error || "Gagal mengekstrak ID file Google Drive dari tautan yang diberikan.");
  }

  return await loadExamFromGoogleDrive(accessTokenOrNull || null, extracted.fileId);
}

/**
 * Searches and automatically loads an exam from Google Drive by exam code or file name.
 * Also intelligently recognizes if the user pasted a direct Google Drive link or file ID!
 * Fulfills requirement: "ketika siswa membuka link maka app akan otomatis mencari nama soal yang sesuai"
 */
export async function findAndLoadExamFromDriveByCode(
  codeOrQuery: string,
  accessTokenOrNull?: string | null
): Promise<ExamPackage | null> {
  const cleanQuery = (codeOrQuery || "").trim();
  if (!cleanQuery) return null;

  // Tier 0: Check if cleanQuery is a Google Drive URL or direct Google Drive File ID
  if (
    cleanQuery.includes("drive.google.com") ||
    cleanQuery.includes("docs.google.com") ||
    cleanQuery.includes("/file/d/") ||
    cleanQuery.includes("id=") ||
    /^[a-zA-Z0-9_-]{25,60}$/.test(cleanQuery)
  ) {
    const extracted = extractGoogleDriveFileId(cleanQuery);
    if (extracted.fileId) {
      try {
        const loadedFromLink = await loadExamFromGoogleDrive(accessTokenOrNull || null, extracted.fileId);
        if (loadedFromLink && Array.isArray(loadedFromLink.questions)) {
          return loadedFromLink;
        }
      } catch (err) {
        console.warn("Direct link loading in code search failed:", err);
      }
    }
  }

  // Tier 1: Check localStorage cache
  try {
    const cached = localStorage.getItem(`gdrive_code_${cleanQuery.toUpperCase()}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        return parsed;
      }
    }
  } catch {}

  // Tier 2: Check server Google Drive registry search endpoint
  try {
    const searchRes = await fetch(`/api/gdrive/search?q=${encodeURIComponent(cleanQuery)}`);
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.success && searchData.item) {
        if (searchData.item.exam && Array.isArray(searchData.item.exam.questions)) {
          return searchData.item.exam;
        }
        if (searchData.item.fileId) {
          return await loadExamFromGoogleDrive(accessTokenOrNull || null, searchData.item.fileId);
        }
      }
    }
  } catch (err) {
    console.warn("Server search failed:", err);
  }

  // Tier 3: Check Google Apps Script / Sheets by code
  try {
    const gasRes = await fetchExamFromGAS(cleanQuery);
    if (gasRes.exam && Array.isArray(gasRes.exam.questions)) {
      return gasRes.exam;
    }
  } catch {}

  // Tier 4: Check server /api/exams/by-code/:code
  try {
    const apiRes = await fetch(`/api/exams/by-code/${encodeURIComponent(cleanQuery)}`);
    if (apiRes.ok) {
      const d = await apiRes.json();
      if (d.success && d.exam && Array.isArray(d.exam.questions)) {
        return d.exam;
      }
    }
  } catch {}

  // Tier 5: If access token available, query Google Drive API directly across backup subfolder and root folder
  const tokenToUse = accessTokenOrNull || getCachedAccessToken();
  if (tokenToUse) {
    try {
      const backupFolderId = await getOrCreateBackupDataSubfolder(tokenToUse);
      const rootFolderId = await getOrCreateSlideExamFolder(tokenToUse);
      const q = `('${backupFolderId}' in parents or '${rootFolderId}' in parents) and name contains '${cleanQuery}' and trashed=false and mimeType='application/json'`;
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
      const res = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${tokenToUse}` },
      });
      if (res.ok) {
        const d = await res.json();
        if (d.files && d.files.length > 0) {
          return await loadExamFromGoogleDrive(tokenToUse, d.files[0].id);
        }
      }
    } catch (err) {
      console.warn("Direct Drive API search failed:", err);
    }
  }

  return null;
}

/**
 * Deletes an exam package file from Google Drive.
 */
export async function deleteExamFromGoogleDrive(accessToken: string, fileId: string): Promise<void> {
  const deleteUrl = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const res = await fetch(deleteUrl, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok && res.status !== 404) {
    throw await parseGoogleDriveError(res, "Gagal menghapus naskah soal dari Google Drive.");
  }
}

/**
 * Uploads a full backup JSON into the 'SlideExam_CBT' folder on Google Drive.
 */
export async function uploadBackupToGoogleDrive(
  accessToken: string,
  backupData: AppStateBackup
): Promise<GoogleDriveFileItem> {
  const folderId = await getOrCreateSlideExamFolder(accessToken);
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `SlideExam_CBT_Backup_${timestamp}.json`;

  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: "application/json",
    description: `Cadangan data SlideExam CBT dibuat pada ${now.toLocaleString("id-ID")}`,
  };

  const fileContent = JSON.stringify(backupData, null, 2);
  const boundary = "-------314159265358979323846";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelim = "\r\n--" + boundary + "--";

  const multipartRequestBody =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: application/json\r\n\r\n" +
    fileContent +
    closeDelim;

  const uploadUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size";
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartRequestBody,
  });

  if (!res.ok) {
    throw await parseGoogleDriveError(res, "Gagal mengunggah file backup ke Google Drive.");
  }

  const uploadedFile = await res.json();
  return uploadedFile;
}

/**
 * Lists all backup files inside the 'SlideExam_CBT' folder.
 */
export async function listBackupsFromGoogleDrive(accessToken: string): Promise<GoogleDriveFileItem[]> {
  const folderId = await getOrCreateSlideExamFolder(accessToken);
  const query = `'${folderId}' in parents and trashed=false and name contains 'Backup' and mimeType='application/json'`;
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=createdTime desc&fields=files(id,name,createdTime,modifiedTime,size)`;

  const res = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw await parseGoogleDriveError(res, "Gagal memuat daftar backup dari folder SlideExam_CBT.");
  }

  const data = await res.json();
  return data.files || [];
}

/**
 * Downloads and parses backup data from a Google Drive file.
 */
export async function downloadBackupFromGoogleDrive(
  accessToken: string,
  fileId: string
): Promise<AppStateBackup> {
  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw await parseGoogleDriveError(res, "Gagal mengunduh file backup dari Google Drive.");
  }

  const json = await res.json();
  return json as AppStateBackup;
}

