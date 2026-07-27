const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = "rahasia_zpin_123";

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// MIDDLEWARE: Cek Token Keamanan
// ==========================================
const verifyToken = (req, res, next) => {
    const bearerHeader = req.headers['authorization'];
    if (typeof bearerHeader !== 'undefined') {
        const token = bearerHeader.split(' ')[1];
        jwt.verify(token, SECRET_KEY, (err, authData) => {
            if (err) return res.status(403).json({ error: "Sesi login tidak valid / kedaluwarsa." });
            req.user = authData; // Simpan data user (termasuk ID dan Role) dari token
            next();
        });
    } else {
        res.status(401).json({ error: "Akses ditolak. Token tidak ditemukan." });
    }
};

// ==========================================
// 1. ENDPOINT AUTENTIKASI (LOGIN & REGISTER)
// ==========================================
app.post('/api/register', (req, res) => {
    const { nama_lengkap, username, password, role } = req.body;
    if (!nama_lengkap || !username || !password || !role) return res.status(400).json({ error: "Semua kolom harus diisi!" });
    
    const sql = `INSERT INTO users (nama_lengkap, username, password, role) VALUES (?, ?, ?, ?)`;
    db.run(sql, [nama_lengkap, username, password, role], function(err) {
        if (err) {
            if (err.code === 'SQLITE_CONSTRAINT') return res.status(400).json({ error: "Username sudah terdaftar!" });
            return res.status(500).json({ error: "Gagal menyimpan data." });
        }
        
        // AUTO-LOGIN: Setelah berhasil simpan ke database, langsung buatkan Token JWT
        const newUserId = this.lastID;
        const token = jwt.sign({ id: newUserId, role: role, nama: nama_lengkap }, SECRET_KEY, { expiresIn: '1d' });

        res.json({ 
            message: "Akun berhasil didaftarkan! Mengalihkan ke menu utama...",
            token: token,
            role: role,
            nama: nama_lengkap
        });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const sql = `SELECT * FROM users WHERE username = ? AND password = ?`;
    db.get(sql, [username, password], (err, user) => {
        if (err) return res.status(500).json({ error: "Terjadi kesalahan database." });
        if (!user) return res.status(401).json({ error: "Username atau password salah!" });

        const token = jwt.sign({ id: user.id, role: user.role, nama: user.nama_lengkap }, SECRET_KEY, { expiresIn: '1d' });
        res.json({ message: "Berhasil login!", token, role: user.role, nama: user.nama_lengkap });
    });
});

// Endpoint untuk melihat semua data user
app.get('/api/users', (req, res) => {
    db.all("SELECT id, nama_lengkap, username, role FROM users", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// ==========================================
// 2. ENDPOINT MURID
// ==========================================
// Mengambil daftar murid khusus untuk guru yang sedang login
app.get('/api/murid', verifyToken, (req, res) => {
    const sql = `SELECT id, nama_lengkap FROM users WHERE role = 'murid'`;
    
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ==========================================
// 3. ENDPOINT REKAPAN (SIMPAN, AMBIL, EDIT & HAPUS DATA)
// ==========================================
app.post('/api/rekapan', verifyToken, (req, res) => {
    const { murid_id, pekan_ke, tanggal_mulai, saran_pengembangan, catatan_umum, data_harian } = req.body;
    const guru_id = req.user.id; 

    if (!murid_id) return res.status(400).json({ error: "Silakan pilih murid terlebih dahulu!" });

    // 1. Cek apakah Pekan ke- yang sama sudah pernah dibuat
    const checkPekanSql = `SELECT id FROM rekapan_mingguan WHERE murid_id = ? AND pekan_ke = ?`;
    db.get(checkPekanSql, [murid_id, pekan_ke], (err, rowPekan) => {
        if (err) return res.status(500).json({ error: "Terjadi kesalahan database." });
        if (rowPekan) {
            return res.status(400).json({ error: `Rekapan untuk Pekan ke-${pekan_ke} bagi siswa ini sudah pernah dibuat sebelumnya!` });
        }

        // 2. Cek apakah tanggal mulai yang diinput sudah pernah dipakai di rekapan lain 
        // atau berdekatan dalam rentang 7 hari (agar tanggal tidak tumpang tindih)
        const checkTanggalSql = `SELECT pekan_ke, tanggal_mulai FROM rekapan_mingguan WHERE murid_id = ?`;
        db.all(checkTanggalSql, [murid_id], (err, rowsRekapan) => {
            if (err) return res.status(500).json({ error: "Terjadi kesalahan database saat cek tanggal." });

            const tglBaru = new Date(tanggal_mulai).getTime();

            for (let rek of rowsRekapan) {
                const tglLama = new Date(rek.tanggal_mulai).getTime();
                const selisihHari = Math.abs(tglBaru - tglLama) / (1000 * 60 * 60 * 24);

                // Jika jarak tanggal mulai kurang dari 7 hari dari rekapan pekan lain, anggap bentrok
                if (selisihHari < 7) {
                    return res.status(400).json({ 
                        error: `Tanggal mulai bentrok! Tanggal ini terlalu dekat dengan Pekan ke-${rek.pekan_ke} (${rek.tanggal_mulai}). Satu pekan minimal berjarak 7 hari.` 
                    });
                }
            }

            // Jika aman dari duplikasi pekan dan bentrok tanggal, lanjutkan simpan
            const sqlMingguan = `INSERT INTO rekapan_mingguan (murid_id, guru_id, pekan_ke, tanggal_mulai, pencapaian_terbaik, catatan_umum) VALUES (?, ?, ?, ?, ?, ?)`;

            db.run(sqlMingguan, [murid_id, guru_id, pekan_ke, tanggal_mulai, saran_pengembangan, catatan_umum], function(err) {
                if (err) return res.status(500).json({ error: "Gagal menyimpan data mingguan: " + err.message });

                const id_mingguan = this.lastID;
                const sqlHarian = `INSERT INTO rekapan_harian (rekapan_mingguan_id, hari, hafalan_surah_ayat, nilai_hafalan, murojaah_surah_ayat, nilai_murojaah, catatan_harian) VALUES (?, ?, ?, ?, ?, ?, ?)`;

                data_harian.forEach(hari => {
                    db.run(sqlHarian, [id_mingguan, hari.nama_hari, hari.hafalan, hari.nilai_hafalan, hari.murojaah, hari.nilai_murojaah, hari.catatan], (err) => {
                        if (err) console.error("Gagal simpan data harian:", err.message);
                    });
                });

                res.json({ message: "Alhamdulillah, Data rekapan berhasil disimpan!" });
            });
        });
    });
});

app.get('/api/rekapan', verifyToken, (req, res) => {
    let sql;
    let params = [];

    // Jika yang login adalah murid, batasi hanya ambil rekapan miliknya sendiri
    if (req.user.role === 'murid') {
        sql = `SELECT id, pekan_ke, tanggal_mulai, pencapaian_terbaik FROM rekapan_mingguan WHERE murid_id = ? ORDER BY pekan_ke DESC`;
        params = [req.user.id];
    } else {
        // Jika guru, tampilkan semuanya
        sql = `SELECT id, pekan_ke, tanggal_mulai, pencapaian_terbaik FROM rekapan_mingguan ORDER BY pekan_ke DESC`;
    }

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/rekapan/:id', verifyToken, (req, res) => {
    const id = req.params.id;

    let sqlMingguan = `
        SELECT rm.*, u.nama_lengkap AS nama_murid 
        FROM rekapan_mingguan rm 
        JOIN users u ON rm.murid_id = u.id 
        WHERE rm.id = ?
    `;
    let params = [id];

    // Jika yang login murid, pastikan rekapan tersebut benar-benar miliknya
    if (req.user.role === 'murid') {
        sqlMingguan += ` AND rm.murid_id = ?`;
        params.push(req.user.id);
    }

    const sqlHarian = `SELECT * FROM rekapan_harian WHERE rekapan_mingguan_id = ?`;

    db.get(sqlMingguan, params, (err, mingguan) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!mingguan) return res.status(404).json({ error: "Data rekapan tidak ditemukan atau Anda tidak memiliki hak akses." });

        db.all(sqlHarian, [id], (err, harian) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mingguan, harian });
        });
    });
});

app.get('/api/rekapan', verifyToken, (req, res) => {
    const sql = `SELECT id, pekan_ke, tanggal_mulai, pencapaian_terbaik FROM rekapan_mingguan ORDER BY pekan_ke DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Mengambil detail rekap berdasarkan ID (untuk halaman detail-rekap.html)
app.get('/api/rekapan/:id', verifyToken, (req, res) => {
    const id = req.params.id;

    // Ambil data mingguan digabung dengan nama lengkap siswa dari tabel users
    const sqlMingguan = `
        SELECT rm.*, u.nama_lengkap AS nama_murid 
        FROM rekapan_mingguan rm 
        JOIN users u ON rm.murid_id = u.id 
        WHERE rm.id = ?
    `;
    const sqlHarian = `SELECT * FROM rekapan_harian WHERE rekapan_mingguan_id = ?`;

    db.get(sqlMingguan, [id], (err, mingguan) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!mingguan) return res.status(404).json({ error: "Data rekapan tidak ditemukan." });

        db.all(sqlHarian, [id], (err, harian) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mingguan, harian });
        });
    });
});

// Guru mengubah/mengedit rekapan mingguan dan harian yang sudah ada
app.put('/api/rekapan/:id/edit', verifyToken, (req, res) => {
    if (req.user.role !== 'guru') {
        return res.status(403).json({ error: "Akses ditolak! Hanya Guru yang bisa mengedit rekapan." });
    }

    const rekapanId = req.params.id;
    const { pekan_ke, tanggal_mulai, saran_pengembangan, catatan_umum, data_harian } = req.body;

    const sqlMingguan = `UPDATE rekapan_mingguan SET pekan_ke = ?, tanggal_mulai = ?, pencapaian_terbaik = ?, catatan_umum = ? WHERE id = ?`;
    
    db.run(sqlMingguan, [pekan_ke, tanggal_mulai, saran_pengembangan, catatan_umum, rekapanId], (err) => {
        if (err) return res.status(500).json({ error: "Gagal update data mingguan: " + err.message });

        const sqlDeleteHarian = `DELETE FROM rekapan_harian WHERE rekapan_mingguan_id = ?`;
        db.run(sqlDeleteHarian, [rekapanId], (err) => {
            if (err) return res.status(500).json({ error: "Gagal memperbarui rincian harian." });

            const sqlInsertHarian = `INSERT INTO rekapan_harian (rekapan_mingguan_id, hari, hafalan_surah_ayat, nilai_hafalan, murojaah_surah_ayat, nilai_murojaah, catatan_harian) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            
            data_harian.forEach(hari => {
                db.run(sqlInsertHarian, [rekapanId, hari.nama_hari, hari.hafalan, hari.nilai_hafalan, hari.murojaah, hari.nilai_murojaah, hari.catatan], (err) => {
                    if (err) console.error("Gagal update harian:", err.message);
                });
            });

            res.json({ message: "Alhamdulillah, Rekapan berhasil diperbarui!" });
        });
    });
});

// Guru menghapus rekapan mingguan beserta rincian harian
app.delete('/api/rekapan/:id/delete', verifyToken, (req, res) => {
    if (req.user.role !== 'guru') {
        return res.status(403).json({ error: "Akses ditolak! Hanya Guru yang bisa menghapus rekapan." });
    }

    const rekapanId = req.params.id;

    const sqlHarian = `DELETE FROM rekapan_harian WHERE rekapan_mingguan_id = ?`;
    const sqlMingguan = `DELETE FROM rekapan_mingguan WHERE id = ?`;

    db.run(sqlHarian, [rekapanId], (err) => {
        if (err) return res.status(500).json({ error: "Gagal menghapus rincian harian: " + err.message });

        db.run(sqlMingguan, [rekapanId], (err) => {
            if (err) return res.status(500).json({ error: "Gagal menghapus rekapan mingguan: " + err.message });

            res.json({ message: "Alhamdulillah, Rekapan berhasil dihapus!" });
        });
    });
});

// ==========================================
// 4. ENDPOINT TARGET MUROJA'AH
// ==========================================

// Guru menyimpan target harian untuk murid
app.post('/api/target', verifyToken, (req, res) => {
    const guru_id = req.user.id;
    const { murid_id, pekan_ke, targets } = req.body;

    if (!murid_id || !pekan_ke || !targets) {
        return res.status(400).json({ error: "Data target belum lengkap!" });
    }

    const checkSql = `SELECT id FROM target_murojaah WHERE murid_id = ? AND pekan_ke = ? LIMIT 1`;
    db.get(checkSql, [murid_id, pekan_ke], (err, row) => {
        if (err) return res.status(500).json({ error: "Terjadi kesalahan database." });
        if (row) {
            return res.status(400).json({ error: `Target untuk Pekan ke-${pekan_ke} bagi siswa ini sudah pernah dibuat! Silakan gunakan menu Edit Target Lama.` });
        }

        const sql = `INSERT INTO target_murojaah (guru_id, murid_id, pekan_ke, hari, isi_target) VALUES (?, ?, ?, ?, ?)`;

        targets.forEach(item => {
            db.run(sql, [guru_id, murid_id, pekan_ke, item.hari, item.isi_target], (err) => {
                if (err) console.error("Gagal simpan target:", err.message);
            });
        });

        res.json({ message: "Alhamdulillah, Target muroja'ah berhasil dikirim ke siswa!" });
    });
});

// PENTING: Letakkan endpoint khusus /pekan-aktif DI ATAS rute umum /api/target
// Endpoint khusus untuk mendeteksi pekan maksimal aktif milik siswa
app.get('/api/target/pekan-aktif', verifyToken, (req, res) => {
    if (req.user.role !== 'murid') {
        return res.status(403).json({ error: "Khusus akses murid!" });
    }
    
    const murid_id = req.user.id;
    const sql = `SELECT MAX(pekan_ke) as pekan_maksimal FROM target_murojaah WHERE murid_id = ?`;
    
    db.get(sql, [murid_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        // Pastikan mengembalikan angka, minimal 1 jika kosong
        const pekanMaksimal = (row && row.pekan_maksimal) ? Number(row.pekan_maksimal) : 1;
        res.json({ pekan_aktif: pekanMaksimal });
    });
});

// Siswa atau Guru melihat daftar target berdasarkan murid & pekan
app.get('/api/target', verifyToken, (req, res) => {
    const { murid_id, pekan_ke } = req.query;
    
    let targetMuridId = req.user.role === 'murid' ? req.user.id : murid_id;

    let sql = `SELECT * FROM target_murojaah WHERE murid_id = ?`;
    let params = [targetMuridId];

    if (pekan_ke) {
        sql += ` AND pekan_ke = ?`;
        params.push(pekan_ke);
    }

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.put('/api/target/:id/edit', verifyToken, (req, res) => {
    if (req.user.role !== 'guru') return res.status(403).json({ error: "Akses ditolak! Hanya Guru yang bisa edit." });

    const targetId = req.params.id;
    const { isi_target } = req.body; 

    const sql = `UPDATE target_murojaah SET isi_target = ? WHERE id = ?`;
    db.run(sql, [isi_target, targetId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Perubahan target berhasil disimpan!" });
    });
});

// Siswa memperbarui status centang target harian
// Siswa memperbarui status centang target harian (dengan validasi isi target tidak boleh kosong)
app.put('/api/target/:id/status', verifyToken, (req, res) => {
    if (req.user.role !== 'murid') {
        return res.status(403).json({ error: "Akses ditolak! Hanya siswa yang bisa mengubah status target." });
    }

    const targetId = req.params.id;
    const { status_selesai } = req.body;

    // Cek dulu apakah isi_target kosong atau bernilai '-'
    const checkSql = `SELECT isi_target FROM target_muroja_ah WHERE id = ? AND murid_id = ?`; // Sesuaikan nama tabel jika perlu
    db.get(`SELECT isi_target FROM target_murojaah WHERE id = ? AND murid_id = ?`, [targetId, req.user.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: "Target tidak ditemukan." });

        if (!row.isi_target || row.isi_target.trim() === '' || row.isi_target.trim() === '-') {
            return res.status(400).json({ error: "Target kosong tidak dapat dicentang!" });
        }

        const sql = `UPDATE target_murojaah SET status_selesai = ? WHERE id = ? AND murid_id = ?`;
        db.run(sql, [status_selesai, targetId, req.user.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Status target berhasil diperbarui!" });
        });
    });
});

// Guru menghapus seluruh target muroja'ah dalam satu pekan tertentu untuk seorang murid
app.delete('/api/target/pekan', verifyToken, (req, res) => {
    if (req.user.role !== 'guru') {
        return res.status(403).json({ error: "Akses ditolak! Hanya Guru yang bisa menghapus target." });
    }

    const { murid_id, pekan_ke } = req.query;

    if (!murid_id || !pekan_ke) {
        return res.status(400).json({ error: "Data murid dan pekan harus disertakan!" });
    }

    const sql = `DELETE FROM target_murojaah WHERE murid_id = ? AND pekan_ke = ?`;
    db.run(sql, [murid_id, pekan_ke], function(err) {
        if (err) return res.status(500).json({ error: "Gagal menghapus target: " + err.message });
        if (this.changes === 0) {
            return res.status(404).json({ error: "Target untuk pekan tersebut tidak ditemukan." });
        }
        res.json({ message: "Alhamdulillah, Target pekanan berhasil dihapus!" });
    });
});

// ==========================================
// ROUTE UTAMA & NYALAKAN SERVER
// ==========================================
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

app.listen(PORT, () => {
    console.log(`Server nyala di port ${PORT}`);
});

// ==========================================
// 5. ENDPOINT Ujian Kenaikan Juz (Hifdz, Tajwid, Tartil)
// ==========================================


// Guru menetapkan ujian kenaikan juz untuk santri
app.post('/api/ujian/mulai', verifyToken, (req, res) => {
    if (req.user.role !== 'guru') return res.status(403).json({ error: "Khusus akses Muhaffidz!" });
    
    const { murid_id, jumlah_juz, daftar_juz } = req.body; // daftar_juz = [1,2,3,4,5]
    const guru_id = req.user.id;
    const waktu_mulai = new Date().toISOString();

    const sqlUjian = `INSERT INTO ujian_kenaikan (murid_id, guru_id, jumlah_juz, daftar_juz, waktu_mulai, status_ujian) VALUES (?, ?, ?, ?, ?, 'persiapan')`;
    
    db.run(sqlUjian, [murid_id, guru_id, jumlah_juz, JSON.stringify(daftar_juz), waktu_mulai], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        const ujian_id = this.lastID;
        const totalBaris = Number(jumlah_juz) + 5; // Jumlah juz + 5 baris kosong tambahan

        // Buat baris kosong otomatis untuk Kertas Tasmi'
        const sqlTasmi = `INSERT INTO kertas_tasmi (ujian_id, nomor, tanbih, khoto) VALUES (?, ?, 0, 0)`;
        for (let i = 1; i <= totalBaris; i++) {
            db.run(sqlTasmi, [ujian_id, i]);
        }

        res.json({ message: "Ujian kenaikan juz berhasil diaktifkan!", ujian_id });
    });
});

// Ambil data ujian aktif milik santri / guru
app.get('/api/ujian/aktif', verifyToken, (req, res) => {
    const murid_id = req.user.role === 'murid' ? req.user.id : req.query.murid_id;
    
    const sql = `SELECT * FROM ujian_kenaikan WHERE murid_id = ? ORDER BY id DESC LIMIT 1`;
    db.get(sql, [murid_id], (err, ujian) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!ujian) return res.json({ aktif: false });

        db.all(`SELECT * FROM kertas_tasmi WHERE ujian_id = ? ORDER BY nomor ASC`, [ujian.id], (err, tasmi) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ aktif: true, ujian, tasmi });
        });
    });
});

// Santri memperbarui baris kertas tasmi'
app.put('/api/ujian/tasmi/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'murid') return res.status(403).json({ error: "Khusus akses murid!" });

    const { tanbih, khoto, taqdir, status_kelulusan, mustami } = req.body;
    const sql = `UPDATE kertas_tasmi SET tanbih = ?, khoto = ?, taqdir = ?, status_kelulusan = ?, mustami = ? WHERE id = ?`;
    
    db.run(sql, [tanbih, khoto, taqdir, status_kelulusan, mustami, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Kertas tasmi' diperbarui." });
    });
});

// Guru memberikan penilaian akhir ujian (Hifdz, Tajwid, Tartil)
app.post('/api/ujian/nilai/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'guru') return res.status(403).json({ error: "Khusus akses guru!" });

    const { nilai_hifdz, nilai_tajwid, nilai_tartil } = req.body;
    
    // Hitung rata-rata: dijumlah lalu dibagi 3
    const nilai_akhir = (Number(nilai_hifdz) + Number(nilai_tajwid) + Number(nilai_tartil)) / 3;

    const sql = `UPDATE ujian_kenaikan SET nilai_hifdz = ?, nilai_tajwid = ?, nilai_tartil = ?, nilai_akhir = ?, status_ujian = 'selesai' WHERE id = ?`;
    
    db.run(sql, [nilai_hifdz, nilai_tajwid, nilai_tartil, nilai_akhir, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Penilaian ujian berhasil disimpan!", nilai_akhir: nilai_akhir.toFixed(2) });
    });
});

// Endpoint Guru menyimpan nilai dan menyelesaikan ujian
app.post('/api/ujian/nilai/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'guru') return res.status(403).json({ error: "Khusus akses guru!" });

    const { nilai_hifdz, nilai_tajwid, nilai_tartil } = req.body;
    const nilai_akhir = (Number(nilai_hifdz) + Number(nilai_tajwid) + Number(nilai_tartil)) / 3;

    // Ubah status_ujian menjadi 'selesai'
    const sql = `UPDATE ujian_kenaikan SET nilai_hifdz = ?, nilai_tajwid = ?, nilai_tartil = ?, nilai_akhir = ?, status_ujian = 'selesai' WHERE id = ?`;
    
    db.run(sql, [nilai_hifdz, nilai_tajwid, nilai_tartil, nilai_akhir, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Ujian berhasil diselesaikan dan dinilai!", nilai_akhir: nilai_akhir.toFixed(2) });
    });
});

// Endpoint untuk mengambil Riwayat Ujian Kenaikan Juz yang sudah selesai
app.get('/api/ujian/riwayat', verifyToken, (req, res) => {
    const murid_id = req.user.role === 'murid' ? req.user.id : req.query.murid_id;
    
    let sql = `SELECT u.*, m.nama_lengkap as nama_santri FROM ujian_kenaikan u 
               JOIN users m ON u.murid_id = m.id 
               WHERE u.status_ujian = 'selesai'`;
    
    const params = [];
    if (murid_id) {
        sql += ` AND u.murid_id = ?`;
        params.push(murid_id);
    }
    sql += ` ORDER BY u.id DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Endpoint untuk melihat detail riwayat ujian tertentu berdasarkan ID Ujian
app.get('/api/ujian/detail/:id', verifyToken, (req, res) => {
    const ujian_id = req.params.id;
    
    db.get(`SELECT u.*, m.nama_lengkap as nama_santri FROM ujian_kenaikan u JOIN users m ON u.murid_id = m.id WHERE u.id = ?`, [ujian_id], (err, ujian) => {
        if (err || !ujian) return res.status(404).json({ error: "Ujian tidak ditemukan." });

        db.all(`SELECT * FROM kertas_tasmi WHERE ujian_id = ? ORDER BY nomor ASC`, [ujian_id], (err, tasmi) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ ujian, tasmi });
        });
    });
});