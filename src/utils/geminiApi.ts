import { GoogleGenAI, Type } from "@google/genai";
import { getCustomGeminiApiKey, getGeminiRequestHeaders } from "./storage";
import { Question, QuestionType, AiDiagnosticResult } from "../types";

/**
 * Format friendly Gemini error message
 */
export function formatGeminiClientError(error: any): string {
  const msg = error?.message || (typeof error === "string" ? error : "");
  if (
    msg.includes("503") ||
    msg.includes("high demand") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("temporarily overloaded") ||
    msg.includes("overloaded")
  ) {
    return "Server Google Gemini sedang mengalami lonjakan beban tinggi sementara (503 Service Unavailable). Sistem telah menyiapkan failover model alternatif, silakan klik 'Coba Lagi' dalam beberapa saat.";
  }
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
    return "Batas kuota harian/menit API Gemini telah tercapai (429 Too Many Requests). Silakan tunggu sebentar sebelum mencoba kembali.";
  }
  if (msg.includes("API_KEY_INVALID") || msg.includes("API key not valid")) {
    return "Kunci API Gemini tidak valid atau belum diaktifkan. Silakan periksa kembali Kunci API Anda di menu 'Kunci API Gemini'.";
  }
  return msg || "Terjadi kendala saat memproses permintaan dengan Google Gemini AI.";
}

/**
 * Resilient client-side caller that automatically cascades across models on 503/429
 */
async function callGeminiClientWithResilience(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config?: any;
    preferredModel?: string;
  }
) {
  const models = [
    params.preferredModel || "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemini-3.1-flash-lite",
  ];
  let lastError: any = null;

  for (const model of models) {
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
        errMsg.includes("temporarily overloaded") ||
        errMsg.includes("overloaded") ||
        errMsg.includes("429") ||
        errMsg.includes("RESOURCE_EXHAUSTED");

      console.warn(`[Client Gemini Failed] Model: ${model}. Error: ${errMsg}`);
      if (isTransient) {
        // Immediately try the next fallback model in the list
        continue;
      }
      break;
    }
  }

  throw new Error(formatGeminiClientError(lastError));
}

/**
 * Safely parse response as JSON, handling HTML error pages or non-JSON responses
 */
async function safeParseResponse(res: Response): Promise<{ isJson: boolean; data: any; rawText: string }> {
  const rawText = await res.text();
  try {
    const data = JSON.parse(rawText);
    return { isJson: true, data, rawText };
  } catch {
    return { isJson: false, data: null, rawText };
  }
}

export interface GeminiStatusResult {
  configured: boolean;
  source: "env" | "custom" | "none";
  maskedKey?: string;
  model: string;
  message: string;
}

export interface GeminiTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  error?: string;
}

export interface GenerateQuestionsParams {
  subject: string;
  gradeLevel: string;
  topic: string;
  academicYear?: string;
  semester?: string;
  count: number;
  difficulty: string;
  questionType: QuestionType;
  additionalInstructions?: string;
  defaultScorePerQuestion?: number;
}

export interface GenerateQuestionsResult {
  examTitle: string;
  questions: Question[];
}

/**
 * Check Gemini API key status
 */
export async function checkGeminiStatus(): Promise<GeminiStatusResult> {
  const customKey = getCustomGeminiApiKey();

  try {
    const headers = getGeminiRequestHeaders();
    const res = await fetch("/api/gemini/status", { headers });
    const parsed = await safeParseResponse(res);

    if (parsed.isJson && parsed.data) {
      return parsed.data;
    }
  } catch (err) {
    console.warn("Server status check error, falling back to local state:", err);
  }

  // Fallback to client-side detection if server endpoint is unavailable
  if (customKey) {
    const maskedKey =
      customKey.length > 8
        ? `${customKey.slice(0, 4)}••••••••${customKey.slice(-4)}`
        : "••••••••";
    return {
      configured: true,
      source: "custom",
      maskedKey,
      model: "gemini-3.8-flash",
      message: "Kunci API Gemini kustom aktif di peramban.",
    };
  }

  return {
    configured: false,
    source: "none",
    model: "gemini-3.8-flash",
    message: "Kunci API Gemini belum terhubung.",
  };
}

/**
 * Test connection to Gemini AI
 */
export async function testGeminiConnection(keyToTest?: string): Promise<GeminiTestResult> {
  const key = keyToTest !== undefined ? keyToTest.trim() : getCustomGeminiApiKey();
  const startTime = Date.now();

  // Try server endpoint first
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (key) {
      headers["x-gemini-api-key"] = key;
    }

    const res = await fetch("/api/gemini/test-connection", {
      method: "POST",
      headers,
      body: JSON.stringify({ apiKey: key || undefined }),
    });

    const parsed = await safeParseResponse(res);
    if (parsed.isJson && parsed.data) {
      const latencyMs = parsed.data.latencyMs ?? (Date.now() - startTime);
      if (parsed.data.success) {
        return {
          success: true,
          message: parsed.data.message || "Koneksi ke Google Gemini AI (gemini-3.8-flash) berhasil!",
          latencyMs,
        };
      } else {
        return {
          success: false,
          message: parsed.data.error || "Gagal menghubungkan ke Gemini API. Pastikan kunci API valid.",
          latencyMs,
        };
      }
    }
  } catch (serverErr) {
    console.warn("Server test-connection endpoint unreachable, attempting client-side test:", serverErr);
  }

  // Client-side direct fallback if key is available
  if (key) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const { response, modelUsed } = await callGeminiClientWithResilience(ai, {
        preferredModel: "gemini-3.8-flash",
        contents: "Balas dengan tepat satu kata: Siap.",
        config: {
          systemInstruction: "Anda adalah asisten AI penguji koneksi.",
        },
      });

      const latencyMs = Date.now() - startTime;
      return {
        success: true,
        message: `Koneksi langsung ke Google Gemini AI (${modelUsed}) berhasil! (${response.text?.trim() || "Siap"})`,
        latencyMs,
      };
    } catch (clientErr: any) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = clientErr?.message || "Gagal menghubungi Google Gemini API.";
      return {
        success: false,
        message: `Koneksi gagal: ${errorMsg}`,
        latencyMs,
      };
    }
  }

  return {
    success: false,
    message: "Kunci API Gemini belum diatur. Masukkan Kunci API Gemini Anda untuk menguji koneksi.",
  };
}

export interface GenerateImageParams {
  prompt: string;
  subject?: string;
  questionContext?: string;
}

export interface GenerateImageResult {
  imageUrl: string;
  caption?: string;
  source: string;
}

/**
 * Generate educational question image/diagram with AI (Imagen or SVG vector)
 */
export async function generateImageWithAi(params: GenerateImageParams): Promise<GenerateImageResult> {
  const customKey = getCustomGeminiApiKey();

  // Try server endpoint first
  try {
    const headers = getGeminiRequestHeaders();
    const res = await fetch("/api/gemini/generate-image", {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });

    const parsed = await safeParseResponse(res);
    if (parsed.isJson && parsed.data?.success && parsed.data?.imageUrl) {
      return {
        imageUrl: parsed.data.imageUrl,
        caption: parsed.data.caption || params.prompt,
        source: parsed.data.source || "server-ai",
      };
    }
  } catch (err) {
    console.warn("Server generate-image endpoint failed, attempting client fallback:", err);
  }

  // Client-side fallback with @google/genai
  if (customKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: customKey });

      // Try generating SVG illustration via Gemini Flash
      const svgPrompt = `Anda adalah desainer diagram ilmiah dan materi pembelajaran sekolah.
Buatlah gambar/diagram vektor SVG yang bersih, kontras tinggi, proporsional, dan sangat rapi berdasarkan deskripsi berikut:
"${params.prompt}"
Mata Pelajaran: ${params.subject || "Pendidikan Umum"}. ${params.questionContext ? `Konteks: ${params.questionContext}` : ""}

Ketentuan SVG:
- Output HANYA tag XML <svg>...</svg> murni tanpa pembuka/penutup markdown (\`\`\`).
- viewBox="0 0 600 400" dengan aspect ratio 3:2 atau 4:3.
- Background rect warna gelap elegan (#1e293b atau gradien modern) dan elemen diagram berwarna cerah kontras (#38bdf8, #818cf8, #34d399, #f43f5e, #fbbf24).
- Lengkapi dengan label teks penjelas yang jelas dan panah jika perlu.`;

      const { response } = await callGeminiClientWithResilience(ai, {
        preferredModel: "gemini-3.8-flash",
        contents: svgPrompt,
        config: {
          systemInstruction:
            "Anda hanya menghasilkan kode SVG XML murni valid tanpa teks pengantar atau penutup apapun.",
        },
      });

      let rawSvg = response.text?.trim() || "";
      if (rawSvg.startsWith("```")) {
        rawSvg = rawSvg.replace(/^```(svg|xml)?\s*/i, "").replace(/```\s*$/i, "").trim();
      }

      if (rawSvg.includes("<svg") && rawSvg.includes("</svg>")) {
        const startIdx = rawSvg.indexOf("<svg");
        const endIdx = rawSvg.lastIndexOf("</svg>") + 6;
        const cleanSvg = rawSvg.substring(startIdx, endIdx);
        const encodedSvg = encodeURIComponent(cleanSvg);
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodedSvg}`;

        return {
          imageUrl: dataUrl,
          caption: params.prompt,
          source: "client_svg_ai",
        };
      }
    } catch (clientErr: any) {
      throw new Error(clientErr?.message || "Gagal membuat visual gambar dari Gemini AI.");
    }
  }

  throw new Error("Kunci API Gemini belum terhubung untuk membuat gambar AI.");
}

/**
 * Generate Questions with Gemini AI
 */
export async function generateQuestionsWithGemini(
  params: GenerateQuestionsParams,
  existingQuestionsCount: number = 0
): Promise<GenerateQuestionsResult> {
  const customKey = getCustomGeminiApiKey();

  // Try server endpoint first
  try {
    const headers = getGeminiRequestHeaders();
    const res = await fetch("/api/gemini/generate-questions", {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });

    const parsed = await safeParseResponse(res);
    if (parsed.isJson && parsed.data) {
      if (parsed.data.success && parsed.data.data) {
        const d = parsed.data.data;
        const questions: Question[] = (d.questions || []).map((q: any, idx: number) => ({
          id: `q-ai-${Date.now()}-${idx + 1}`,
          questionNumber: existingQuestionsCount + idx + 1,
          stimulus: q.stimulus || "",
          questionText: q.questionText || "Pertanyaan",
          type: (q.type as QuestionType) || params.questionType || "pilihan_ganda",
          options: q.options || [
            { key: "A", text: "Opsi A" },
            { key: "B", text: "Opsi B" },
            { key: "C", text: "Opsi C" },
            { key: "D", text: "Opsi D" },
          ],
          matchingPairs: q.matchingPairs || (q.type === "menjodohkan" ? [
            { id: "m1", left: "Pernyataan 1", right: "Pasangan A" },
            { id: "m2", left: "Pernyataan 2", right: "Pasangan B" },
            { id: "m3", left: "Pernyataan 3", right: "Pasangan C" },
          ] : undefined),
          correctAnswer: q.correctAnswer || "A",
          score: q.score || params.defaultScorePerQuestion || 20,
          explanation: q.explanation || "Pembahasan otomatis AI",
          sampleAnswer: q.sampleAnswer || "",
          cognitiveLevel: q.cognitiveLevel || "C4 - HOTS",
          topicTag: q.topicTag || params.topic,
        }));

        return {
          examTitle: d.examTitle || `Ujian ${params.subject} - ${params.topic}`,
          questions,
        };
      } else {
        throw new Error(parsed.data.error || "Server mengembalikan galat saat pembuatan soal.");
      }
    }
  } catch (err: any) {
    console.warn("Server generation failed, trying direct client fallback if key is available:", err);
    if (!customKey) {
      throw new Error(
        err.message || "Gagal menghubungkan ke server pembuat soal. Pastikan Kunci API Gemini telah dimasukkan."
      );
    }
  }

  // Client-side fallback using @google/genai
  if (!customKey) {
    throw new Error(
      "Kunci API Gemini belum dimasukkan. Silakan buka menu 'Kunci API Gemini' untuk memasukkan kunci Anda."
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey: customKey });
    const prompt = `Anda adalah seorang ahli pembuat soal ujian kurikulum merdeka / nasional Indonesia yang sangat berpengalaman.
Buatlah ${params.count} butir soal ujian dengan ketentuan:
- Mata Pelajaran: ${params.subject || "Umum"}
- Jenjang / Tingkat Kelas: ${params.gradeLevel || "SMP / SMA"}
- Tahun Pelajaran: ${params.academicYear || "2025/2026"}
- Semester: ${params.semester || "Ganjil"}
- Topik / Materi: ${params.topic || "Umum"}
- Tingkat Kesukaran: ${params.difficulty} (mudah, sedang, sukar, atau variatif HOTS)
- Tipe Soal Utama: ${params.questionType} (pilihan_ganda, menjodohkan, isian_singkat, atau uraian)
- Bobot Nilai per Soal: ${params.defaultScorePerQuestion || 20} poin
- Instruksi Tambahan: ${params.additionalInstructions || "Sajikan soal berbasis stimulus kontekstual dan penalaran HOTS"}

Kembalikan format JSON yang valid persis sesuai skema yang diminta.`;

    const { response } = await callGeminiClientWithResilience(ai, {
      preferredModel: "gemini-3.8-flash",
      contents: prompt,
      config: {
        systemInstruction:
          "Anda adalah pembuat soal ujian profesional. Berikan soal berkualitas tinggi, stimulus bacaan/kasus relevan, kunci jawaban tepat, dan pembahasan lengkap.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            examTitle: { type: Type.STRING, description: "Judul paket ujian" },
            subject: { type: Type.STRING, description: "Nama mata pelajaran" },
            gradeLevel: { type: Type.STRING, description: "Jenjang atau kelas" },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: "Unique ID" },
                  questionNumber: { type: Type.INTEGER, description: "Nomor soal" },
                  stimulus: { type: Type.STRING, description: "Stimulus atau narasi kasus" },
                  questionText: { type: Type.STRING, description: "Pertanyaan inti" },
                  type: { type: Type.STRING, description: "pilihan_ganda | menjodohkan | isian_singkat | uraian" },
                  options: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        key: { type: Type.STRING, description: "A, B, C, D, atau E" },
                        text: { type: Type.STRING, description: "Teks opsi" },
                      },
                      required: ["key", "text"],
                    },
                  },
                  matchingPairs: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        left: { type: Type.STRING },
                        right: { type: Type.STRING },
                      },
                      required: ["left", "right"],
                    },
                  },
                  correctAnswer: { type: Type.STRING, description: "Kunci jawaban benar" },
                  score: { type: Type.NUMBER, description: "Bobot nilai" },
                  explanation: { type: Type.STRING, description: "Pembahasan" },
                  sampleAnswer: { type: Type.STRING, description: "Contoh / rubrik jawaban uraian" },
                  cognitiveLevel: { type: Type.STRING, description: "Level kognitif" },
                  topicTag: { type: Type.STRING, description: "Subtopik materi" },
                },
                required: ["questionText", "correctAnswer", "score", "explanation"],
              },
            },
          },
          required: ["examTitle", "questions"],
        },
      },
    });

    const parsedJson = JSON.parse(response.text || "{}");
    const questions: Question[] = (parsedJson.questions || []).map((q: any, idx: number) => ({
      id: `q-ai-${Date.now()}-${idx + 1}`,
      questionNumber: existingQuestionsCount + idx + 1,
      stimulus: q.stimulus || "",
      questionText: q.questionText || "Pertanyaan",
      type: (q.type as QuestionType) || params.questionType || "pilihan_ganda",
      options: q.options || [
        { key: "A", text: "Opsi A" },
        { key: "B", text: "Opsi B" },
        { key: "C", text: "Opsi C" },
        { key: "D", text: "Opsi D" },
      ],
      matchingPairs: q.matchingPairs,
      correctAnswer: q.correctAnswer || "A",
      score: q.score || params.defaultScorePerQuestion || 20,
      explanation: q.explanation || "Pembahasan otomatis AI",
      sampleAnswer: q.sampleAnswer || "",
      cognitiveLevel: q.cognitiveLevel || "C4 - HOTS",
      topicTag: q.topicTag || params.topic,
    }));

    return {
      examTitle: parsedJson.examTitle || `Ujian ${params.subject} - ${params.topic}`,
      questions,
    };
  } catch (clientErr: any) {
    throw new Error(formatGeminiClientError(clientErr));
  }
}

/**
 * Generate Student Remediation & Diagnostic Feedback
 */
export async function generateStudentRemediation(params: {
  studentName: string;
  subject: string;
  score: number;
  maxScore: number;
  wrongQuestions: any[];
  totalQuestions: number;
}): Promise<string> {
  const customKey = getCustomGeminiApiKey();

  // Try server endpoint first
  try {
    const headers = getGeminiRequestHeaders();
    const res = await fetch("/api/gemini/analyze-student-remediation", {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });

    const parsed = await safeParseResponse(res);
    if (parsed.isJson && parsed.data?.success && parsed.data?.analysis) {
      return parsed.data.analysis;
    } else if (parsed.isJson && parsed.data?.error) {
      throw new Error(formatGeminiClientError(parsed.data.error));
    }
  } catch (err: any) {
    console.warn("Server remediation endpoint failed, falling back to client:", err);
    if (!customKey) {
      throw new Error(formatGeminiClientError(err));
    }
  }

  // Client-side fallback
  if (customKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: customKey });
      const prompt = `Berikan analisis pembelajaran dan rekomendasi remedial personal untuk siswa:
- Nama: ${params.studentName}
- Mata Pelajaran: ${params.subject}
- Nilai: ${params.score} dari ${params.maxScore} (${Math.round((params.score / (params.maxScore || 100)) * 100)}%)
- Soal yang dijawab salah (${params.wrongQuestions.length} dari ${params.totalQuestions}):
${params.wrongQuestions.map((q: any, idx: number) => `${idx + 1}. Topik: ${q.topicTag || "Umum"} | Soal: ${q.questionText} | Jawaban Siswa: ${q.studentAnswer} | Kunci: ${q.correctAnswer} | Pembahasan: ${q.explanation}`).join("\n")}

Berikan:
1. Evaluasi kelebihan dan kelemahan pemahaman konsep siswa
2. Rekomendasi 3 materi spesifik yang perlu dipelajari kembali
3. Kalimat motivasi apresiatif dan membangkitkan semangat belajar siswa.`;

      const { response } = await callGeminiClientWithResilience(ai, {
        preferredModel: "gemini-3.8-flash",
        contents: prompt,
        config: {
          systemInstruction:
            "Anda adalah guru konselor dan evaluator pedagogik yang hangat, memotivasi, dan memberikan saran praktis bagi kemajuan belajar siswa.",
        },
      });

      return response.text || "Analisis remedial telah berhasil dibuat.";
    } catch (err: any) {
      throw new Error(formatGeminiClientError(err));
    }
  }

  throw new Error("Kunci API Gemini belum terhubung. Silakan masukkan Kunci API Anda.");
}

/**
 * Evaluates and auto-grades student essay answer against rubric or answer key using Gemini
 */
export async function gradeEssayWithGemini(params: {
  questionText: string;
  correctAnswer?: string;
  rubric?: string;
  studentAnswer: string;
  maxScore?: number;
}): Promise<{ score: number; feedback: string }> {
  const customKey = getCustomGeminiApiKey();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (customKey) {
    headers["x-gemini-api-key"] = customKey;
  }

  // 1. Try server endpoint
  try {
    const res = await fetch("/api/gemini/grade-essay", {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        return {
          score: typeof data.score === "number" ? data.score : 0,
          feedback: data.feedback || "Telah dinilai otomatis oleh Gemini AI.",
        };
      }
    }
  } catch {}

  // 2. Direct client fallback if custom key exists
  if (customKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: customKey });
      const maxScore = params.maxScore || 10;
      const prompt = `Koreksi jawaban esai siswa berikut berdasarkan kunci jawaban/rubrik ini:
- Soal: ${params.questionText}
- Kunci Jawaban / Model Jawaban: ${params.correctAnswer || "-"}
- Panduan Rubrik Penilaian: ${params.rubric || "Nilai ketepatan konsep, kelengkapan argumen, dan logika penalaran."}
- Bobot Nilai Maksimal: ${maxScore} Poin
- Jawaban Siswa: "${params.studentAnswer || "(Kosong / Tidak menjawab)"}"

Tugas Anda:
1. Berikan skor numerik yang adil antara 0 hingga ${maxScore}.
2. Berikan feedback penjelasan singkat (1-3 kalimat) mengapa skor tersebut diberikan.`;

      const { response } = await callGeminiClientWithResilience(ai, {
        preferredModel: "gemini-3.8-flash",
        contents: prompt,
        config: {
          systemInstruction:
            "Anda adalah penilai ujian objektif yang mengoreksi jawaban esai siswa secara adil sesuai rubrik.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              feedback: { type: Type.STRING },
            },
            required: ["score", "feedback"],
          },
        },
      });

      const parsed = JSON.parse(response.text?.trim() || "{}");
      return {
        score: Math.max(0, Math.min(Number(parsed.score) || 0, maxScore)),
        feedback: parsed.feedback || "Telah dinilai otomatis oleh Gemini AI.",
      };
    } catch (err: any) {
      throw new Error(formatGeminiClientError(err));
    }
  }

  throw new Error("Koneksi ke Gemini AI belum siap. Pastikan Kunci API Gemini telah aktif.");
}

/**
 * Generate comprehensive AI Diagnostic, Enrichment & Remedial materials for student exam results
 */
export async function generateStudentEnrichmentAndRemediation(params: {
  studentName: string;
  nisn?: string;
  className?: string;
  subject?: string;
  score: number;
  maxScore?: number;
  passingGrade?: number;
  passed?: boolean;
  wrongQuestions?: any[];
  correctQuestions?: any[];
  totalQuestions?: number;
}): Promise<AiDiagnosticResult> {
  const customKey = getCustomGeminiApiKey();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (customKey) {
    headers["x-gemini-api-key"] = customKey;
  }

  // 1. Try server endpoint first
  try {
    const res = await fetch("/api/gemini/analyze-student-enrichment-remediation", {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.analysis) {
        return data.analysis as AiDiagnosticResult;
      }
    }
  } catch (err) {
    console.warn("[geminiApi] Server enrichment endpoint error, trying client fallback:", err);
  }

  // 2. Client fallback with @google/genai if custom key exists
  if (customKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: customKey });
      const score = params.score;
      const maxScore = params.maxScore || 100;
      const percentage = Math.round((score / maxScore) * 100);
      const isPassed = params.passed !== undefined ? params.passed : score >= (params.passingGrade || 75);

      const prompt = `Analisis hasil ujian siswa untuk Program Pengayaan & Remidi:
Siswa: ${params.studentName} | Kelas: ${params.className || "-"} | Mapel: ${params.subject || "Umum"}
Nilai: ${score}/${maxScore} (${percentage}%) | Status: ${isPassed ? "TUNTAS (PENGAYAAN)" : "BELUM TUNTAS (REMIDI)"}
Soal Salah: ${(params.wrongQuestions || []).map((q, i) => `${i+1}. [${q.topicTag || "Materi"}] ${q.questionText} (Kunci: ${q.correctAnswer}, Siswa: ${q.studentAnswer})`).join("; ") || "Tidak ada, sempurna"}
Susun: diagnosis pemahaman, program pengayaan (materi advance, tugas kreatif, tantangan HOTS), program remidi (klarifikasi konsep, langkah perbaikan, soal latihan terarah), dan motivasi.`;

      const { response } = await callGeminiClientWithResilience(ai, {
        preferredModel: "gemini-3.8-flash",
        contents: prompt,
        config: {
          systemInstruction: "Anda adalah konselor dan guru evaluator kurikulum merdeka.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              passed: { type: Type.BOOLEAN },
              diagnosis: { type: Type.STRING },
              misconceptions: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendedTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
              enrichment: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  targetCompetencies: { type: Type.ARRAY, items: { type: Type.STRING } },
                  advancedMaterials: { type: Type.STRING },
                  creativeTask: { type: Type.STRING },
                  hotsChallenges: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        question: { type: Type.STRING },
                        guidance: { type: Type.STRING },
                      },
                      required: ["question", "guidance"],
                    },
                  },
                },
                required: ["title", "targetCompetencies", "advancedMaterials", "creativeTask"],
              },
              remediation: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  targetDeficits: { type: Type.ARRAY, items: { type: Type.STRING } },
                  conceptClarification: { type: Type.STRING },
                  remedialSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
                  guidedQuestions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        question: { type: Type.STRING },
                        hint: { type: Type.STRING },
                        answer: { type: Type.STRING },
                      },
                      required: ["question", "hint"],
                    },
                  },
                },
                required: ["title", "targetDeficits", "conceptClarification", "remedialSteps"],
              },
              motivation: { type: Type.STRING },
            },
            required: ["passed", "diagnosis", "enrichment", "remediation", "motivation"],
          },
        },
      });

      const parsed = JSON.parse(response.text?.trim() || "{}");
      return {
        ...parsed,
        score,
        maxScore,
        percentage,
        passed: isPassed,
        generatedAt: new Date().toISOString(),
      } as AiDiagnosticResult;
    } catch (e: any) {
      throw new Error(formatGeminiClientError(e));
    }
  }

  // 3. Deterministic pedagogical fallback if no API key is available
  const isPassed = params.passed !== undefined ? params.passed : params.score >= (params.passingGrade || 75);
  return {
    passed: isPassed,
    score: params.score,
    maxScore: params.maxScore || 100,
    percentage: Math.round((params.score / (params.maxScore || 100)) * 100),
    diagnosis: isPassed
      ? `Ananda ${params.studentName} telah menunjukkan penguasaan kompetensi dasar yang sangat baik pada mata pelajaran ${params.subject || "ini"}. Konsep-konsep esensial dipahami secara tepat.`
      : `Ananda ${params.studentName} perlu memperkuat beberapa konsep kunci pada materi yang diujikan, terutama pada butir soal yang belum terjawab dengan tepat.`,
    misconceptions: (params.wrongQuestions || []).map((q) => `Perlu pemahaman lebih lanjut pada topik: ${q.topicTag || q.questionText?.slice(0, 40) + "..."}`),
    recommendedTopics: Array.from(new Set((params.wrongQuestions || []).map((q) => q.topicTag || "Materi Ujian"))),
    enrichment: {
      title: "Program Pengayaan: Eksplorasi Konseptual Lanjutan",
      targetCompetencies: ["Menganalisis keterkaitan konsep dalam studi kasus nyata", "Pemecahan masalah aplikatif"],
      advancedMaterials: "Pelajari bagaimana konsep dalam mata pelajaran ini diterapkan pada fenomena kehidupan sehari-hari dan teknologi modern.",
      creativeTask: "Buatlah ringkasan grafis atau infografis sederhana mengenai penerapan konsep ini dalam kehidupan sehari-hari.",
      hotsChallenges: [
        {
          question: "Bagaimana Anda memecahkan permasalahan jika kondisi awal soal diubah dengan parameter yang berlawanan?",
          guidance: "Analisis perubahan hubungan sebab-akibat antar variabel.",
        },
      ],
    },
    remediation: {
      title: "Program Remidi: Penguatan Konsep Dasar",
      targetDeficits: (params.wrongQuestions || []).map((q) => q.topicTag || "Konsep Dasar").slice(0, 3),
      conceptClarification: "Tinjau kembali definisi dan langkah-langkah dasar pada butir soal yang keliru. Ingat kembali rumus dan kata kunci utamanya.",
      remedialSteps: [
        "Membaca kembali catatan atau buku teks pada bab terkait.",
        "Mendiskusikan kembali soal yang keliru dengan guru atau teman belajar.",
        "Mencoba mengerjakan ulang butir latihan dengan tenang dan teliti.",
      ],
      guidedQuestions: (params.wrongQuestions || []).slice(0, 2).map((q) => ({
        question: `Latihan: Tuliskan kembali konsep utama dari: ${q.questionText}`,
        hint: q.explanation || "Perhatikan kata kunci pertanyaan",
        answer: q.correctAnswer,
      })),
    },
    motivation: isPassed
      ? "Luar biasa! Pertahankan semangat eksplorasi belajarmu dan teruslah menantang diri dengan hal-hal baru."
      : "Jangan patah semangat! Setiap kesalahan adalah petunjuk berharga untuk melangkah lebih maju. Kamu pasti bisa lebih baik lagi!",
    generatedAt: new Date().toISOString(),
  };
}

