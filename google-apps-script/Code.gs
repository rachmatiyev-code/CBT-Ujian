/**
 * =========================================================================
 * CBT SLIDEEXAM - GOOGLE APPS SCRIPT BACKEND & GOOGLE SHEETS DATABASE
 * =========================================================================
 * Skrip ini bertindak sebagai backend serverless dan database utama untuk SlideExam CBT.
 * 
 * Struktur Penyimpanan di Google Drive:
 * 📁 CBT SlideExam Database (Folder Utama)
 *    ├── 📁 Data Siswa dan Kelas
 *    │    └── 📊 Data_Siswa_Dan_Kelas (Sheet: Roster_Siswa, Token_Ujian)
 *    ├── 📁 Data Analisis dan Nilai
 *    │    └── 📊 Data_Analisis_Dan_Nilai (Sheet: Hasil_Ujian, Pengayaan_Dan_Remidi_AI, Analisis_Butir_Soal)
 *    └── 📁 Data Soal
 *         ├── 📊 Data_Bank_Soal (Sheet: Paket_Ujian, Butir_Soal)
 *         └── 📄 [Kode_Ujian]_ExamPackage.json (File JSON paket soal lengkap)
 * 
 * PANDUAN DEPLOYMENT:
 * 1. Buka https://script.google.com/home
 * 2. Buat proyek baru: "SlideExam CBT Backend"
 * 3. Salin seluruh kode ini ke dalam editor Code.gs
 * 4. Klik "Deploy" -> "New deployment"
 * 5. Pilih tipe: "Web app"
 * 6. Set Description: "SlideExam CBT Production"
 * 7. Set Execute as: "Me" (email Google Anda)
 * 8. Set Who has access: "Anyone" (Siapa saja - agar siswa bisa mengirim jawaban tanpa login akun Google)
 * 9. Klik "Deploy", beri izin akses Google Drive & Sheets yang diminta.
 * 10. Salin "Web app URL" (akhiran /exec) dan tempelkan ke aplikasi SlideExam CBT.
 * =========================================================================
 */

var MASTER_FOLDER_NAME = "CBT SlideExam Database";
var SUBFOLDER_SISWA = "Data Siswa dan Kelas";
var SUBFOLDER_ANALISIS = "Data Analisis dan Nilai";
var SUBFOLDER_SOAL = "Data Soal";

var SHEET_NAME_SISWA = "Data_Siswa_Dan_Kelas";
var SHEET_NAME_ANALISIS = "Data_Analisis_Dan_Nilai";
var SHEET_NAME_SOAL = "Data_Bank_Soal";

/**
 * Handle HTTP GET Requests
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "ping";
  var result = { success: false, action: action };

  try {
    switch (action) {
      case "ping":
        var foldersData = null;
        try {
          foldersData = getFoldersInfo();
        } catch (eFolders) {
          foldersData = { warning: "Folder database belum diinisialisasi: " + eFolders.toString() };
        }
        result = {
          success: true,
          status: "ready",
          message: "Google Apps Script SlideExam CBT Backend aktif dan siap digunakan.",
          timestamp: new Date().toISOString(),
          folders: foldersData
        };
        break;

      case "initFolders":
        result = initMasterFoldersAndSheets();
        break;

      case "getFolders":
        result = { success: true, data: getFoldersInfo() };
        break;

      case "getExam":
        var code = e.parameter.code || "";
        result = getExamByCode(code);
        break;

      case "listExams":
        result = listAllExams();
        break;

      case "getSessions":
        var examCode = e.parameter.examCode || "";
        result = getStudentSessions(examCode);
        break;

      case "getRoster":
        var targetExamCode = e.parameter.examCode || "";
        var targetClass = e.parameter.className || "";
        result = getStudentRoster(targetExamCode, targetClass);
        break;

      case "listBackups":
        result = listAppBackups();
        break;

      case "restoreBackup":
        var fileId = e.parameter.fileId || "";
        result = getAppBackup(fileId);
        break;

      default:
        result = { success: false, error: "Action '" + action + "' tidak dikenali pada GET." };
        break;
    }
  } catch (err) {
    result = { success: false, error: err.toString(), stack: err.stack };
  }

  return createJsonResponse(result);
}

/**
 * Handle HTTP POST Requests
 */
function doPost(e) {
  var result = { success: false };

  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    var action = payload.action || (e && e.parameter && e.parameter.action) || "";

    switch (action) {
      case "ping":
        result = { success: true, message: "PONG - GAS Backend Online", timestamp: new Date().toISOString() };
        break;

      case "initFolders":
        result = initMasterFoldersAndSheets();
        break;

      case "syncExam":
        result = saveExamPackage(payload.exam, payload.tokens);
        break;

      case "saveSession":
      case "submitExam":
        result = saveStudentSession(payload.session, payload.aiAnalysis);
        break;

      case "saveAiAnalysis":
        result = saveAiPengayaanRemidi(payload.session, payload.aiAnalysis);
        break;

      case "saveRoster":
        result = saveStudentRoster(payload.roster, payload.examCode);
        break;

      case "deleteSession":
        result = deleteStudentSession(payload.sessionId, payload.examCode, payload.studentName);
        break;

      case "batchDeleteSessions":
        result = batchDeleteStudentSessions(payload.sessionIds, payload.examCode);
        break;

      case "backupApp":
        result = saveAppBackup(payload.backupData);
        break;

      case "restoreBackup":
        result = getAppBackup(payload.fileId);
        break;

      default:
        result = { success: false, error: "Action '" + action + "' tidak dikenali pada POST." };
        break;
    }
  } catch (err) {
    result = { success: false, error: err.toString(), stack: err.stack };
  }

  return createJsonResponse(result);
}

/**
 * Buat respons JSON standar dengan header CORS
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Resolusi folder menjadi objek Folder DriveApp yang valid
 */
function resolveFolder(folderOrId) {
  if (!folderOrId) return null;
  // Jika sudah merupakan objek Folder dengan metode getId atau getFolders
  if (typeof folderOrId === "object") {
    if (typeof folderOrId.getFoldersByName === "function" || typeof folderOrId.getFolders === "function") {
      return folderOrId;
    }
    if (folderOrId.id) {
      try {
        return DriveApp.getFolderById(folderOrId.id);
      } catch (eObjId) {
        // Lanjutkan fallback
      }
    }
  }
  // Jika berupa string (folder ID atau nama folder)
  if (typeof folderOrId === "string") {
    var trimmed = folderOrId.trim();
    if (trimmed.length > 0) {
      try {
        return DriveApp.getFolderById(trimmed);
      } catch (eId) {
        var it = DriveApp.getFoldersByName(trimmed);
        while (it.hasNext()) {
          var f = it.next();
          if (!f.isTrashed()) return f;
        }
      }
    }
  }
  return null;
}

/**
 * Ambil atau buat folder utama dan 3 subfolder yang diminta secara aman
 */
function getOrCreateFolder(parent, name) {
  var parentFolder = resolveFolder(parent);

  if (parentFolder) {
    // 1. Cari subfolder yang aktif (bukan di trash) menggunakan getFoldersByName jika tersedia
    if (typeof parentFolder.getFoldersByName === "function") {
      try {
        var childIt = parentFolder.getFoldersByName(name);
        while (childIt.hasNext()) {
          var child = childIt.next();
          if (!child.isTrashed()) {
            return child;
          }
        }
      } catch (eFind) {
        // Fallback ke iterator getFolders()
      }
    }

    // 2. Fallback pencarian iteratif menggunakan getFolders()
    if (typeof parentFolder.getFolders === "function") {
      try {
        var allFolders = parentFolder.getFolders();
        while (allFolders.hasNext()) {
          var f = allFolders.next();
          if (!f.isTrashed() && f.getName() === name) {
            return f;
          }
        }
      } catch (eAll) {
        // Lanjutkan pembuatan baru
      }
    }

    // 3. Jika belum ditemukan, buat subfolder baru di dalam parentFolder
    if (typeof parentFolder.createFolder === "function") {
      return parentFolder.createFolder(name);
    }
  }

  // Jika tidak ada parent (level root Google Drive)
  try {
    var rootIt = DriveApp.getFoldersByName(name);
    while (rootIt.hasNext()) {
      var rootFolder = rootIt.next();
      if (!rootFolder.isTrashed()) {
        return rootFolder;
      }
    }
  } catch (eRoot) {
    // Abaikan jika pencarian root gagal
  }

  return DriveApp.createFolder(name);
}

/**
 * Dapatkan referensi ke Master Folder dan 3 Subfolder
 */
function getSystemFolders() {
  var master = getOrCreateFolder(null, MASTER_FOLDER_NAME);
  var fSiswa = getOrCreateFolder(master, SUBFOLDER_SISWA);
  var fAnalisis = getOrCreateFolder(master, SUBFOLDER_ANALISIS);
  var fSoal = getOrCreateFolder(master, SUBFOLDER_SOAL);

  return {
    master: master,
    siswa: fSiswa,
    analisis: fAnalisis,
    soal: fSoal
  };
}

/**
 * Ambil informasi link dan ID folder
 */
function getFoldersInfo() {
  var folders = getSystemFolders();
  return {
    master: { id: folders.master.getId(), name: folders.master.getName(), url: folders.master.getUrl() },
    siswaKelas: { id: folders.siswa.getId(), name: folders.siswa.getName(), url: folders.siswa.getUrl() },
    analisisNilai: { id: folders.analisis.getId(), name: folders.analisis.getName(), url: folders.analisis.getUrl() },
    soal: { id: folders.soal.getId(), name: folders.soal.getName(), url: folders.soal.getUrl() }
  };
}

/**
 * Ambil atau buat Spreadsheet di dalam folder tertentu
 */
function getOrCreateSpreadsheet(folder, name, sheetsConfig) {
  var targetFolder = resolveFolder(folder) || DriveApp.getRootFolder();
  var files = targetFolder.getFilesByName(name);
  var ss;
  var found = false;

  while (files && files.hasNext()) {
    var file = files.next();
    if (!file.isTrashed()) {
      ss = SpreadsheetApp.openById(file.getId());
      found = true;
      break;
    }
  }

  if (!found || !ss) {
    ss = SpreadsheetApp.create(name);
    var driveFile = DriveApp.getFileById(ss.getId());
    if (typeof driveFile.moveTo === "function") {
      driveFile.moveTo(targetFolder);
    } else {
      targetFolder.addFile(driveFile);
      try { DriveApp.getRootFolder().removeFile(driveFile); } catch(eRem) {}
    }
  }

  // Siapkan sheets dan headers
  if (sheetsConfig && Array.isArray(sheetsConfig)) {
    sheetsConfig.forEach(function(cfg) {
      var sheet = ss.getSheetByName(cfg.name);
      if (!sheet) {
        sheet = ss.insertSheet(cfg.name);
      }
      if (sheet.getLastRow() === 0 && cfg.headers && cfg.headers.length > 0) {
        sheet.appendRow(cfg.headers);
        var headerRange = sheet.getRange(1, 1, 1, cfg.headers.length);
        headerRange.setFontWeight("bold");
        headerRange.setBackground(cfg.headerBg || "#1e293b");
        headerRange.setFontColor("#ffffff");
        sheet.setFrozenRows(1);
      }
    });

    // Hapus 'Sheet1' bawaan jika ada sheet lain
    var defaultSheet = ss.getSheetByName("Sheet1");
    if (defaultSheet && ss.getSheets().length > 1) {
      try { ss.deleteSheet(defaultSheet); } catch(e) {}
    }
  }

  return ss;
}

/**
 * Inisialisasi Master Folder dan Ketiga Subfolder beserta Spreadsheet Database
 */
function initMasterFoldersAndSheets() {
  var folders = getSystemFolders();

  // 1. Spreadsheet Data Siswa dan Kelas
  var ssSiswa = getOrCreateSpreadsheet(folders.siswa, SHEET_NAME_SISWA, [
    {
      name: "Roster_Siswa",
      headers: [
        "Timestamp", "ID Siswa", "NISN", "Nama Lengkap Siswa", "Kelas",
        "No Kursi", "Status Ujian", "Kode Ujian Terakhir", "Token Sesi", "Terakhir Aktif"
      ],
      headerBg: "#0f766e"
    },
    {
      name: "Token_Ujian",
      headers: [
        "Timestamp", "Kode Ujian", "Judul Ujian", "Token Sesi", "Kelas Sasaran",
        "Waktu Dibuat", "Status Token", "Total Siswa Terdaftar"
      ],
      headerBg: "#047857"
    }
  ]);

  // 2. Spreadsheet Data Analisis dan Nilai
  var ssAnalisis = getOrCreateSpreadsheet(folders.analisis, SHEET_NAME_ANALISIS, [
    {
      name: "Hasil_Ujian",
      headers: [
        "Timestamp", "Sesi ID", "Kode Ujian", "Judul Ujian", "Mata Pelajaran",
        "NISN", "Nama Siswa", "Kelas", "Skor Diperoleh", "Skor Maksimal",
        "Persentase (%)", "Status Kelulusan", "Durasi Pengerjaan (Menit)",
        "Jumlah Soal Benar", "Jumlah Soal Salah", "Status Sesi", "Waktu Selesai"
      ],
      headerBg: "#4338ca"
    },
    {
      name: "Pengayaan_Dan_Remidi_AI",
      headers: [
        "Timestamp", "Sesi ID", "Kode Ujian", "NISN", "Nama Siswa", "Kelas",
        "Skor Akhir", "Status Kelulusan", "Diagnosis Miskonsepsi AI",
        "Program Pengayaan AI", "Program Remidi AI", "Rekomendasi Materi Lanjutan AI", "Pesan Motivasi AI"
      ],
      headerBg: "#6366f1"
    },
    {
      name: "Analisis_Butir_Soal",
      headers: [
        "Timestamp", "Kode Ujian", "No Butir", "ID Soal", "Topik / Materi",
        "Tipe Soal", "Kunci Jawaban", "Tingkat Kesukaran", "Persentase Benar (%)",
        "Jumlah Menjawab Benar", "Total Peserta Ujian"
      ],
      headerBg: "#3730a3"
    }
  ]);

  // 3. Spreadsheet Data Soal
  var ssSoal = getOrCreateSpreadsheet(folders.soal, SHEET_NAME_SOAL, [
    {
      name: "Paket_Ujian",
      headers: [
        "Timestamp", "ID Ujian", "Kode Ujian", "Judul Ujian", "Mata Pelajaran",
        "Jenjang / Kelas", "Nama Guru", "KKM Minimum", "Durasi (Menit)",
        "Jumlah Soal", "Total Skor", "Link File JSON Drive", "Terakhir Diperbarui"
      ],
      headerBg: "#b45309"
    },
    {
      name: "Butir_Soal",
      headers: [
        "Timestamp", "ID Ujian", "Kode Ujian", "No Soal", "ID Soal", "Tipe Soal",
        "Topik Tag", "Level Kognitif", "Teks Soal", "Stimulus", "Pilihan / Pasangan",
        "Kunci Jawaban", "Bobot Skor", "Pembahasan"
      ],
      headerBg: "#d97706"
    }
  ]);

  return {
    success: true,
    message: "Master Folder dan 3 Subfolder beserta Database Google Sheets berhasil diinisialisasi.",
    folders: {
      master: { id: folders.master.getId(), name: folders.master.getName(), url: folders.master.getUrl() },
      siswaKelas: { id: folders.siswa.getId(), name: folders.siswa.getName(), url: folders.siswa.getUrl() },
      analisisNilai: { id: folders.analisis.getId(), name: folders.analisis.getName(), url: folders.analisis.getUrl() },
      soal: { id: folders.soal.getId(), name: folders.soal.getName(), url: folders.soal.getUrl() }
    },
    sheets: {
      siswa: { id: ssSiswa.getId(), name: ssSiswa.getName(), url: ssSiswa.getUrl() },
      analisis: { id: ssAnalisis.getId(), name: ssAnalisis.getName(), url: ssAnalisis.getUrl() },
      soal: { id: ssSoal.getId(), name: ssSoal.getName(), url: ssSoal.getUrl() }
    }
  };
}

/**
 * Simpan atau perbarui Paket Ujian ke dalam subfolder 'Data Soal' dan 'Data Siswa dan Kelas'
 */
function saveExamPackage(exam, tokens) {
  if (!exam || (!exam.id && !exam.code)) {
    throw new Error("Data paket ujian tidak valid.");
  }

  var folders = getSystemFolders();
  var examCode = (exam.code || "").trim().toUpperCase();
  var examTitle = exam.title || "Ujian CBT";

  // 1. Simpan paket soal lengkap sebagai JSON file di subfolder 'Data Soal'
  var fileName = "[" + examCode + "]_" + examTitle.replace(/[\/\\?%*:|"<>]/g, "_") + ".json";
  var existingFiles = folders.soal.getFilesByName(fileName);
  var jsonFile;
  var jsonContent = JSON.stringify(exam, null, 2);

  if (existingFiles.hasNext()) {
    jsonFile = existingFiles.next();
    jsonFile.setContent(jsonContent);
  } else {
    jsonFile = folders.soal.createFile(fileName, jsonContent, "application/json");
  }

  // Set izin file agar dapat dibaca publik (agar siswa dapat mengunduh soal langsung)
  try {
    jsonFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {}

  var fileUrl = jsonFile.getUrl();
  var fileDownloadUrl = "https://drive.google.com/uc?id=" + jsonFile.getId() + "&export=download";

  // 2. Catat ke Spreadsheet 'Data_Bank_Soal' di subfolder 'Data Soal'
  var ssSoal = getOrCreateSpreadsheet(folders.soal, SHEET_NAME_SOAL);
  var sheetPaket = ssSoal.getSheetByName("Paket_Ujian");
  if (sheetPaket) {
    var data = sheetPaket.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][2]).toUpperCase() === examCode || String(data[i][1]) === exam.id) {
        existingRow = i + 1;
        break;
      }
    }

    var rowValues = [
      new Date(),
      exam.id || "",
      examCode,
      examTitle,
      exam.teacherProfile ? exam.teacherProfile.subject : "",
      exam.teacherProfile ? exam.teacherProfile.gradeLevel : "",
      exam.teacherProfile ? exam.teacherProfile.teacherName : "",
      exam.teacherProfile ? exam.teacherProfile.passingGrade : 75,
      exam.durationMinutes || 60,
      exam.questions ? exam.questions.length : 0,
      exam.totalScore || 100,
      fileUrl,
      new Date().toISOString()
    ];

    if (existingRow > 0) {
      sheetPaket.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheetPaket.appendRow(rowValues);
    }
  }

  // 3. Catat butir-butir soal ke sheet 'Butir_Soal'
  var sheetButir = ssSoal.getSheetByName("Butir_Soal");
  if (sheetButir && exam.questions && Array.isArray(exam.questions)) {
    // Bersihkan butir soal lama untuk ujian ini agar tidak duplikat
    var butirData = sheetButir.getDataRange().getValues();
    for (var r = butirData.length - 1; r >= 1; r--) {
      if (String(butirData[r][2]).toUpperCase() === examCode) {
        sheetButir.deleteRow(r + 1);
      }
    }

    var rowsToAdd = [];
    exam.questions.forEach(function(q, idx) {
      var optionsStr = "";
      if (q.options && Array.isArray(q.options)) {
        optionsStr = q.options.map(function(o) { return o.key + ": " + o.text; }).join(" | ");
      } else if (q.matchingPairs && Array.isArray(q.matchingPairs)) {
        optionsStr = q.matchingPairs.map(function(p) { return p.left + " -> " + p.right; }).join(" | ");
      }

      rowsToAdd.push([
        new Date(),
        exam.id || "",
        examCode,
        q.questionNumber || idx + 1,
        q.id || "q" + (idx + 1),
        q.type || "pilihan_ganda",
        q.topicTag || "",
        q.cognitiveLevel || "",
        q.questionText || "",
        q.stimulus || "",
        optionsStr,
        q.correctAnswer || "",
        q.score || 10,
        q.explanation || ""
      ]);
    });

    if (rowsToAdd.length > 0) {
      sheetButir.getRange(sheetButir.getLastRow() + 1, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
    }
  }

  // 4. Jika ada token dan roster siswa, catat ke subfolder 'Data Siswa dan Kelas'
  if (tokens && Array.isArray(tokens) && tokens.length > 0) {
    saveStudentRoster(tokens, examCode, examTitle, exam.sessionToken);
  }

  return {
    success: true,
    message: "Paket ujian berhasil disimpan ke Google Sheets (Data Soal) & Drive.",
    examCode: examCode,
    fileId: jsonFile.getId(),
    fileUrl: fileUrl,
    downloadUrl: fileDownloadUrl,
    sheetUrl: ssSoal.getUrl()
  };
}

/**
 * Simpan atau perbarui Roster Siswa & Token Ujian ke subfolder 'Data Siswa dan Kelas'
 */
function saveStudentRoster(tokens, examCode, examTitle, sessionToken) {
  var folders = getSystemFolders();
  var ssSiswa = getOrCreateSpreadsheet(folders.siswa, SHEET_NAME_SISWA);

  var sheetRoster = ssSiswa.getSheetByName("Roster_Siswa");
  if (sheetRoster && Array.isArray(tokens)) {
    var rosterData = sheetRoster.getDataRange().getValues();
    var existingMap = {};
    for (var i = 1; i < rosterData.length; i++) {
      var key = (String(rosterData[i][2]).trim() + "_" + String(rosterData[i][7]).trim()).toUpperCase();
      existingMap[key] = i + 1;
    }

    tokens.forEach(function(tok) {
      var tNisn = String(tok.nisn || "").trim();
      var tCode = String(tok.examCode || examCode || "").trim().toUpperCase();
      var lookupKey = (tNisn + "_" + tCode).toUpperCase();

      var rowValues = [
        new Date(),
        tok.id || "",
        tNisn,
        tok.studentName || "",
        tok.className || "",
        tok.seatNumber || "",
        tok.status || "belum_mulai",
        tCode,
        tok.token || "",
        new Date().toISOString()
      ];

      if (existingMap[lookupKey]) {
        sheetRoster.getRange(existingMap[lookupKey], 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        sheetRoster.appendRow(rowValues);
      }
    });
  }

  // Catat Token Sesi Umum ke sheet 'Token_Ujian'
  if (sessionToken && examCode) {
    var sheetToken = ssSiswa.getSheetByName("Token_Ujian");
    if (sheetToken) {
      sheetToken.appendRow([
        new Date(),
        examCode,
        examTitle || "",
        sessionToken,
        tokens[0] ? tokens[0].className : "Semua Kelas",
        new Date().toISOString(),
        "Aktif",
        tokens.length
      ]);
    }
  }

  return {
    success: true,
    count: tokens.length,
    sheetUrl: ssSiswa.getUrl()
  };
}

/**
 * Ambil daftar nama siswa (Roster_Siswa) dari Spreadsheet 'Data_Siswa_Dan_Kelas'
 */
function getStudentRoster(targetExamCode, targetClass) {
  var folders = getSystemFolders();
  var ssSiswa = getOrCreateSpreadsheet(folders.siswa, SHEET_NAME_SISWA);
  var sheetRoster = ssSiswa.getSheetByName("Roster_Siswa");
  var roster = [];

  if (sheetRoster && sheetRoster.getLastRow() > 1) {
    var data = sheetRoster.getDataRange().getValues();
    var filterCode = targetExamCode ? String(targetExamCode).trim().toUpperCase() : "";
    var filterClass = targetClass ? String(targetClass).trim().toUpperCase() : "";

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var sId = String(row[1] || "").trim();
      var sNisn = String(row[2] || "").trim();
      var sName = String(row[3] || "").trim();
      var sClass = String(row[4] || "").trim();
      var sSeat = String(row[5] || "").trim();
      var sStatus = String(row[6] || "belum_mulai").trim();
      var sExamCode = String(row[7] || "").trim();
      var sToken = String(row[8] || "").trim();
      var sUpdated = String(row[9] || "").trim();

      // Lewati baris jika nama siswa kosong
      if (!sName) continue;

      // Filter: jika siswa diinput umum di sheet (tanpa kode ujian), tampilkan untuk semua ujian
      var matchCode = !filterCode || !sExamCode || sExamCode.toUpperCase() === filterCode;
      var matchClass = !filterClass || !sClass || sClass.toUpperCase() === filterClass;

      if (matchCode && matchClass) {
        roster.push({
          id: sId || ("tok-" + i + "-" + sName.toLowerCase().replace(/\s+/g, "")),
          nisn: sNisn,
          studentName: sName,
          className: sClass,
          seatNumber: sSeat,
          status: sStatus || "belum_mulai",
          examCode: sExamCode || targetExamCode || "",
          token: sToken || "",
          generatedAt: sUpdated || new Date().toISOString()
        });
      }
    }
  }

  return {
    success: true,
    count: roster.length,
    roster: roster,
    spreadsheetUrl: ssSiswa.getUrl()
  };
}

/**
 * Simpan hasil ujian siswa dan analisis pengayaan/remidi ke subfolder 'Data Analisis dan Nilai'
 */
function saveStudentSession(session, aiAnalysis) {
  if (!session || !session.id) {
    throw new Error("Data sesi siswa tidak valid.");
  }

  var folders = getSystemFolders();
  var ssAnalisis = getOrCreateSpreadsheet(folders.analisis, SHEET_NAME_ANALISIS);

  // 1. Tulis ke sheet 'Hasil_Ujian'
  var sheetHasil = ssAnalisis.getSheetByName("Hasil_Ujian");
  if (sheetHasil) {
    var data = sheetHasil.getDataRange().getValues();
    var existingRow = -1;
    var cleanSessionId = String(session.id).trim();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === cleanSessionId) {
        existingRow = i + 1;
        break;
      }
    }

    var correctCount = 0;
    var wrongCount = 0;
    if (session.answers && typeof session.answers === "object") {
      Object.values(session.answers).forEach(function(ans) {
        if (ans && ans.isCorrect) correctCount++;
        else wrongCount++;
      });
    }

    var rowValues = [
      new Date(),
      cleanSessionId,
      session.examCode || "",
      session.examTitle || "",
      session.subject || "",
      session.nisn || "",
      session.studentName || "",
      session.className || "",
      session.totalScoreEarned || 0,
      session.maxScore || 100,
      session.percentage || 0,
      session.passed ? "TUNTAS (LULUS)" : "BELUM TUNTAS (REMIDIAL)",
      Math.round((session.timeSpentSeconds || 0) / 60),
      correctCount,
      wrongCount,
      session.status || "submitted",
      session.submitTime || new Date().toISOString()
    ];

    if (existingRow > 0) {
      sheetHasil.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheetHasil.appendRow(rowValues);
    }
  }

  // 2. Tulis analisis pengayaan dan remidi ke sheet 'Pengayaan_Dan_Remidi_AI'
  if (aiAnalysis || session.aiRemediation || session.aiEnrichment) {
    saveAiPengayaanRemidi(session, aiAnalysis);
  }

  // 3. Perbarui status siswa di 'Data Siswa dan Kelas' -> 'Roster_Siswa'
  try {
    var ssSiswa = getOrCreateSpreadsheet(folders.siswa, SHEET_NAME_SISWA);
    var sheetRoster = ssSiswa.getSheetByName("Roster_Siswa");
    if (sheetRoster) {
      var rData = sheetRoster.getDataRange().getValues();
      for (var k = 1; k < rData.length; k++) {
        var matchNisn = String(rData[k][2]).trim() === String(session.nisn).trim();
        var matchName = String(rData[k][3]).trim().toLowerCase() === String(session.studentName).trim().toLowerCase();
        var matchCode = !session.examCode || String(rData[k][7]).trim().toUpperCase() === String(session.examCode).trim().toUpperCase();

        if ((matchNisn || matchName) && matchCode) {
          sheetRoster.getRange(k + 1, 7).setValue("selesai");
          sheetRoster.getRange(k + 1, 10).setValue(new Date().toISOString());
          break;
        }
      }
    }
  } catch (e) {
    console.warn("Gagal update status di roster siswa:", e);
  }

  return {
    success: true,
    message: "Hasil ujian siswa berhasil dicatat ke Google Sheets (Data Analisis dan Nilai).",
    sessionId: session.id,
    sheetUrl: ssAnalisis.getUrl()
  };
}

/**
 * Simpan analisis Pengayaan & Remidi AI ke sheet 'Pengayaan_Dan_Remidi_AI'
 */
function saveAiPengayaanRemidi(session, aiAnalysis) {
  var folders = getSystemFolders();
  var ssAnalisis = getOrCreateSpreadsheet(folders.analisis, SHEET_NAME_ANALISIS);
  var sheetAI = ssAnalisis.getSheetByName("Pengayaan_Dan_Remidi_AI");
  if (!sheetAI) return { success: false, error: "Sheet Pengayaan_Dan_Remidi_AI tidak ditemukan" };

  var cleanSessionId = String(session.id).trim();
  var data = sheetAI.getDataRange().getValues();
  var existingRow = -1;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === cleanSessionId) {
      existingRow = i + 1;
      break;
    }
  }

  // Ekstrak komponen AI (objek atau string)
  var diagnosis = "";
  var enrichment = "";
  var remediation = "";
  var recommendations = "";
  var motivation = "";

  if (typeof aiAnalysis === "object" && aiAnalysis !== null) {
    diagnosis = aiAnalysis.diagnosis || aiAnalysis.summary || "";
    enrichment = typeof aiAnalysis.enrichment === "object" ? JSON.stringify(aiAnalysis.enrichment) : (aiAnalysis.enrichment || "");
    remediation = typeof aiAnalysis.remediation === "object" ? JSON.stringify(aiAnalysis.remediation) : (aiAnalysis.remediation || "");
    recommendations = (aiAnalysis.recommendedTopics && aiAnalysis.recommendedTopics.join(", ")) || aiAnalysis.recommendations || "";
    motivation = aiAnalysis.motivation || aiAnalysis.motivationMessage || "";
  } else if (typeof aiAnalysis === "string") {
    diagnosis = aiAnalysis;
    enrichment = session.aiEnrichment || (session.passed ? aiAnalysis : "-");
    remediation = session.aiRemediation || (!session.passed ? aiAnalysis : "-");
  } else {
    enrichment = session.aiEnrichment || "-";
    remediation = session.aiRemediation || "-";
  }

  var rowValues = [
    new Date(),
    cleanSessionId,
    session.examCode || "",
    session.nisn || "",
    session.studentName || "",
    session.className || "",
    session.totalScoreEarned || 0,
    session.passed ? "TUNTAS (PENGAYAAN)" : "BELUM TUNTAS (REMIDIAL)",
    diagnosis,
    enrichment,
    remediation,
    recommendations,
    motivation
  ];

  if (existingRow > 0) {
    sheetAI.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheetAI.appendRow(rowValues);
  }

  return {
    success: true,
    message: "Analisis Pengayaan & Remidi AI tersimpan di database spreadsheet.",
    sheetUrl: ssAnalisis.getUrl()
  };
}

/**
 * Ambil naskah ujian berdasarkan kode ujian dari subfolder 'Data Soal'
 */
function getExamByCode(code) {
  var cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) throw new Error("Kode ujian harus disertakan.");

  var folders = getSystemFolders();
  var files = folders.soal.getFiles();
  var matchedFile = null;

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName().toUpperCase();
    if (name.indexOf("[" + cleanCode + "]") !== -1 || name.indexOf(cleanCode) !== -1) {
      matchedFile = file;
      break;
    }
  }

  if (!matchedFile) {
    return {
      success: false,
      message: "Naskah soal dengan kode '" + cleanCode + "' belum ditemukan di folder 'Data Soal'."
    };
  }

  var content = matchedFile.getBlob().getDataAsString();
  var examData = JSON.parse(content);

  return {
    success: true,
    exam: examData,
    fileId: matchedFile.getId(),
    fileUrl: matchedFile.getUrl()
  };
}

/**
 * Ambil daftar semua ujian yang tersimpan di subfolder 'Data Soal'
 */
function listAllExams() {
  var folders = getSystemFolders();
  var ssSoal = getOrCreateSpreadsheet(folders.soal, SHEET_NAME_SOAL);
  var sheetPaket = ssSoal.getSheetByName("Paket_Ujian");
  var list = [];

  if (sheetPaket && sheetPaket.getLastRow() > 1) {
    var data = sheetPaket.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      list.push({
        id: data[i][1],
        code: data[i][2],
        title: data[i][3],
        subject: data[i][4],
        gradeLevel: data[i][5],
        teacherName: data[i][6],
        passingGrade: data[i][7],
        durationMinutes: data[i][8],
        questionsCount: data[i][9],
        totalScore: data[i][10],
        fileUrl: data[i][11],
        updatedAt: data[i][12]
      });
    }
  }

  return { success: true, exams: list };
}

/**
 * Ambil seluruh data sesi siswa dari subfolder 'Data Analisis dan Nilai'
 */
function getStudentSessions(examCode) {
  var folders = getSystemFolders();
  var ssAnalisis = getOrCreateSpreadsheet(folders.analisis, SHEET_NAME_ANALISIS);
  var sheetHasil = ssAnalisis.getSheetByName("Hasil_Ujian");
  var sheetAI = ssAnalisis.getSheetByName("Pengayaan_Dan_Remidi_AI");

  var aiMap = {};
  if (sheetAI && sheetAI.getLastRow() > 1) {
    var aiData = sheetAI.getDataRange().getValues();
    for (var j = 1; j < aiData.length; j++) {
      var sId = String(aiData[j][1]).trim();
      aiMap[sId] = {
        diagnosis: aiData[j][8],
        enrichment: aiData[j][9],
        remediation: aiData[j][10],
        recommendations: aiData[j][11],
        motivation: aiData[j][12]
      };
    }
  }

  var sessions = [];
  var filterCode = examCode ? String(examCode).trim().toUpperCase() : "";

  if (sheetHasil && sheetHasil.getLastRow() > 1) {
    var data = sheetHasil.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var sCode = String(data[i][2]).trim().toUpperCase();
      if (!filterCode || sCode === filterCode) {
        var sessId = String(data[i][1]).trim();
        sessions.push({
          id: sessId,
          examCode: data[i][2],
          examTitle: data[i][3],
          subject: data[i][4],
          nisn: data[i][5],
          studentName: data[i][6],
          className: data[i][7],
          totalScoreEarned: Number(data[i][8]) || 0,
          maxScore: Number(data[i][9]) || 100,
          percentage: Number(data[i][10]) || 0,
          passed: String(data[i][11]).indexOf("TUNTAS") !== -1,
          timeSpentSeconds: (Number(data[i][12]) || 0) * 60,
          correctCount: Number(data[i][13]) || 0,
          wrongCount: Number(data[i][14]) || 0,
          status: data[i][15] || "submitted",
          submitTime: data[i][16],
          aiAnalysis: aiMap[sessId] || null
        });
      }
    }
  }

  return { success: true, count: sessions.length, sessions: sessions };
}

/**
 * Hapus atau reset sesi siswa
 */
function deleteStudentSession(sessionId, examCode, studentName) {
  var folders = getSystemFolders();
  var ssAnalisis = getOrCreateSpreadsheet(folders.analisis, SHEET_NAME_ANALISIS);
  var sheetHasil = ssAnalisis.getSheetByName("Hasil_Ujian");
  var sheetAI = ssAnalisis.getSheetByName("Pengayaan_Dan_Remidi_AI");

  var deleted = 0;
  var targetId = String(sessionId || "").trim();

  if (sheetHasil && sheetHasil.getLastRow() > 1) {
    var data = sheetHasil.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][1]).trim() === targetId) {
        sheetHasil.deleteRow(i + 1);
        deleted++;
        break;
      }
    }
  }

  if (sheetAI && sheetAI.getLastRow() > 1) {
    var aiData = sheetAI.getDataRange().getValues();
    for (var j = aiData.length - 1; j >= 1; j--) {
      if (String(aiData[j][1]).trim() === targetId) {
        sheetAI.deleteRow(j + 1);
        break;
      }
    }
  }

  return { success: true, deleted: deleted, message: "Sesi " + targetId + " berhasil dihapus dari Google Sheets." };
}

/**
 * Batch delete sesi siswa
 */
function batchDeleteStudentSessions(sessionIds, examCode) {
  var idSet = {};
  (sessionIds || []).forEach(function(id) { idSet[String(id).trim()] = true; });

  var folders = getSystemFolders();
  var ssAnalisis = getOrCreateSpreadsheet(folders.analisis, SHEET_NAME_ANALISIS);
  var sheetHasil = ssAnalisis.getSheetByName("Hasil_Ujian");

  var deletedCount = 0;
  if (sheetHasil && sheetHasil.getLastRow() > 1) {
    var data = sheetHasil.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      var sId = String(data[i][1]).trim();
      if (idSet[sId]) {
        sheetHasil.deleteRow(i + 1);
        deletedCount++;
      }
    }
  }

  return { success: true, deletedCount: deletedCount };
}

/**
 * Simpan backup aplikasi lengkap ke folder utama 'CBT SlideExam Database'
 */
function saveAppBackup(backupData) {
  if (!backupData) {
    return { success: false, message: "Data backup kosong atau tidak valid." };
  }
  var folders = getSystemFolders();
  var targetFolder = (folders && folders.master) ? folders.master : DriveApp.getRootFolder();
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+7", "yyyy-MM-dd_HH-mm-ss");
  var fileName = "SlideExam_CBT_Backup_" + timestamp + ".json";
  var jsonContent = typeof backupData === "string" ? backupData : JSON.stringify(backupData, null, 2);
  var file = targetFolder.createFile(fileName, jsonContent, "application/json");

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}

  return {
    success: true,
    fileId: file.getId(),
    fileName: fileName,
    fileUrl: file.getUrl(),
    message: "Backup berhasil disimpan di Google Drive: " + fileName
  };
}

/**
 * Ambil daftar file backup di folder utama 'CBT SlideExam Database'
 */
function listAppBackups() {
  var folders = getSystemFolders();
  var targetFolder = (folders && folders.master) ? folders.master : DriveApp.getRootFolder();
  var files = targetFolder.getFiles();
  var backups = [];
  while (files && files.hasNext()) {
    var f = files.next();
    var name = f.getName();
    if (name.indexOf("SlideExam_CBT_Backup_") === 0 && name.indexOf(".json") !== -1) {
      backups.push({
        id: f.getId(),
        name: name,
        size: f.getSize(),
        createdTime: f.getDateCreated().toISOString(),
        modifiedTime: f.getLastUpdated().toISOString(),
        webViewLink: f.getUrl()
      });
    }
  }

  backups.sort(function(a, b) {
    return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
  });

  return { success: true, backups: backups };
}

/**
 * Ambil data backup untuk restore dari Google Drive
 */
function getAppBackup(fileId) {
  if (!fileId) throw new Error("ID File tidak diberikan.");
  var file = DriveApp.getFileById(fileId);
  var content = file.getBlob().getDataAsString();
  var parsed = JSON.parse(content);
  return { success: true, data: parsed, fileName: file.getName() };
}

