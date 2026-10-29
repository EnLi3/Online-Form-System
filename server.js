// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const xlsx = require('xlsx');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'local-dev-secret-key-change-in-prod';

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
  CREATE TABLE IF NOT EXISTS master_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_name TEXT UNIQUE,
    category TEXT,
    unit_price REAL
  )
`);

// Ensure approval_status column exists in masterlist_requests
try {
  db.prepare(`ALTER TABLE masterlist_requests ADD COLUMN approval_status TEXT DEFAULT 'PENDING_T3'`).run();
} catch (e) {
  // Column already exists, safe to ignore
}

// Seed default materials if empty
const matCount = db.prepare(`SELECT COUNT(*) as cnt FROM master_materials`).get().cnt;
if (matCount === 0) {
  const defaultMats = [
    ['Wall Mural', 'Large', 2000],
    ['Wall Sticker', 'Medium', 1000],
    ['Activity Table', 'Medium', 1000],
    ['Bunting', 'Small', 500],
    ['Poster', 'Small', 500],
    ['Growth Chart', 'Small', 500],
    ['Counter-Top Display', 'Small', 500],
    ['Counter-Top Flip Chart', 'Small', 500],
    ['Product Placement (Gum/Maternal)', 'Small', 500],
    ['Calendar', 'Small', 600],
    ['Educational Wooden Board', 'X-Small', 300],
    ['Tent Card', 'X-Small', 300],
    ['Leaflet in Leaflet Holder', 'X-Small', 200],
    ['Door Hanger/Door Sticker', 'X-Small', 100],
    ['Product Placement (Nestle Food Products)', 'X-Small', 100]
  ];
  const insertMat = db.prepare(`INSERT INTO master_materials (material_name, category, unit_price) VALUES (?, ?, ?)`);
  defaultMats.forEach(m => insertMat.run(m[0], m[1], m[2]));
}

// GET Materials
app.get('/api/materials', auth, (req, res) => {
  res.json(db.prepare(`SELECT * FROM master_materials ORDER BY id ASC`).all());
});

// POST / PUT Material (Director Only)
app.post('/api/materials', auth, (req, res) => {
  if (req.user.role !== 'TIER_1' && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Only Tier 1 Directors can modify material pricing.' });
  }
  const { id, material_name, category, unit_price } = req.body;
  try {
    if (id) {
      db.prepare(`UPDATE master_materials SET material_name = ?, category = ?, unit_price = ? WHERE id = ?`).run(material_name, category, unit_price, id);
      res.json({ message: 'Material updated successfully!' });
    } else {
      db.prepare(`INSERT INTO master_materials (material_name, category, unit_price) VALUES (?, ?, ?)`).run(material_name, category, unit_price);
      res.json({ message: 'Material added successfully!' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Multer memory storage so Sharp can compress before saving to disk
const upload = multer({ storage: multer.memoryStorage() });

// Middleware: Authenticate JWT Token
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Ensure approval_status column exists in masterlist_requests
try {
  db.prepare(`ALTER TABLE masterlist_requests ADD COLUMN approval_status TEXT DEFAULT 'PENDING_T3'`).run();
} catch (e) {
  // Column already exists, safe to ignore
}

// Ensure report_id column exists in masterlist_requests
try {
  db.prepare(`ALTER TABLE masterlist_requests ADD COLUMN report_id INTEGER`).run();
} catch (e) {
  // Column already exists, safe to ignore
}

// Link existing masterlist_requests to their matching reports by ref_no & dates
try {
  db.prepare(`
    UPDATE masterlist_requests
    SET report_id = (
      SELECT r.id FROM reports r 
      WHERE r.ref_no = masterlist_requests.sr_ref_no 
        AND r.start_date = masterlist_requests.start_date
      ORDER BY r.id DESC LIMIT 1
    )
    WHERE report_id IS NULL
  `).run();
} catch (e) {}

// ==========================================
// 1. LOGIN API (With Hierarchy Details)
// ==========================================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare(`
    SELECT u.*, z.name as zone_name, t.name as team_name 
    FROM users u
    LEFT JOIN zones z ON u.zone_id = z.id
    LEFT JOIN teams t ON u.team_id = t.id
    WHERE u.username = ? AND u.status = 'ACTIVE'
  `).get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password (or account disabled)' });
  }

  // Find their Team Leader (Tier 3 in the same team)
  let leader = null;
  if (['TIER_4'].includes(user.role) && user.team_id) {
    leader = db.prepare(`
      SELECT full_name FROM users 
      WHERE role = 'TIER_3' AND team_id = ? AND status = 'ACTIVE' LIMIT 1
    `).get(user.team_id);
  }

  // Find their Sales Manager (Tier 2 in the same zone)
  let manager = null;
  if (['TIER_4', 'TIER_3'].includes(user.role) && user.zone_id) {
    manager = db.prepare(`
      SELECT full_name FROM users 
      WHERE role = 'TIER_2' AND zone_id = ? AND status = 'ACTIVE' LIMIT 1
    `).get(user.zone_id);
  }

  user.leader_name = leader ? leader.full_name : 'Not Assigned';
  user.manager_name = manager ? manager.full_name : 'Not Assigned';

  const token = jwt.sign({
    id: user.id, username: user.username, full_name: user.full_name,
    role: user.role, zone_id: user.zone_id, team_id: user.team_id
  }, JWT_SECRET, { expiresIn: '12h' });

  res.json({ token, user });
});

// ==========================================
// 2. GET REPORTS (With Resilient Leader & Manager Lookup)
// ==========================================
app.get('/api/reports', auth, (req, res) => {
  const { role, id, zone_id: userZoneId, team_id: userTeamId } = req.user;
  const { search, month, zone_name, team_name, status } = req.query;

  let query = `
    SELECT r.*, 
           u.full_name as assigned_user_name, 
           c.full_name as creator_user_name,
           z.name as zone_name, 
           t.name as team_name,
           (
             SELECT full_name FROM users 
             WHERE role = 'TIER_3' 
               AND team_id = COALESCE(r.team_id, u.team_id)
               AND status = 'ACTIVE' 
             LIMIT 1
           ) as leader_name,
           (
             SELECT full_name FROM users 
             WHERE role = 'TIER_2' 
               AND zone_id = COALESCE(r.zone_id, u.zone_id)
               AND status = 'ACTIVE' 
             LIMIT 1
           ) as manager_name
    FROM reports r
    LEFT JOIN users u ON r.assigned_to_id = u.id
    LEFT JOIN users c ON r.created_by_id = c.id
    LEFT JOIN zones z ON COALESCE(r.zone_id, u.zone_id) = z.id
    LEFT JOIN teams t ON COALESCE(r.team_id, u.team_id) = t.id
    WHERE 1=1
  `;
  const params = [];

  // Role-based restrictions (Super Admin and Tier 1 see all)
  if (role === 'TIER_4') {
    query += ` AND r.assigned_to_id = ?`;
    params.push(id);
  } else if (role === 'TIER_3' && userTeamId) {
    query += ` AND COALESCE(r.team_id, u.team_id) = ?`;
    params.push(userTeamId);
  } else if (role === 'TIER_2' && userZoneId) {
    query += ` AND COALESCE(r.zone_id, u.zone_id) = ?`;
    params.push(userZoneId);
  }

  // Month filter
  if (month) {
    query += ` AND (r.start_date LIKE ? OR r.end_date LIKE ?)`;
    params.push(`${month}%`, `${month}%`);
  }

  // Zone Name filter
  if (zone_name && ['SUPER_ADMIN', 'ADMIN', 'TIER_1'].includes(role)) {
    query += ` AND z.name = ?`;
    params.push(zone_name);
  }

  // Team Name filter
  if (team_name && ['SUPER_ADMIN', 'ADMIN', 'TIER_1', 'TIER_2'].includes(role)) {
    query += ` AND t.name = ?`;
    params.push(team_name);
  }

  // Status filter
  if (status) {
    query += ` AND r.approval_status = ?`;
    params.push(status);
  }

  // Search filter
  if (search) {
    query += ` AND (r.clinic_name LIKE ? OR r.ref_no LIKE ? OR r.pic_name LIKE ? OR z.name LIKE ? OR t.name LIKE ? OR u.full_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY r.id DESC`;

  
  
  try {
    const reports = db.prepare(query).all(...params);
    const photoStmt = db.prepare('SELECT * FROM report_photos WHERE report_id = ?');
    reports.forEach(r => {
      r.photos = photoStmt.all(r.id);
    });
    res.json(reports);
  } catch (err) {
    console.error('Reports query error:', err.message);
    res.status(500).json({ error: 'Failed to load reports: ' + err.message });
  }
});

// ==========================================
// 3. SUBMIT NEW REPORT (Scoped by Zone)
// ==========================================
app.post('/api/reports', auth, upload.array('photos', 5), async (req, res) => {
  try {

    if (req.user.role === 'ADMIN') {
    return res.status(403).json({ error: 'Admins are restricted to user management and cannot submit reports.' });
  }

    const { clinic_name, pic_name, material, start_date, end_date, amount_paid } = req.body;
    const cleanClinicName = clinic_name.trim();
    const userZoneId = req.user.zone_id;

    const existingClinic = db.prepare(`
      SELECT ref_no, clinic_name FROM reports 
      WHERE LOWER(TRIM(clinic_name)) = LOWER(?) AND zone_id = ?
      LIMIT 1
    `).get(cleanClinicName, userZoneId);

    const ref_no = existingClinic 
      ? existingClinic.ref_no 
      : `REF-${new Date().toISOString().slice(0,7).replace('-','')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const finalClinicName = existingClinic ? existingClinic.clinic_name : cleanClinicName;
    const initialStatus = req.user.role === 'TIER_3' ? 'PENDING_T2' : 'PENDING_T3';

    const result = db.prepare(`
      INSERT INTO reports (ref_no, clinic_name, pic_name, material, start_date, end_date, amount_paid, approval_status, created_by_id, assigned_to_id, zone_id, team_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ref_no, finalClinicName, pic_name.trim(), material, start_date, end_date, parseFloat(amount_paid),
      initialStatus, req.user.id, req.user.id, req.user.zone_id, req.user.team_id
    );

    const reportId = result.lastInsertRowid;

    if (req.files && req.files.length > 0) {
      // document_types can be passed as a single string or array corresponding to files
      const docTypes = req.body.doc_types || req.body.doc_type || 'Supporting Document';

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const currentDocType = Array.isArray(docTypes) ? (docTypes[i] || 'Supporting Document') : docTypes;
        
        const filename = `${ref_no}-${Date.now()}-${Math.round(Math.random()*1000)}.webp`;
        const outputPath = path.join(uploadDir, filename);
        const originalSizeKb = Math.round(file.size / 1024);

        await sharp(file.buffer)
          .resize({ width: 1200, withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(outputPath);

        const stats = fs.statSync(outputPath);
        const compressedSizeKb = Math.round(stats.size / 1024);

        db.prepare(`
          INSERT INTO report_photos (report_id, file_path, photo_date, doc_type, original_size_kb, compressed_size_kb)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(reportId, `/uploads/${filename}`, `${start_date} to ${end_date}`, currentDocType, originalSizeKb, compressedSizeKb);
      }
    }

    res.json({ 
      message: existingClinic ? `Matched clinic in your zone! Added under ${ref_no}` : `New clinic report created with ${ref_no}!`, 
      ref_no 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3.5 EDIT & UPLOAD DOCUMENTS FOR ANY REPORT
// ==========================================
app.put('/api/reports/:id', auth, upload.array('photos', 5), async (req, res) => {
  try {
    const reportId = req.params.id;
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);

    if (!report) return res.status(404).json({ error: 'Report not found' });

    const { clinic_name, pic_name, material, start_date, end_date, amount_paid, replace_photos, doc_type } = req.body;

    if (clinic_name) {
      db.prepare(`
        UPDATE reports 
        SET clinic_name = ?, pic_name = ?, material = ?, start_date = ?, end_date = ?, 
            amount_paid = ?, remarks = COALESCE(?, remarks)
        WHERE id = ?
      `).run(
        clinic_name, pic_name, material, start_date, end_date, 
        parseFloat(amount_paid || report.amount_paid), doc_type ? `Uploaded document: ${doc_type}` : report.remarks, reportId
      );
    }

    if (req.files && req.files.length > 0) {
      const docTypes = doc_type || req.body.doc_types || 'Supporting Document';

      if (replace_photos === 'true') {
        const oldPhotos = db.prepare('SELECT * FROM report_photos WHERE report_id = ?').all(reportId);
        for (const p of oldPhotos) {
          const fullPath = path.join(__dirname, p.file_path);
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
        db.prepare('DELETE FROM report_photos WHERE report_id = ?').run(reportId);
      }

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const currentDocType = Array.isArray(docTypes) ? (docTypes[i] || 'Supporting Document') : docTypes;
        
        const filename = `${report.ref_no}-DOC-${Date.now()}-${Math.round(Math.random()*1000)}.webp`;
        const outputPath = path.join(uploadDir, filename);
        const originalSizeKb = Math.round(file.size / 1024);

        await sharp(file.buffer)
          .resize({ width: 1200, withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(outputPath);

        const stats = fs.statSync(outputPath);
        const compressedSizeKb = Math.round(stats.size / 1024);

        db.prepare(`
          INSERT INTO report_photos (report_id, file_path, photo_date, doc_type, original_size_kb, compressed_size_kb)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(reportId, `/uploads/${filename}`, report.start_date, currentDocType, originalSizeKb, compressedSizeKb);
      }
    }

    res.json({ message: `Supporting document uploaded and linked to ${report.ref_no} successfully!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. APPROVAL & REJECTION WORKFLOW
// ==========================================
app.patch('/api/reports/:id/approval', auth, (req, res) => {
  const { action, remarks } = req.body;
  const targetId = req.params.id;

  // 1. Locate the exact report record
  let report = db.prepare('SELECT * FROM reports WHERE id = ?').get(targetId);

  // 2. If targetId was masterlist_requests.id, find its linked report
  let mlRow = null;
  if (!report) {
    mlRow = db.prepare('SELECT id, sr_ref_no, report_id FROM masterlist_requests WHERE id = ?').get(targetId);
    if (mlRow && mlRow.report_id) {
      report = db.prepare('SELECT * FROM reports WHERE id = ?').get(mlRow.report_id);
    }
  }

  // 3. Fallback: match by ref_no only if no direct ID match was found
  if (!report) {
    report = db.prepare('SELECT * FROM reports WHERE ref_no = ? ORDER BY id DESC LIMIT 1').get(targetId);
  }

  if (!report) {
    return res.status(404).json({ error: 'Report not found for identifier: ' + targetId });
  }

  const userRole = (req.user.role || '').trim();
  const currentStatus = (report.approval_status || '').trim();

  if (!['SUPER_ADMIN', 'TIER_1', 'TIER_2', 'TIER_3'].includes(userRole)) {
    return res.status(403).json({ error: 'Sales (Tier 4) cannot approve or reject reports.' });
  }

  let nextStatus = currentStatus;
  let newRemarks = report.remarks || '';

  if (action === 'REJECT') {
    if (!remarks || !remarks.trim()) {
      return res.status(400).json({ error: 'Please enter a rejection remark.' });
    }
    nextStatus = 'REJECTED';
    newRemarks = remarks.trim();
  } else if (action === 'APPROVE') {
    if (userRole === 'TIER_1' || userRole === 'SUPER_ADMIN') {
      nextStatus = 'APPROVED_CLOSED';
      newRemarks = 'Final Approved & Closed by Director/Admin';
    } else if (userRole === 'TIER_2') {
      nextStatus = 'PENDING_T1';
      newRemarks = 'Approved by Sales Manager';
    } else if (userRole === 'TIER_3') {
      nextStatus = 'PENDING_T2';
      newRemarks = 'Approved by Team Leader';
    }
  } else {
    return res.status(400).json({ error: 'Invalid action provided.' });
  }

  // Update ONLY this specific report record
  db.prepare('UPDATE reports SET approval_status = ?, remarks = ? WHERE id = ?')
    .run(nextStatus, newRemarks, report.id);

  // CRITICAL FIX: Update ONLY the specific masterlist entry linked to this report.
  // DO NOT update by sr_ref_no so other duration records remain untouched!
  if (mlRow) {
    db.prepare('UPDATE masterlist_requests SET approval_status = ?, report_id = ? WHERE id = ?')
      .run(nextStatus, report.id, mlRow.id);
  } else {
    const updated = db.prepare('UPDATE masterlist_requests SET approval_status = ? WHERE report_id = ?')
      .run(nextStatus, report.id);
    
    // If old records had report_id NULL, update the single newest masterlist row for this date/period
    if (updated.changes === 0) {
      db.prepare(`
        UPDATE masterlist_requests 
        SET approval_status = ?, report_id = ? 
        WHERE id = (
          SELECT id FROM masterlist_requests 
          WHERE sr_ref_no = ? AND (report_id IS NULL OR report_id = ?) 
          ORDER BY id DESC LIMIT 1
        )
      `).run(nextStatus, report.id, report.ref_no, report.id);
    }
  }

  res.json({ message: `Success! Status is now ${nextStatus}`, nextStatus, reportId: report.id });
});
// ==========================================
// 5. MIGRATION & USERS
// ==========================================
app.get('/api/users', auth, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role, u.status, u.zone_id, u.team_id, z.name as zone_name, t.name as team_name
    FROM users u
    LEFT JOIN zones z ON u.zone_id = z.id
    LEFT JOIN teams t ON u.team_id = t.id
  `).all();
  res.json(users);
});

app.post('/api/users/migrate', auth, (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Access denied. Only Super Admin can migrate employee records.' });
  }

  const { fromUserId, toUserId } = req.body;
  if (String(fromUserId) === String(toUserId)) {
    return res.status(400).json({ error: 'Source and Target user cannot be the same.' });
  }

  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(toUserId);
  if (!targetUser) return res.status(404).json({ error: 'Target user not found' });

  const updateResult = db.prepare(`
    UPDATE reports 
    SET assigned_to_id = ?, zone_id = COALESCE(?, zone_id), team_id = COALESCE(?, team_id)
    WHERE assigned_to_id = ?
  `).run(targetUser.id, targetUser.zone_id, targetUser.team_id, fromUserId);

  db.prepare(`
    INSERT INTO migration_logs (from_user_id, to_user_id, performed_by_id, migrated_count)
    VALUES (?, ?, ?, ?)
  `).run(fromUserId, toUserId, req.user.id, updateResult.changes);

  res.json({ message: `Successfully migrated ${updateResult.changes} record(s) to ${targetUser.full_name}` });
});

// ==========================================
// 6. USER & METADATA MANAGEMENT
// ==========================================
function requireAdminOrSuper(req, res, next) {
  if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied. Admin or Super Admin only.' });
  }
  next();
}

// GET Zones and Teams (Accessible to all authenticated users for dropdowns)
app.get('/api/metadata/zones-teams', auth, (req, res) => {
  const zones = db.prepare('SELECT * FROM zones').all();
  const teams = db.prepare('SELECT * FROM teams').all();
  res.json({ zones, teams });
});

app.post('/api/users', auth, requireAdminOrSuper, (req, res) => {
  try {
    const { username, password, full_name, role, zone_id, team_id } = req.body;
    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (req.user.role === 'ADMIN' && role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied. Admins cannot create Super Admins.' });
    }

    if (['TIER_4', 'TIER_3'].includes(role) && (!zone_id || !team_id)) {
      return res.status(400).json({ error: 'Zone and Team are mandatory for Tier 3 and Tier 4 users.' });
    }
    if (role === 'TIER_2' && !zone_id) {
      return res.status(400).json({ error: 'Zone is mandatory for Tier 2 Managers.' });
    }

    const password_hash = bcrypt.hashSync(password, 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, zone_id, team_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(username.trim(), password_hash, full_name.trim(), role, zone_id || null, team_id || null);

    res.json({ message: `User ${username} created successfully!` });
  } catch (err) {
    res.status(400).json({ error: 'Username already exists or invalid data.' });
  }
});

app.patch('/api/users/:id/status', auth, requireAdminOrSuper, (req, res) => {
  const userId = req.params.id;
  const { status } = req.body;
  if (!['ACTIVE', 'DISABLED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
  res.json({ message: `User status changed to ${status}` });
});

app.post('/api/users/import-csv', auth, upload.single('file'), async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Only Super Admin can import users via CSV/Excel.' });
  }
  if (!req.file) return res.status(400).json({ error: 'Please upload a CSV or Excel file.' });

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let importedCount = 0;
    const defaultPass = bcrypt.hashSync('123456', 10);

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO users (username, password_hash, full_name, role, zone_id, team_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
    `);

    for (const row of rows) {
      const username = row.username || row.Username;
      const full_name = row.full_name || row.FullName || row['Full Name'];
      const role = row.role || row.Role;

      if (username && full_name && role) {
        const resRun = insertStmt.run(
          String(username).trim(),
          defaultPass,
          String(full_name).trim(),
          String(role).trim(),
          row.zone_id || row.ZoneId || null,
          row.team_id || row.TeamId || null
        );
        if (resRun.changes > 0) importedCount++;
      }
    }

    res.json({ message: `Successfully imported ${importedCount} user(s)! Default password is '123456'.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse file: ' + err.message });
  }
});

app.post('/api/zones', auth, requireAdminOrSuper, (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Zone name is required' });
    db.prepare('INSERT INTO zones (name) VALUES (?)').run(name.trim());
    res.json({ message: `Zone "${name}" created successfully!` });
  } catch (err) {
    res.status(400).json({ error: 'Zone name already exists.' });
  }
});

app.post('/api/teams', auth, requireAdminOrSuper, (req, res) => {
  try {
    const { name, zone_id } = req.body;
    if (!name || !name.trim() || !zone_id) {
      return res.status(400).json({ error: 'Team name and valid Zone selection are required.' });
    }
    const zoneExists = db.prepare('SELECT id FROM zones WHERE id = ?').get(zone_id);
    if (!zoneExists) return res.status(400).json({ error: 'Selected zone does not exist.' });

    db.prepare('INSERT INTO teams (name, zone_id) VALUES (?, ?)').run(name.trim(), zone_id);
    res.json({ message: `Team "${name.trim()}" successfully assigned to Zone!` });
  } catch (err) {
    res.status(400).json({ error: 'Failed to create team.' });
  }
});

// Ensure historical reports carry their assigned user's zone and team
try {
  db.prepare(`
    UPDATE reports 
    SET zone_id = (SELECT zone_id FROM users WHERE users.id = reports.assigned_to_id),
        team_id = (SELECT team_id FROM users WHERE users.id = reports.assigned_to_id)
    WHERE zone_id IS NULL OR team_id IS NULL
  `).run();
} catch (e) {
  console.error('Data backfill error:', e);
}

app.listen(PORT, () => {
  console.log(`✅ Local Server running at http://localhost:${PORT}`);
});

// ==========================================
// 4.5 GET FINAL INVOICE & AUTHORIZATION LETTER DATA
// ==========================================
app.get('/api/reports/:id/invoice-data', auth, (req, res) => {
  const reportId = req.params.id;
  const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(reportId);

  if (!report) return res.status(404).json({ error: 'Report not found' });

  // Enforce lock until final director approval
  if (report.approval_status !== 'APPROVED_CLOSED') {
    return res.status(400).json({ error: 'Booking PDF / Invoice is locked until final approval by Director (APPROVED_CLOSED).' });
  }

  res.json(report);
});


// ==========================================
// MASTER LIST & APPROVAL PIPELINE API
// ==========================================

// GET Masterlist records
// GET Masterlist records (Joined with reports & attached photos)
// GET Masterlist records (Joined with reports & attached photos)
app.get('/api/masterlist', auth, (req, res) => {
  try {
    const records = db.prepare(`
      SELECT m.*, 
             u.full_name as creator_name, 
             COALESCE(m.approval_status, r.approval_status, 'PENDING_T3') as approval_status, 
             COALESCE(m.report_id, r.id) as report_id,
             r.remarks,
             z.name as zone_name,
             t.name as team_name
      FROM masterlist_requests m 
      LEFT JOIN users u ON m.created_by_id = u.id 
      LEFT JOIN reports r ON (m.report_id IS NOT NULL AND m.report_id = r.id)
      LEFT JOIN zones z ON r.zone_id = z.id
      LEFT JOIN teams t ON r.team_id = t.id
      ORDER BY m.id DESC
    `).all();

    const photoStmt = db.prepare(`
      SELECT p.* FROM report_photos p 
      WHERE p.report_id = ?
    `);
    
    records.forEach(r => {
      r.photos = r.report_id ? photoStmt.all(r.report_id) : [];
    });

    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Masterlist record (Auto-registers as a dashboard approval report)
app.post('/api/masterlist', auth, (req, res) => {
  const { id: userId, role, zone_id, team_id } = req.user;

  const {
    sr_ref_no, region, ne_name, clinic_name, payee_name, hci_address,
    placement_location, payee_acc_no, payee_bank_name, business_reg_no,
    pic_name, start_date, end_date, period_months, material_details, materials_json, total_amount
  } = req.body;

  try {
    const cleanClinic = (clinic_name || '').trim().toLowerCase();
    const cleanPic = (pic_name || '').trim().toLowerCase();

    const existingRecord = db.prepare(`
      SELECT sr_ref_no FROM masterlist_requests 
      WHERE LOWER(TRIM(clinic_name)) = ? AND LOWER(TRIM(pic_name)) = ?
      ORDER BY id DESC LIMIT 1
    `).get(cleanClinic, cleanPic);

    const assignedRefNo = existingRecord 
      ? existingRecord.sr_ref_no 
      : (sr_ref_no || `SR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`);

    const initialStatus = role === 'TIER_3' ? 'PENDING_T2' : 'PENDING_T3';

    // 1. Insert into reports first to get its real ID
    const reportStmt = db.prepare(`
      INSERT INTO reports (
        ref_no, clinic_name, address, company_name, reg_no, pic_name, material, space, 
        start_date, end_date, amount_paid, payee, bank_name, bank_acc, approval_status, 
        created_by_id, assigned_to_id, zone_id, team_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assignedRefNo, clinic_name, hci_address, payee_name, business_reg_no, pic_name, material_details, placement_location,
      start_date, end_date, parseFloat(total_amount), payee_name, payee_bank_name, payee_acc_no,
      initialStatus, userId, userId, zone_id, team_id
    );

    const newReportId = reportStmt.lastInsertRowid;

    // 2. Insert into masterlist_requests with direct report_id linkage
    db.prepare(`
      INSERT INTO masterlist_requests (
        sr_ref_no, region, ne_name, clinic_name, payee_name, hci_address,
        placement_location, payee_acc_no, payee_bank_name, business_reg_no,
        pic_name, start_date, end_date, period_months, material_details, materials_json, total_amount, created_by_id, approval_status, report_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assignedRefNo,
      region || 'CREC', ne_name || req.user.full_name, clinic_name, payee_name, hci_address,
      placement_location, payee_acc_no, payee_bank_name, business_reg_no,
      pic_name, start_date, end_date, period_months, material_details, JSON.stringify(materials_json || {}), total_amount, userId, initialStatus, newReportId
    );

    res.json({ message: `Masterlist SR request saved successfully with status: ${initialStatus}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create Masterlist record: ' + err.message });
  }
});

// PUT Masterlist record (Update existing SR Request)
app.put('/api/masterlist/:id', auth, (req, res) => {
  const recordId = req.params.id;
  const {
    sr_ref_no, region, ne_name, clinic_name, payee_name, hci_address,
    placement_location, payee_acc_no, payee_bank_name, business_reg_no,
    pic_name, start_date, end_date, period_months, material_details, materials_json, total_amount
  } = req.body;

  try {
    const existing = db.prepare('SELECT * FROM masterlist_requests WHERE id = ?').get(recordId);
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    // When resubmitting, reset approval status back to pending
    const resubmitStatus = req.user.role === 'TIER_3' ? 'PENDING_T2' : 'PENDING_T3';

    db.prepare(`
      UPDATE masterlist_requests SET
        sr_ref_no = ?, region = ?, ne_name = ?, clinic_name = ?, payee_name = ?, 
        hci_address = ?, placement_location = ?, payee_acc_no = ?, payee_bank_name = ?, 
        business_reg_no = ?, pic_name = ?, start_date = ?, end_date = ?, 
        period_months = ?, material_details = ?, materials_json = ?, total_amount = ?,
        approval_status = ?
      WHERE id = ?
    `).run(
      sr_ref_no, region, ne_name, clinic_name, payee_name,
      hci_address, placement_location, payee_acc_no, payee_bank_name,
      business_reg_no, pic_name, start_date, end_date,
      period_months, material_details, JSON.stringify(materials_json || {}), parseFloat(total_amount),
      resubmitStatus, recordId
    );

    // Sync parallel report table entry by report_id or ref_no
    const reportTargetId = existing.report_id;
    if (reportTargetId) {
      db.prepare(`
        UPDATE reports SET
          clinic_name = ?, address = ?, company_name = ?, reg_no = ?, pic_name = ?, 
          material = ?, space = ?, start_date = ?, end_date = ?, amount_paid = ?, 
          payee = ?, bank_name = ?, bank_acc = ?, approval_status = ?, remarks = ?
        WHERE id = ?
      `).run(
        clinic_name, hci_address, payee_name, business_reg_no, pic_name,
        material_details, placement_location, start_date, end_date, parseFloat(total_amount),
        payee_name, payee_bank_name, payee_acc_no, resubmitStatus, 'Resubmitted after edits', reportTargetId
      );
    } else {
      db.prepare(`
        UPDATE reports SET
          clinic_name = ?, address = ?, company_name = ?, reg_no = ?, pic_name = ?, 
          material = ?, space = ?, start_date = ?, end_date = ?, amount_paid = ?, 
          payee = ?, bank_name = ?, bank_acc = ?, approval_status = ?, remarks = ?
        WHERE ref_no = ?
      `).run(
        clinic_name, hci_address, payee_name, business_reg_no, pic_name,
        material_details, placement_location, start_date, end_date, parseFloat(total_amount),
        payee_name, payee_bank_name, payee_acc_no, resubmitStatus, 'Resubmitted after edits', sr_ref_no
      );
    }

    res.json({ message: 'Masterlist SR request updated and resubmitted for approval successfully!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update Masterlist record: ' + err.message });
  }
});

//Apendix List
// GET Clinic Appendix List
app.get('/api/appendix', auth, (req, res) => {
  try {
    const list = db.prepare(`SELECT a.*, u.full_name as creator_name FROM clinic_appendix a LEFT JOIN users u ON a.created_by_id = u.id ORDER BY a.id DESC`).all();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/appendix', auth, (req, res) => {
  const { id: userId } = req.user;
  const { id, ref_no, ne_name, region, ref_type, health_care_institution, pic_name, payee_details, remarks, status_text } = req.body;

  try {
    // ALWAYS generate a unique Ref No for every distinct PIC / entry
    const generatedRefNo = ref_no || `APP-${new Date().toISOString().slice(0,7).replace('-','')}-${Math.floor(1000 + Math.random() * 9000)}`;

    if (id) {
      db.prepare(`
        UPDATE clinic_appendix SET ref_no = ?, ne_name = ?, region = ?, ref_type = ?, health_care_institution = ?, pic_name = ?, payee_details = ?, remarks = ?, status_text = ?
        WHERE id = ?
      `).run(generatedRefNo, ne_name, region, ref_type, health_care_institution, pic_name || '', payee_details, remarks || '', status_text, id);
      res.json({ message: 'Appendix entry updated successfully!', ref_no: generatedRefNo });
    } else {
      const defaultStatus = `Added to Clinic Appendix List on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      db.prepare(`
        INSERT INTO clinic_appendix (ref_no, ne_name, region, ref_type, health_care_institution, pic_name, payee_details, remarks, status_text, created_by_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(generatedRefNo, ne_name, region, ref_type || '2026 New', health_care_institution, pic_name || '', payee_details, remarks || '', status_text || defaultStatus, userId);
      res.json({ message: 'New clinic & PIC added to Appendix with unique Ref No ' + generatedRefNo, ref_no: generatedRefNo });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to save appendix record: ' + err.message });
  }
});

// ==========================================
// SUBMIT SIGNED AGREEMENT & POSM PHOTO
// ==========================================
app.post('/api/reports/:id/completion-docs', auth, upload.array('photos', 5), async (req, res) => {
  try {
    const reportId = req.params.id;
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const docTypes = req.body.doc_types || req.body.doc_type || ['Signed Agreement / Booking Form', 'POSM in Place Photo'];

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const currentDocType = Array.isArray(docTypes) ? (docTypes[i] || 'Supporting Document') : docTypes;
        
        const filename = `${report.ref_no}-COMPLETION-${Date.now()}-${Math.round(Math.random()*1000)}.webp`;
        const outputPath = path.join(uploadDir, filename);
        const originalSizeKb = Math.round(file.size / 1024);

        await sharp(file.buffer)
          .resize({ width: 1200, withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(outputPath);

        const stats = fs.statSync(outputPath);
        const compressedSizeKb = Math.round(stats.size / 1024);

        db.prepare(`
          INSERT INTO report_photos (report_id, file_path, photo_date, doc_type, original_size_kb, compressed_size_kb)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(reportId, `/uploads/${filename}`, report.start_date, currentDocType, originalSizeKb, compressedSizeKb);
      }
    }

    res.json({ message: `Signed Agreement and POSM placement photo uploaded successfully for ${report.ref_no}!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// UPLOAD MONTHLY PROOF PHOTO
// ==========================================
app.post('/api/reports/:id/monthly-proof', auth, upload.single('photo'), async (req, res) => {
  try {
    const reportId = req.params.id;
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const { target_month } = req.body; // e.g., "2026-06" or "Month 1 (June 2026)"
    if (!req.file) return res.status(400).json({ error: 'Please select a proof photo.' });

    const filename = `${report.ref_no}-MONTHLY-${target_month}-${Date.now()}.webp`;
    const outputPath = path.join(uploadDir, filename);
    const originalSizeKb = Math.round(req.file.size / 1024);

    await sharp(req.file.buffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    const compressedSizeKb = Math.round(stats.size / 1024);

    db.prepare(`
      INSERT INTO report_photos (report_id, file_path, photo_date, doc_type, original_size_kb, compressed_size_kb)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(reportId, `/uploads/${filename}`, target_month, `Monthly Proof: ${target_month}`, originalSizeKb, compressedSizeKb);

    res.json({ message: `Proof photo for month ${target_month} uploaded successfully for ${report.ref_no}!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});