import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "20mb" }));

// Helper to sleep for ms
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Format friendly Gemini error message
function formatGeminiError(error: any): string {
  const msg = error?.message || (typeof error === "string" ? error : "");
  if (
    msg.includes("503") ||
    msg.includes("high demand") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("temporarily overloaded")
  ) {
    return "Server Google Gemini sedang mengalami lonjakan trafik tinggi sementara (503 Service Unavailable). Sistem telah mencoba otomatis, silakan klik 'Coba Lagi' dalam beberapa detik.";
  }
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
    return "Batas kuota harian/menit API Gemini telah tercapai (429 Too Many Requests). Silakan tunggu sebentar sebelum mencoba kembali.";
  }
  if (msg.includes("API_KEY_INVALID") || msg.includes("API key not valid")) {
    return "Kunci API Gemini tidak valid atau belum diaktifkan. Silakan periksa kembali Kunci API Anda di menu 'Kunci API Gemini'.";
  }
  return msg || "Terjadi kesalahan saat memproses permintaan dengan Google Gemini AI.";
}

// Resilient Gemini Generate Content caller with automatic fallback models & retry on 503 / 429
async function callGeminiWithResilience(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config?: any;
    preferredModel?: string;
    fallbackModels?: string[];
    maxRetries?: number;
  }
) {
  const models = [
    params.preferredModel || "gemini-3.6-flash",
    ...(params.fallbackModels || [
      "gemini-3.7-flash",
      "gemini-flash-latest",
      "gemini-3.1-flash-lite",
    ]),
  ];
  const maxRetries = params.maxRetries ?? 2;
  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        });
        return { response, modelUsed: model };
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || "";
        const isTransient =
          errMsg.includes("503") ||
          errMsg.includes("high demand") ||
          errMsg.includes("UNAVAILABLE") ||
          errMsg.includes("429") ||
          errMsg.includes("RESOURCE_EXHAUSTED") ||
          errMsg.includes("fetch failed");

        console.warn(`[Gemini Attempt Failed] Model: ${model}, Attempt: ${attempt + 1}/${maxRetries + 1}. Error: ${errMsg}`);

        if (isTransient && attempt < maxRetries) {
          // Wait with exponential backoff before retrying same model
          const backoffDelay = (attempt + 1) * 1200 + Math.random() * 500;
          await sleep(backoffDelay);
          continue;
        } else {
          // Break out to try next fallback model
          break;
        }
      }
    }
  }

  throw new Error(formatGeminiError(lastError));
}

// Server-Side Gemini API client
const getGeminiClient = (customKey?: string) => {
  const apiKey = (customKey && customKey.trim()) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Kunci API Gemini belum terhubung. Silakan masukkan Kunci API Gemini melalui menu 'Kunci API Gemini' atau konfigurasi GEMINI_API_KEY."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

import fs from "fs";

// Persistent disk storage directory for 2-way multi-device communication
const DATA_DIR = path.join(process.cwd(), ".data");
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

const EXAMS_FILE = path.join(DATA_DIR, "exams_store.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions_store.json");
const GDRIVE_INDEX_FILE = path.join(DATA_DIR, "gdrive_index.json");

function loadExamsFromDisk(): Map<string, any> {
  const map = new Map<string, any>();
  try {
    if (fs.existsSync(EXAMS_FILE)) {
      const data = JSON.parse(fs.readFileSync(EXAMS_FILE, "utf-8"));
      if (typeof data === "object" && data !== null) {
        Object.entries(data).forEach(([k, v]) => map.set(k, v));
      }
    }
  } catch {}
  return map;
}

function saveExamsToDisk(map: Map<string, any>) {
  try {
    const obj: Record<string, any> = {};
    map.forEach((v, k) => {
      obj[k] = v;
    });
    fs.writeFileSync(EXAMS_FILE, JSON.stringify(obj), "utf-8");
  } catch {}
}

function loadGDriveIndexFromDisk(): Map<string, any> {
  const map = new Map<string, any>();
  try {
    if (fs.existsSync(GDRIVE_INDEX_FILE)) {
      const data = JSON.parse(fs.readFileSync(GDRIVE_INDEX_FILE, "utf-8"));
      if (typeof data === "object" && data !== null) {
        Object.entries(data).forEach(([k, v]) => map.set(k, v));
      }
    }
  } catch {}
  return map;
}

function saveGDriveIndexToDisk(map: Map<string, any>) {
  try {
    const obj: Record<string, any> = {};
    map.forEach((v, k) => {
      obj[k] = v;
    });
    fs.writeFileSync(GDRIVE_INDEX_FILE, JSON.stringify(obj), "utf-8");
  } catch {}
}

function loadSessionsFromDisk(): Map<string, any> {
  const map = new Map<string, any>();
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
      if (typeof data === "object" && data !== null) {
        Object.entries(data).forEach(([k, v]) => map.set(k, v));
      }
    }
  } catch {}
  return map;
}

function saveSessionsToDisk(map: Map<string, any>) {
  try {
    const obj: Record<string, any> = {};
    map.forEach((v, k) => {
      obj[k] = v;
    });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj), "utf-8");
  } catch {}
}

// Persistent exam package registry for short-link resolution across devices
const sharedExamsRegistry = loadExamsFromDisk();

// Persistent Google Drive exams registry for direct cloud file matching
const gdriveExamsRegistry = loadGDriveIndexFromDisk();

// Cached last known Google Drive access token for proxying student requests
let lastKnownDriveToken = "";

// Persistent Student Sessions Registry for live monitoring & grading
const studentSessionsRegistry = loadSessionsFromDisk();

// Registry of reset sessions to actively tell student devices to stop and reset
interface ResetSessionRecord {
  resetAt: number;
  sessionId?: string;
  studentName?: string;
  examCode?: string;
  nisn?: string;
}
const resetSessionsRegistry = new Map<string, ResetSessionRecord>();

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    examsCount: sharedExamsRegistry.size,
    gdriveCount: gdriveExamsRegistry.size,
    sessionsCount: studentSessionsRegistry.size,
    timestamp: new Date().toISOString(),
  });
});

// Register an exam uploaded to Google Drive
app.post("/api/gdrive/register-exam", (req, res) => {
  try {
    const { code, fileId, fileName, webViewLink, downloadUrl, exam, accessToken } = req.body;
    if (!fileId && !code) {
      return res.status(400).json({ success: false, message: "File ID or code is required" });
    }

    if (accessToken && typeof accessToken === "string") {
      lastKnownDriveToken = accessToken;
    }

    const cleanCode = (code || exam?.code || "").trim().toUpperCase();
    const cleanFileName = (fileName || exam?.title || "").trim();

    const entry = {
      code: cleanCode,
      fileId: fileId || "",
      fileName: cleanFileName,
      webViewLink: webViewLink || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : ""),
      downloadUrl: downloadUrl || (fileId ? `https://drive.google.com/uc?id=${fileId}&export=download` : ""),
      exam: exam || null,
      updatedAt: new Date().toISOString(),
    };

    if (cleanCode) {
      gdriveExamsRegistry.set(cleanCode, entry);
    }
    if (fileId) {
      gdriveExamsRegistry.set(`ID_${fileId}`, entry);
      gdriveExamsRegistry.set(fileId, entry);
    }
    if (cleanFileName) {
      gdriveExamsRegistry.set(`FN_${cleanFileName.toUpperCase()}`, entry);
    }

    saveGDriveIndexToDisk(gdriveExamsRegistry);

    // Also populate sharedExamsRegistry if exam payload is provided
    if (exam && (exam.id || cleanCode)) {
      const examRecord = {
        exam,
        token: exam.sessionToken,
        tokens: exam.tokens || [],
        gdriveFileId: fileId || exam.gdriveFileId || "",
        gdriveFileName: cleanFileName,
        updatedAt: new Date().toISOString(),
      };
      if (exam.id) sharedExamsRegistry.set(exam.id, examRecord);
      if (cleanCode) sharedExamsRegistry.set(cleanCode, examRecord);
      if (fileId) sharedExamsRegistry.set(`DRIVE_${fileId}`, examRecord);
      saveExamsToDisk(sharedExamsRegistry);
    }

    res.json({ success: true, entry });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Failed to register Drive file" });
  }
});

// Proxy download exam directly from Google Drive without CORS or cookie issues
app.get("/api/gdrive/exam/:fileId", async (req, res) => {
  const fileId = (req.params.fileId || "").trim();
  if (!fileId) {
    return res.status(400).json({ success: false, message: "Missing Google Drive file ID" });
  }

  // 1. Check if we already have it in memory/disk
  let cached = gdriveExamsRegistry.get(`ID_${fileId}`) || gdriveExamsRegistry.get(fileId);
  if (!cached) {
    for (const [_, entry] of gdriveExamsRegistry.entries()) {
      if (
        entry?.fileId === fileId ||
        (entry?.code && entry.code.toUpperCase() === fileId.toUpperCase()) ||
        (entry?.fileName && entry.fileName.toUpperCase() === fileId.toUpperCase())
      ) {
        cached = entry;
        break;
      }
    }
  }
  if (cached?.exam && Array.isArray(cached.exam.questions) && cached.exam.questions.length > 0) {
    return res.json({ success: true, exam: cached.exam, source: "cache" });
  }

  // 2. Also check if any exam in sharedExamsRegistry matches this fileId or code
  let matchedFromShare: any = null;
  for (const [_, val] of sharedExamsRegistry.entries()) {
    if (
      val?.exam?.gdriveFileId === fileId ||
      val?.gdriveFileId === fileId ||
      val?.exam?.id === fileId ||
      (val?.exam?.code && val.exam.code.toUpperCase() === fileId.toUpperCase())
    ) {
      matchedFromShare = val.exam;
      break;
    }
  }
  if (matchedFromShare && Array.isArray(matchedFromShare.questions) && matchedFromShare.questions.length > 0) {
    return res.json({ success: true, exam: matchedFromShare, source: "sharedRegistry" });
  }

  try {
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    let driveAuthHeader = req.headers.authorization || (req.query.token ? `Bearer ${req.query.token}` : "");
    if (!driveAuthHeader && lastKnownDriveToken) {
      driveAuthHeader = `Bearer ${lastKnownDriveToken}`;
    }

    let examData: any = null;
    let lastError: any = null;

    // 1. If auth token provided or cached, try official Drive API v3 endpoint first
    if (driveAuthHeader) {
      try {
        const apiRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
          {
            headers: {
              Authorization: driveAuthHeader,
              "User-Agent": userAgent,
            },
          }
        );
        if (apiRes.ok) {
          const apiJson = await apiRes.json();
          if (apiJson && (Array.isArray(apiJson.questions) || Array.isArray(apiJson.items))) {
            examData = apiJson;
          }
        } else if (apiRes.status === 401) {
          console.warn(
            `[Server Drive Proxy] Auth token for file ${fileId} expired (401). Falling back to public endpoints.`
          );
          driveAuthHeader = "";
        }
      } catch (err) {
        lastError = err;
      }
    }

    // 2. If not found or no valid token, try public Google Drive web download endpoints
    if (!examData) {
      const publicUrls = [
        `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
        `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
        `https://drive.google.com/uc?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
        `https://drive.google.com/uc?id=${encodeURIComponent(fileId)}&export=download`,
        `https://docs.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
      ];

      let isRestricted = false;
      let restrictionMessage = "";

      for (const url of publicUrls) {
        try {
          const driveRes = await fetch(url, {
            redirect: "follow",
            headers: {
              "User-Agent": userAgent,
              Accept: "application/json, text/plain, */*",
            },
          });

          if (driveRes.status === 403) {
            isRestricted = true;
            restrictionMessage =
              "Akses ditolak oleh Google Drive (403 Forbidden). Kemungkinan file naskah soal berada di akun @belajar.id yang dibatasi oleh kebijakan organisasi atau belum diubah menjadi 'Siapa saja yang memiliki link'.";
          }

          if (driveRes.ok) {
            const text = await driveRes.text();

            // Check if Google Drive returned an HTML login redirect (typical with Belajar.id domain restrictions)
            if (
              text.includes("accounts.google.com/ServiceLogin") ||
              text.includes("accounts.google.com/v3/signin") ||
              text.includes("You need access") ||
              text.includes("Perlu izin") ||
              text.includes("Akses ditolak")
            ) {
              isRestricted = true;
              restrictionMessage =
                "File Google Drive meminta login akun organisasi (kebijakan domain @belajar.id). File tidak dapat diakses secara publik oleh browser siswa atau server.";
            }

            try {
              const parsed = JSON.parse(text);
              if (parsed && (Array.isArray(parsed.questions) || Array.isArray(parsed.items))) {
                examData = parsed;
                isRestricted = false;
                break;
              }
            } catch {
              // Check if Google Drive returned a virus scan confirmation page with a link
              const matchConfirm =
                text.match(/href="(\/uc\?export=download[^"]+)"/i) ||
                text.match(/href="(https:\/\/drive\.google\.com\/uc\?export=download[^"]+)"/i) ||
                text.match(/action="(https:\/\/drive\.google\.com\/[^"]+)"/i);
              if (matchConfirm && matchConfirm[1]) {
                const confirmUrl = matchConfirm[1].startsWith("http")
                  ? matchConfirm[1]
                  : `https://drive.google.com${matchConfirm[1]}`;
                try {
                  const confirmRes = await fetch(confirmUrl, {
                    headers: { "User-Agent": userAgent },
                    redirect: "follow",
                  });
                  if (confirmRes.ok) {
                    const confirmText = await confirmRes.text();
                    const confirmParsed = JSON.parse(confirmText);
                    if (confirmParsed && Array.isArray(confirmParsed.questions)) {
                      examData = confirmParsed;
                      isRestricted = false;
                      break;
                    }
                  }
                } catch {}
              }
            }
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (!examData && isRestricted) {
        // Fallback: check if any exam in sharedExamsRegistry has this gdriveFileId
        let fallbackShare: any = null;
        sharedExamsRegistry.forEach((val) => {
          if (val?.exam?.gdriveFileId === fileId || val?.gdriveFileId === fileId) {
            fallbackShare = val.exam;
          }
        });
        if (fallbackShare) {
          return res.json({ success: true, exam: fallbackShare, source: "sharedRegistry" });
        }

        return res.status(403).json({
          success: false,
          isDomainRestricted: true,
          message:
            restrictionMessage ||
            `Akses naskah soal Google Drive (${fileId}) ditolak. Kebijakan akun @belajar.id membatasi akses di luar domain organisasi. Harap gunakan akun Gmail pribadi (@gmail.com) atau gunakan Link Paket Mandiri (Anti-Gagal).`,
        });
      }
    }

    if (!examData) {
      // Fallback: check if any exam in sharedExamsRegistry has this gdriveFileId
      let fallbackShare: any = null;
      sharedExamsRegistry.forEach((val) => {
        if (val?.exam?.gdriveFileId === fileId || val?.gdriveFileId === fileId) {
          fallbackShare = val.exam;
        }
      });
      if (fallbackShare) {
        return res.json({ success: true, exam: fallbackShare, source: "sharedRegistry" });
      }

      return res.status(404).json({
        success: false,
        message: `Gagal mengunduh file Google Drive dengan ID "${fileId}". Pastikan file dibagikan dengan akses 'Siapa saja yang memiliki link' atau gunakan alternatif link Google Drive.`,
      });
    }

    // Attach drive properties
    const completeExam = {
      ...examData,
      gdriveFileId: fileId,
      gdriveSyncedAt: new Date().toISOString(),
    };

    // Cache it
    const newEntry = {
      code: completeExam.code ? completeExam.code.toUpperCase() : "",
      fileId,
      fileName: completeExam.title || `Exam_${fileId}`,
      webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
      downloadUrl: `https://drive.google.com/uc?id=${fileId}&export=download`,
      exam: completeExam,
      updatedAt: new Date().toISOString(),
    };
    gdriveExamsRegistry.set(`ID_${fileId}`, newEntry);
    gdriveExamsRegistry.set(fileId, newEntry);
    if (newEntry.code) {
      gdriveExamsRegistry.set(newEntry.code, newEntry);
    }
    saveGDriveIndexToDisk(gdriveExamsRegistry);

    res.json({ success: true, exam: completeExam, source: "drive" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Failed to fetch from Google Drive" });
  }
});

// Search Drive Exam Registry by code, file name, or general keyword
app.get("/api/gdrive/search", (req, res) => {
  const query = String(req.query.q || req.query.code || "").trim().toUpperCase();
  if (!query) {
    return res.status(400).json({ success: false, message: "Parameter 'q' atau 'code' diperlukan." });
  }

  // 1. Direct code match
  let direct = gdriveExamsRegistry.get(query);
  if (direct) {
    return res.json({ success: true, item: direct });
  }

  // 2. Scan entries for matching code or filename
  const matches: any[] = [];
  gdriveExamsRegistry.forEach((entry, key) => {
    if (key.startsWith("ID_")) return; // skip redundant ID duplicates in list
    const entryCode = (entry.code || "").toUpperCase();
    const entryName = (entry.fileName || "").toUpperCase();

    if (
      entryCode === query ||
      entryName.includes(query) ||
      (query.length >= 3 && entryCode.includes(query))
    ) {
      matches.push(entry);
    }
  });

  if (matches.length > 0) {
    return res.json({ success: true, item: matches[0], matches });
  }

  // 3. Fallback: check sharedExamsRegistry
  const sharedRecord = sharedExamsRegistry.get(query);
  if (sharedRecord) {
    return res.json({
      success: true,
      item: {
        code: query,
        exam: sharedRecord.exam,
        fileId: sharedRecord.exam?.gdriveFileId || sharedRecord.gdriveFileId,
        fileName: sharedRecord.exam?.gdriveFileName,
      },
    });
  }

  res.status(404).json({ success: false, message: `Naskah soal dengan kueri "${query}" tidak ditemukan di indeks Google Drive.` });
});

// Save or sync shared exam package to server
app.post("/api/exams/share", (req, res) => {
  try {
    const { exam, token, tokens } = req.body;
    if (!exam || !exam.id) {
      return res.status(400).json({ success: false, error: "Invalid exam package payload" });
    }
    const cleanCode = (exam.code || "").trim().toUpperCase();
    const cleanId = (exam.id || "").trim();

    // Preserve tokens associated with this exam
    const rawTokens = Array.isArray(tokens) ? tokens : Array.isArray(exam.tokens) ? exam.tokens : [];
    const examTokens = rawTokens.map((t: any) => ({
      ...t,
      examCode: t.examCode || cleanCode,
    }));

    const record = {
      exam: {
        ...exam,
        tokens: examTokens,
      },
      token: token || exam.sessionToken,
      tokens: examTokens,
      updatedAt: new Date().toISOString(),
    };

    if (cleanId) {
      sharedExamsRegistry.set(cleanId, record);
      sharedExamsRegistry.set(cleanId.toUpperCase(), record);
    }
    if (cleanCode) {
      sharedExamsRegistry.set(cleanCode, record);
      sharedExamsRegistry.set(cleanCode.toUpperCase(), record);
    }

    saveExamsToDisk(sharedExamsRegistry);

    res.json({ success: true, examId: cleanId, code: cleanCode, tokenCount: examTokens.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Failed to share exam" });
  }
});

// List all shared exams
app.get("/api/exams", (req, res) => {
  const examsList: any[] = [];
  const seenIds = new Set<string>();
  sharedExamsRegistry.forEach((record) => {
    if (record?.exam?.id && !seenIds.has(record.exam.id)) {
      seenIds.add(record.exam.id);
      examsList.push(record.exam);
    }
  });
  res.json({ success: true, exams: examsList });
});

// Endpoint to get Google Apps Script Code.gs content
app.get("/api/gas/code", (req, res) => {
  try {
    const codePath = path.join(process.cwd(), "google-apps-script", "Code.gs");
    if (fs.existsSync(codePath)) {
      const code = fs.readFileSync(codePath, "utf-8");
      return res.json({ success: true, code });
    }
    return res.status(404).json({ success: false, message: "Code.gs tidak ditemukan" });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message });
  }
});

// Retrieve shared exam package by code or ID
const handleGetExamByCode = async (req: any, res: any) => {
  const code = (req.params.code || req.params.codeOrId || "").trim();
  const upperCode = code.toUpperCase();
  let record = sharedExamsRegistry.get(code) || sharedExamsRegistry.get(upperCode);

  if (!record) {
    // Check if gdriveExamsRegistry has this code, ID, or filename
    let driveEntry =
      gdriveExamsRegistry.get(code) ||
      gdriveExamsRegistry.get(upperCode) ||
      gdriveExamsRegistry.get(`ID_${code}`) ||
      gdriveExamsRegistry.get(`ID_${upperCode}`);

    if (!driveEntry) {
      for (const [_, entry] of gdriveExamsRegistry.entries()) {
        if (
          entry?.fileId === code ||
          (entry?.code && entry.code.toUpperCase() === upperCode) ||
          (entry?.fileName && entry.fileName.toUpperCase() === upperCode)
        ) {
          driveEntry = entry;
          break;
        }
      }
    }

    if (driveEntry && driveEntry.exam) {
      record = {
        exam: driveEntry.exam,
        token: driveEntry.exam.sessionToken,
        tokens: driveEntry.exam.tokens || [],
        gdriveFileId: driveEntry.fileId,
        gdriveFileName: driveEntry.fileName,
      };
    }
  }

  // Also scan sharedExamsRegistry values by exam.code, exam.gdriveFileId, or exam.id
  if (!record) {
    for (const [_, val] of sharedExamsRegistry.entries()) {
      if (
        (val?.exam?.code && val.exam.code.toUpperCase() === upperCode) ||
        val?.exam?.gdriveFileId === code ||
        val?.gdriveFileId === code ||
        val?.exam?.id === code
      ) {
        record = val;
        break;
      }
    }
  }

  if (!record) {
    return res.status(404).json({ success: false, message: `Naskah soal dengan kode atau ID '${code}' belum ditemukan di server.` });
  }

  res.json({ success: true, ...record });
};

app.get("/api/exams/by-code/:code", handleGetExamByCode);
app.get("/api/exams/share/:code", handleGetExamByCode);
app.get("/api/exams/code/:code", handleGetExamByCode);
app.get("/api/exams/:codeOrId", (req, res, next) => {
  if (req.params.codeOrId === "share" || req.params.codeOrId === "by-code") return next();
  handleGetExamByCode(req, res);
});

// Record or update student session (2-way sync from student device to teacher)
app.post("/api/sessions", (req, res) => {
  try {
    const session = req.body;
    if (!session || !session.id) {
      return res.status(400).json({ success: false, message: "Invalid session payload" });
    }
    const cleanId = String(session.id).trim();
    const cleanName = String(session.studentName || "").trim().toLowerCase();
    const cleanCode = String(session.examCode || "").trim().toUpperCase();
    const cleanNisn = String(session.nisn || "").trim();

    // Check if this specific session was marked as reset by teacher
    const nameCodeKey = cleanName && cleanCode ? `${cleanName}__${cleanCode}` : "";
    const nisnCodeKey = cleanNisn && cleanCode ? `${cleanNisn}__${cleanCode}` : "";

    const resetRecord =
      resetSessionsRegistry.get(cleanId) ||
      (nameCodeKey ? resetSessionsRegistry.get(nameCodeKey) : undefined) ||
      (nisnCodeKey ? resetSessionsRegistry.get(nisnCodeKey) : undefined);

    if (resetRecord) {
      const sessionStartTime = session.startTime ? new Date(session.startTime).getTime() : 0;
      // If this is the OLD session created BEFORE the reset timestamp, reject it and notify device to reset!
      if (sessionStartTime <= resetRecord.resetAt && cleanId === resetRecord.sessionId) {
        return res.json({
          success: false,
          isReset: true,
          message: "Sesi ujian ini telah di-reset oleh Guru / Pengawas.",
        });
      }
      // If student restarted with a new session (created after resetAt, or a fresh sessionId), clear reset entry!
      if (sessionStartTime > resetRecord.resetAt || (resetRecord.sessionId && cleanId !== resetRecord.sessionId)) {
        if (resetRecord.sessionId) resetSessionsRegistry.delete(resetRecord.sessionId);
        if (nameCodeKey) resetSessionsRegistry.delete(nameCodeKey);
        if (nisnCodeKey) resetSessionsRegistry.delete(nisnCodeKey);
      }
    }

    studentSessionsRegistry.set(cleanId, {
      ...session,
      serverReceivedAt: new Date().toISOString(),
    });

    saveSessionsToDisk(studentSessionsRegistry);

    res.json({ success: true, sessionId: cleanId, isReset: false });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Failed to save session" });
  }
});

// Check if a session has been reset
app.get("/api/sessions/status/:sessionId", (req, res) => {
  const cleanId = decodeURIComponent(req.params.sessionId || "").trim();
  const reset = resetSessionsRegistry.has(cleanId);
  const exists = studentSessionsRegistry.has(cleanId);
  res.json({
    success: true,
    isReset: reset,
    exists,
    session: exists ? studentSessionsRegistry.get(cleanId) : null,
  });
});

// Get all student sessions or filter by exam code / exam ID
app.get("/api/sessions", (req, res) => {
  const allSessions = Array.from(studentSessionsRegistry.values());
  res.json({ success: true, sessions: allSessions });
});

app.get("/api/sessions/by-exam/:codeOrId", (req, res) => {
  const target = (req.params.codeOrId || "").trim().toUpperCase();
  const matched: any[] = [];
  studentSessionsRegistry.forEach((session) => {
    const sId = (session.examId || "").trim().toUpperCase();
    const sCode = (session.examCode || "").trim().toUpperCase();
    if (target === "ALL" || !target || sId === target || sCode === target) {
      matched.push(session);
    }
  });
  res.json({ success: true, sessions: matched });
});

// Delete or reset student session
app.delete("/api/sessions/:sessionId", (req, res) => {
  const id = decodeURIComponent(req.params.sessionId || "").trim();
  const examCode = String(req.query.examCode || req.body?.examCode || "").trim().toUpperCase();
  const studentName = String(req.query.studentName || req.body?.studentName || "").trim().toLowerCase();
  const nisn = String(req.query.nisn || req.body?.nisn || "").trim();
  const now = Date.now();

  // Record into reset registry so active student devices are actively told to reset
  if (id) {
    resetSessionsRegistry.set(id, { resetAt: now, sessionId: id, examCode, studentName, nisn });
  }
  if (studentName && examCode) {
    resetSessionsRegistry.set(`${studentName}__${examCode}`, { resetAt: now, sessionId: id, examCode, studentName, nisn });
  }
  if (nisn && examCode) {
    resetSessionsRegistry.set(`${nisn}__${examCode}`, { resetAt: now, sessionId: id, examCode, studentName, nisn });
  }

  // Direct delete
  studentSessionsRegistry.delete(id);

  // Purge matching by id, or strictly by (studentName && (examCode || nisn)), NEVER by bare token!
  const toDelete: string[] = [];
  studentSessionsRegistry.forEach((session, key) => {
    const sId = String(session.id || "").trim();
    const sName = String(session.studentName || "").trim().toLowerCase();
    const sCode = String(session.examCode || "").trim().toUpperCase();
    const sNisn = String(session.nisn || "").trim();

    const matchId = key === id || sId === id;
    const matchNameAndExam = studentName && sName === studentName && (!examCode || sCode === examCode);
    const matchNisnAndExam = nisn && sNisn === nisn && (!examCode || sCode === examCode);

    if (matchId || matchNameAndExam || matchNisnAndExam) {
      toDelete.push(key);
    }
  });

  toDelete.forEach((k) => studentSessionsRegistry.delete(k));
  saveSessionsToDisk(studentSessionsRegistry);
  res.json({ success: true, message: `Session ${id} deleted`, deletedCount: toDelete.length });
});

// Batch delete sessions by IDs, tokens, or student names
app.post("/api/sessions/batch-delete", (req, res) => {
  try {
    const { sessionIds = [], studentNames = [], nisns = [], examCode, examId } = req.body || {};
    const lowerNames = new Set<string>((studentNames || []).map((n: string) => String(n).trim().toLowerCase()));
    const idSet = new Set<string>((sessionIds || []).map((i: string) => String(i).trim()));
    const nisnSet = new Set<string>((nisns || []).map((n: string) => String(n).trim()));
    const cleanExamCode = examCode ? String(examCode).trim().toUpperCase() : null;
    const cleanExamId = examId ? String(examId).trim() : null;
    const now = Date.now();

    // Register all in reset registry
    idSet.forEach((sid: string) => {
      resetSessionsRegistry.set(sid, { resetAt: now, sessionId: sid, examCode: cleanExamCode || undefined });
    });
    lowerNames.forEach((name: string) => {
      if (cleanExamCode) {
        resetSessionsRegistry.set(`${name}__${cleanExamCode}`, { resetAt: now, studentName: name, examCode: cleanExamCode });
      }
    });

    const toDelete: string[] = [];
    studentSessionsRegistry.forEach((session, key) => {
      const sId = String(session.id || "").trim();
      const sName = String(session.studentName || "").trim().toLowerCase();
      const sNisn = String(session.nisn || "").trim();
      const sCode = String(session.examCode || "").trim().toUpperCase();
      const sExamId = String(session.examId || "").trim();

      const matchId = idSet.has(key) || (sId && idSet.has(sId));
      const matchName = sName && lowerNames.has(sName) && (!cleanExamCode || sCode === cleanExamCode);
      const matchNisn = sNisn && nisnSet.has(sNisn) && (!cleanExamCode || sCode === cleanExamCode);
      const matchExamOnly = (!idSet.size && !lowerNames.size && !nisnSet.size) &&
                            ((cleanExamCode && sCode === cleanExamCode) || (cleanExamId && sExamId === cleanExamId));

      if (matchId || matchName || matchNisn || matchExamOnly) {
        toDelete.push(key);
      }
    });

    toDelete.forEach((k) => studentSessionsRegistry.delete(k));
    saveSessionsToDisk(studentSessionsRegistry);
    res.json({ success: true, deletedCount: toDelete.length, message: `${toDelete.length} sesi berhasil dihapus` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Failed to batch delete sessions" });
  }
});

// Reconcile and unify student sessions with mismatched exam codes for the same examId
app.post("/api/sessions/reconcile", (req, res) => {
  try {
    const { examId, canonicalCode } = req.body || {};
    if (!examId || !canonicalCode) {
      return res.status(400).json({ success: false, message: "Missing examId or canonicalCode" });
    }
    const cleanId = String(examId).trim();
    const cleanCode = String(canonicalCode).trim().toUpperCase();
    let updatedCount = 0;

    studentSessionsRegistry.forEach((session, key) => {
      if (session && String(session.examId || "").trim() === cleanId) {
        const currentCode = String(session.examCode || "").trim().toUpperCase();
        if (currentCode !== cleanCode) {
          session.examCode = cleanCode;
          studentSessionsRegistry.set(key, session);
          updatedCount++;
        }
      }
    });

    if (updatedCount > 0) {
      saveSessionsToDisk(studentSessionsRegistry);
    }

    res.json({ success: true, updatedCount, canonicalCode, examId: cleanId });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Failed to reconcile sessions" });
  }
});

// Check Gemini API Key Status
app.get("/api/gemini/status", (req, res) => {
  const headerKey = req.headers["x-gemini-api-key"] as string | undefined;
  const envKey = process.env.GEMINI_API_KEY;
  const activeKey = (headerKey && headerKey.trim()) || (envKey && envKey.trim()) || "";

  if (!activeKey) {
    return res.json({
      configured: false,
      source: "none",
      message: "Kunci API Gemini belum terhubung.",
      model: "gemini-3.7-flash",
    });
  }

  const maskedKey =
    activeKey.length > 8
      ? `${activeKey.slice(0, 4)}••••••••${activeKey.slice(-4)}`
      : "••••••••";

  res.json({
    configured: true,
    source: headerKey ? "custom" : "env",
    maskedKey,
    model: "gemini-3.7-flash",
    message: headerKey
      ? "Kunci API Gemini kustom aktif dan terhubung."
      : "Kunci API Gemini sistem server aktif dan terhubung.",
  });
});

// Test Gemini Connection
app.post("/api/gemini/test-connection", async (req, res) => {
  const startTime = Date.now();
  try {
    const customKey = (req.headers["x-gemini-api-key"] as string) || req.body?.apiKey;
    const ai = getGeminiClient(customKey);

    const { response, modelUsed } = await callGeminiWithResilience(ai, {
      preferredModel: "gemini-3.6-flash",
      fallbackModels: ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"],
      contents: "Balas dengan tepat satu kata: Siap.",
      config: {
        systemInstruction: "Anda adalah asisten AI pemeriksa status koneksi.",
      },
      maxRetries: 2,
    });

    const latencyMs = Date.now() - startTime;
    res.json({
      success: true,
      message: `Koneksi ke Google Gemini AI (${modelUsed}) berhasil terhubung!`,
      latencyMs,
      reply: response.text?.trim() || "Siap.",
      modelUsed,
    });
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    console.error("Gemini test connection failed:", error);
    res.status(400).json({
      success: false,
      error: formatGeminiError(error),
      latencyMs,
    });
  }
});

// AI Question Generator Endpoint
app.post("/api/gemini/generate-questions", async (req, res) => {
  try {
    const customKey = (req.headers["x-gemini-api-key"] as string) || req.body?.apiKey;
    const {
      subject,
      gradeLevel,
      topic,
      count = 5,
      difficulty = "sedang",
      questionType = "pilihan_ganda",
      additionalInstructions = "",
      defaultScorePerQuestion = 10,
    } = req.body;

    const ai = getGeminiClient(customKey);

    const typeGuide =
      questionType === "menjodohkan"
        ? "Tipe Soal: menjodohkan (berikan minimal 3-4 pasang pernyataan kiri 'left' dan pasangan cocok 'right' pada matchingPairs, serta kunci jawaban). "
        : questionType === "isian_singkat"
        ? "Tipe Soal: isian_singkat (pertanyaan langsung dengan jawaban singkat 1-3 kata pada correctAnswer). "
        : questionType === "uraian"
        ? "Tipe Soal: uraian (pertanyaan esai/analisis mendalam dengan rubrik atau contoh jawaban ideal pada sampleAnswer). "
        : "Tipe Soal: pilihan_ganda (4-5 opsi A, B, C, D, E dengan kunci correctAnswer huruf kapital). ";

    const prompt = `Anda adalah seorang ahli pembuat soal ujian kurikulum merdeka / nasional Indonesia yang sangat berpengalaman.
Buatlah ${count} butir soal ujian dengan ketentuan:
- Mata Pelajaran: ${subject || "Umum"}
- Jenjang / Kelas: ${gradeLevel || "SMP / SMA"}
- Topik / Materi: ${topic || "Umum"}
- Tingkat Kesukaran: ${difficulty} (mudah, sedang, sukar, atau variatif HOTS)
- Tipe Soal Utama: ${questionType}. ${typeGuide}
- Bobot Nilai per Soal: ${defaultScorePerQuestion} poin
- Instruksi Tambahan: ${additionalInstructions || "Sajikan soal berbasis stimulus kontekstual, studi kasus nyata, atau data penalaran"}

Kembalikan format JSON yang valid persis sesuai skema yang diminta.`;

    const { response, modelUsed } = await callGeminiWithResilience(ai, {
      preferredModel: "gemini-3.6-flash",
      fallbackModels: ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"],
      contents: prompt,
      config: {
        systemInstruction:
          "Anda adalah pembuat soal ujian profesional. Berikan soal berkualitas tinggi, stimulus bacaan/kasus relevan, kunci jawaban tepat, dan pembahasan lengkap.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            examTitle: { type: Type.STRING, description: "Judul paket ujian yang sesuai materi" },
            subject: { type: Type.STRING, description: "Nama mata pelajaran" },
            gradeLevel: { type: Type.STRING, description: "Jenjang atau kelas" },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: "Unique ID e.g. q1, q2" },
                  questionNumber: { type: Type.INTEGER, description: "Nomor urut soal" },
                  stimulus: { type: Type.STRING, description: "Teks stimulus, narasi kasus, atau tabel pendukung" },
                  questionText: { type: Type.STRING, description: "Pertanyaan inti yang jelas dan tegas" },
                  type: { type: Type.STRING, description: "pilihan_ganda | menjodohkan | isian_singkat | uraian" },
                  options: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        key: { type: Type.STRING, description: "A, B, C, D, atau E" },
                        text: { type: Type.STRING, description: "Teks isi pilihan jawaban" },
                      },
                      required: ["key", "text"],
                    },
                    description: "Daftar opsi untuk pilihan ganda",
                  },
                  matchingPairs: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        left: { type: Type.STRING, description: "Pernyataan / Item Kiri" },
                        right: { type: Type.STRING, description: "Pasangan Cocok / Item Kanan" },
                      },
                      required: ["left", "right"],
                    },
                    description: "Daftar pasangan untuk tipe soal menjodohkan",
                  },
                  correctAnswer: { type: Type.STRING, description: "Kunci jawaban benar (huruf A-E, kata isian singkat, atau format matching)" },
                  score: { type: Type.NUMBER, description: "Bobot skor nilai butir soal ini" },
                  explanation: { type: Type.STRING, description: "Pembahasan lengkap dan alasan rasional jawaban benar" },
                  sampleAnswer: { type: Type.STRING, description: "Rubrik / contoh jawaban ideal untuk soal uraian" },
                  cognitiveLevel: { type: Type.STRING, description: "Level kognitif: C1, C2, C3, C4, C5, C6 (HOTS)" },
                  topicTag: { type: Type.STRING, description: "Subtopik materi spesifik" },
                },
                required: ["questionText", "correctAnswer", "score", "explanation"],
              },
            },
          },
          required: ["examTitle", "questions"],
        },
      },
    });

    const outputText = response.text || "{}";
    const parsedData = JSON.parse(outputText);

    res.json({ success: true, data: parsedData, modelUsed });
  } catch (error: any) {
    console.error("Error generating questions with Gemini:", error);
    res.status(500).json({
      success: false,
      error: formatGeminiError(error),
    });
  }
});

// AI Question Image Generator Endpoint
app.post("/api/gemini/generate-image", async (req, res) => {
  try {
    const customKey = (req.headers["x-gemini-api-key"] as string) || req.body?.apiKey;
    const { prompt, subject = "Pendidikan", questionContext = "" } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ success: false, error: "Prompt gambar tidak boleh kosong." });
    }

    const ai = getGeminiClient(customKey);

    // Strategy 1: Try Imagen 3 first if supported
    try {
      const imagenRes = await ai.models.generateImages({
        model: "imagen-3.0-generate-002",
        prompt: `Educational illustration for high school exam question: ${prompt.trim()}. Clear, accurate, educational diagram, vector style, white or dark background, no blurry text, high contrast.`,
        config: {
          numberOfImages: 1,
          outputMimeType: "image/jpeg",
          aspectRatio: "4:3",
        },
      });

      if (imagenRes.generatedImages && imagenRes.generatedImages[0]?.image?.imageBytes) {
        const base64Data = imagenRes.generatedImages[0].image.imageBytes;
        const dataUrl = `data:image/jpeg;base64,${base64Data}`;
        return res.json({
          success: true,
          imageUrl: dataUrl,
          caption: prompt.trim(),
          source: "imagen-3",
        });
      }
    } catch (imagenErr) {
      console.log("Imagen 3 generation unavailable, falling back to SVG diagram generation:", imagenErr);
    }

    // Strategy 2: Generate crisp, clean pedagogical SVG illustration with Gemini Flash
    const svgPrompt = `Anda adalah desainer grafis materi edukasi dan diagram ilmiah profesional.
Buatlah ilustrasi grafis/diagram vektor SVG yang mendidik, jelas, presisi, dan indah berdasarkan prompt berikut:
"${prompt.trim()}"
Konteks Soal / Pelajaran: ${subject}. ${questionContext ? `Konteks: ${questionContext}` : ""}

Ketentuan SVG:
- Output HANYA kode XML <svg>...</svg> murni tanpa markdown, tanpa backtick \`\`\`, tanpa teks lain di luar tag <svg>.
- Gunakan viewBox="0 0 600 400" dengan aspect ratio 3:2 atau 4:3.
- Gunakan skema warna modern, kontras tinggi, elegan (cocok pada background gelap/terang).
- Sertakan label teks yang jelas, panah penunjuk, bentuk geometri / diagram / anatomi yang rapi jika diperlukan.
- Tambahkan background rect bergradasi halus di dalam SVG.`;

    const { response: svgResponse, modelUsed } = await callGeminiWithResilience(ai, {
      preferredModel: "gemini-3.7-flash",
      fallbackModels: ["gemini-flash-latest", "gemini-3.1-flash-lite"],
      contents: svgPrompt,
      config: {
        systemInstruction:
          "Anda hanya menghasilkan kode SVG murni valid yang siap dirender di browser sebagai gambar vektor edukasi.",
      },
    });

    let rawSvg = svgResponse.text?.trim() || "";
    // Clean markdown code fence if model included it
    if (rawSvg.startsWith("```")) {
      rawSvg = rawSvg.replace(/^```(svg|xml)?\s*/i, "").replace(/```\s*$/i, "").trim();
    }

    if (rawSvg.includes("<svg") && rawSvg.includes("</svg>")) {
      const startIdx = rawSvg.indexOf("<svg");
      const endIdx = rawSvg.lastIndexOf("</svg>") + 6;
      const cleanSvg = rawSvg.substring(startIdx, endIdx);
      const encodedSvg = encodeURIComponent(cleanSvg);
      const dataUrl = `data:image/svg+xml;charset=utf-8,${encodedSvg}`;

      return res.json({
        success: true,
        imageUrl: dataUrl,
        caption: prompt.trim(),
        source: `svg_vector_${modelUsed}`,
      });
    }

    throw new Error("Gagal menyusun visual gambar dari prompt yang diberikan.");
  } catch (error: any) {
    console.error("Error generating image:", error);
    res.status(500).json({
      success: false,
      error: formatGeminiError(error),
    });
  }
});

// AI Diagnostic & Remediation feedback for student results
app.post("/api/gemini/analyze-student-remediation", async (req, res) => {
  try {
    const customKey = (req.headers["x-gemini-api-key"] as string) || req.body?.apiKey;
    const { studentName, subject, score, maxScore, wrongQuestions = [], totalQuestions } = req.body;
    const ai = getGeminiClient(customKey);

    const prompt = `Berikan analisis pembelajaran dan rekomendasi remedial personal untuk siswa:
- Nama: ${studentName}
- Mata Pelajaran: ${subject}
- Nilai: ${score} dari ${maxScore} (${Math.round((score / (maxScore || 100)) * 100)}%)
- Soal yang dijawab salah (${wrongQuestions.length} dari ${totalQuestions}):
${wrongQuestions.map((q: any, idx: number) => `${idx + 1}. Topik: ${q.topicTag || "Umum"} | Soal: ${q.questionText} | Jawaban Siswa: ${q.studentAnswer} | Kunci: ${q.correctAnswer} | Pembahasan: ${q.explanation}`).join("\n")}

Berikan:
1. Evaluasi kelebihan dan kelemahan pemahaman konsep siswa
2. Rekomendasi 3 materi spesifik yang perlu dipelajari kembali
3. Kalimat motivasi apresiatif dan membangkitkan semangat belajar siswa.`;

    const { response, modelUsed } = await callGeminiWithResilience(ai, {
      preferredModel: "gemini-3.6-flash",
      fallbackModels: ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"],
      contents: prompt,
      config: {
        systemInstruction: "Anda adalah guru konselor dan evaluator pedagogik yang hangat, memotivasi, dan memberikan saran praktis bagi kemajuan belajar siswa.",
      },
    });

    res.json({ success: true, analysis: response.text, modelUsed });
  } catch (error: any) {
    console.error("Error analyzing student:", error);
    res.status(500).json({ success: false, error: formatGeminiError(error) });
  }
});

// Comprehensive AI Diagnostic, Enrichment & Remedial Generator
app.post("/api/gemini/analyze-student-enrichment-remediation", async (req, res) => {
  try {
    const customKey = (req.headers["x-gemini-api-key"] as string) || req.body?.apiKey;
    const {
      studentName,
      nisn,
      className,
      subject,
      score,
      maxScore = 100,
      passingGrade = 75,
      passed,
      wrongQuestions = [],
      correctQuestions = [],
      totalQuestions = 10,
    } = req.body;

    const ai = getGeminiClient(customKey);
    const percentage = Math.round((Number(score) / (Number(maxScore) || 100)) * 100);
    const isPassed = passed !== undefined ? Boolean(passed) : score >= passingGrade;

    const prompt = `Anda adalah seorang pakar kurikulum, psikolog pendidikan, dan evaluator pembelajaran terkemuka.
Analisis hasil ujian siswa berikut untuk menyusun "Program Pengayaan" dan "Program Remidi":
- Nama Siswa: ${studentName || "Siswa"}
- NISN: ${nisn || "-"}
- Kelas: ${className || "-"}
- Mata Pelajaran: ${subject || "Umum"}
- Nilai Diperoleh: ${score} dari ${maxScore} (${percentage}%)
- Batas Kelulusan KKM: ${passingGrade} (Status: ${isPassed ? "TUNTAS / LULUS" : "BELUM TUNTAS / PERLU REMIDIAL"})
- Total Soal: ${totalQuestions} Butir

Rincian Butir Soal yang Salah (${wrongQuestions.length} butir):
${
  wrongQuestions.length > 0
    ? wrongQuestions
        .slice(0, 10)
        .map(
          (q: any, i: number) =>
            `${i + 1}. [${q.topicTag || "Materi"}] ${q.questionText} | Jawaban Siswa: "${q.studentAnswer}" | Kunci: "${q.correctAnswer}" | Pembahasan: ${q.explanation}`
        )
        .join("\n")
    : "(Tidak ada soal yang salah, siswa meraih nilai sempurna)"
}

Rincian Butir Soal yang Dijawab Benar (${correctQuestions.length} butir):
${
  correctQuestions.length > 0
    ? correctQuestions
        .slice(0, 5)
        .map((q: any, i: number) => `${i + 1}. [${q.topicTag || "Materi"}] ${q.questionText}`)
        .join("\n")
    : "(Belum ada yang benar)"
}

Instruksi Analisis:
1. Diagnosis Miskonsepsi & Evaluasi: Analisis pola kesalahan siswa atau kekuatan pemahaman konsepnya.
2. Program Pengayaan (Enrichment):
   - Jika siswa TUNTAS (${isPassed}), berikan materi pengayaan mendalam, perluasan wawasan konsep, tugas tantangan kontekstual di dunia nyata, serta 2 soal tantangan penalaran tingkat tinggi (HOTS).
   - Jika siswa belum tuntas, tetap berikan arahan pengayaan motivasional untuk dicapai setelah remedial.
3. Program Remidi (Remedial):
   - Rincikan materi spesifik yang belum dipahami siswa.
   - Berikan klarifikasi konsep inti yang mudah dipahami (dengan analogi atau langkah logis).
   - Susun langkah-langkah perbaikan belajar konkret.
   - Sediakan 2 butir soal latihan pemantapan beserta petunjuk (hint) dan kunci jawaban.
4. Motivasi: Pesan penyemangat yang hangat, suportif, dan membangun growth mindset.

Kembalikan respon DALAM FORMAT JSON PERSIS SESUAI SKEMA.`;

    const { response, modelUsed } = await callGeminiWithResilience(ai, {
      preferredModel: "gemini-3.6-flash",
      fallbackModels: ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"],
      contents: prompt,
      config: {
        systemInstruction:
          "Anda adalah guru evaluator pembelajaran profesional yang merumuskan diagnosis belajar, program pengayaan, dan program remedial berbasis data hasil ujian siswa.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            passed: { type: Type.BOOLEAN, description: "Status kelulusan KKM" },
            score: { type: Type.NUMBER },
            maxScore: { type: Type.NUMBER },
            percentage: { type: Type.NUMBER },
            diagnosis: { type: Type.STRING, description: "Diagnosis mendalam pola pemahaman siswa dan evaluasi pedagogis" },
            misconceptions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Daftar miskonsepsi atau materi yang keliru dipahami",
            },
            recommendedTopics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Topik-topik yang perlu dipelajari kembali atau diperdalam",
            },
            enrichment: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: "Judul Program Pengayaan" },
                targetCompetencies: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Kompetensi lanjutan yang dibidik",
                },
                advancedMaterials: { type: Type.STRING, description: "Uraian materi pengayaan tingkat lanjut" },
                creativeTask: { type: Type.STRING, description: "Aktivitas proyek / studi kasus nyata aplikatif" },
                hotsChallenges: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING, description: "Soal tantangan penalaran HOTS" },
                      guidance: { type: Type.STRING, description: "Petunjuk pemecahan masalah" },
                    },
                    required: ["question", "guidance"],
                  },
                  description: "Soal tantangan pengayaan HOTS",
                },
              },
              required: ["title", "targetCompetencies", "advancedMaterials", "creativeTask"],
            },
            remediation: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: "Judul Program Remidi" },
                targetDeficits: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Daftar materi defisit / butir yang perlu remedial",
                },
                conceptClarification: { type: Type.STRING, description: "Klarifikasi dan penjelasan ulang konsep yang keliru" },
                remedialSteps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Langkah-langkah terarah perbaikan belajar siswa",
                },
                guidedQuestions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING, description: "Soal latihan perbaikan konsep" },
                      hint: { type: Type.STRING, description: "Petunjuk berpikir" },
                      answer: { type: Type.STRING, description: "Kunci / solusi ringkas" },
                    },
                    required: ["question", "hint"],
                  },
                  description: "Latihan soal terarah remedial",
                },
              },
              required: ["title", "targetDeficits", "conceptClarification", "remedialSteps"],
            },
            motivation: { type: Type.STRING, description: "Kalimat motivasi apresiatif untuk siswa" },
          },
          required: ["passed", "diagnosis", "enrichment", "remediation", "motivation"],
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    res.json({
      success: true,
      analysis: {
        ...parsed,
        score,
        maxScore,
        percentage,
        passed: isPassed,
        generatedAt: new Date().toISOString(),
      },
      modelUsed,
    });
  } catch (error: any) {
    console.error("Error generating enrichment and remediation:", error);
    res.status(500).json({ success: false, error: formatGeminiError(error) });
  }
});

// AI Essay Auto-Grading based on rubric or answer key
app.post("/api/gemini/grade-essay", async (req, res) => {
  try {
    const customKey = (req.headers["x-gemini-api-key"] as string) || req.body?.apiKey;
    const { questionText, correctAnswer, rubric, studentAnswer, maxScore = 10 } = req.body;
    const ai = getGeminiClient(customKey);

    const prompt = `Koreksi jawaban esai siswa berikut berdasarkan kunci jawaban/rubrik ini:
- Soal: ${questionText}
- Kunci Jawaban / Model Jawaban: ${correctAnswer || "-"}
- Panduan Rubrik Penilaian: ${rubric || "Nilai ketepatan konsep, kelengkapan argumen, dan logika penalaran."}
- Bobot Nilai Maksimal: ${maxScore} Poin
- Jawaban Siswa: "${studentAnswer || "(Kosong / Tidak menjawab)"}"

Tugas Anda:
1. Berikan skor numerik yang adil dan proporsional antara 0 hingga ${maxScore} (bisa desimal 0.5 jika perlu).
2. Berikan feedback penjelasan singkat (1-3 kalimat) mengapa skor tersebut diberikan dan koreksi konsep jika ada kekeliruan.`;

    const { response, modelUsed } = await callGeminiWithResilience(ai, {
      preferredModel: "gemini-3.6-flash",
      fallbackModels: ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"],
      contents: prompt,
      config: {
        systemInstruction:
          "Anda adalah penilai ujian profesional dan objektif yang mengoreksi jawaban esai siswa secara adil sesuai rubrik.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: {
              type: Type.NUMBER,
              description: `Skor nilai yang diperoleh siswa (rentang 0 sampai ${maxScore})`,
            },
            feedback: {
              type: Type.STRING,
              description: "Penjelasan alasan pemberian skor dan koreksi jawaban secara pedagogik",
            },
          },
          required: ["score", "feedback"],
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    const awardedScore = Math.max(0, Math.min(Number(parsed.score) || 0, maxScore));

    res.json({
      success: true,
      score: awardedScore,
      feedback: parsed.feedback || "Telah dikoreksi oleh AI.",
      modelUsed,
    });
  } catch (error: any) {
    console.error("Error grading essay:", error);
    res.status(500).json({ success: false, error: formatGeminiError(error) });
  }
});

// Endpoint to retrieve the Google Apps Script backend template (Code.gs)
app.get("/api/gas-code", (req, res) => {
  try {
    const filePath = path.join(process.cwd(), "google-apps-script", "Code.gs");
    if (fs.existsSync(filePath)) {
      const code = fs.readFileSync(filePath, "utf-8");
      return res.json({ success: true, code });
    }
    return res.status(404).json({ success: false, error: "File Code.gs tidak ditemukan." });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Vite middleware for development & static serving for production
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SlideExam CBT Server running on http://0.0.0.0:${PORT}`);
  });
}

setupVite();
