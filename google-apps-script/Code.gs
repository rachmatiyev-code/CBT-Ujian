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

// =========================================================================
// 1. KONFIGURASI ID SPREADSHEET GOOGLE (SANGAT PENTING)
// =========================================================================
// Salin string ID spreadsheet dari URL browser di antara /d/ dan /edit:
// Contoh: https://docs.google.com/spreadsheets/d/1jgREm74oAftju7CWA0mv4fBq0Cz-sar3E7GvbgljUJg/edit
// ID Spreadsheet Anda: 1jgREm74oAftju7CWA0mv4fBq0Cz-sar3E7GvbgljUJg
// =========================================================================
var SPREADSHEET_ID = "1jgREm74oAftju7CWA0mv4fBq0Cz-sar3E7GvbgljUJg"; // Target Spreadsheet Utama / Data_Analisis_Dan_Nilai

// Konfigurasi ID Spreadsheet Terpisah (Opsional):
// Jika Anda memisahkan file Spreadsheet, isi ID masing-masing di bawah.
// Jika dikosongkan (""), seluruh sheet (MasterData, Hasil_Ujian, dll) akan otomatis masuk ke SPREADSHEET_ID di atas.
var SPREADSHEET_ANALISIS_ID = "1jgREm74oAftju7CWA0mv4fBq0Cz-sar3E7GvbgljUJg"; // Target Data_Analisis_Dan_Nilai
var SPREADSHEET_SOAL_ID = "";     // Target Data_Soal (kosongkan jika digabung)
var SPREADSHEET_SISWA_ID = "";    // Target Data_Siswa_Dan_Kelas (kosongkan jika digabung)

var MASTER_FOLDER_NAME = "CBT SlideExam Database";
var SUBFOLDER_SISWA = "Data Siswa dan Kelas";
var SUBFOLDER_ANALISIS = "Data Analisis dan Nilai";
var SUBFOLDER_SOAL = "Data Soal";

var SHEET_NAME_SISWA = "Data_Siswa_Dan_Kelas";
var SHEET_NAME_ANALISIS = "Data_Analisis_Dan_Nilai";
var SHEET_NAME_SOAL = "Data_Bank_Soal";

// Nama Tab Standar
var TAB_MASTER_DATA = "MasterData";
var TAB_HASIL_UJIAN = "Hasil_Ujian";
var TAB_PENGAYAAN_REMIDI = "Pengayaan_Dan_Remidi_AI";
var TAB_ANALISIS_BUTIR = "Analisis_Butir_Soal";
var TAB_PAKET_UJIAN = "Paket_Ujian";
var TAB_BUTIR_SOAL = "Butir_Soal";
var TAB_ROSTER_SISWA = "Roster_Siswa";
var TAB_TOKEN_UJIAN = "Token_Ujian";

/**
 * Handle HTTP GET Requests
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "ping";
  var result = { success: false, action: action };

  try {
    switch (action) {
      case "ping":
        var ssPing = null;
        var pingInfo = { spreadsheetId: SPREADSHEET_ID, connected: false };
        try {
          ssPing = getSpreadsheetByType("analisis");
          if (ssPing) {
            pingInfo = {
              connected: true,
              id: ssPing.getId(),
              name: ssPing.getName(),
              url: ssPing.getUrl(),
              sheets: ssPing.getSheets().map(function(s) { return s.getName(); })
            };
          }
        } catch (ePing) {
          pingInfo.error = ePing.toString();
        }

        var foldersData = null;
        try {
          foldersData = getFoldersInfo();
        } catch (eFolders) {
          foldersData = { warning: "Folder database belum diinisialisasi: " + eFolders.toString() };
        }

        result = {
          success: true,
          status: "ready",
          message: "Google Apps Script CBT Backend aktif & terhubung ke Google Sheets.",
          timestamp: new Date().toISOString(),
          spreadsheet: pingInfo,
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

      case "getMonitoring":
        var targetExamCode = (e.parameter.examCode || "").trim().toUpperCase();
        var ssMonitoring = null;
        try {
          ssMonitoring = getSpreadsheetByType("analisis");
        } catch (eMon) {
          if (SPREADSHEET_ID) {
            ssMonitoring = SpreadsheetApp.openById(SPREADSHEET_ID);
          }
        }

        var sheetHasil = ssMonitoring ? ssMonitoring.getSheetByName("Hasil_Ujian") : null;
        if (!sheetHasil) {
          result = { success: true, count: 0, students: [] };
          break;
        }

        var dataMonitoring = sheetHasil.getDataRange().getValues();
        var monitoringStudents = [];

        // Abaikan baris header (indeks 0)
        for (var mi = 1; mi < dataMonitoring.length; mi++) {
          var rowExamCode = String(dataMonitoring[mi][2] || "").trim().toUpperCase();
          if (!targetExamCode || !rowExamCode || rowExamCode === targetExamCode) {
            monitoringStudents.push({
              timestamp: dataMonitoring[mi][0],
              sessionId: dataMonitoring[mi][1],
              examCode: dataMonitoring[mi][2],
              examTitle: dataMonitoring[mi][3],
              subject: dataMonitoring[mi][4],
              studentId: dataMonitoring[mi][5],
              nisn: dataMonitoring[mi][5],
              name: dataMonitoring[mi][6],
              studentName: dataMonitoring[mi][6],
              class: dataMonitoring[mi][7],
              className: dataMonitoring[mi][7],
              score: dataMonitoring[mi][8],
              maxScore: dataMonitoring[mi][9] || 100,
              percentage: dataMonitoring[mi][10] || dataMonitoring[mi][8] || 0,
              passed: String(dataMonitoring[mi][11] || "").indexOf("TUNTAS") !== -1,
              timeSpentMinutes: dataMonitoring[mi][12],
              timeSpentSeconds: (Number(dataMonitoring[mi][12]) || 0) * 60,
              correctCount: dataMonitoring[mi][13],
              wrongCount: dataMonitoring[mi][14],
              status: dataMonitoring[mi][15] || "Belum Mulai",
              submitTime: dataMonitoring[mi][16] || dataMonitoring[mi][0]
            });
          }
        }

        result = {
          success: true,
          count: monitoringStudents.length,
          students: monitoringStudents
        };
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
 * -------------------------------------------------------------------------
 * Menerima payload JSON, mem-parse data, membuka spreadsheet menggunakan SPREADSHEET_ID,
 * mengidentifikasi targetSheet (misal: 'Hasil_Ujian', 'MasterData', 'Pengayaan_Dan_Remidi_AI', 'Analisis_Butir_Soal'),
 * dan menggunakan appendRow() untuk menyimpan rowValues dengan penanganan galat terperinci.
 */
function doPost(e) {
  var result = { success: false };

  try {
    // 1. Parsing incoming JSON dari request body
    var data = null;
    if (e && e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (errJson) {
        return createJsonResponse({
          success: false,
          error: "Format JSON tidak valid: " + errJson.toString(),
          rawContent: e.postData.contents ? e.postData.contents.substring(0, 300) : null
        });
      }
    } else if (e && e.parameter && Object.keys(e.parameter).length > 0) {
      data = e.parameter;
    } else {
      return createJsonResponse({
        success: false,
        error: "Permintaan POST kosong: Tidak ada data JSON (postData.contents) atau parameter yang diterima."
      });
    }

    if (!data || typeof data !== "object") {
      return createJsonResponse({
        success: false,
        error: "Payload JSON tidak valid atau bukan berupa objek."
      });
    }

    var payload = data; // alias untuk kompatibilitas ganda

    // 2. Hubungkan ke target Google Spreadsheet menggunakan SpreadsheetApp.openById(SPREADSHEET_ID)
    var targetSpreadsheetId = (data.spreadsheetId && String(data.spreadsheetId).trim()) || SPREADSHEET_ID;
    var ss = null;

    if (targetSpreadsheetId) {
      try {
        ss = SpreadsheetApp.openById(targetSpreadsheetId);
      } catch (eOpen) {
        if (data.targetSheet) {
          return createJsonResponse({
            success: false,
            error: "Gagal membuka Spreadsheet dengan ID '" + targetSpreadsheetId + "': " + eOpen.toString(),
            spreadsheetId: targetSpreadsheetId,
            hint: "Pastikan ID spreadsheet benar dan akun Google yang mendeploy Web App memiliki akses Editor ke Spreadsheet tersebut."
          });
        }
      }
    }

    // Fallback otomatis jika SPREADSHEET_ID belum diisi atau gagal
    if (!ss) {
      try {
        ss = getSpreadsheetByType("analisis");
      } catch (eFallback) {}
    }

    if (!ss && data.targetSheet) {
      return createJsonResponse({
        success: false,
        error: "SPREADSHEET_ID belum dikonfigurasi dan spreadsheet Google Drive tidak ditemukan. Harap isi variabel SPREADSHEET_ID di bagian atas Code.gs.",
        hint: "Isi SPREADSHEET_ID di bagian atas Code.gs atau kirim parameter { spreadsheetId: '...' }."
      });
    }

    // 3. Routing Berdasarkan data.targetSheet
    // Mendukung sheet utama: 'Hasil_Ujian', 'MasterData', 'Pengayaan_Dan_Remidi_AI', 'Analisis_Butir_Soal', dll.
    if (data.targetSheet) {
      var targetSheetName = String(data.targetSheet).trim();
      if (!targetSheetName) {
        return createJsonResponse({
          success: false,
          error: "Parameter 'targetSheet' tidak boleh kosong."
        });
      }

      var sheet = ss.getSheetByName(targetSheetName);

      // Pencarian fleksibel case-insensitive jika nama sheet tidak cocok persis (misal: 'hasil_ujian' -> 'Hasil_Ujian')
      if (!sheet) {
        var cleanTarget = targetSheetName.toLowerCase().replace(/[\s_-]+/g, "");
        var allSheets = ss.getSheets();
        for (var s = 0; s < allSheets.length; s++) {
          var curSheet = allSheets[s];
          var curName = curSheet.getName();
          if (curName.toLowerCase().replace(/[\s_-]+/g, "") === cleanTarget) {
            sheet = curSheet;
            targetSheetName = curName;
            break;
          }
        }
      }

      // ERROR HANDLING UNTUK MISSING SHEETS (Sheet tidak ditemukan)
      if (!sheet) {
        // Cek apakah sheet yang diminta terdaftar dalam konfigurasi standar sehingga dapat dibuat otomatis (Self-Healing)
        var tabCfg = getHeadersForTab(targetSheetName);
        if (data.createIfMissing !== false && tabCfg && tabCfg.headers && tabCfg.headers.length > 0) {
          try {
            sheet = getOrInsertSheet(ss, targetSheetName, tabCfg.headers, tabCfg.headerBg);
          } catch (eInsert) {
            var existingSheets = ss.getSheets().map(function(s) { return s.getName(); });
            return createJsonResponse({
              success: false,
              error: "Sheet '" + targetSheetName + "' tidak ditemukan dan gagal dibuat secara otomatis: " + eInsert.toString(),
              missingSheet: targetSheetName,
              availableSheets: existingSheets,
              spreadsheetId: ss.getId()
            });
          }
        } else {
          // Kembalikan pesan error terstruktur jika sheet tidak ditemukan dan tidak dapat dibuat
          var availableSheetsList = ss.getSheets().map(function(s) { return s.getName(); });
          return createJsonResponse({
            success: false,
            error: "Sheet tujuan '" + targetSheetName + "' tidak ditemukan di dalam Spreadsheet.",
            missingSheet: targetSheetName,
            availableSheets: availableSheetsList,
            spreadsheetId: ss.getId(),
            spreadsheetUrl: ss.getUrl(),
            hint: "Buat sheet bernama '" + targetSheetName + "' di Spreadsheet atau kirim parameter { createIfMissing: true }."
          });
        }
      }

      // 4. Menggunakan appendRow() untuk menyimpan rowValues
      var rowsWritten = 0;
      var cleanTargetUpper = targetSheetName.toUpperCase().replace(/[\s_-]+/g, "");

      // A. Jika payload memiliki rowValues (array satu baris)
      if (data.rowValues !== undefined) {
        if (!Array.isArray(data.rowValues)) {
          return createJsonResponse({
            success: false,
            error: "Parameter 'rowValues' harus berupa Array nilai kolom (contoh: ['nilai1', 'nilai2', ...]).",
            targetSheet: targetSheetName,
            receivedType: typeof data.rowValues
          });
        }
        try {
          sheet.appendRow(data.rowValues);
          rowsWritten = 1;
        } catch (eAppend) {
          return createJsonResponse({
            success: false,
            error: "Gagal mengeksekusi appendRow() pada sheet '" + targetSheetName + "': " + eAppend.toString(),
            targetSheet: targetSheetName,
            spreadsheetId: ss.getId()
          });
        }
      } else if (data.row && Array.isArray(data.row)) {
        try {
          sheet.appendRow(data.row);
          rowsWritten = 1;
        } catch (eAppend) {
          return createJsonResponse({
            success: false,
            error: "Gagal mengeksekusi appendRow() pada sheet '" + targetSheetName + "': " + eAppend.toString(),
            targetSheet: targetSheetName,
            spreadsheetId: ss.getId()
          });
        }
      } else if (data.values && Array.isArray(data.values) && (!data.values[0] || !Array.isArray(data.values[0]))) {
        try {
          sheet.appendRow(data.values);
          rowsWritten = 1;
        } catch (eAppend) {
          return createJsonResponse({
            success: false,
            error: "Gagal mengeksekusi appendRow() pada sheet '" + targetSheetName + "': " + eAppend.toString(),
            targetSheet: targetSheetName,
            spreadsheetId: ss.getId()
          });
        }
      }
      // B. Multi-baris (data.rows atau data.data)
      else if (data.rows && Array.isArray(data.rows) && data.rows.length > 0) {
        for (var r = 0; r < data.rows.length; r++) {
          if (Array.isArray(data.rows[r])) {
            try {
              sheet.appendRow(data.rows[r]);
              rowsWritten++;
            } catch (eAppendRow) {
              console.warn("Gagal appendRow baris ke-" + r + ":", eAppendRow);
            }
          }
        }
      } else if (data.data && Array.isArray(data.data) && data.data.length > 0 && Array.isArray(data.data[0])) {
        for (var d = 0; d < data.data.length; d++) {
          if (Array.isArray(data.data[d])) {
            try {
              sheet.appendRow(data.data[d]);
              rowsWritten++;
            } catch (eAppendRow) {
              console.warn("Gagal appendRow data ke-" + d + ":", eAppendRow);
            }
          }
        }
      }
      // C. Objek sesi siswa yang ditargetkan ke 'Hasil_Ujian' atau 'MasterData'
      else if (data.session && typeof data.session === "object") {
        if (cleanTargetUpper === "HASILUJIAN" || cleanTargetUpper === "HASIL_UJIAN") {
          return createJsonResponse(saveStudentSession(data.session, data.aiAnalysis, ss.getId()));
        } else if (cleanTargetUpper === "MASTERDATA") {
          logToMasterData(ss, {
            type: "HASIL_UJIAN",
            examCode: data.session.examCode || "",
            examTitle: data.session.examTitle || "",
            subject: data.session.subject || "",
            className: data.session.className || "",
            nisn: data.session.nisn || "",
            studentName: data.session.studentName || "",
            score: data.session.totalScoreEarned || 0,
            status: data.session.passed ? "TUNTAS" : "REMIDIAL",
            note: "Nilai: " + (data.session.percentage || 0) + "%",
            sessionId: data.session.id
          });
          return createJsonResponse({
            success: true,
            message: "Data sesi siswa berhasil dicatat ke MasterData",
            targetSheet: targetSheetName,
            spreadsheetUrl: ss.getUrl()
          });
        }
      }
      // D. Objek entry / log audit langsung
      else if (data.entry && typeof data.entry === "object") {
        logToMasterData(ss, data.entry);
        rowsWritten = 1;
      }
      // E. Objek key-value generik yang dipetakan ke header kolom
      else if (data.record && typeof data.record === "object") {
        var numCols = sheet.getLastColumn() || 1;
        var headers = sheet.getRange(1, 1, 1, numCols).getValues()[0] || [];
        var mappedRow = [];
        for (var h = 0; h < headers.length; h++) {
          var colKey = String(headers[h]).trim();
          var val = data.record[colKey] !== undefined ? data.record[colKey] : (data.record[colKey.toLowerCase()] !== undefined ? data.record[colKey.toLowerCase()] : "");
          mappedRow.push(val);
        }
        sheet.appendRow(mappedRow);
        rowsWritten = 1;
      } else {
        return createJsonResponse({
          success: false,
          error: "Payload untuk targetSheet '" + targetSheetName + "' harus menyertakan 'rowValues' (Array nilai kolom).",
          targetSheet: targetSheetName,
          hint: "Contoh format JSON: { targetSheet: '" + targetSheetName + "', rowValues: ['Data1', 'Data2', 100] }"
        });
      }

      // Catat log audit ke MasterData jika tujuan bukan MasterData
      if (cleanTargetUpper !== "MASTERDATA") {
        logToMasterData(ss, {
          type: "ROUTED_" + targetSheetName.toUpperCase(),
          examCode: data.examCode || (data.session && data.session.examCode) || "",
          studentName: data.studentName || (data.session && data.session.studentName) || "",
          note: "Data berhasil dirutekan ke sheet " + targetSheetName + " (" + rowsWritten + " baris)"
        });
      }

      return createJsonResponse({
        success: true,
        message: "Data berhasil disimpan ke sheet '" + targetSheetName + "' via appendRow()",
        targetSheet: targetSheetName,
        rowsWritten: rowsWritten,
        lastRow: sheet.getLastRow(),
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl()
      });
    }

    // 4. Routing Berdasarkan action standar (jika targetSheet tidak spesifik)
    var action = data.action || (e && e.parameter && e.parameter.action) || "";

    switch (action) {
      case "ping":
        result = {
          success: true,
          message: "PONG - GAS Backend Online & Terhubung ke Sheets",
          timestamp: new Date().toISOString(),
          spreadsheetId: ss.getId(),
          spreadsheetUrl: ss.getUrl(),
          availableSheets: ss.getSheets().map(function(s) { return s.getName(); })
        };
        break;

      case "initFolders":
        result = initMasterFoldersAndSheets();
        break;

      case "syncExam":
        result = saveExamPackage(data.exam, data.tokens, targetSpreadsheetId);
        break;

      case "cleanupDuplicates":
        result = cleanupDriveDuplicates();
        break;

      case "saveSession":
      case "submitExam":
        result = saveStudentSession(data.session, data.aiAnalysis, targetSpreadsheetId);
        break;

      case "saveAiAnalysis":
        result = saveAiPengayaanRemidi(data.session, data.aiAnalysis, targetSpreadsheetId);
        break;

      case "saveRoster":
        result = saveStudentRoster(data.roster || data.tokens, data.examCode, data.examTitle, data.sessionToken, targetSpreadsheetId);
        break;

      case "deleteSession":
        result = deleteStudentSession(data.sessionId, data.examCode, data.studentName, targetSpreadsheetId);
        break;

      case "batchDeleteSessions":
        result = batchDeleteStudentSessions(data.sessionIds, data.examCode, data.studentNames, targetSpreadsheetId);
        break;

      case "backupApp":
        result = saveAppBackup(data.backupData);
        break;

      case "restoreBackup":
        result = getAppBackup(data.fileId);
        break;

      default:
        // Jika action tidak dikenal, tapi ada data baris:
        if (data.rowValues && Array.isArray(data.rowValues)) {
          var defSheet = getOrInsertSheet(ss, TAB_HASIL_UJIAN, getHeadersForTab(TAB_HASIL_UJIAN).headers, getHeadersForTab(TAB_HASIL_UJIAN).headerBg);
          defSheet.appendRow(data.rowValues);
          result = {
            success: true,
            message: "Data berhasil ditulis ke sheet default '" + TAB_HASIL_UJIAN + "'",
            targetSheet: TAB_HASIL_UJIAN,
            spreadsheetUrl: ss.getUrl()
          };
        } else {
          result = {
            success: false,
            error: "Permintaan POST tidak valid: Tentukan 'targetSheet' (misal: 'Hasil_Ujian', 'MasterData') atau 'action' yang valid.",
            receivedData: data
          };
        }
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
 * Konfigurasi Skema Tab & Header Standar Database Spreadsheet
 */
var DEFAULT_SHEET_CONFIGS = {};
DEFAULT_SHEET_CONFIGS[SHEET_NAME_SISWA] = [
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
];

DEFAULT_SHEET_CONFIGS[SHEET_NAME_SOAL] = [
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
];

DEFAULT_SHEET_CONFIGS[SHEET_NAME_ANALISIS] = [
  {
    name: "MasterData",
    headers: [
      "Timestamp", "Tipe Data", "Kode Ujian", "Judul Ujian", "Mata Pelajaran",
      "Kelas", "NISN / Token", "Nama Siswa", "Nilai / Skor", "Status Kelulusan",
      "Keterangan", "Sesi ID", "Waktu Pengerjaan"
    ],
    headerBg: "#0f172a"
  },
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
];

// Fallback config untuk MasterData jika dipanggil langsung
DEFAULT_SHEET_CONFIGS["MasterData"] = [
  {
    name: "MasterData",
    headers: [
      "Timestamp", "Tipe Data", "Kode Ujian", "Judul Ujian", "Mata Pelajaran",
      "Kelas", "NISN / Token", "Nama Siswa", "Nilai / Skor", "Status Kelulusan",
      "Keterangan", "Sesi ID", "Waktu Pengerjaan"
    ],
    headerBg: "#0f172a"
  }
];

/**
 * Cari definisi headers dan background warna untuk nama tab tertentu
 */
function getHeadersForTab(tabName) {
  var clean = String(tabName || "").toLowerCase().replace(/[\s_-]+/g, "");
  for (var key in DEFAULT_SHEET_CONFIGS) {
    var tabs = DEFAULT_SHEET_CONFIGS[key];
    if (Array.isArray(tabs)) {
      for (var i = 0; i < tabs.length; i++) {
        var tClean = tabs[i].name.toLowerCase().replace(/[\s_-]+/g, "");
        if (tClean === clean) {
          return tabs[i];
        }
      }
    }
  }
  return { name: tabName, headers: [], headerBg: "#1e293b" };
}

/**
 * Catat ringkasan transaksi/data ke sheet 'MasterData'
 */
function logToMasterData(ss, entry) {
  try {
    if (!ss) return;
    var masterTabCfg = getHeadersForTab("MasterData");
    var sheetMaster = getOrInsertSheet(ss, "MasterData", masterTabCfg.headers, masterTabCfg.headerBg);
    if (sheetMaster) {
      sheetMaster.appendRow([
        new Date(),
        entry.type || "LOG",
        entry.examCode || "",
        entry.examTitle || "",
        entry.subject || "",
        entry.className || "",
        entry.nisn || entry.token || "",
        entry.studentName || "",
        entry.score !== undefined ? entry.score : "",
        entry.status || "",
        entry.note || "",
        entry.sessionId || "",
        new Date().toISOString()
      ]);
    }
  } catch (eMaster) {
    console.warn("Gagal mencatat log ke MasterData:", eMaster);
  }
}

/**
 * Format nama file naskah soal Google Drive:
 * Format: "Naskah_Soal_[ExamID].json" atau "Naskah_Soal_[ExamCode].json"
 * Contoh: "Naskah_Soal_PP-01.json", "Naskah_Soal_exam-174123.json"
 * Mencegah duplikasi file generic Naskah_Soal_CBT.json di Google Drive.
 */
function formatExamFileName(exam) {
  var cleanId = ((exam && exam.id) || "").trim().replace(/[/\\?%*:|"<>]/g, "");
  var cleanKode = ((exam && exam.code) || "")
    .trim()
    .toUpperCase()
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, "_");

  var identifier = cleanKode && cleanKode !== "SOAL" ? cleanKode : cleanId || "CBT";

  return "Naskah_Soal_" + identifier + ".json";
}

/**
 * Dapatkan atau buat Sheet baru secara otomatis (Self-Healing)
 * Mendukung pencarian fleksibel case-insensitive & variasi karakter pemisah
 */
function getOrInsertSheet(ss, sheetName, headers, headerBg) {
  if (!ss) return null;
  var cleanTarget = String(sheetName || "").toLowerCase().replace(/[\s_-]+/g, "");
  var sheets = ss.getSheets();
  var matchedSheet = null;

  for (var i = 0; i < sheets.length; i++) {
    var curName = sheets[i].getName();
    var cleanCur = curName.toLowerCase().replace(/[\s_-]+/g, "");
    if (cleanCur === cleanTarget || curName.toLowerCase() === sheetName.toLowerCase()) {
      matchedSheet = sheets[i];
      break;
    }
  }

  if (!matchedSheet) {
    matchedSheet = ss.insertSheet(sheetName);
  }

  // Jika sheet belum ada header atau masih kosong melompong (getLastRow() === 0)
  if (matchedSheet.getLastRow() === 0 && headers && headers.length > 0) {
    matchedSheet.appendRow(headers);
    try {
      var headerRange = matchedSheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setBackground(headerBg || "#1e293b");
      headerRange.setFontColor("#ffffff");
      matchedSheet.setFrozenRows(1);
    } catch(eFmt) {}
  }

  // Bersihkan sheet default bawaan Google Sheets (Sheet1 / Lembar1) jika ada sheet data lain
  var allSheets = ss.getSheets();
  if (allSheets.length > 1) {
    for (var j = 0; j < allSheets.length; j++) {
      var s = allSheets[j];
      var sName = s.getName().toLowerCase().replace(/\s+/g, "");
      if ((sName === "sheet1" || sName === "lembar1" || sName === "sheet") && s.getLastRow() === 0) {
        try {
          ss.deleteSheet(s);
        } catch(eDel) {}
      }
    }
  }

  return matchedSheet;
}

/**
 * Buka Spreadsheet berdasarkan Tipe atau ID kustom secara langsung.
 * Jika SPREADSHEET_ID / SPREADSHEET_ANALISIS_ID diisi, fungsi ini akan langsung membuka file Google Sheet tersebut!
 */
function getSpreadsheetByType(type, customId) {
  var id = (customId && String(customId).trim()) || "";
  var cleanType = String(type || "").toLowerCase().trim();

  if (!id) {
    if (cleanType === "soal" || cleanType === "data_soal" || cleanType === "bank_soal") {
      id = SPREADSHEET_SOAL_ID || SPREADSHEET_ID;
    } else if (cleanType === "siswa" || cleanType === "data_siswa_dan_kelas" || cleanType === "roster") {
      id = SPREADSHEET_SISWA_ID || SPREADSHEET_ID;
    } else {
      id = SPREADSHEET_ANALISIS_ID || SPREADSHEET_ID;
    }
  }

  // 1. Prioritaskan membuka Spreadsheet menggunakan ID langsung (SpreadsheetApp.openById)
  if (id && String(id).trim().length > 5) {
    try {
      var ssById = SpreadsheetApp.openById(String(id).trim());
      if (ssById) {
        // Self-healing: Pastikan tab dasar (MasterData, Hasil_Ujian, dll.) ada
        var targetConfigName = (cleanType === "soal" || cleanType === "bank_soal") ? SHEET_NAME_SOAL
          : (cleanType === "siswa" || cleanType === "roster") ? SHEET_NAME_SISWA
          : SHEET_NAME_ANALISIS;
        var configs = DEFAULT_SHEET_CONFIGS[targetConfigName] || DEFAULT_SHEET_CONFIGS[SHEET_NAME_ANALISIS] || [];
        for (var c = 0; c < configs.length; c++) {
          getOrInsertSheet(ssById, configs[c].name, configs[c].headers, configs[c].headerBg);
        }
        return ssById;
      }
    } catch (eOpenById) {
      console.warn("SpreadsheetApp.openById('" + id + "') gagal: " + eOpenById.toString());
    }
  }

  // 2. Fallback: Cari atau buat otomatis di Google Drive
  var folders = getSystemFolders();
  var targetFolder = (cleanType === "soal" || cleanType === "bank_soal") ? folders.soal
    : (cleanType === "siswa" || cleanType === "roster") ? folders.siswa
    : folders.analisis;
  var targetName = (cleanType === "soal" || cleanType === "bank_soal") ? SHEET_NAME_SOAL
    : (cleanType === "siswa" || cleanType === "roster") ? SHEET_NAME_SISWA
    : SHEET_NAME_ANALISIS;

  return getOrCreateSpreadsheet(targetFolder, targetName, DEFAULT_SHEET_CONFIGS[targetName]);
}

/**
 * Ambil atau buat Spreadsheet di dalam folder tertentu secara fleksibel & mandiri
 */
function getOrCreateSpreadsheet(folder, name, sheetsConfig) {
  var targetFolder = resolveFolder(folder) || DriveApp.getRootFolder();
  var cleanTargetName = String(name || "").toLowerCase().replace(/[\s_-]+/g, "");
  var ss = null;
  var found = false;

  // 1. Cari di targetFolder terlebih dahulu (nama persis)
  var files = targetFolder.getFilesByName(name);
  while (files && files.hasNext()) {
    var f = files.next();
    if (!f.isTrashed()) {
      try {
        ss = SpreadsheetApp.openById(f.getId());
        found = true;
        break;
      } catch(eOpen) {}
    }
  }

  // 2. Cari variasi nama di targetFolder (e.g. data_bank_soal, Data Bank Soal)
  if (!found || !ss) {
    var allFilesInTarget = targetFolder.getFiles();
    while (allFilesInTarget && allFilesInTarget.hasNext()) {
      var cf = allFilesInTarget.next();
      if (!cf.isTrashed()) {
        var cfClean = cf.getName().toLowerCase().replace(/[\s_-]+/g, "");
        if (cfClean === cleanTargetName) {
          try {
            ss = SpreadsheetApp.openById(cf.getId());
            found = true;
            break;
          } catch(eOpen2) {}
        }
      }
    }
  }

  // 3. Cari di seluruh Google Drive (jika dibuat di root atau folder lain)
  if (!found || !ss) {
    try {
      var variations = [
        name,
        name.toLowerCase(),
        name.replace(/_/g, " "),
        name.replace(/_/g, " ").toLowerCase()
      ];
      for (var v = 0; v < variations.length; v++) {
        var vf = DriveApp.getFilesByName(variations[v]);
        while (vf && vf.hasNext()) {
          var matchedFile = vf.next();
          if (!matchedFile.isTrashed()) {
            try {
              ss = SpreadsheetApp.openById(matchedFile.getId());
              found = true;
              break;
            } catch(eMatch) {}
          }
        }
        if (found) break;
      }
    } catch(eDrive) {}
  }

  // 4. Jika belum ada, buat spreadsheet baru di targetFolder
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

  // 5. Inisialisasi tabs & headers secara self-healing
  var configs = sheetsConfig || DEFAULT_SHEET_CONFIGS[name] || [];
  if (configs && Array.isArray(configs)) {
    configs.forEach(function(cfg) {
      getOrInsertSheet(ss, cfg.name, cfg.headers, cfg.headerBg);
    });
  }

  return ss;
}

/**
 * Inisialisasi Master Folder dan Ketiga Subfolder beserta Spreadsheet Database
 */
function initMasterFoldersAndSheets() {
  var folders = getSystemFolders();

  // 1. Spreadsheet Data Siswa dan Kelas
  var ssSiswa = getSpreadsheetByType("siswa");

  // 2. Spreadsheet Data Analisis dan Nilai
  var ssAnalisis = getSpreadsheetByType("analisis");

  // 3. Spreadsheet Data Soal
  var ssSoal = getSpreadsheetByType("soal");

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
 * Simpan atau perbarui Paket Ujian ke dalam subfolder 'Data Soal' dan 'Data Siswa dan Kelas'.
 * Memastikan nama file menggunakan format: "kelas_nama mata pelajaran_kode naskah soal.json"
 * dan MENCEGAH DUPLIKASI dengan mencari & memperbarui file lama serta menghapus file duplikat.
 */
function saveExamPackage(exam, tokens, customSpreadsheetId) {
  if (!exam || (!exam.id && !exam.code)) {
    throw new Error("Data paket ujian tidak valid.");
  }

  var folders = getSystemFolders();
  var examCode = (exam.code || "").trim().toUpperCase();
  var examTitle = exam.title || "Ujian CBT";

  // 1. Simpan naskah soal dengan format nama: Naskah_Soal_[ExamID].json
  var fileName = formatExamFileName(exam);
  var cleanId = ((exam && exam.id) || "").trim().replace(/[/\\?%*:|"<>]/g, "");
  var cleanKode = examCode.replace(/[/\\?%*:|"<>]/g, "");

  // Cari file naskah soal yang sudah ada di subfolder 'Data Soal' (termasuk generic Naskah_Soal_CBT.json)
  var matchedFile = null;
  var candidateFiles = [];

  try {
    var allFiles = folders.soal.getFiles();
    while (allFiles && allFiles.hasNext()) {
      var f = allFiles.next();
      if (f.isTrashed()) continue;
      var fName = f.getName();
      // Cocokkan jika nama persis SAMA, generic Naskah_Soal_CBT.json, atau mengandung kode/ID ujian
      var isMatch = (fName === fileName) ||
                    (fName.toLowerCase() === "naskah_soal_cbt.json") ||
                    (cleanKode.length >= 2 && (fName.indexOf(cleanKode) !== -1 || fName.indexOf("[" + cleanKode + "]") !== -1)) ||
                    (cleanId.length >= 4 && fName.indexOf(cleanId) !== -1);

      if (isMatch) {
        candidateFiles.push(f);
      }
    }

    if (candidateFiles.length > 0) {
      // Urutkan berdasarkan waktu update terbaru (descending)
      candidateFiles.sort(function(a, b) {
        return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
      });

      matchedFile = candidateFiles[0];

      // Bersihkan file duplikat lama ke Trash agar hanya ada 1 file naskah soal di Drive
      for (var d = 1; d < candidateFiles.length; d++) {
        try {
          candidateFiles[d].setTrashed(true);
        } catch (eTrash) {}
      }
    }
  } catch (eSearch) {
    console.warn("Pencarian file soal di Drive:", eSearch);
  }

  var jsonFile = null;
  var jsonContent = JSON.stringify(exam, null, 2);

  if (matchedFile) {
    jsonFile = matchedFile;
    jsonFile.setContent(jsonContent);
    if (jsonFile.getName() !== fileName) {
      jsonFile.setName(fileName);
    }
  } else {
    jsonFile = folders.soal.createFile(fileName, jsonContent, "application/json");
  }

  // Set izin file agar dapat dibaca publik (agar siswa dapat mengunduh soal langsung)
  try {
    jsonFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {}

  var fileUrl = jsonFile.getUrl();
  var fileDownloadUrl = "https://drive.google.com/uc?id=" + jsonFile.getId() + "&export=download";

  // 2. Catat ke Spreadsheet 'Data_Bank_Soal' di sheet 'Paket_Ujian'
  var ssSoal = getSpreadsheetByType("soal", customSpreadsheetId);
  var tabPaketCfg = getHeadersForTab("Paket_Ujian");
  var sheetPaket = getOrInsertSheet(
    ssSoal,
    "Paket_Ujian",
    tabPaketCfg.headers,
    tabPaketCfg.headerBg
  );

  var data = sheetPaket.getDataRange().getValues();
  var existingRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]).toUpperCase() === examCode || (exam.id && String(data[i][1]) === exam.id)) {
      existingRow = i + 1;
      break;
    }
  }

  var teacherProf = exam.teacherProfile || {};
  var rowValues = [
    new Date(),
    exam.id || "",
    examCode,
    examTitle,
    teacherProf.subject || "",
    teacherProf.gradeLevel || "",
    teacherProf.teacherName || "",
    teacherProf.passingGrade || 75,
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

  // Catat juga ke MasterData
  logToMasterData(ssSoal, {
    type: "PAKET_UJIAN",
    examCode: examCode,
    examTitle: examTitle,
    subject: teacherProf.subject || "",
    className: teacherProf.gradeLevel || "",
    note: "Naskah Soal Disimpan (" + (exam.questions ? exam.questions.length : 0) + " butir)"
  });

  // 3. Catat butir-butir soal ke sheet 'Butir_Soal'
  var tabButirCfg = getHeadersForTab("Butir_Soal");
  var sheetButir = getOrInsertSheet(
    ssSoal,
    "Butir_Soal",
    tabButirCfg.headers,
    tabButirCfg.headerBg
  );

  var questionsCount = 0;
  if (sheetButir && exam.questions && Array.isArray(exam.questions)) {
    // Bersihkan butir soal lama untuk ujian ini agar tidak duplikat
    var butirData = sheetButir.getDataRange().getValues();
    for (var r = butirData.length - 1; r >= 1; r--) {
      if (String(butirData[r][2]).toUpperCase() === examCode || (exam.id && String(butirData[r][1]) === exam.id)) {
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

      var correctAnsStr = "";
      if (Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0) {
        correctAnsStr = q.correctAnswers.join(", ");
      } else if (q.correctAnswer) {
        correctAnsStr = String(q.correctAnswer);
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
        correctAnsStr,
        q.score || 10,
        q.explanation || ""
      ]);
    });

    if (rowsToAdd.length > 0) {
      var requiredRows = sheetButir.getLastRow() + rowsToAdd.length;
      if (sheetButir.getMaxRows() < requiredRows) {
        sheetButir.insertRowsAfter(sheetButir.getMaxRows(), rowsToAdd.length);
      }
      sheetButir.getRange(sheetButir.getLastRow() + 1, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
      questionsCount = rowsToAdd.length;
    }
  }

  // 4. Selalu sinkronkan data siswa & token ke subfolder 'Data Siswa dan Kelas' (Data_Siswa_Dan_Kelas)
  var effectiveTokens = tokens;
  if ((!effectiveTokens || !effectiveTokens.length) && exam.tokens && exam.tokens.length) {
    effectiveTokens = exam.tokens;
  }
  var rosterRes = saveStudentRoster(effectiveTokens || [], examCode, examTitle, exam.sessionToken, customSpreadsheetId);

  return {
    success: true,
    message: "Naskah ujian (" + questionsCount + " butir soal) berhasil disimpan (1 file tanpa duplikasi) dan dicatat ke Google Sheets!",
    examCode: examCode,
    fileName: fileName,
    questionsCount: questionsCount,
    studentsCount: effectiveTokens ? effectiveTokens.length : 0,
    fileId: jsonFile.getId(),
    fileUrl: fileUrl,
    downloadUrl: fileDownloadUrl,
    sheetSoalUrl: ssSoal.getUrl(),
    sheetSiswaUrl: rosterRes.sheetUrl
  };
}

/**
 * Simpan atau perbarui Roster Siswa & Token Ujian ke subfolder 'Data Siswa dan Kelas'
 */
function saveStudentRoster(tokens, examCode, examTitle, sessionToken, customSpreadsheetId) {
  var ssSiswa = getSpreadsheetByType("siswa", customSpreadsheetId);
  var tabRosterCfg = getHeadersForTab("Roster_Siswa");
  var sheetRoster = getOrInsertSheet(
    ssSiswa,
    "Roster_Siswa",
    tabRosterCfg.headers,
    tabRosterCfg.headerBg
  );

  var countAdded = 0;
  if (sheetRoster && Array.isArray(tokens) && tokens.length > 0) {
    var rosterData = sheetRoster.getDataRange().getValues();
    var existingMap = {};
    for (var i = 1; i < rosterData.length; i++) {
      var key = (String(rosterData[i][2]).trim() + "_" + String(rosterData[i][7]).trim()).toUpperCase();
      existingMap[key] = i + 1;
    }

    var rowsToAppend = [];
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
        rowsToAppend.push(rowValues);
      }
      countAdded++;
    });

    if (rowsToAppend.length > 0) {
      var requiredRows = sheetRoster.getLastRow() + rowsToAppend.length;
      if (sheetRoster.getMaxRows() < requiredRows) {
        sheetRoster.insertRowsAfter(sheetRoster.getMaxRows(), rowsToAppend.length);
      }
      sheetRoster.getRange(sheetRoster.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    }
  }

  // Catat atau perbarui Token Sesi Umum ke sheet 'Token_Ujian'
  if (sessionToken && examCode) {
    var tabTokenCfg = getHeadersForTab("Token_Ujian");
    var sheetToken = getOrInsertSheet(
      ssSiswa,
      "Token_Ujian",
      tabTokenCfg.headers,
      tabTokenCfg.headerBg
    );

    if (sheetToken) {
      var tData = sheetToken.getDataRange().getValues();
      var existingTRow = -1;
      var cleanTargetCode = String(examCode).trim().toUpperCase();

      for (var t = 1; t < tData.length; t++) {
        if (String(tData[t][1]).trim().toUpperCase() === cleanTargetCode) {
          existingTRow = t + 1;
          break;
        }
      }

      var className = (tokens && tokens[0] && tokens[0].className) ? tokens[0].className : "Semua Kelas";
      var tRowValues = [
        new Date(),
        cleanTargetCode,
        examTitle || "",
        sessionToken,
        className,
        new Date().toISOString(),
        "Aktif",
        tokens ? tokens.length : 0
      ];

      if (existingTRow > 0) {
        sheetToken.getRange(existingTRow, 1, 1, tRowValues.length).setValues([tRowValues]);
      } else {
        sheetToken.appendRow(tRowValues);
      }
    }
  }

  // Catat ringkasan roster ke MasterData
  logToMasterData(ssSiswa, {
    type: "ROSTER_SISWA",
    examCode: examCode || "",
    examTitle: examTitle || "",
    note: "Roster diperbarui (" + countAdded + " siswa)"
  });

  return {
    success: true,
    count: countAdded,
    sheetUrl: ssSiswa.getUrl()
  };
}

/**
 * Ambil daftar nama siswa (Roster_Siswa) dari Spreadsheet 'Data_Siswa_Dan_Kelas'
 */
function getStudentRoster(targetExamCode, targetClass) {
  var ssSiswa = getSpreadsheetByType("siswa");
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

      if (!sName) continue;

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
 * Catat atau perbarui Analisis Butir Soal ke sheet 'Analisis_Butir_Soal'
 */
function recordItemAnalysis(ssAnalisis, session) {
  try {
    if (!ssAnalisis || !session || !session.answers) return;
    var tabAnalisisCfg = getHeadersForTab("Analisis_Butir_Soal");
    var sheetButir = getOrInsertSheet(ssAnalisis, "Analisis_Butir_Soal", tabAnalisisCfg.headers, tabAnalisisCfg.headerBg);
    if (!sheetButir) return;

    var cleanExamCode = String(session.examCode || "").trim().toUpperCase();
    var answers = session.answers;
    var questionKeys = Object.keys(answers);

    if (!questionKeys.length) return;

    var existingData = sheetButir.getDataRange().getValues();
    // Peta indeks berdasarkan: [KodeUjian_QuestionId]
    var rowMap = {};
    for (var i = 1; i < existingData.length; i++) {
      var rowCode = String(existingData[i][1]).trim().toUpperCase();
      var rowQId = String(existingData[i][3]).trim();
      rowMap[rowCode + "_" + rowQId] = i + 1;
    }

    questionKeys.forEach(function(qId, index) {
      var ans = answers[qId];
      if (!ans) return;
      var mapKey = cleanExamCode + "_" + qId;
      var existingRowIndex = rowMap[mapKey];

      var isCorrect = ans.isCorrect === true || ans.isCorrect === 1;

      if (existingRowIndex) {
        // Update akumulasi
        var currentCorrect = Number(existingData[existingRowIndex - 1][9]) || 0;
        var currentTotal = Number(existingData[existingRowIndex - 1][10]) || 0;

        var newCorrect = currentCorrect + (isCorrect ? 1 : 0);
        var newTotal = currentTotal + 1;
        var percentage = Math.round((newCorrect / newTotal) * 100);

        var difficulty = "Sedang";
        if (percentage > 70) difficulty = "Mudah";
        else if (percentage < 30) difficulty = "Sukar";

        sheetButir.getRange(existingRowIndex, 8).setValue(difficulty);
        sheetButir.getRange(existingRowIndex, 9).setValue(percentage);
        sheetButir.getRange(existingRowIndex, 10).setValue(newCorrect);
        sheetButir.getRange(existingRowIndex, 11).setValue(newTotal);
      } else {
        // Buat baris butir soal baru
        var percentageNew = isCorrect ? 100 : 0;
        var diffNew = isCorrect ? "Mudah" : "Sukar";
        var newRow = [
          new Date(),
          cleanExamCode,
          index + 1,
          qId,
          session.subject || "Umum",
          ans.type || "Pilihan Ganda",
          ans.correctAnswer || "-",
          diffNew,
          percentageNew,
          isCorrect ? 1 : 0,
          1
        ];
        sheetButir.appendRow(newRow);
        rowMap[mapKey] = sheetButir.getLastRow();
      }
    });
  } catch (eItem) {
    console.warn("Gagal memperbarui Analisis_Butir_Soal:", eItem);
  }
}

/**
 * Simpan hasil ujian siswa dan analisis pengayaan/remidi ke subfolder 'Data Analisis dan Nilai'
 */
function saveStudentSession(session, aiAnalysis, customSpreadsheetId) {
  if (!session || !session.id) {
    throw new Error("Data sesi siswa tidak valid.");
  }

  var folders = getSystemFolders();
  var ssAnalisis = getSpreadsheetByType("analisis", customSpreadsheetId);

  // 1. Tulis ke sheet 'Hasil_Ujian'
  var tabHasilCfg = getHeadersForTab("Hasil_Ujian");
  var sheetHasil = getOrInsertSheet(
    ssAnalisis,
    "Hasil_Ujian",
    tabHasilCfg.headers,
    tabHasilCfg.headerBg
  );

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

  // 2. Tulis log transaksi ke MasterData
  logToMasterData(ssAnalisis, {
    type: "HASIL_UJIAN",
    examCode: session.examCode || "",
    examTitle: session.examTitle || "",
    subject: session.subject || "",
    className: session.className || "",
    nisn: session.nisn || "",
    studentName: session.studentName || "",
    score: session.totalScoreEarned || 0,
    status: session.passed ? "TUNTAS" : "REMIDIAL",
    note: "Nilai: " + (session.percentage || 0) + "% (" + correctCount + " benar, " + wrongCount + " salah)",
    sessionId: session.id
  });

  // 3. Tulis analisis pengayaan dan remidi ke sheet 'Pengayaan_Dan_Remidi_AI'
  if (aiAnalysis || session.aiRemediation || session.aiEnrichment) {
    saveAiPengayaanRemidi(session, aiAnalysis, customSpreadsheetId);
  }

  // 4. Catat butir soal ke sheet 'Analisis_Butir_Soal'
  recordItemAnalysis(ssAnalisis, session);

  // 5. Perbarui status siswa di 'Data Siswa dan Kelas' -> 'Roster_Siswa'
  try {
    var ssSiswa = getSpreadsheetByType("siswa", customSpreadsheetId);
    var tabRosterCfg = getHeadersForTab("Roster_Siswa");
    var sheetRoster = getOrInsertSheet(
      ssSiswa,
      "Roster_Siswa",
      tabRosterCfg.headers,
      tabRosterCfg.headerBg
    );
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
    message: "Hasil ujian siswa berhasil dicatat ke Google Sheets (Hasil_Ujian, MasterData, Analisis_Butir_Soal).",
    sessionId: session.id,
    sheetUrl: ssAnalisis.getUrl()
  };
}

/**
 * Simpan analisis Pengayaan & Remidi AI ke sheet 'Pengayaan_Dan_Remidi_AI'
 */
function saveAiPengayaanRemidi(session, aiAnalysis, customSpreadsheetId) {
  var ssAnalisis = getSpreadsheetByType("analisis", customSpreadsheetId);
  var tabAiCfg = getHeadersForTab("Pengayaan_Dan_Remidi_AI");
  var sheetAI = getOrInsertSheet(
    ssAnalisis,
    "Pengayaan_Dan_Remidi_AI",
    tabAiCfg.headers,
    tabAiCfg.headerBg
  );
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

  // Catat juga ke MasterData
  logToMasterData(ssAnalisis, {
    type: "AI_PENGAYAAN_REMIDI",
    examCode: session.examCode || "",
    nisn: session.nisn || "",
    studentName: session.studentName || "",
    status: session.passed ? "PENGAYAAN" : "REMIDIAL",
    note: "Diagnosis: " + diagnosis.substring(0, 80),
    sessionId: cleanSessionId
  });

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
function deleteStudentSession(sessionId, examCode, studentName, customSpreadsheetId) {
  var ssAnalisis = null;
  try {
    ssAnalisis = getSpreadsheetByType("analisis", customSpreadsheetId);
  } catch (e) {
    if (SPREADSHEET_ID) {
      try { ssAnalisis = SpreadsheetApp.openById(SPREADSHEET_ID); } catch (e2) {}
    }
  }

  if (!ssAnalisis) {
    return { success: false, message: "Spreadsheet analisis tidak ditemukan" };
  }

  var sheetHasil = ssAnalisis.getSheetByName("Hasil_Ujian");
  var sheetAI = ssAnalisis.getSheetByName("Pengayaan_Dan_Remidi_AI");
  var sheetButir = ssAnalisis.getSheetByName("Analisis_Butir_Soal");

  var deleted = 0;
  var targetId = String(sessionId || "").trim();
  var targetName = String(studentName || "").trim().toLowerCase();
  var targetCode = String(examCode || "").trim().toUpperCase();

  // 1. Hapus dari sheet Hasil_Ujian
  if (sheetHasil && sheetHasil.getLastRow() > 1) {
    var data = sheetHasil.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      var rowSessId = String(data[i][1]).trim();
      var rowExamCode = String(data[i][2]).trim().toUpperCase();
      var rowName = String(data[i][6]).trim().toLowerCase();

      var matchId = targetId && rowSessId === targetId;
      var matchNameAndExam = targetName && rowName === targetName && (!targetCode || rowExamCode === targetCode);

      if (matchId || matchNameAndExam) {
        sheetHasil.deleteRow(i + 1);
        deleted++;
      }
    }
  }

  // 2. Hapus dari sheet Pengayaan_Dan_Remidi_AI
  if (sheetAI && sheetAI.getLastRow() > 1) {
    var aiData = sheetAI.getDataRange().getValues();
    for (var j = aiData.length - 1; j >= 1; j--) {
      var aiSessId = String(aiData[j][1]).trim();
      var aiName = String(aiData[j][4]).trim().toLowerCase();
      var aiExamCode = String(aiData[j][2]).trim().toUpperCase();

      var matchAiId = targetId && aiSessId === targetId;
      var matchAiName = targetName && aiName === targetName && (!targetCode || aiExamCode === targetCode);

      if (matchAiId || matchAiName) {
        sheetAI.deleteRow(j + 1);
      }
    }
  }

  // 3. Reset status siswa di sheet Roster_Siswa (dari 'selesai' ke 'belum_mulai')
  try {
    var ssSiswa = null;
    try {
      ssSiswa = getSpreadsheetByType("siswa", customSpreadsheetId);
    } catch (eS) {
      if (SPREADSHEET_ID) ssSiswa = SpreadsheetApp.openById(SPREADSHEET_ID);
    }
    if (ssSiswa) {
      var sheetRoster = ssSiswa.getSheetByName("Roster_Siswa");
      if (sheetRoster && sheetRoster.getLastRow() > 1) {
        var rData = sheetRoster.getDataRange().getValues();
        for (var r = 1; r < rData.length; r++) {
          var rName = String(rData[r][3]).trim().toLowerCase();
          var rExamCode = String(rData[r][7]).trim().toUpperCase();
          var matchRoster = targetName && rName === targetName && (!targetCode || rExamCode === targetCode);
          if (matchRoster) {
            sheetRoster.getRange(r + 1, 7).setValue("belum_mulai");
            sheetRoster.getRange(r + 1, 10).setValue("");
          }
        }
      }
    }
  } catch (errRoster) {
    console.warn("Gagal reset status di Roster_Siswa:", errRoster);
  }

  return {
    success: true,
    deleted: deleted,
    message: "Sesi " + (targetName || targetId) + " berhasil dihapus dan direset dari Google Sheets."
  };
}

/**
 * Batch delete sesi siswa
 */
function batchDeleteStudentSessions(sessionIds, examCode, studentNames, customSpreadsheetId) {
  var idSet = {};
  (sessionIds || []).forEach(function(id) { if (id) idSet[String(id).trim()] = true; });

  var nameSet = {};
  (studentNames || []).forEach(function(n) { if (n) nameSet[String(n).trim().toLowerCase()] = true; });

  var ssAnalisis = null;
  try {
    ssAnalisis = getSpreadsheetByType("analisis", customSpreadsheetId);
  } catch (e) {
    if (SPREADSHEET_ID) {
      try { ssAnalisis = SpreadsheetApp.openById(SPREADSHEET_ID); } catch (e2) {}
    }
  }

  if (!ssAnalisis) {
    return { success: false, message: "Spreadsheet analisis tidak ditemukan" };
  }

  var sheetHasil = ssAnalisis.getSheetByName("Hasil_Ujian");
  var sheetAI = ssAnalisis.getSheetByName("Pengayaan_Dan_Remidi_AI");
  var targetCode = examCode ? String(examCode).trim().toUpperCase() : "";

  var deletedCount = 0;
  if (sheetHasil && sheetHasil.getLastRow() > 1) {
    var data = sheetHasil.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      var sId = String(data[i][1]).trim();
      var sName = String(data[i][6]).trim().toLowerCase();
      var sExamCode = String(data[i][2]).trim().toUpperCase();

      var matchId = idSet[sId];
      var matchName = nameSet[sName] && (!targetCode || sExamCode === targetCode);

      if (matchId || matchName) {
        sheetHasil.deleteRow(i + 1);
        deletedCount++;
      }
    }
  }

  if (sheetAI && sheetAI.getLastRow() > 1) {
    var aiData = sheetAI.getDataRange().getValues();
    for (var j = aiData.length - 1; j >= 1; j--) {
      var aiId = String(aiData[j][1]).trim();
      var aiName = String(aiData[j][4]).trim().toLowerCase();
      var aiExam = String(aiData[j][2]).trim().toUpperCase();

      if (idSet[aiId] || (nameSet[aiName] && (!targetCode || aiExam === targetCode))) {
        sheetAI.deleteRow(j + 1);
      }
    }
  }

  // Reset status siswa di Roster_Siswa
  try {
    var ssSiswa = null;
    try {
      ssSiswa = getSpreadsheetByType("siswa", customSpreadsheetId);
    } catch (eS) {
      if (SPREADSHEET_ID) ssSiswa = SpreadsheetApp.openById(SPREADSHEET_ID);
    }
    if (ssSiswa) {
      var sheetRoster = ssSiswa.getSheetByName("Roster_Siswa");
      if (sheetRoster && sheetRoster.getLastRow() > 1) {
        var rData = sheetRoster.getDataRange().getValues();
        for (var r = 1; r < rData.length; r++) {
          var rName = String(rData[r][3]).trim().toLowerCase();
          var rExam = String(rData[r][7]).trim().toUpperCase();
          if (nameSet[rName] && (!targetCode || rExam === targetCode)) {
            sheetRoster.getRange(r + 1, 7).setValue("belum_mulai");
            sheetRoster.getRange(r + 1, 10).setValue("");
          }
        }
      }
    }
  } catch (errRoster) {}

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

/**
 * Pembersihan File Duplikat Google Drive:
 * Memindai subfolder 'Data Soal' untuk file Naskah_Soal_CBT.json dan file soal berduplikat.
 * Menyimpan hanya 1 file terbaru per naskah soal dan memindahkan file duplikat lama ke Trash.
 */
function cleanupDriveDuplicates() {
  var folders = getSystemFolders();
  var foldersToScan = [folders.soal, folders.master];
  var trashedCount = 0;
  var keptList = [];

  for (var fIdx = 0; fIdx < foldersToScan.length; fIdx++) {
    var folder = foldersToScan[fIdx];
    if (!folder) continue;

    var groups = {};
    var allFiles = folder.getFiles();

    while (allFiles && allFiles.hasNext()) {
      var f = allFiles.next();
      if (f.isTrashed()) continue;

      var name = f.getName().trim();
      var key = name.toLowerCase();

      // Generic Naskah_Soal_CBT.json grouping
      if (key === "naskah_soal_cbt.json") {
        key = "generic_naskah_soal_cbt";
      } else if (key.indexOf("naskah_soal_") === 0) {
        key = key.replace(/\.json$/i, "");
      } else {
        // Group by exact file name
        key = "file_" + key;
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(f);
    }

    // Process each group
    for (var gKey in groups) {
      var list = groups[gKey];
      if (list.length > 1) {
        // Sort descending by updated timestamp
        list.sort(function(a, b) {
          return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
        });

        keptList.push(list[0].getName() + " (" + list[0].getId() + ")");

        // Trash all older duplicates
        for (var i = 1; i < list.length; i++) {
          try {
            list[i].setTrashed(true);
            trashedCount++;
          } catch (eTrash) {
            console.warn("Gagal memindahkan duplikat ke trash:", eTrash);
          }
        }
      } else if (list.length === 1) {
        keptList.push(list[0].getName());
      }
    }
  }

  return {
    success: true,
    trashedCount: trashedCount,
    keptCount: keptList.length,
    message: "Berhasil membersihkan " + trashedCount + " file duplikat di Google Drive."
  };
}


