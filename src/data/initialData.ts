import { SchoolProfile, TeacherProfile, ExamPackage, StudentExamSession, StudentTokenItem } from "../types";

export const defaultSchoolProfile: SchoolProfile = {
  agencyName: "PEMERINTAH PROVINSI / DINAS PENDIDIKAN DAN KEBUDAYAAN",
  schoolName: "SMA NEGERI NUSANTARA UNGGUL",
  npsn: "20109988",
  address: "Jl. Pendidikan Nasional No. 45, Kompleks Edukasi Terpadu",
  postalCode: "65123",
  phone: "(0341) 554321 / 0812-3456-7890",
  email: "info@sman-nusantaraunggul.sch.id",
  website: "www.sman-nusantaraunggul.sch.id",
  principalName: "Drs. H. Bambang Sudarsono, M.Pd.",
  principalNIP: "19720415 199803 1 004",
  motto: "Unggul dalam Prestasi, Berkarakter, dan Berdaya Saing Global",
  logoLeftUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Logo_of_Ministry_of_Education_and_Culture_of_Republic_of_Indonesia.svg/200px-Logo_of_Ministry_of_Education_and_Culture_of_Republic_of_Indonesia.svg.png",
  logoRightUrl: "https://images.unsplash.com/photo-1546410531-bb4caa6b424d?w=160&auto=format&fit=crop&q=80"
};

export const defaultTeacherProfile: TeacherProfile = {
  teacherName: "Rachmat Susanto, S.Pd., M.Kom.",
  teacherNIP: "19880921 201402 1 002",
  subject: "Informatika & Literasi Digital",
  subjectCode: "INF-X-2026",
  gradeLevel: "Kelas X (Fase E)",
  academicYear: "2025/2026",
  semester: "Genap",
  passingGrade: 75,
  durationMinutes: 45,
};

export const sampleInitialExam: ExamPackage = {
  id: "exam-demo-01",
  code: "INF-X-CBT",
  title: "Penilaian Sumatif Akhir Semester: Informatika & Literasi Digital",
  description: "Ujian berbasis komputer menguji pemahaman algoritma, etika kecerdasan buatan, dan keamanan siber.",
  schoolProfile: defaultSchoolProfile,
  teacherProfile: defaultTeacherProfile,
  durationMinutes: 45,
  totalScore: 100,
  sessionToken: "SLIDE7",
  tokenCreatedAt: new Date().toISOString(),
  isTokenActive: true,
  allowReviewExplanation: true,
  shuffleQuestions: false,
  shuffleOptions: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  questions: [
    {
      id: "q-1",
      questionNumber: 1,
      stimulus: "Perhatikan narasi berikut: Sebuah sistem pembayaran digital di mini market menggunakan kode QR untuk memverifikasi transaksi. Sistem memastikan keaslian transaksi dengan memeriksa tanda tangan kriptografi.",
      questionText: "Komponen berpikir komputasional mana yang paling dominan saat menyederhanakan proses pembayaran kompleks menjadi satu kali pemindaian QR code tanpa menampilkan detail kode perbankan di layar?",
      type: "pilihan_ganda",
      options: [
        { key: "A", text: "Dekomposisi (Decomposition)" },
        { key: "B", text: "Abstraksi (Abstraction)" },
        { key: "C", text: "Pengenalan Pola (Pattern Recognition)" },
        { key: "D", text: "Perancangan Algoritma (Algorithm Design)" },
        { key: "E", text: "Evaluasi Logika (Logic Evaluation)" },
      ],
      correctAnswer: "B",
      score: 20,
      explanation: "Abstraksi adalah proses menyembunyikan detail teknis yang kompleks dan hanya menampilkan informasi relevan dan esensial bagi pengguna (dalam hal ini penyederhanaan antarmuka pemindaian QR).",
      cognitiveLevel: "C4 - Menganalisis (HOTS)",
      topicTag: "Berpikir Komputasional"
    },
    {
      id: "q-2",
      questionNumber: 2,
      stimulus: "Kecerdasan Buatan (Generative AI) saat ini mampu menghasilkan teks, gambar, dan kode program dengan cepat. Namun, terdapat risiko timbulnya fenomena 'AI Hallucination'.",
      questionText: "Apa yang dimaksud dengan istilah 'AI Hallucination' dalam konteks model bahasa besar (Large Language Models)?",
      type: "pilihan_ganda",
      options: [
        { key: "A", text: "Kondisi di mana model AI kehabisan memori server saat memproses data" },
        { key: "B", text: "Kemampuan model AI meniru gaya bicara manusia secara sempurna" },
        { key: "C", text: "Model AI menghasilkan informasi yang terdengar meyakinkan namun sebenarnya salah atau tidak berbasis fakta" },
        { key: "D", text: "Proses training model AI menggunakan data gambar beresolusi tinggi" },
        { key: "E", text: "Sistem keamanan siber yang mendeteksi spam email secara otomatis" },
      ],
      correctAnswer: "C",
      score: 20,
      explanation: "AI Hallucination merujuk pada situasi di mana model AI menghasilkan jawaban yang percaya diri dan koheren secara tata bahasa, tetapi faktanya fiktif atau tidak akurat.",
      cognitiveLevel: "C2 - Memahami",
      topicTag: "Etika & Teknologi AI"
    },
    {
      id: "q-3",
      questionNumber: 3,
      stimulus: "Diberikan pseudocode berikut:\n1. Inisialisasi total = 0\n2. Untuk i = 1 sampai 5 lakukan:\n3.    Jika i mod 2 == 1 maka:\n4.       total = total + i\n5. Cetak total",
      questionText: "Berapakah nilai akhir variabel 'total' yang dicetak setelah algoritma di atas selesai dieksekusi?",
      type: "pilihan_ganda",
      options: [
        { key: "A", text: "6" },
        { key: "B", text: "9" },
        { key: "C", text: "12" },
        { key: "D", text: "15" },
        { key: "E", text: "25" },
      ],
      correctAnswer: "B",
      score: 20,
      explanation: "Nilai i yang ganjil (i mod 2 == 1) antara 1 sampai 5 adalah 1, 3, dan 5. Maka total = 1 + 3 + 5 = 9.",
      cognitiveLevel: "C3 - Menerapkan (Tracing Algoritma)",
      topicTag: "Algoritma & Pemrograman"
    },
    {
      id: "q-4",
      questionNumber: 4,
      stimulus: "Dalam arsitektur jaringan komputer, model referensi OSI (Open Systems Interconnection) membagi komunikasi data ke dalam 7 lapisan.",
      questionText: "Protokol HTTPS dan DNS beroperasi pada lapisan (layer) manakah dalam model OSI?",
      type: "pilihan_ganda",
      options: [
        { key: "A", text: "Network Layer (Lapisan 3)" },
        { key: "B", text: "Transport Layer (Lapisan 4)" },
        { key: "C", text: "Session Layer (Lapisan 5)" },
        { key: "D", text: "Application Layer (Lapisan 7)" },
        { key: "E", text: "Data Link Layer (Lapisan 2)" },
      ],
      correctAnswer: "D",
      score: 20,
      explanation: "Protokol seperti HTTP/HTTPS, DNS, FTP, dan SMTP bekerja pada Lapisan Aplikasi (Application Layer / Layer 7) yang berinteraksi langsung dengan aplikasi pengguna.",
      cognitiveLevel: "C2 - Memahami",
      topicTag: "Jaringan Komputer & Internet"
    },
    {
      id: "q-5",
      questionNumber: 5,
      stimulus: "Serangan rekayasa sosial (Social Engineering) sering menyasar ketidaktahuan pengguna melalui manipulasi psikologis ketimbang meretas kelemahan sistem secara teknis.",
      questionText: "Manakah tindakan pencegahan yang paling efektif untuk melindungi akun sekolah dari ancaman spear-phishing?",
      type: "pilihan_ganda",
      options: [
        { key: "A", text: "Menonaktifkan firewall komputer sekolah" },
        { key: "B", text: "Mengaktifkan Otentikasi Dua Faktor (2FA / Multi-Factor Authentication) dan memeriksa keaslian domain pengirim pesan" },
        { key: "C", text: "Menggunakan kata sandi yang sama di semua platform agar mudah diingat" },
        { key: "D", text: "Membuka semua lampiran file email yang menawarkan hadiah beasiswa" },
        { key: "E", text: "Menghapus riwayat penelusuran browser setiap 10 menit" },
      ],
      correctAnswer: "B",
      score: 20,
      explanation: "Otentikasi Dua Faktor (2FA) memberikan lapisan keamanan kedua jika kata sandi tercuri, serta verifikasi domain pengirim mencegah tertipu tautan login palsu.",
      cognitiveLevel: "C3 - Menerapkan",
      topicTag: "Keamanan Informasi & Privasi"
    }
  ]
};

export const sampleInitialTokens: StudentTokenItem[] = [
  {
    id: "tok-1",
    examCode: "INF-X-CBT",
    token: "TKN01",
    studentName: "Aditya Pratama Putra",
    nisn: "0078123401",
    className: "X MIPA 1",
    seatNumber: "A-01",
    status: "selesai",
    generatedAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: "tok-2",
    examCode: "INF-X-CBT",
    token: "TKN02",
    studentName: "Bella Safitri Anggraini",
    nisn: "0078123402",
    className: "X MIPA 1",
    seatNumber: "A-02",
    status: "selesai",
    generatedAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: "tok-3",
    examCode: "INF-X-CBT",
    token: "TKN03",
    studentName: "Citra Lestari",
    nisn: "0078123403",
    className: "X MIPA 1",
    seatNumber: "A-03",
    status: "sedang_mengerjakan",
    generatedAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: "tok-4",
    examCode: "INF-X-CBT",
    token: "TKN04",
    studentName: "Dimas Arya Wijaya",
    nisn: "0078123404",
    className: "X MIPA 1",
    seatNumber: "A-04",
    status: "belum_mulai",
    generatedAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: "tok-5",
    examCode: "INF-X-CBT",
    token: "TKN05",
    studentName: "Eka Nurhaliza",
    nisn: "0078123405",
    className: "X MIPA 1",
    seatNumber: "A-05",
    status: "belum_mulai",
    generatedAt: new Date(Date.now() - 3600000).toISOString()
  }
];

export const sampleInitialHistory: StudentExamSession[] = [
  {
    id: "hist-1",
    examId: "exam-demo-01",
    examCode: "INF-X-CBT",
    examTitle: "Penilaian Sumatif Akhir Semester: Informatika & Literasi Digital",
    subject: "Informatika & Literasi Digital",
    studentName: "Aditya Pratama Putra",
    nisn: "0078123401",
    className: "X MIPA 1",
    token: "SLIDE7",
    currentSlideIndex: 7,
    answers: {
      "q-1": { questionId: "q-1", selectedOption: "B", isFlagged: false, isCorrect: true, scoreEarned: 20 },
      "q-2": { questionId: "q-2", selectedOption: "C", isFlagged: false, isCorrect: true, scoreEarned: 20 },
      "q-3": { questionId: "q-3", selectedOption: "B", isFlagged: false, isCorrect: true, scoreEarned: 20 },
      "q-4": { questionId: "q-4", selectedOption: "D", isFlagged: false, isCorrect: true, scoreEarned: 20 },
      "q-5": { questionId: "q-5", selectedOption: "B", isFlagged: false, isCorrect: true, scoreEarned: 20 },
    },
    startTime: new Date(Date.now() - 2400000).toISOString(),
    submitTime: new Date(Date.now() - 600000).toISOString(),
    timeSpentSeconds: 1800,
    totalScoreEarned: 100,
    maxScore: 100,
    percentage: 100,
    passed: true,
    status: "submitted",
    aiRemediation: "Luar biasa! Pemahaman konsep berpikir komputasional, AI, dan keamanan siber sangat solid dan menguasai seluruh indikator soal."
  },
  {
    id: "hist-2",
    examId: "exam-demo-01",
    examCode: "INF-X-CBT",
    examTitle: "Penilaian Sumatif Akhir Semester: Informatika & Literasi Digital",
    subject: "Informatika & Literasi Digital",
    studentName: "Bella Safitri Anggraini",
    nisn: "0078123402",
    className: "X MIPA 1",
    token: "SLIDE7",
    currentSlideIndex: 7,
    answers: {
      "q-1": { questionId: "q-1", selectedOption: "B", isFlagged: false, isCorrect: true, scoreEarned: 20 },
      "q-2": { questionId: "q-2", selectedOption: "A", isFlagged: false, isCorrect: false, scoreEarned: 0 },
      "q-3": { questionId: "q-3", selectedOption: "B", isFlagged: false, isCorrect: true, scoreEarned: 20 },
      "q-4": { questionId: "q-4", selectedOption: "D", isFlagged: false, isCorrect: true, scoreEarned: 20 },
      "q-5": { questionId: "q-5", selectedOption: "B", isFlagged: false, isCorrect: true, scoreEarned: 20 },
    },
    startTime: new Date(Date.now() - 2500000).toISOString(),
    submitTime: new Date(Date.now() - 400000).toISOString(),
    timeSpentSeconds: 2100,
    totalScoreEarned: 80,
    maxScore: 100,
    percentage: 80,
    passed: true,
    status: "submitted",
    aiRemediation: "Sangat baik. Perlu sedikit pendalaman mengenai konsep AI Hallucination pada topik model bahasa besar."
  }
];
