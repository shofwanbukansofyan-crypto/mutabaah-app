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

    const sql = `INSERT INTO target_murojaah (guru_id, murid_id, pekan_ke, hari, isi_target) VALUES (?, ?, ?, ?, ?)`;

    targets.forEach(item => {
        db.run(sql, [guru_id, murid_id, pekan_ke, item.hari, item.isi_target], (err) => {
            if (err) console.error("Gagal simpan target:", err.message);
        });
    });

    res.json({ message: "Alhamdulillah, Target muroja'ah berhasil dikirim ke siswa!" });
});

// Siswa atau Guru melihat daftar target berdasarkan murid & pekan
app.get('/api/target', verifyToken, (req, res) => {
    const { murid_id, pekan_ke } = req.query;
    
    let targetMuridId = req.user.role === 'murid' ? req.user.id : murid_id;

    const sql = `SELECT * FROM target_murojaah WHERE murid_id = ? AND pekan_ke = ?`;
    db.all(sql, [targetMuridId, pekan_ke], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Siswa mengubah status ceklis (selesai / belum)
app.put('/api/target/:id/status', verifyToken, (req, res) => {
    const targetId = req.params.id;
    const { status_selesai } = req.body;

    const sql = `UPDATE target_murojaah SET status_selesai = ? WHERE id = ?`;
    db.run(sql, [status_selesai, targetId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Status target diperbarui!" });
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

// ==========================================
// ROUTE UTAMA & NYALAKAN SERVER
// ==========================================
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

app.listen(PORT, () => {
    console.log(`Server nyala di port ${PORT}`);
});