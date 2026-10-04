const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = process.env.STUDY_PLANNER_DB || path.join(__dirname, "studyplanner.db");
const db = new Database(dbPath);
const configuredPublicUrl = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : "";

app.set("trust proxy", 1);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TEXT NOT NULL DEFAULT '',
    due_time TEXT NOT NULL DEFAULT '',
    topic TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    recurrence TEXT NOT NULL DEFAULT 'none',
    series_id TEXT NOT NULL DEFAULT '',
    recurrence_next_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subjects (
    name TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL,
    due_time TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS study_sessions (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL DEFAULT '',
    duration_minutes INTEGER NOT NULL,
    studied_on TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    weekly_goal_minutes INTEGER NOT NULL DEFAULT 600
  );
  INSERT OR IGNORE INTO notes (id, content, updated_at)
    VALUES (1, '', CURRENT_TIMESTAMP);
  INSERT OR IGNORE INTO settings (id, weekly_goal_minutes) VALUES (1, 600);
`);

const existingTaskColumns = new Set(
  db.prepare("PRAGMA table_info(tasks)").all().map((column) => column.name)
);
const taskMigrations = [
  ["topic", "TEXT NOT NULL DEFAULT ''"],
  ["recurrence", "TEXT NOT NULL DEFAULT 'none'"],
  ["series_id", "TEXT NOT NULL DEFAULT ''"],
  ["recurrence_next_id", "TEXT NOT NULL DEFAULT ''"]
];

for (const [name, definition] of taskMigrations) {
  if (!existingTaskColumns.has(name)) {
    db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`);
  }
}

db.exec(`
  INSERT OR IGNORE INTO subjects (name)
  SELECT DISTINCT subject FROM tasks WHERE TRIM(subject) <> '';
`);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const taskColumns = `
  id, title, subject, priority, due_date AS date, due_time AS time,
  topic, details, completed, recurrence, series_id AS seriesId,
  created_at AS createdAt, updated_at AS updatedAt
`;

function taskOut(row) {
  return {
    ...row,
    completed: Boolean(row.completed)
  };
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function cleanTask(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Task data must be an object." };
  }

  const title = String(body.title || "").trim();
  if (!title) return { error: "Task title is required." };
  if (title.length > 120) return { error: "Title must be 120 characters or fewer." };

  const date = String(body.date || "");
  if (date && !isDate(date)) return { error: "Enter a valid due date." };

  const time = String(body.time || "");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return { error: "Enter a valid study time." };
  }

  const recurrence = ["none", "daily", "weekly", "monthly"].includes(body.recurrence)
    ? body.recurrence
    : "none";

  return {
    task: {
      title,
      subject: String(body.subject || "").trim().slice(0, 60),
      priority: ["low", "medium", "high"].includes(body.priority) ? body.priority : "medium",
      date,
      time,
      topic: String(body.topic || "").trim().slice(0, 80),
      details: String(body.details || "").trim().slice(0, 500),
      completed: body.completed ? 1 : 0,
      recurrence
    }
  };
}

function shiftDate(date, recurrence) {
  if (!date || recurrence === "none") return "";
  const [year, month, day] = date.split("-").map(Number);
  if (recurrence === "daily") {
    return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  }
  if (recurrence === "weekly") {
    return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  }

  const targetMonth = month;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

function addTask(task, id = crypto.randomUUID(), seriesId = id) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO tasks (
      id, title, subject, priority, due_date, due_time, topic, details,
      completed, recurrence, series_id, created_at, updated_at
    ) VALUES (
      @id, @title, @subject, @priority, @date, @time, @topic, @details,
      @completed, @recurrence, @seriesId, @now, @now
    )
  `).run({ ...task, id, seriesId, now });
  return taskOut(db.prepare(`SELECT ${taskColumns} FROM tasks WHERE id = ?`).get(id));
}

function cleanExam(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Exam data must be an object." };
  }
  const title = String(body.title || "").trim();
  const date = String(body.date || "");
  if (!title) return { error: "Exam title is required." };
  if (title.length > 120) return { error: "Exam title must be 120 characters or fewer." };
  if (!isDate(date)) return { error: "Enter a valid exam date." };
  const time = String(body.time || "");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return { error: "Enter a valid exam time." };
  }
  return {
    exam: {
      title,
      subject: String(body.subject || "").trim().slice(0, 60),
      date,
      time,
      details: String(body.details || "").trim().slice(0, 500)
    }
  };
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "Offline Study Planner API" });
});

app.get("/robots.txt", (req, res) => {
  const origin = configuredPublicUrl || `${req.protocol}://${req.get("host")}`;
  res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
});

app.get("/sitemap.xml", (req, res) => {
  const origin = configuredPublicUrl || `${req.protocol}://${req.get("host")}`;
  const escapeXml = (value) => value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;"
  })[character]);
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${escapeXml(`${origin}/`)}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>`);
});

app.get("/api/tasks", (_req, res) => {
  const tasks = db.prepare(`
    SELECT ${taskColumns} FROM tasks
    ORDER BY completed ASC, CASE WHEN due_date = '' THEN 1 ELSE 0 END,
      due_date ASC, due_time ASC, created_at DESC
  `).all();
  res.json(tasks.map(taskOut));
});

app.post("/api/tasks", (req, res) => {
  const result = cleanTask(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const task = addTask(result.task);
  if (task.subject) {
    db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES (?)").run(task.subject);
  }
  return res.status(201).json(task);
});

app.put("/api/tasks/:id", (req, res) => {
  const previous = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!previous) return res.status(404).json({ error: "Task not found." });
  const result = cleanTask(req.body);
  if (result.error) return res.status(400).json({ error: result.error });

  const updatedAt = new Date().toISOString();
  const update = db.transaction(() => {
    db.prepare(`
      UPDATE tasks SET title = @title, subject = @subject, priority = @priority,
        due_date = @date, due_time = @time, topic = @topic, details = @details,
        completed = @completed, recurrence = @recurrence, updated_at = @updatedAt
      WHERE id = @id
    `).run({ ...result.task, id: req.params.id, updatedAt });

    if (
      !previous.completed
      && result.task.completed
      && result.task.recurrence !== "none"
      && !previous.recurrence_next_id
    ) {
      const nextId = crypto.randomUUID();
      const nextTask = {
        ...result.task,
        date: shiftDate(result.task.date, result.task.recurrence),
        completed: 0
      };
      addTask(nextTask, nextId, previous.series_id || previous.id);
      db.prepare("UPDATE tasks SET recurrence_next_id = ? WHERE id = ?")
        .run(nextId, req.params.id);
    }
  });
  update();

  const task = taskOut(db.prepare(`SELECT ${taskColumns} FROM tasks WHERE id = ?`).get(req.params.id));
  if (task.subject) {
    db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES (?)").run(task.subject);
  }
  return res.json(task);
});

app.delete("/api/tasks/:id", (req, res) => {
  const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Task not found." });
  return res.status(204).end();
});

app.get("/api/notes", (_req, res) => {
  const note = db.prepare("SELECT content, updated_at AS updatedAt FROM notes WHERE id = 1").get();
  res.json(note);
});

app.put("/api/notes", (req, res) => {
  if (typeof req.body?.content !== "string") {
    return res.status(400).json({ error: "Note content must be text." });
  }
  const content = req.body.content.slice(0, 10000);
  const updatedAt = new Date().toISOString();
  db.prepare("UPDATE notes SET content = ?, updated_at = ? WHERE id = 1")
    .run(content, updatedAt);
  return res.json({ content, updatedAt });
});

app.get("/api/subjects", (_req, res) => {
  res.json(db.prepare("SELECT name FROM subjects ORDER BY name COLLATE NOCASE").all().map((row) => row.name));
});

app.post("/api/subjects", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Subject name is required." });
  if (name.length > 60) return res.status(400).json({ error: "Subject names must be 60 characters or fewer." });
  db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES (?)").run(name);
  return res.status(201).json({ name });
});

app.delete("/api/subjects/:name", (req, res) => {
  const result = db.prepare("DELETE FROM subjects WHERE name = ?").run(req.params.name);
  if (!result.changes) return res.status(404).json({ error: "Subject not found." });
  return res.status(204).end();
});

app.get("/api/exams", (_req, res) => {
  res.json(db.prepare(`
    SELECT id, title, subject, due_date AS date, due_time AS time, details
    FROM exams ORDER BY due_date ASC, due_time ASC
  `).all());
});

app.post("/api/exams", (req, res) => {
  const result = cleanExam(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const exam = { id: crypto.randomUUID(), ...result.exam };
  db.prepare(`
    INSERT INTO exams (id, title, subject, due_date, due_time, details, created_at)
    VALUES (@id, @title, @subject, @date, @time, @details, @createdAt)
  `).run({ ...exam, createdAt: new Date().toISOString() });
  if (exam.subject) {
    db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES (?)").run(exam.subject);
  }
  return res.status(201).json(exam);
});

app.put("/api/exams/:id", (req, res) => {
  const result = cleanExam(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const update = db.prepare(`
    UPDATE exams SET title = @title, subject = @subject, due_date = @date,
      due_time = @time, details = @details WHERE id = @id
  `).run({ ...result.exam, id: req.params.id });
  if (!update.changes) return res.status(404).json({ error: "Exam not found." });
  if (result.exam.subject) {
    db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES (?)").run(result.exam.subject);
  }
  return res.json({ id: req.params.id, ...result.exam });
});

app.delete("/api/exams/:id", (req, res) => {
  const result = db.prepare("DELETE FROM exams WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Exam not found." });
  return res.status(204).end();
});

app.get("/api/sessions", (_req, res) => {
  res.json(db.prepare(`
    SELECT id, subject, duration_minutes AS durationMinutes, studied_on AS date
    FROM study_sessions ORDER BY studied_on DESC, created_at DESC
  `).all());
});

app.post("/api/sessions", (req, res) => {
  const durationMinutes = Number(req.body?.durationMinutes);
  const date = String(req.body?.date || todayKey());
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    return res.status(400).json({ error: "Study sessions must be between 1 minute and 24 hours." });
  }
  if (!isDate(date)) return res.status(400).json({ error: "Enter a valid session date." });
  const session = {
    id: crypto.randomUUID(),
    subject: String(req.body?.subject || "").trim().slice(0, 60),
    durationMinutes,
    date
  };
  db.prepare(`
    INSERT INTO study_sessions (id, subject, duration_minutes, studied_on, created_at)
    VALUES (@id, @subject, @durationMinutes, @date, @createdAt)
  `).run({ ...session, createdAt: new Date().toISOString() });
  return res.status(201).json(session);
});

app.get("/api/settings", (_req, res) => {
  const settings = db.prepare(`
    SELECT weekly_goal_minutes AS weeklyGoalMinutes FROM settings WHERE id = 1
  `).get();
  res.json(settings);
});

app.put("/api/settings", (req, res) => {
  const weeklyGoalMinutes = Number(req.body?.weeklyGoalMinutes);
  if (!Number.isInteger(weeklyGoalMinutes) || weeklyGoalMinutes < 60 || weeklyGoalMinutes > 10080) {
    return res.status(400).json({ error: "Weekly goal must be between 1 and 168 hours." });
  }
  db.prepare("UPDATE settings SET weekly_goal_minutes = ? WHERE id = 1")
    .run(weeklyGoalMinutes);
  return res.json({ weeklyGoalMinutes });
});

app.get("/api/reports", (_req, res) => {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_value, index) => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    return { date, minutes: 0 };
  });
  const start = days[0].date;
  const end = days[6].date;
  const totals = db.prepare(`
    SELECT studied_on AS date, SUM(duration_minutes) AS minutes
    FROM study_sessions WHERE studied_on BETWEEN ? AND ? GROUP BY studied_on
  `).all(start, end);
  const totalsByDate = new Map(totals.map((row) => [row.date, row.minutes]));
  days.forEach((day) => { day.minutes = totalsByDate.get(day.date) || 0; });

  const studiedDates = new Set(db.prepare(`
    SELECT DISTINCT studied_on AS date FROM study_sessions
    ORDER BY studied_on DESC
  `).all().map((row) => row.date));
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let streak = 0;
  const yesterday = new Date(cursor);
  yesterday.setDate(yesterday.getDate() - 1);
  const keyFor = (day) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  if (!studiedDates.has(keyFor(cursor))) cursor = yesterday;
  while (studiedDates.has(keyFor(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const goal = db.prepare("SELECT weekly_goal_minutes AS minutes FROM settings WHERE id = 1").get().minutes;
  const weeklyMinutes = days.reduce((total, day) => total + day.minutes, 0);
  res.json({
    days,
    streak,
    weeklyMinutes,
    weeklyGoalMinutes: goal,
    upcomingExams: db.prepare("SELECT COUNT(*) AS count FROM exams WHERE due_date >= ?").get(todayKey()).count
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Offline Study Planner running at http://localhost:${PORT}`);
});
