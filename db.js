const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Membuat atau koneksi ke file database SQLite
const dbPath = path.resolve(__dirname, 'rekapan.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Gagal terkoneksi ke database:', err.message);
    } else {
        console.log('Berhasil terkoneksi ke database SQLite.');
    }
});

// Membuat Tabel-Tabel
db.serialize(() => {
    // 1. Tabel Users (Untuk Login)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nama_lengkap TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT CHECK(role IN ('guru', 'murid')) NOT NULL,
        guru_id INTEGER,
        FOREIGN KEY (guru_id) REFERENCES users (id)
    )`);

    // 2. Tabel Rekapan Mingguan (Header & Evaluasi)
    db.run(`CREATE TABLE IF NOT EXISTS rekapan_mingguan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        murid_id INTEGER NOT NULL,
        guru_id INTEGER NOT NULL,
        pekan_ke INTEGER NOT NULL,
        tanggal_mulai DATE,
        pencapaian_terbaik TEXT,
        catatan_umum TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (murid_id) REFERENCES users (id),
        FOREIGN KEY (guru_id) REFERENCES users (id)
    )`);

    // 3. Tabel Rekapan Harian (Rincian per hari Senin-Ahad)
    db.run(`CREATE TABLE IF NOT EXISTS rekapan_harian (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rekapan_mingguan_id INTEGER NOT NULL,
        hari TEXT NOT NULL,
        hafalan_surah_ayat TEXT,
        nilai_hafalan TEXT,
        murojaah_surah_ayat TEXT,
        nilai_murojaah TEXT,
        catatan_harian TEXT,
        FOREIGN KEY (rekapan_mingguan_id) REFERENCES rekapan_mingguan (id) ON DELETE CASCADE
    )`);

    // 4. Tabel Target Muroja'ah (Tugas dari Guru untuk Siswa)
    db.run(`CREATE TABLE IF NOT EXISTS target_murojaah (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guru_id INTEGER NOT NULL,
        murid_id INTEGER NOT NULL,
        pekan_ke INTEGER NOT NULL,
        hari TEXT NOT NULL,
        isi_target TEXT NOT NULL,
        status_selesai INTEGER DEFAULT 0,
        FOREIGN KEY (guru_id) REFERENCES users (id),
        FOREIGN KEY (murid_id) REFERENCES users (id)
    )`);

    // Memasukkan Data Dummy untuk Testing Login
    db.run(`INSERT OR IGNORE INTO users (id, nama_lengkap, username, password, role) 
            VALUES (1, 'Ustadz Ahmad', 'guru1', '123456', 'guru')`);
    
    db.run(`INSERT OR IGNORE INTO users (id, nama_lengkap, username, password, role, guru_id) 
            VALUES (2, 'Zpin', 'siswa1', '123456', 'murid', 1)`);
    
    console.log('Skema tabel lengkap dan data testing berhasil disiapkan.');
});

// Tabel Sesi Ujian Kenaikan Juz
db.run(`CREATE TABLE IF NOT EXISTS ujian_kenaikan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    murid_id INTEGER,
    guru_id INTEGER,
    jumlah_juz INTEGER,
    daftar_juz TEXT,
    waktu_mulai DATETIME,
    status_ujian TEXT DEFAULT 'persiapan',
    nilai_hifdz REAL DEFAULT 0,
    nilai_tajwid REAL DEFAULT 0,
    nilai_tartil REAL DEFAULT 0,
    nilai_akhir REAL DEFAULT 0,
    FOREIGN KEY(murid_id) REFERENCES users(id),
    FOREIGN KEY(guru_id) REFERENCES users(id)
)`);

// Tabel Kertas Tasmi' (Baris disesuaikan dengan jumlah juz + 5 baris ekstra)
db.run(`CREATE TABLE IF NOT EXISTS kertas_tasmi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ujian_id INTEGER,
    nomor INTEGER,
    tanbih INTEGER DEFAULT 0,
    khoto INTEGER DEFAULT 0,
    taqdir TEXT,       -- 'mumtaz', 'jayyid_jiddan', 'jayyid'
    status_kelulusan TEXT, -- 'maqbul', 'mardud'
    mustami TEXT,      -- Teks input nama penyimak
    FOREIGN KEY(ujian_id) REFERENCES ujian_kenaikan(id)
)`);

module.exports = db;