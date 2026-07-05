/* ============================================================
   LIFE DROP SAVER — Backend (Node.js + Express + SQLite)
   Run:  node server.js   →  http://localhost:3000
   The database file (db/lifedropsaver.db) is created
   automatically on first run, with demo data seeded.
   Requires Node.js 22.5+ (uses the built-in node:sqlite).
   ============================================================ */

const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 5)) {
  console.error(`\n✖ Life Drop Saver needs Node.js 22.5 or newer (you have ${process.versions.node}).`);
  console.error("  Download the latest LTS from https://nodejs.org and try again.\n");
  process.exit(1);
}

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const PORT = process.env.PORT || 3000;

fs.mkdirSync(path.join(__dirname, "db"), { recursive: true });
fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });

const db = new DatabaseSync(path.join(__dirname, "db", "lifedropsaver.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

/* ---------------- schema ---------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS donors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, father TEXT NOT NULL,
  cnic TEXT NOT NULL UNIQUE, dob TEXT NOT NULL, gender TEXT NOT NULL,
  blood_group TEXT NOT NULL, weight REAL NOT NULL,
  phone TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL, address TEXT NOT NULL,
  last_donation TEXT,
  pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (date('now'))
);
CREATE TABLE IF NOT EXISTS hospitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, type TEXT NOT NULL,
  lic TEXT NOT NULL, bblic TEXT NOT NULL,
  phone TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL, address TEXT NOT NULL,
  contact TEXT NOT NULL, desig TEXT NOT NULL, cnic TEXT NOT NULL,
  thal TEXT NOT NULL DEFAULT 'Yes',
  pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (date('now'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_role TEXT NOT NULL CHECK(owner_role IN ('donor','hospital')),
  owner_id INTEGER NOT NULL,
  doc_name TEXT NOT NULL,          -- e.g. 'CNIC (front)'
  original_name TEXT NOT NULL,     -- file name the user uploaded
  stored_name TEXT NOT NULL,       -- file name on disk in /uploads
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_id INTEGER NOT NULL REFERENCES donors(id),
  hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
  date TEXT NOT NULL,
  blood_group TEXT NOT NULL,
  volume TEXT NOT NULL,
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_id INTEGER NOT NULL REFERENCES donors(id),
  hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','completed','cancelled'))
);
CREATE TABLE IF NOT EXISTS inventory (
  hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
  blood_group TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hospital_id, blood_group)
);
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
  blood_group TEXT NOT NULL,
  message TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (date('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* ---------------- helpers ---------------- */
const BG = ["A+","A-","B+","B-","AB+","AB-","O+","O-"];
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");
const newSalt = () => crypto.randomBytes(16).toString("hex");
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0,10); };
const today = () => new Date().toISOString().slice(0,10);
const cnicOK = v => /^\d{13}$/.test(String(v||"").replace(/-/g,""));

function seedInventory(hospId, values) {
  const ins = db.prepare("INSERT OR IGNORE INTO inventory (hospital_id, blood_group, units) VALUES (?,?,?)");
  BG.forEach(g => ins.run(hospId, g, values ? (values[g] ?? 0) : 0));
}

/* ---------------- seed demo data (first run only) ---------------- */
if (db.prepare("SELECT COUNT(*) c FROM donors").get().c === 0) {
  console.log("• Seeding demo data (first run)…");
  const s1 = newSalt();
  const donorId = db.prepare(`INSERT INTO donors
    (name,father,cnic,dob,gender,blood_group,weight,phone,email,city,address,last_donation,pass_hash,salt,verified)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
    .run("Ali Raza","Muhammad Akram","35202-1234567-1","1999-04-12","Male","B+",70,
         "0300-1234567","ali@donor.pk","Lahore","House 12, Model Town",daysAgo(120),hash("demo123",s1),s1).lastInsertRowid;

  const hosp = db.prepare(`INSERT INTO hospitals
    (name,type,lic,bblic,phone,email,city,address,contact,desig,cnic,thal,pass_hash,salt,verified)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);
  const s2 = newSalt(), s3 = newSalt(), s4 = newSalt();
  const h1 = hosp.run("Sundas Foundation","Thalassemia centre","PHC-LHR-00812","PBTA-BB-0093","042-35761976",
    "staff@sundas.pk","Lahore","Main Boulevard, Gulberg III","Dr. Sana Malik","Blood Bank Incharge","35201-7654321-2","Yes",hash("demo123",s2),s2).lastInsertRowid;
  const h2 = hosp.run("Riphah International Hospital","Private hospital","PHC-LHR-01440","PBTA-BB-0121","042-111747424",
    "bloodbank@riphah.pk","Lahore","Raiwind Road","Dr. Usman Tariq","Pathology Head","35202-1112223-3","Yes",hash("demo123",s3),s3).lastInsertRowid;
  const h3 = hosp.run("Jinnah Hospital Blood Bank","Government hospital","PHC-LHR-00021","PBTA-BB-0007","042-99231400",
    "bb@jinnah.gop.pk","Lahore","Allama Shabbir Ahmed Usmani Road","Dr. Hina Aslam","Transfusion Officer","35200-9998887-4","Yes",hash("demo123",s4),s4).lastInsertRowid;

  seedInventory(h1, {"A+":6,"A-":2,"B+":9,"B-":1,"AB+":3,"AB-":0,"O+":7,"O-":2});
  seedInventory(h2, {"A+":4,"A-":1,"B+":5,"B-":2,"AB+":2,"AB-":1,"O+":6,"O-":1});
  seedInventory(h3, {"A+":10,"A-":3,"B+":8,"B-":2,"AB+":4,"AB-":1,"O+":12,"O-":3});

  const don = db.prepare("INSERT INTO donations (donor_id,hospital_id,date,blood_group,volume,notes) VALUES (?,?,?,?,?,?)");
  don.run(donorId,h1,daysAgo(320),"B+","450 ml (1 unit)","");
  don.run(donorId,h2,daysAgo(215),"B+","450 ml (1 unit)","");
  don.run(donorId,h1,daysAgo(120),"B+","450 ml (1 unit)","Thalassemia ward");

  const docd = db.prepare("INSERT INTO documents (owner_role,owner_id,doc_name,original_name,stored_name) VALUES (?,?,?,?,?)");
  ["CNIC (front)|cnic_front.jpg","CNIC (back)|cnic_back.jpg","Photo|photo.jpg","Medical report|cbc_report.pdf"]
    .forEach(x => { const [n,f] = x.split("|"); docd.run("donor",donorId,n,f,"demo-"+f); });
  [[h1,"staff"],[h2,"riphah"],[h3,"jinnah"]].forEach(([h,tag]) => {
    ["PHC licence|phc_licence.pdf","Blood bank licence|bb_licence.pdf","Authorisation letter|auth_letter.pdf","Contact CNIC|cnic.jpg"]
      .forEach(x => { const [n,f] = x.split("|"); docd.run("hospital",h,n,f,`demo-${tag}-${f}`); });
  });

  db.prepare("INSERT INTO broadcasts (hospital_id,blood_group,message,at) VALUES (?,?,?,?)")
    .run(h1,"B+","B+ blood needed this week for a Thalassemia patient's scheduled transfusion.",daysAgo(1));
}

/* ---------------- middleware ---------------- */
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, "uploads"),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
      cb(null, Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "-" + safe);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpg|jpeg|png|pdf)$/i.test(file.originalname);
    cb(ok ? null : new Error("Only JPG, PNG, or PDF files are allowed"), ok);
  }
});

function auth(role) {
  return (req, res, next) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const s = token && db.prepare("SELECT * FROM sessions WHERE token=?").get(token);
    if (!s) return res.status(401).json({ error: "Please log in again." });
    if (role && s.role !== role) return res.status(403).json({ error: "Wrong portal for this action." });
    req.user = { role: s.role, id: s.user_id };
    next();
  };
}

const eligibility = last => {
  if (!last) return { ok: true, text: "Eligible now", days: 0 };
  const diff = Math.floor((new Date(today()) - new Date(last)) / 86400000);
  return diff >= 90 ? { ok: true, text: "Eligible now", days: 0 }
                    : { ok: false, text: `Eligible in ${90 - diff} days`, days: 90 - diff };
};
const docsOf = (role, id) =>
  db.prepare("SELECT doc_name AS n, original_name AS f, stored_name AS url FROM documents WHERE owner_role=? AND owner_id=?").all(role, id)
    .map(d => ({ n: d.n, f: d.f, url: d.url.startsWith("demo-") ? null : "/uploads/" + d.url }));
const lastDonationOf = donorId => {
  const r = db.prepare("SELECT MAX(date) d FROM donations WHERE donor_id=?").get(donorId);
  const donor = db.prepare("SELECT last_donation FROM donors WHERE id=?").get(donorId);
  return r.d || donor.last_donation || null;
};

/* ---------------- auth routes ---------------- */
app.post("/api/register/donor", upload.fields([
  { name: "cnic_front", maxCount: 1 }, { name: "cnic_back", maxCount: 1 },
  { name: "photo", maxCount: 1 }, { name: "medical_report", maxCount: 1 }
]), (req, res) => {
  try {
    const b = req.body;
    const need = ["name","father","cnic","dob","gender","blood_group","weight","phone","email","city","address","password"];
    for (const k of need) if (!String(b[k] || "").trim()) return res.status(400).json({ error: `Missing field: ${k}` });
    if (!cnicOK(b.cnic)) return res.status(400).json({ error: "CNIC must be 13 digits." });
    const age = Math.floor((new Date() - new Date(b.dob)) / 3.15576e10);
    if (age < 18 || age > 60) return res.status(400).json({ error: "Donors must be between 18 and 60 years old." });
    if (+b.weight < 50) return res.status(400).json({ error: "Minimum weight to donate is 50 kg." });
    if (String(b.password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    if ((b.health_flags || "").match(/Hepatitis|HIV/i))
      return res.status(400).json({ error: "For patient safety, donors reporting Hepatitis or HIV cannot be registered for donation." });
    const f = req.files || {};
    if (!f.cnic_front || !f.cnic_back || !f.photo)
      return res.status(400).json({ error: "CNIC front, CNIC back, and a photo are required." });
    const email = b.email.trim().toLowerCase();
    if (db.prepare("SELECT id FROM donors WHERE email=?").get(email)) return res.status(409).json({ error: "An account with this email already exists — try logging in." });
    if (db.prepare("SELECT id FROM donors WHERE replace(cnic,'-','')=?").get(b.cnic.replace(/-/g,""))) return res.status(409).json({ error: "A donor with this CNIC is already registered." });

    const salt = newSalt();
    const id = db.prepare(`INSERT INTO donors
      (name,father,cnic,dob,gender,blood_group,weight,phone,email,city,address,last_donation,pass_hash,salt,verified)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
      .run(b.name.trim(), b.father.trim(), b.cnic.trim(), b.dob, b.gender, b.blood_group, +b.weight,
           b.phone.trim(), email, b.city.trim(), b.address.trim(), b.last_donation || null, hash(b.password, salt), salt).lastInsertRowid;

    const docIns = db.prepare("INSERT INTO documents (owner_role,owner_id,doc_name,original_name,stored_name) VALUES ('donor',?,?,?,?)");
    const map = { cnic_front: "CNIC (front)", cnic_back: "CNIC (back)", photo: "Photo", medical_report: "Medical report" };
    for (const [field, label] of Object.entries(map))
      if (f[field]) docIns.run(id, label, f[field][0].originalname, f[field][0].filename);

    const token = crypto.randomBytes(24).toString("hex");
    db.prepare("INSERT INTO sessions (token,role,user_id) VALUES (?,?,?)").run(token, "donor", id);
    res.json({ token, role: "donor", name: b.name.trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/register/hospital", upload.fields([
  { name: "phc_licence", maxCount: 1 }, { name: "bb_licence", maxCount: 1 },
  { name: "auth_letter", maxCount: 1 }, { name: "contact_cnic", maxCount: 1 }
]), (req, res) => {
  try {
    const b = req.body;
    const need = ["name","type","lic","bblic","phone","email","city","address","contact","desig","cnic","password"];
    for (const k of need) if (!String(b[k] || "").trim()) return res.status(400).json({ error: `Missing field: ${k}` });
    if (!cnicOK(b.cnic)) return res.status(400).json({ error: "Contact person CNIC must be 13 digits." });
    if (String(b.password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    const f = req.files || {};
    if (!f.phc_licence || !f.bb_licence || !f.auth_letter || !f.contact_cnic)
      return res.status(400).json({ error: "All four verification documents are required." });
    const email = b.email.trim().toLowerCase();
    if (db.prepare("SELECT id FROM hospitals WHERE email=?").get(email)) return res.status(409).json({ error: "A hospital account with this email already exists." });

    const salt = newSalt();
    const id = db.prepare(`INSERT INTO hospitals
      (name,type,lic,bblic,phone,email,city,address,contact,desig,cnic,thal,pass_hash,salt,verified)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`)
      .run(b.name.trim(), b.type, b.lic.trim(), b.bblic.trim(), b.phone.trim(), email, b.city.trim(),
           b.address.trim(), b.contact.trim(), b.desig.trim(), b.cnic.trim(), b.thal || "Yes", hash(b.password, salt), salt).lastInsertRowid;
    seedInventory(id);

    const docIns = db.prepare("INSERT INTO documents (owner_role,owner_id,doc_name,original_name,stored_name) VALUES ('hospital',?,?,?,?)");
    const map = { phc_licence: "PHC licence", bb_licence: "Blood bank licence", auth_letter: "Authorisation letter", contact_cnic: "Contact CNIC" };
    for (const [field, label] of Object.entries(map)) docIns.run(id, label, f[field][0].originalname, f[field][0].filename);

    const token = crypto.randomBytes(24).toString("hex");
    db.prepare("INSERT INTO sessions (token,role,user_id) VALUES (?,?,?)").run(token, "hospital", id);
    res.json({ token, role: "hospital", name: b.name.trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/login", (req, res) => {
  const { role, email, password } = req.body || {};
  if (!["donor","hospital"].includes(role)) return res.status(400).json({ error: "Invalid role." });
  const table = role === "donor" ? "donors" : "hospitals";
  const acc = db.prepare(`SELECT * FROM ${table} WHERE email=?`).get(String(email || "").trim().toLowerCase());
  if (!acc || hash(String(password || ""), acc.salt) !== acc.pass_hash)
    return res.status(401).json({ error: "Incorrect email or password for the selected portal." });
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token,role,user_id) VALUES (?,?,?)").run(token, role, acc.id);
  res.json({ token, role, name: acc.name });
});

app.post("/api/logout", auth(), (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  db.prepare("DELETE FROM sessions WHERE token=?").run(token);
  res.json({ ok: true });
});

/* ---------------- donor routes ---------------- */
app.get("/api/donor/dashboard", auth("donor"), (req, res) => {
  const d = db.prepare("SELECT * FROM donors WHERE id=?").get(req.user.id);
  const donations = db.prepare(`SELECT dn.*, h.name hospital FROM donations dn JOIN hospitals h ON h.id=dn.hospital_id
                                WHERE dn.donor_id=? ORDER BY dn.date DESC`).all(d.id);
  const appts = db.prepare(`SELECT a.*, h.name hospital FROM appointments a JOIN hospitals h ON h.id=a.hospital_id
                            WHERE a.donor_id=? AND a.status='booked' ORDER BY a.date`).all(d.id);
  const broadcasts = db.prepare(`SELECT b.*, h.name hospital FROM broadcasts b JOIN hospitals h ON h.id=b.hospital_id
                                 WHERE b.blood_group IN ('Any group', ?) ORDER BY b.id DESC LIMIT 3`).all(d.blood_group);
  const last = lastDonationOf(d.id);
  delete d.pass_hash; delete d.salt;
  res.json({ profile: d, donations, appointments: appts, broadcasts,
             docs: docsOf("donor", d.id), eligibility: eligibility(last), lastDonation: last });
});

app.get("/api/hospitals", auth(), (req, res) => {
  const rows = db.prepare("SELECT id,name,type,address,city,thal FROM hospitals WHERE verified=1").all();
  rows.forEach(h => h.stock = db.prepare("SELECT COALESCE(SUM(units),0) s FROM inventory WHERE hospital_id=?").get(h.id).s);
  res.json(rows);
});

app.post("/api/appointments", auth("donor"), (req, res) => {
  const { hospital_id, date } = req.body || {};
  const h = db.prepare("SELECT id,name FROM hospitals WHERE id=? AND verified=1").get(hospital_id);
  if (!h) return res.status(404).json({ error: "Hospital not found." });
  if (!date || date < today()) return res.status(400).json({ error: "Pick today or a future date." });
  const el = eligibility(lastDonationOf(req.user.id));
  if (!el.ok) return res.status(400).json({ error: `You'll be eligible again in ${el.days} days (90-day gap between donations).` });
  db.prepare("INSERT INTO appointments (donor_id,hospital_id,date) VALUES (?,?,?)").run(req.user.id, hospital_id, date);
  res.json({ ok: true, hospital: h.name });
});

/* ---------------- hospital routes ---------------- */
app.get("/api/hospital/dashboard", auth("hospital"), (req, res) => {
  const h = db.prepare("SELECT * FROM hospitals WHERE id=?").get(req.user.id);
  delete h.pass_hash; delete h.salt;
  const stats = {
    donations: db.prepare("SELECT COUNT(*) c FROM donations WHERE hospital_id=?").get(h.id).c,
    donors: db.prepare("SELECT COUNT(DISTINCT donor_id) c FROM donations WHERE hospital_id=?").get(h.id).c,
    pending: db.prepare("SELECT COUNT(*) c FROM appointments WHERE hospital_id=? AND status='booked'").get(h.id).c,
    units: db.prepare("SELECT COALESCE(SUM(units),0) s FROM inventory WHERE hospital_id=?").get(h.id).s
  };
  const appts = db.prepare(`SELECT a.id, a.date, d.id donor_id, d.name, d.cnic, d.blood_group,
      (SELECT COUNT(*) FROM donations WHERE donor_id=d.id) prior
      FROM appointments a JOIN donors d ON d.id=a.donor_id
      WHERE a.hospital_id=? AND a.status='booked' ORDER BY a.date`).all(h.id);
  const inventory = Object.fromEntries(db.prepare("SELECT blood_group,units FROM inventory WHERE hospital_id=?").all(h.id).map(r => [r.blood_group, r.units]));
  const broadcasts = db.prepare("SELECT * FROM broadcasts WHERE hospital_id=? ORDER BY id DESC LIMIT 3").all(h.id);
  res.json({ hospital: h, stats, appointments: appts, inventory, broadcasts });
});

app.get("/api/donors", auth("hospital"), (req, res) => {
  const q = String(req.query.q || "").toLowerCase().replace(/-/g, "");
  const bg = req.query.bg && req.query.bg !== "All groups" ? req.query.bg : null;
  let rows = db.prepare(`SELECT id,name,cnic,blood_group,phone,verified,last_donation FROM donors`).all();
  rows = rows.filter(d =>
    (!bg || d.blood_group === bg) &&
    (!q || d.name.toLowerCase().includes(q) || d.cnic.replace(/-/g, "").includes(q)));
  rows.forEach(d => {
    d.total = db.prepare("SELECT COUNT(*) c FROM donations WHERE donor_id=?").get(d.id).c;
    d.last = lastDonationOf(d.id);
    d.eligible = eligibility(d.last).ok;
    delete d.last_donation;
  });
  res.json(rows);
});

app.get("/api/donors/:id/docs", auth("hospital"), (req, res) => {
  const d = db.prepare("SELECT id,name,cnic,dob,blood_group,weight FROM donors WHERE id=?").get(req.params.id);
  if (!d) return res.status(404).json({ error: "Donor not found." });
  const last = lastDonationOf(d.id);
  res.json({ donor: d, docs: docsOf("donor", d.id), eligibility: eligibility(last), last });
});

app.post("/api/donations", auth("hospital"), (req, res) => {
  const h = db.prepare("SELECT verified,name FROM hospitals WHERE id=?").get(req.user.id);
  if (!h.verified) return res.status(403).json({ error: "Donation recording is locked until your hospital is verified." });
  const { donor_id, date, blood_group, volume, notes, appointment_id } = req.body || {};
  const d = db.prepare("SELECT id,name FROM donors WHERE id=?").get(donor_id);
  if (!d) return res.status(404).json({ error: "Donor not found." });
  if (!BG.includes(blood_group)) return res.status(400).json({ error: "Invalid blood group." });
  const dt = date || today();
  db.prepare("INSERT INTO donations (donor_id,hospital_id,date,blood_group,volume,notes) VALUES (?,?,?,?,?,?)")
    .run(d.id, req.user.id, dt, blood_group, volume || "450 ml (1 unit)", notes || "");
  db.prepare("UPDATE donors SET last_donation=? WHERE id=?").run(dt, d.id);
  db.prepare("UPDATE inventory SET units=units+1 WHERE hospital_id=? AND blood_group=?").run(req.user.id, blood_group);
  if (appointment_id) db.prepare("UPDATE appointments SET status='completed' WHERE id=? AND hospital_id=?").run(appointment_id, req.user.id);
  const total = db.prepare("SELECT COUNT(*) c FROM donations WHERE donor_id=?").get(d.id).c;
  res.json({ ok: true, donor: d.name, total, rewardUnlocked: total % 4 === 0 });
});

app.post("/api/appointments/:id/cancel", auth("hospital"), (req, res) => {
  db.prepare("UPDATE appointments SET status='cancelled' WHERE id=? AND hospital_id=?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.post("/api/broadcasts", auth("hospital"), (req, res) => {
  const { blood_group, message } = req.body || {};
  if (!String(message || "").trim()) return res.status(400).json({ error: "Write a short message first." });
  db.prepare("INSERT INTO broadcasts (hospital_id,blood_group,message) VALUES (?,?,?)")
    .run(req.user.id, blood_group || "Any group", message.trim());
  res.json({ ok: true });
});

/* Demo helper: simulate admin approval of a hospital */
app.post("/api/hospital/simulate-approve", auth("hospital"), (req, res) => {
  db.prepare("UPDATE hospitals SET verified=1 WHERE id=?").run(req.user.id);
  res.json({ ok: true });
});

/* multer / generic error handler */
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

app.listen(PORT, () => {
  console.log("┌──────────────────────────────────────────────┐");
  console.log("│  🩸 Life Drop Saver server is running        │");
  console.log(`│  Open:  http://localhost:${PORT}                │`);
  console.log("│  DB:    db/lifedropsaver.db (auto-created)   │");
  console.log("└──────────────────────────────────────────────┘");
});
