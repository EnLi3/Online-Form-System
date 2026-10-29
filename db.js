// db.js
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);
module.exports = db;

// Enable foreign keys
db.pragma('foreign_keys = ON');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS clinic_appendix (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no TEXT UNIQUE,
    ne_name TEXT,
    region TEXT,
    ref_type TEXT,
    health_care_institution TEXT,
    pic_name TEXT,
    payee_details TEXT,
    remarks TEXT,
    status_text TEXT,
    created_by_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

    CREATE TABLE IF NOT EXISTS report_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      photo_date TEXT NOT NULL,
      doc_type TEXT DEFAULT 'Supporting Document',
      original_size_kb INTEGER,
      compressed_size_kb INTEGER,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS masterlist_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sr_ref_no TEXT,
      region TEXT,
      ne_name TEXT,
      clinic_name TEXT,
      payee_name TEXT,
      hci_address TEXT,
      placement_location TEXT,
      payee_acc_no TEXT,
      payee_bank_name TEXT,
      business_reg_no TEXT,
      pic_name TEXT,
      start_date TEXT,
      end_date TEXT,
      period_months INTEGER,
      material_details TEXT,
      materials_json TEXT,
      total_amount REAL,
      created_by_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      zone_id INTEGER,
      FOREIGN KEY (zone_id) REFERENCES zones(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT CHECK(role IN ('SUPER_ADMIN', 'ADMIN', 'TIER_1', 'TIER_2', 'TIER_3', 'TIER_4')) NOT NULL,
      zone_id INTEGER,
      team_id INTEGER,
      status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'DISABLED', 'DELETED')),
      FOREIGN KEY (zone_id) REFERENCES zones(id),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no TEXT,
    clinic_name TEXT,
    address TEXT,
    company_name TEXT,
    reg_no TEXT,
    pic_name TEXT,
    material TEXT,
    space TEXT,
    start_date TEXT,
    end_date TEXT,
    amount_paid REAL,
    payee TEXT,
    bank_name TEXT,
    bank_acc TEXT,
    director_name TEXT,
    approval_status TEXT DEFAULT 'PENDING_T3',
    assigned_to_id INTEGER,
    created_by_id INTEGER,
    zone_id INTEGER,
    team_id INTEGER,
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

    CREATE TABLE IF NOT EXISTS report_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      photo_date TEXT NOT NULL,
      original_size_kb INTEGER,
      compressed_size_kb INTEGER,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS migration_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      performed_by_id INTEGER NOT NULL,
      migrated_count INTEGER NOT NULL,
      migrated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default Zones, Teams, and Users if empty
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    console.log('Seeding initial demo data...');
    const zone1 = db.prepare('INSERT INTO zones (name) VALUES (?)').run('Zone North (KL/Selangor)').lastInsertRowid;
    const zone2 = db.prepare('INSERT INTO zones (name) VALUES (?)').run('Zone South (Johor/Melaka)').lastInsertRowid;

    const teamA = db.prepare('INSERT INTO teams (name, zone_id) VALUES (?, ?)').run('Team Alpha', zone1).lastInsertRowid;

    const pass = bcrypt.hashSync('123456', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, zone_id, team_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertUser.run('superadmin', pass, 'Super Admin', 'SUPER_ADMIN', null, null);
    insertUser.run('admin', pass, 'System Admin', 'ADMIN', null, null);
    insertUser.run('director', pass, 'David (Sales Director - T1)', 'TIER_1', null, null);
    insertUser.run('manager', pass, 'Sarah (Sales Manager - T2)', 'TIER_2', zone1, null);
    insertUser.run('leader', pass, 'Alex (Team Leader - T3)', 'TIER_3', zone1, teamA);
    const sales1 = insertUser.run('sales1', pass, 'Jason (Salesperson - T4)', 'TIER_4', zone1, teamA).lastInsertRowid;
    insertUser.run('sales2', pass, 'Emily (New Salesperson - T4)', 'TIER_4', zone1, teamA);

    // Seed 1 sample clinic report
    db.prepare(`
      INSERT INTO reports (ref_no, clinic_name, pic_name, material, start_date, end_date, amount_paid, approval_status, created_by_id, assigned_to_id, zone_id, team_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('REF-202610-001', 'Klinik Mediviron Shah Alam', 'Dr. Lim', '2x Poster Standees, 100x Brochures', '2026-10-01', '2026-12-31', 1500.00, 'PENDING_T3', sales1, sales1, zone1, teamA);
  }
}

initDb();
module.exports = db;