# 🩸 Life Drop Saver — Website + Database

A blood-donation platform connecting donors and hospitals, with a core mission of
supporting Thalassemia patients. Now with a **real SQLite database** — accounts,
donations, appointments, documents, and inventory all persist permanently.

## How to run (2 steps)

You need **Node.js 22.5 or newer** → download from https://nodejs.org (choose LTS).

Open a terminal / command prompt inside this folder, then:

```bash
npm install        # step 1 — installs Express & Multer (first time only)
node server.js     # step 2 — starts the website + database
```

Then open **http://localhost:3000** in your browser. That's it.

- The database file is created automatically at `db/lifedropsaver.db` on first run,
  with demo data seeded.
- Uploaded documents (CNIC scans, licences, etc.) are saved in the `uploads/` folder.
- Stop the server with `Ctrl + C`. Your data stays saved.

## Demo accounts

| Portal   | Email             | Password |
|----------|-------------------|----------|
| Donor    | ali@donor.pk      | demo123  |
| Hospital | staff@sundas.pk   | demo123  |

(Also seeded: `bloodbank@riphah.pk` and `bb@jinnah.gop.pk`, same password.)

## What's inside

```
lifedropsaver/
├── server.js          ← backend: Express API + SQLite database + file uploads
├── public/index.html  ← the website (talks to the API with fetch)
├── db/                ← lifedropsaver.db is auto-created here
├── uploads/           ← verification documents are stored here
└── package.json
```

## Database tables

| Table         | Stores                                                     |
|---------------|------------------------------------------------------------|
| donors        | Donor profiles (CNIC, blood group, hashed password, …)     |
| hospitals     | Hospital accounts (licences, contact person, verified flag)|
| documents     | Every uploaded verification file, linked to its owner      |
| donations     | Each donation: donor, hospital, date, group, volume        |
| appointments  | Donor bookings (booked / completed / cancelled)            |
| inventory     | Units in stock per hospital per blood group                |
| broadcasts    | Urgent blood requests sent by hospitals                    |
| sessions      | Login tokens                                               |

## Security notes (already handled)

- Passwords are **hashed with scrypt + per-user salt** — never stored as plain text.
- Login uses **bearer tokens** stored in the sessions table.
- Uploads are limited to **JPG / PNG / PDF, max 5 MB**, with sanitised file names.
- Server re-validates everything the browser checks (age 18–60, weight ≥ 50 kg,
  13-digit CNIC, 90-day donation gap, duplicate email/CNIC, Hepatitis/HIV screening).

## Handy commands

```bash
# Reset to a fresh database (demo data re-seeds on next start)
# Windows:  del db\lifedropsaver.db*     Mac/Linux:
rm db/lifedropsaver.db*

# Run on a different port
PORT=4000 node server.js
```

## Ideas for your next iteration

- Admin panel to approve hospitals (currently a "Simulate approval" demo button)
- Email/SMS notifications for broadcasts and eligibility reminders
- Move to MySQL/PostgreSQL for multi-server deployment — the schema transfers directly
