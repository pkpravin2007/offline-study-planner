const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const { cleanMaterial, cleanChecklistItem, cleanQuestion, cleanFlashcard, scoreQuiz } = require("./study-materials");
const { analyzeStudyActivity } = require("./aiStudyMonitor");

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
    topic_id TEXT NOT NULL DEFAULT '',
    duration_minutes INTEGER NOT NULL,
    studied_on TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS syllabus_chapters (
    id TEXT PRIMARY KEY,
    subject_name TEXT NOT NULL REFERENCES subjects(name) ON UPDATE CASCADE ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS syllabus_topics (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES syllabus_chapters(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started'
      CHECK (status IN ('not_started', 'in_progress', 'completed')),
    needs_revision INTEGER NOT NULL DEFAULT 0 CHECK (needs_revision IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS revision_history (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
    needs_revision INTEGER NOT NULL CHECK (needs_revision IN (0, 1)),
    changed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_revision_history_topic_date
    ON revision_history(topic_id, changed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_revision_history_date
    ON revision_history(changed_at DESC);
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    weekly_goal_minutes INTEGER NOT NULL DEFAULT 600
  );
  CREATE TABLE IF NOT EXISTS student_profiles (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    education_level TEXT NOT NULL CHECK (education_level IN ('school', 'college')),
    class_level INTEGER,
    course TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    year_of_study INTEGER,
    semester INTEGER,
    available_minutes_per_day INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS study_plan_items (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    topic TEXT NOT NULL,
    topic_id TEXT NOT NULL DEFAULT '',
    chapter TEXT NOT NULL DEFAULT '',
    scheduled_date TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
    kind TEXT NOT NULL CHECK (kind IN ('study', 'revision')),
    exam_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'skipped')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS study_plan_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fingerprint TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days INTEGER NOT NULL,
    block_minutes INTEGER NOT NULL DEFAULT 30,
    daily_minutes INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS study_materials (
    id TEXT PRIMARY KEY,
    education_level TEXT NOT NULL CHECK (education_level IN ('school', 'college')),
    class_level INTEGER,
    course TEXT NOT NULL DEFAULT '',
    semester INTEGER,
    subject TEXT NOT NULL,
    chapter TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    material_type TEXT NOT NULL CHECK (material_type IN ('notes', 'summary', 'text')),
    content TEXT NOT NULL,
    source_label TEXT NOT NULL DEFAULT 'Student-created',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS revision_checklist_items (
    id TEXT PRIMARY KEY,
    education_level TEXT NOT NULL DEFAULT 'school',
    class_level INTEGER,
    course TEXT NOT NULL DEFAULT '',
    semester INTEGER,
    subject TEXT NOT NULL,
    chapter TEXT NOT NULL,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS practice_questions (
    id TEXT PRIMARY KEY,
    education_level TEXT NOT NULL CHECK (education_level IN ('school', 'college')),
    class_level INTEGER,
    course TEXT NOT NULL DEFAULT '',
    semester INTEGER,
    subject TEXT NOT NULL,
    chapter TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    question TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
    explanation TEXT NOT NULL DEFAULT '',
    source_label TEXT NOT NULL DEFAULT 'Student-created',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL DEFAULT '',
    chapter TEXT NOT NULL DEFAULT '',
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    percent INTEGER NOT NULL,
    attempted_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quiz_answer_results (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    chapter TEXT NOT NULL DEFAULT '',
    topic TEXT NOT NULL DEFAULT '',
    answer_index INTEGER NOT NULL CHECK (answer_index BETWEEN 0 AND 3),
    correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
    is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
    answered_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_quiz_answer_results_attempt
    ON quiz_answer_results(attempt_id, answered_at);
  CREATE INDEX IF NOT EXISTS idx_quiz_answer_results_subject_topic
    ON quiz_answer_results(subject, chapter, topic);
  CREATE TABLE IF NOT EXISTS ai_monitor_feedback (
    recommendation_id TEXT PRIMARY KEY,
    feedback TEXT NOT NULL CHECK (feedback IN ('helpful', 'not_helpful', 'already_completed', 'remind_me_later')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ai_monitor_feedback_updated
    ON ai_monitor_feedback(updated_at);
  CREATE TABLE IF NOT EXISTS study_flashcards (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    chapter TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    known INTEGER NOT NULL DEFAULT 0 CHECK (known IN (0, 1)),
    review_count INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quiz_progress (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    question_ids_json TEXT NOT NULL,
    answers_json TEXT NOT NULL DEFAULT '{}',
    current_index INTEGER NOT NULL DEFAULT 0,
    subject TEXT NOT NULL DEFAULT '',
    chapter TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
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

const existingSessionColumns = new Set(
  db.prepare("PRAGMA table_info(study_sessions)").all().map((column) => column.name)
);
if (!existingSessionColumns.has("topic_id")) {
  db.exec("ALTER TABLE study_sessions ADD COLUMN topic_id TEXT NOT NULL DEFAULT ''");
}

const existingStudyPlanMetadataColumns = new Set(
  db.prepare("PRAGMA table_info(study_plan_metadata)").all().map((column) => column.name)
);
if (!existingStudyPlanMetadataColumns.has("block_minutes")) {
  db.exec("ALTER TABLE study_plan_metadata ADD COLUMN block_minutes INTEGER NOT NULL DEFAULT 30");
}

const existingChecklistColumns = new Set(
  db.prepare("PRAGMA table_info(revision_checklist_items)").all().map((column) => column.name)
);
const checklistMigrations = [
  ["education_level", "TEXT NOT NULL DEFAULT 'school'"],
  ["class_level", "INTEGER"],
  ["course", "TEXT NOT NULL DEFAULT ''"],
  ["semester", "INTEGER"]
];
for (const [name, definition] of checklistMigrations) {
  if (!existingChecklistColumns.has(name)) {
    db.exec(`ALTER TABLE revision_checklist_items ADD COLUMN ${name} ${definition}`);
  }
}

const existingQuestionColumns = new Set(
  db.prepare("PRAGMA table_info(practice_questions)").all().map((column) => column.name)
);
if (!existingQuestionColumns.has("topic")) {
  db.exec("ALTER TABLE practice_questions ADD COLUMN topic TEXT NOT NULL DEFAULT ''");
}

db.pragma("foreign_keys = ON");

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

function cleanStudentProfile(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Profile data must be an object." };
  }

  if (!["school", "college"].includes(body.educationLevel)) {
    return { error: "Choose school or college as the education level." };
  }

  const availableMinutesPerDay = body.availableMinutesPerDay;
  if (!Number.isInteger(availableMinutesPerDay) || availableMinutesPerDay < 30 || availableMinutesPerDay > 960) {
    return { error: "Available study time must be between 30 minutes and 16 hours per day." };
  }

  const profile = {
    educationLevel: body.educationLevel,
    classLevel: null,
    course: "",
    department: "",
    yearOfStudy: null,
    semester: null,
    availableMinutesPerDay
  };

  if (body.educationLevel === "school") {
    const classLevel = body.classLevel;
    if (!Number.isInteger(classLevel) || classLevel < 6 || classLevel > 12) {
      return { error: "Choose a class from 6 to 12." };
    }
    profile.classLevel = classLevel;
  } else {
    const course = typeof body.course === "string" ? body.course.trim() : "";
    const department = typeof body.department === "string" ? body.department.trim() : "";
    const yearOfStudy = body.yearOfStudy;
    const semester = body.semester === null || body.semester === undefined
      ? null
      : body.semester;

    if (!course) return { error: "Enter your course or degree program." };
    if (course.length > 80) return { error: "Course names must be 80 characters or fewer." };
    if (department.length > 80) return { error: "Department names must be 80 characters or fewer." };
    if (!Number.isInteger(yearOfStudy) || yearOfStudy < 1 || yearOfStudy > 8) {
      return { error: "Choose a college year from 1 to 8." };
    }
    if (semester !== null && (!Number.isInteger(semester) || semester < 1 || semester > 16)) {
      return { error: "Choose a semester from 1 to 16, or leave it blank." };
    }

    profile.course = course;
    profile.department = department;
    profile.yearOfStudy = yearOfStudy;
    profile.semester = semester;
  }

  return { profile };
}

function cleanSyllabusTitle(body, label) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: `${label} data must be an object.` };
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { error: `${label} title is required.` };
  if (title.length > 120) return { error: `${label} titles must be 120 characters or fewer.` };
  return { title };
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

app.get("/api/profile", (_req, res) => {
  const profile = db.prepare(`
    SELECT education_level AS educationLevel, class_level AS classLevel,
      course, department, year_of_study AS yearOfStudy, semester,
      available_minutes_per_day AS availableMinutesPerDay,
      updated_at AS updatedAt
    FROM student_profiles WHERE id = 1
  `).get();
  res.json(profile || null);
});

app.put("/api/profile", (req, res) => {
  const result = cleanStudentProfile(req.body);
  if (result.error) return res.status(400).json({ error: result.error });

  const updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO student_profiles (
      id, education_level, class_level, course, department,
      year_of_study, semester, available_minutes_per_day, updated_at
    ) VALUES (
      1, @educationLevel, @classLevel, @course, @department,
      @yearOfStudy, @semester, @availableMinutesPerDay, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      education_level = excluded.education_level,
      class_level = excluded.class_level,
      course = excluded.course,
      department = excluded.department,
      year_of_study = excluded.year_of_study,
      semester = excluded.semester,
      available_minutes_per_day = excluded.available_minutes_per_day,
      updated_at = excluded.updated_at
  `).run({ ...result.profile, updatedAt });

  const profile = db.prepare(`
    SELECT education_level AS educationLevel, class_level AS classLevel,
      course, department, year_of_study AS yearOfStudy, semester,
      available_minutes_per_day AS availableMinutesPerDay,
      updated_at AS updatedAt
    FROM student_profiles WHERE id = 1
  `).get();
  return res.json(profile);
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

function cleanStudyPlan(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Study plan data must be an object." };
  }
  if (!Array.isArray(body.items) || body.items.length > 500) {
    return { error: "Study plans must contain no more than 500 items." };
  }
  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
  if (fingerprint.length > 100000) return { error: "Study plan inputs are too large." };
  const startDate = String(body.startDate || "");
  const endDate = String(body.endDate || "");
  const days = Number(body.days);
  const blockMinutes = Number(body.blockMinutes ?? 30);
  const dailyMinutes = Number(body.dailyMinutes);
  if (!isDate(startDate) || !isDate(endDate) || days < 1 || days > 31 || !Number.isInteger(days)) {
    return { error: "Enter a valid study plan date range." };
  }
  const expectedEndDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + (days - 1) * 86400000)
    .toISOString().slice(0, 10);
  if (expectedEndDate !== endDate) return { error: "The study plan length does not match its date range." };
  if (!Number.isInteger(dailyMinutes) || dailyMinutes < 0 || dailyMinutes > 1440) {
    return { error: "Daily study time must be between 0 and 1440 minutes." };
  }
  if (!Number.isInteger(blockMinutes) || blockMinutes < 10 || blockMinutes > 120) {
    return { error: "Study blocks must be between 10 and 120 minutes." };
  }
  const items = [];
  for (const item of body.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: "Each study plan item must be an object." };
    }
    const subject = String(item.subject || "").trim();
    const topic = String(item.topic || "").trim();
    const date = String(item.date || "");
    const minutes = Number(item.minutes);
    const priority = item.priority;
    const kind = item.kind;
    const examDate = String(item.examDate || "");
    if (!subject || subject.length > 60 || !topic || topic.length > 120 || !isDate(date)) {
      return { error: "Study plan items require a valid subject, topic, and date." };
    }
    if (date < startDate || date > endDate) return { error: "Study plan items must stay within the selected date range." };
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      return { error: "Study plan durations must be between 1 minute and 24 hours." };
    }
    if (!["low", "medium", "high"].includes(priority) || !["study", "revision"].includes(kind)) {
      return { error: "Choose a valid study-plan priority and item type." };
    }
    if (examDate && !isDate(examDate)) return { error: "Study plan exam dates must be valid." };
    items.push({
      id: crypto.randomUUID(),
      subject,
      topic,
      topicId: String(item.topicId || "").slice(0, 80),
      chapter: String(item.chapter || "").trim().slice(0, 120),
      date,
      minutes,
      priority,
      kind,
      examDate,
      status: "planned"
    });
  }
  return { plan: { fingerprint, startDate, endDate, days, blockMinutes, dailyMinutes, items } };
}

const insertStudyPlanItem = db.prepare(`
  INSERT INTO study_plan_items (
    id, subject, topic, topic_id, chapter, scheduled_date, duration_minutes,
    priority, kind, exam_date, status, created_at, updated_at
  ) VALUES (
    @id, @subject, @topic, @topicId, @chapter, @date, @minutes,
    @priority, @kind, @examDate, @status, @createdAt, @updatedAt
  )
`);

function saveStudyPlanMetadata(plan, updatedAt) {
  db.prepare(`
    INSERT INTO study_plan_metadata (id, fingerprint, start_date, end_date, days, block_minutes, daily_minutes, updated_at)
    VALUES (1, @fingerprint, @startDate, @endDate, @days, @blockMinutes, @dailyMinutes, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      fingerprint = excluded.fingerprint, start_date = excluded.start_date,
      end_date = excluded.end_date, days = excluded.days,
      block_minutes = excluded.block_minutes,
      daily_minutes = excluded.daily_minutes, updated_at = excluded.updated_at
  `).run({ ...plan, updatedAt });
}

function insertStudyPlanItems(items, updatedAt) {
  for (const item of items) {
    insertStudyPlanItem.run({ ...item, createdAt: updatedAt, updatedAt });
  }
}

function studyPlanCapacityError(plan) {
  const profileMinutes = db.prepare("SELECT available_minutes_per_day AS minutes FROM student_profiles WHERE id = 1")
    .get()?.minutes || 0;
  if (plan.dailyMinutes !== profileMinutes) {
    return "Daily study availability changed. Refresh the planner before saving.";
  }
  const completedByDate = new Map(db.prepare(`
    SELECT scheduled_date AS date, SUM(duration_minutes) AS minutes
    FROM study_plan_items
    WHERE status = 'completed' AND scheduled_date >= ? AND scheduled_date BETWEEN ? AND ?
    GROUP BY scheduled_date
  `).all(todayKey(), plan.startDate, plan.endDate).map((row) => [row.date, row.minutes]));
  const plannedByDate = new Map();
  plan.items.forEach((item) => {
    plannedByDate.set(item.date, (plannedByDate.get(item.date) || 0) + item.minutes);
  });
  for (const [date, minutes] of plannedByDate) {
    const remainingMinutes = Math.max(0, profileMinutes - (completedByDate.get(date) || 0));
    if (minutes > remainingMinutes) {
      return `The study plan exceeds your available time on ${date}. Adjust the schedule or your daily availability.`;
    }
  }
  return "";
}

app.get("/api/study-plan", (_req, res) => {
  const metadata = db.prepare(`
    SELECT fingerprint, start_date AS startDate, end_date AS endDate,
      days, block_minutes AS blockMinutes, daily_minutes AS dailyMinutes, updated_at AS updatedAt
    FROM study_plan_metadata WHERE id = 1
  `).get() || null;
  const items = db.prepare(`
    SELECT id, subject, topic, topic_id AS topicId, chapter,
      scheduled_date AS date, duration_minutes AS minutes, priority,
      kind, exam_date AS examDate, status, created_at AS createdAt, updated_at AS updatedAt
    FROM study_plan_items
    ORDER BY scheduled_date, priority DESC, subject COLLATE NOCASE, topic COLLATE NOCASE
  `).all();
  return res.json({ metadata, items });
});

app.put("/api/study-plan", (req, res) => {
  const result = cleanStudyPlan(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const plan = result.plan;
  const capacityError = studyPlanCapacityError(plan);
  if (capacityError) return res.status(409).json({ error: capacityError });
  const updatedAt = new Date().toISOString();
  const save = db.transaction(() => {
    db.prepare("DELETE FROM study_plan_items WHERE status = 'planned'").run();
    insertStudyPlanItems(plan.items, updatedAt);
    saveStudyPlanMetadata(plan, updatedAt);
  });
  save();
  return res.status(200).json({ saved: plan.items.length });
});

app.post("/api/study-plan/recalculate", (req, res) => {
  const result = cleanStudyPlan(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const plan = result.plan;
  const capacityError = studyPlanCapacityError(plan);
  if (capacityError) return res.status(409).json({ error: capacityError });
  const today = todayKey();
  const futureItems = plan.items.filter((item) => item.date >= today);
  const updatedAt = new Date().toISOString();
  const recalculate = db.transaction(() => {
    db.prepare("DELETE FROM study_plan_items WHERE status = 'planned' AND scheduled_date >= ?").run(today);
    insertStudyPlanItems(futureItems, updatedAt);
    saveStudyPlanMetadata(plan, updatedAt);
  });
  recalculate();
  return res.json({ recalculated: futureItems.length });
});

app.put("/api/study-plan/:id", (req, res) => {
  const item = db.prepare("SELECT id, status, scheduled_date AS date, duration_minutes AS minutes FROM study_plan_items WHERE id = ?")
    .get(req.params.id);
  if (!item) return res.status(404).json({ error: "Study plan item not found." });
  const updatedAt = new Date().toISOString();
  if (req.body?.status !== undefined) {
    if (!["planned", "completed", "skipped"].includes(req.body.status)) {
      return res.status(400).json({ error: "Choose Planned, Completed, or Skipped." });
    }
    if (req.body.status === "planned" && item.status !== "planned") {
      const profileMinutes = db.prepare("SELECT available_minutes_per_day AS minutes FROM student_profiles WHERE id = 1")
        .get()?.minutes || 0;
      const occupiedMinutes = db.prepare(`
        SELECT COALESCE(SUM(duration_minutes), 0) AS minutes
        FROM study_plan_items
        WHERE scheduled_date = ? AND status IN ('planned', 'completed') AND id <> ?
      `).get(item.date, item.id).minutes;
      if (item.minutes + occupiedMinutes > profileMinutes) {
        return res.status(409).json({ error: "Returning this item to Planned would exceed your daily study availability." });
      }
    }
    db.prepare("UPDATE study_plan_items SET status = ?, updated_at = ? WHERE id = ?")
      .run(req.body.status, updatedAt, item.id);
  } else if (req.body?.date !== undefined) {
    if (item.status !== "planned") {
      return res.status(409).json({ error: "Only planned items can be rescheduled." });
    }
    if (!isDate(req.body.date) || req.body.date < todayKey()) {
      return res.status(400).json({ error: "Choose a valid date today or later." });
    }
    const profileMinutes = db.prepare("SELECT available_minutes_per_day AS minutes FROM student_profiles WHERE id = 1")
      .get()?.minutes || 0;
    const occupiedMinutes = db.prepare(`
      SELECT COALESCE(SUM(duration_minutes), 0) AS minutes
      FROM study_plan_items
      WHERE scheduled_date = ? AND status IN ('planned', 'completed') AND id <> ?
    `).get(req.body.date, item.id).minutes;
    if (item.minutes + occupiedMinutes > profileMinutes) {
      return res.status(409).json({ error: "Rescheduling this item would exceed your daily study availability." });
    }
    db.prepare("UPDATE study_plan_items SET scheduled_date = ?, updated_at = ? WHERE id = ?")
      .run(req.body.date, updatedAt, item.id);
  } else {
    return res.status(400).json({ error: "Choose a status or a reschedule date." });
  }
  return res.json({ id: item.id, updatedAt });
});

const materialSelect = `
  SELECT id, education_level AS educationLevel, class_level AS classLevel,
    course, semester, subject, chapter, title, material_type AS type,
    content, source_label AS sourceLabel, created_at AS createdAt, updated_at AS updatedAt
  FROM study_materials
`;

app.get("/api/materials", (req, res) => {
  const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
  const chapter = typeof req.query.chapter === "string" ? req.query.chapter.trim() : "";
  const rows = db.prepare(`${materialSelect}
    WHERE (? = '' OR subject = ?) AND (? = '' OR chapter = ?)
    ORDER BY subject COLLATE NOCASE, chapter COLLATE NOCASE, updated_at DESC
  `).all(subject, subject, chapter, chapter);
  return res.json(rows);
});

app.post("/api/materials", (req, res) => {
  const result = cleanMaterial(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const now = new Date().toISOString();
  const material = { id: crypto.randomUUID(), ...result.material, createdAt: now, updatedAt: now };
  db.prepare(`
    INSERT INTO study_materials (
      id, education_level, class_level, course, semester, subject, chapter,
      title, material_type, content, source_label, created_at, updated_at
    ) VALUES (
      @id, @educationLevel, @classLevel, @course, @semester, @subject, @chapter,
      @title, @type, @content, @sourceLabel, @createdAt, @updatedAt
    )
  `).run(material);
  return res.status(201).json(db.prepare(`${materialSelect} WHERE id = ?`).get(material.id));
});

app.put("/api/materials/:id", (req, res) => {
  const result = cleanMaterial(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const updatedAt = new Date().toISOString();
  const update = db.prepare(`
    UPDATE study_materials SET
      education_level = @educationLevel, class_level = @classLevel, course = @course,
      semester = @semester, subject = @subject, chapter = @chapter, title = @title,
      material_type = @type, content = @content, source_label = @sourceLabel,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({ ...result.material, id: req.params.id, updatedAt });
  if (!update.changes) return res.status(404).json({ error: "Study material not found." });
  return res.json(db.prepare(`${materialSelect} WHERE id = ?`).get(req.params.id));
});

app.delete("/api/materials/:id", (req, res) => {
  const result = db.prepare("DELETE FROM study_materials WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Study material not found." });
  return res.status(204).end();
});

const flashcardSelect = `
  SELECT id, subject, chapter, question, answer, known,
    review_count AS reviewCount, last_reviewed_at AS lastReviewedAt,
    created_at AS createdAt, updated_at AS updatedAt
  FROM study_flashcards
`;

app.get("/api/flashcards", (req, res) => {
  const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
  const chapter = typeof req.query.chapter === "string" ? req.query.chapter.trim() : "";
  const cards = db.prepare(`${flashcardSelect}
    WHERE (? = '' OR subject = ?) AND (? = '' OR chapter = ?)
    ORDER BY subject COLLATE NOCASE, chapter COLLATE NOCASE, created_at, id
  `).all(subject, subject, chapter, chapter)
    .map((card) => ({ ...card, known: Boolean(card.known) }));
  return res.json(cards);
});

app.post("/api/flashcards", (req, res) => {
  const result = cleanFlashcard(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const now = new Date().toISOString();
  const card = { id: crypto.randomUUID(), ...result.flashcard, createdAt: now, updatedAt: now };
  db.prepare(`
    INSERT INTO study_flashcards (id, subject, chapter, question, answer, created_at, updated_at)
    VALUES (@id, @subject, @chapter, @question, @answer, @createdAt, @updatedAt)
  `).run(card);
  return res.status(201).json({ ...card, known: false, reviewCount: 0, lastReviewedAt: null });
});

app.put("/api/flashcards/:id", (req, res) => {
  const result = cleanFlashcard(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const updatedAt = new Date().toISOString();
  const update = db.prepare(`
    UPDATE study_flashcards
    SET subject = @subject, chapter = @chapter, question = @question, answer = @answer,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({ ...result.flashcard, updatedAt, id: req.params.id });
  if (!update.changes) return res.status(404).json({ error: "Flashcard not found." });
  const card = db.prepare(`${flashcardSelect} WHERE id = ?`).get(req.params.id);
  return res.json({ ...card, known: Boolean(card.known) });
});

app.post("/api/flashcards/:id/review", (req, res) => {
  if (typeof req.body?.known !== "boolean") {
    return res.status(400).json({ error: "Flashcard review status must be known or not known." });
  }
  const updatedAt = new Date().toISOString();
  const update = db.prepare(`
    UPDATE study_flashcards SET known = ?, review_count = review_count + 1,
      last_reviewed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(Number(req.body.known), updatedAt, updatedAt, req.params.id);
  if (!update.changes) return res.status(404).json({ error: "Flashcard not found." });
  const card = db.prepare(`${flashcardSelect} WHERE id = ?`).get(req.params.id);
  return res.json({ ...card, known: Boolean(card.known) });
});

app.delete("/api/flashcards/:id", (req, res) => {
  const result = db.prepare("DELETE FROM study_flashcards WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Flashcard not found." });
  return res.status(204).end();
});

app.get("/api/revision-checklist", (req, res) => {
  const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
  const chapter = typeof req.query.chapter === "string" ? req.query.chapter.trim() : "";
  return res.json(db.prepare(`
    SELECT id, education_level AS educationLevel, class_level AS classLevel, course,
      semester, subject, chapter, title, completed,
      created_at AS createdAt, updated_at AS updatedAt
    FROM revision_checklist_items
    WHERE (? = '' OR subject = ?) AND (? = '' OR chapter = ?)
    ORDER BY subject COLLATE NOCASE, chapter COLLATE NOCASE, created_at, title COLLATE NOCASE
  `).all(subject, subject, chapter, chapter).map((item) => ({ ...item, completed: Boolean(item.completed) })));
});

app.post("/api/revision-checklist", (req, res) => {
  const result = cleanChecklistItem(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const now = new Date().toISOString();
  const item = { id: crypto.randomUUID(), ...result.item, completed: 0, createdAt: now, updatedAt: now };
  db.prepare(`
    INSERT INTO revision_checklist_items (
      id, education_level, class_level, course, semester,
      subject, chapter, title, completed, created_at, updated_at
    ) VALUES (
      @id, @educationLevel, @classLevel, @course, @semester,
      @subject, @chapter, @title, @completed, @createdAt, @updatedAt
    )
  `).run(item);
  return res.status(201).json({ ...item, completed: false });
});

app.put("/api/revision-checklist/:id", (req, res) => {
  const current = db.prepare("SELECT id FROM revision_checklist_items WHERE id = ?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Revision checklist item not found." });
  const result = cleanChecklistItem(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  if (typeof req.body.completed !== "boolean") {
    return res.status(400).json({ error: "Checklist completion must be true or false." });
  }
  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE revision_checklist_items
    SET education_level = @educationLevel, class_level = @classLevel,
      course = @course, semester = @semester, subject = @subject,
      chapter = @chapter, title = @title,
      completed = @completed, updated_at = @updatedAt
    WHERE id = @id
  `).run({ ...result.item, completed: Number(req.body.completed), updatedAt, id: req.params.id });
  return res.json({ id: req.params.id, ...result.item, completed: req.body.completed, updatedAt });
});

app.delete("/api/revision-checklist/:id", (req, res) => {
  const result = db.prepare("DELETE FROM revision_checklist_items WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Revision checklist item not found." });
  return res.status(204).end();
});

const questionSelect = `
  SELECT id, education_level AS educationLevel, class_level AS classLevel,
    course, semester, subject, chapter, topic, question, options_json AS optionsJson,
    correct_index AS correctIndex, explanation, source_label AS sourceLabel,
    created_at AS createdAt, updated_at AS updatedAt
  FROM practice_questions
`;

function questionOut(row) {
  return { ...row, options: JSON.parse(row.optionsJson) };
}

app.get("/api/questions", (req, res) => {
  const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
  const chapter = typeof req.query.chapter === "string" ? req.query.chapter.trim() : "";
  const rows = db.prepare(`${questionSelect}
    WHERE (? = '' OR subject = ?) AND (? = '' OR chapter = ?)
    ORDER BY subject COLLATE NOCASE, chapter COLLATE NOCASE, created_at DESC
  `).all(subject, subject, chapter, chapter);
  return res.json(rows.map(questionOut));
});

app.post("/api/questions", (req, res) => {
  const result = cleanQuestion(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const now = new Date().toISOString();
  const question = { id: crypto.randomUUID(), ...result.questionData, optionsJson: JSON.stringify(result.questionData.options), createdAt: now, updatedAt: now };
  db.prepare(`
    INSERT INTO practice_questions (
      id, education_level, class_level, course, semester, subject, chapter, topic,
      question, options_json, correct_index, explanation, source_label, created_at, updated_at
    ) VALUES (
      @id, @educationLevel, @classLevel, @course, @semester, @subject, @chapter, @topic,
      @question, @optionsJson, @correctIndex, @explanation, @sourceLabel, @createdAt, @updatedAt
    )
  `).run(question);
  return res.status(201).json(questionOut(db.prepare(`${questionSelect} WHERE id = ?`).get(question.id)));
});

app.put("/api/questions/:id", (req, res) => {
  const result = cleanQuestion(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const now = new Date().toISOString();
  const update = db.prepare(`
    UPDATE practice_questions SET
      education_level = @educationLevel, class_level = @classLevel, course = @course,
      semester = @semester, subject = @subject, chapter = @chapter, topic = @topic,
      question = @question, options_json = @optionsJson, correct_index = @correctIndex,
      explanation = @explanation, source_label = @sourceLabel, updated_at = @updatedAt
    WHERE id = @id
  `).run({
    ...result.questionData,
    optionsJson: JSON.stringify(result.questionData.options),
    updatedAt: now,
    id: req.params.id
  });
  if (!update.changes) return res.status(404).json({ error: "Practice question not found." });
  return res.json(questionOut(db.prepare(`${questionSelect} WHERE id = ?`).get(req.params.id)));
});

app.delete("/api/questions/:id", (req, res) => {
  const result = db.prepare("DELETE FROM practice_questions WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Practice question not found." });
  return res.status(204).end();
});

function quizProgressOut() {
  const progress = db.prepare("SELECT * FROM quiz_progress WHERE id = 1").get();
  if (!progress) return null;
  const requestedIds = JSON.parse(progress.question_ids_json);
  const rows = db.prepare(`
    SELECT id, subject, chapter, topic, question, options_json AS optionsJson
    FROM practice_questions WHERE id IN (${requestedIds.map(() => "?").join(",")})
  `).all(...requestedIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const questionIds = requestedIds.filter((id) => byId.has(id));
  if (!questionIds.length) {
    db.prepare("DELETE FROM quiz_progress WHERE id = 1").run();
    return null;
  }
  const answers = JSON.parse(progress.answers_json);
  Object.keys(answers).forEach((id) => {
    if (!questionIds.includes(id)) delete answers[id];
  });
  const currentIndex = Math.min(progress.current_index, questionIds.length - 1);
  if (questionIds.length !== requestedIds.length || currentIndex !== progress.current_index) {
    db.prepare(`
      UPDATE quiz_progress SET question_ids_json = ?, answers_json = ?, current_index = ?, updated_at = ?
      WHERE id = 1
    `).run(JSON.stringify(questionIds), JSON.stringify(answers), currentIndex, new Date().toISOString());
  }
  return {
    questionIds,
    answers,
    currentIndex,
    subject: progress.subject,
    chapter: progress.chapter,
    updatedAt: progress.updated_at,
    questions: questionIds.map((id) => {
      const row = byId.get(id);
      return {
        id: row.id,
        subject: row.subject,
        chapter: row.chapter,
        topic: row.topic,
        question: row.question,
        options: JSON.parse(row.optionsJson)
      };
    })
  };
}

app.get("/api/quizzes/progress", (_req, res) => {
  return res.json(quizProgressOut());
});

app.post("/api/quizzes/progress", (req, res) => {
  const questionIds = req.body?.questionIds;
  if (!Array.isArray(questionIds) || !questionIds.length || questionIds.length > 100
    || questionIds.some((id) => typeof id !== "string")
    || new Set(questionIds).size !== questionIds.length) {
    return res.status(400).json({ error: "Quiz progress must include 1 to 100 different saved questions." });
  }
  const subject = typeof req.body.subject === "string" ? req.body.subject.trim() : "";
  const chapter = typeof req.body.chapter === "string" ? req.body.chapter.trim() : "";
  if (subject.length > 60 || chapter.length > 120) {
    return res.status(400).json({ error: "Quiz subject or chapter is too long." });
  }
  const existing = db.prepare(`
    SELECT id FROM practice_questions WHERE id IN (${questionIds.map(() => "?").join(",")})
  `).all(...questionIds);
  if (existing.length !== questionIds.length) {
    return res.status(404).json({ error: "One or more quiz questions no longer exist." });
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO quiz_progress (id, question_ids_json, answers_json, current_index, subject, chapter, updated_at)
    VALUES (1, ?, '{}', 0, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      question_ids_json = excluded.question_ids_json,
      answers_json = excluded.answers_json,
      current_index = excluded.current_index,
      subject = excluded.subject,
      chapter = excluded.chapter,
      updated_at = excluded.updated_at
  `).run(JSON.stringify(questionIds), subject, chapter, now);
  return res.status(201).json(quizProgressOut());
});

app.put("/api/quizzes/progress", (req, res) => {
  const progress = db.prepare("SELECT question_ids_json FROM quiz_progress WHERE id = 1").get();
  if (!progress) return res.status(404).json({ error: "There is no quiz in progress." });
  const questionIds = JSON.parse(progress.question_ids_json);
  const currentIndex = req.body?.currentIndex;
  const answers = req.body?.answers;
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= questionIds.length) {
    return res.status(400).json({ error: "Choose a valid question in this quiz." });
  }
  if (!answers || typeof answers !== "object" || Array.isArray(answers)
    || Object.entries(answers).some(([id, answerIndex]) => (
      !questionIds.includes(id) || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3
    ))) {
    return res.status(400).json({ error: "Quiz answers must match saved questions and valid options." });
  }
  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE quiz_progress SET answers_json = ?, current_index = ?, updated_at = ? WHERE id = 1
  `).run(JSON.stringify(answers), currentIndex, updatedAt);
  return res.json(quizProgressOut());
});

app.delete("/api/quizzes/progress", (_req, res) => {
  db.prepare("DELETE FROM quiz_progress WHERE id = 1").run();
  return res.status(204).end();
});

app.get("/api/quizzes/questions", (req, res) => {
  const subject = typeof req.query.subject === "string" ? req.query.subject.trim() : "";
  const chapter = typeof req.query.chapter === "string" ? req.query.chapter.trim() : "";
  const rows = db.prepare(`
    SELECT id, subject, chapter, topic, question, options_json AS optionsJson
    FROM practice_questions
    WHERE (? = '' OR subject = ?) AND (? = '' OR chapter = ?)
    ORDER BY subject COLLATE NOCASE, chapter COLLATE NOCASE, created_at
  `).all(subject, subject, chapter, chapter);
  return res.json(rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    chapter: row.chapter,
    topic: row.topic,
    question: row.question,
    options: JSON.parse(row.optionsJson)
  })));
});

app.get("/api/quizzes/attempts", (_req, res) => {
  return res.json(db.prepare(`
    SELECT id, subject, chapter, score, total, percent, attempted_at AS attemptedAt
    FROM quiz_attempts ORDER BY attempted_at DESC LIMIT 50
  `).all());
});

function accuracyPercent(correctAnswers, totalAttempted) {
  return totalAttempted
    ? Math.round(correctAnswers / totalAttempted * 1000) / 10
    : 0;
}

function summarizeAccuracyGroup(group) {
  const totalAttempted = group.correctAnswers + group.incorrectAnswers;
  const accuracyPercentValue = accuracyPercent(group.correctAnswers, totalAttempted);
  let recommendation = "";
  if (accuracyPercentValue < 50) {
    recommendation = "Revise this topic before attempting more questions.";
  } else if (accuracyPercentValue <= 75) {
    recommendation = "Practice this topic with more questions.";
  } else {
    recommendation = "Review this topic and try a slightly harder practice quiz.";
  }
  return {
    ...group,
    totalAttempted,
    accuracyPercent: accuracyPercentValue,
    recommendation
  };
}

app.get("/api/quiz-accuracy", (_req, res) => {
  const rows = db.prepare(`
    SELECT r.attempt_id AS attemptId, r.question_id AS questionId,
      r.question_text AS question, r.subject, r.chapter, r.topic,
      r.is_correct AS isCorrect, r.answered_at AS answeredAt,
      a.attempted_at AS attemptedAt, a.rowid AS attemptOrder
    FROM quiz_answer_results r
    JOIN quiz_attempts a ON a.id = r.attempt_id
    ORDER BY a.attempted_at DESC, a.rowid DESC, r.id
  `).all();
  const groupBy = (keyOf, labelOf) => {
    const groups = new Map();
    rows.forEach((row) => {
      const key = keyOf(row);
      if (!groups.has(key)) groups.set(key, { ...labelOf(row), correctAnswers: 0, incorrectAnswers: 0 });
      const group = groups.get(key);
      if (row.isCorrect) group.correctAnswers += 1;
      else group.incorrectAnswers += 1;
    });
    return [...groups.values()]
      .map(summarizeAccuracyGroup)
      .sort((left, right) => right.accuracyPercent - left.accuracyPercent
        || right.totalAttempted - left.totalAttempted
        || (left.subject || "").localeCompare(right.subject || "")
        || (left.topic || "").localeCompare(right.topic || ""));
  };
  const subjects = groupBy(
    (row) => row.subject,
    (row) => ({ subject: row.subject })
  );
  const topics = groupBy(
    (row) => `${row.subject}\u0000${row.chapter}\u0000${row.topic || row.chapter || "Unspecified topic"}`,
    (row) => ({
      subject: row.subject,
      chapter: row.chapter,
      topic: row.topic || row.chapter || "Unspecified topic",
      repeatedIncorrect: false
    })
  ).map((topic) => ({
    ...topic,
    repeatedIncorrect: topic.incorrectAnswers >= 2
  }));
  const attemptMap = new Map();
  rows.forEach((row) => {
    if (!attemptMap.has(row.attemptId)) {
      attemptMap.set(row.attemptId, {
        id: row.attemptId,
        attemptedAt: row.attemptedAt,
        attemptOrder: row.attemptOrder,
        correctAnswers: 0,
        incorrectAnswers: 0,
        subjects: new Set(),
        chapters: new Set()
      });
    }
    const attempt = attemptMap.get(row.attemptId);
    if (row.subject) attempt.subjects.add(row.subject);
    if (row.chapter) attempt.chapters.add(row.chapter);
    if (row.isCorrect) attempt.correctAnswers += 1;
    else attempt.incorrectAnswers += 1;
  });
  const attempts = [...attemptMap.values()]
    .map((attempt) => {
      const totalAttempted = attempt.correctAnswers + attempt.incorrectAnswers;
      return {
        id: attempt.id,
        attemptedAt: attempt.attemptedAt,
        subjects: [...attempt.subjects],
        chapters: [...attempt.chapters],
        correctAnswers: attempt.correctAnswers,
        incorrectAnswers: attempt.incorrectAnswers,
        totalAttempted,
        accuracyPercent: accuracyPercent(attempt.correctAnswers, totalAttempted)
      };
    })
    .sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt)
      || right.attemptOrder - left.attemptOrder);
  const recentAttempts = attempts.slice(0, 5);
  const latestAttempt = attempts[0] || null;
  const previousAttempt = attempts[1] || null;
  const totalAttempted = rows.length;
  const correctAnswers = rows.filter((row) => row.isCorrect).length;
  const incorrectAnswers = totalAttempted - correctAnswers;
  const legacyAttemptsExcluded = db.prepare(`
    SELECT COUNT(*) AS count FROM quiz_attempts a
    WHERE NOT EXISTS (
      SELECT 1 FROM quiz_answer_results r WHERE r.attempt_id = a.id
    )
  `).get().count;
  return res.json({
    totalAttempted,
    correctAnswers,
    incorrectAnswers,
    accuracyPercent: accuracyPercent(correctAnswers, totalAttempted),
    subjects,
    topics,
    recentAttempts,
    recentTrend: latestAttempt && previousAttempt ? {
      previousPercent: previousAttempt.accuracyPercent,
      currentPercent: latestAttempt.accuracyPercent,
      percentagePointChange: Math.round((latestAttempt.accuracyPercent - previousAttempt.accuracyPercent) * 10) / 10,
      direction: latestAttempt.accuracyPercent > previousAttempt.accuracyPercent
        ? "improving"
        : latestAttempt.accuracyPercent < previousAttempt.accuracyPercent
          ? "declining"
          : "unchanged"
    } : null,
    strongTopics: topics.filter((topic) => topic.totalAttempted >= 3 && topic.accuracyPercent > 75),
    topicsNeedingPractice: topics.filter((topic) => topic.accuracyPercent <= 75 || topic.repeatedIncorrect),
    legacyAttemptsExcluded
  });
});

function buildAiMonitorData() {
  const quizAnswers = db.prepare(`
    SELECT r.attempt_id AS attemptId, r.question_id AS questionId,
      r.subject, r.chapter, r.topic, r.is_correct AS isCorrect,
      a.attempted_at AS attemptedAt, a.rowid AS attemptOrder
    FROM quiz_answer_results r
    JOIN quiz_attempts a ON a.id = r.attempt_id
    ORDER BY a.attempted_at DESC, a.rowid DESC, r.id
  `).all();
  const legacyAttemptsExcluded = db.prepare(`
    SELECT COUNT(*) AS count FROM quiz_attempts a
    WHERE NOT EXISTS (
      SELECT 1 FROM quiz_answer_results r WHERE r.attempt_id = a.id
    )
  `).get().count;
  return analyzeStudyActivity({
    today: todayKey(),
    profile: db.prepare(`
      SELECT available_minutes_per_day AS availableMinutesPerDay
      FROM student_profiles WHERE id = 1
    `).get() || null,
    subjects: db.prepare("SELECT name FROM subjects ORDER BY name COLLATE NOCASE").all().map((row) => row.name),
    topics: db.prepare(`
      SELECT t.id, c.subject_name AS subject, c.title AS chapter, t.title,
        t.status, t.needs_revision AS needsRevision, t.updated_at AS updatedAt
      FROM syllabus_topics t
      JOIN syllabus_chapters c ON c.id = t.chapter_id
      ORDER BY c.subject_name COLLATE NOCASE, c.title COLLATE NOCASE, t.title COLLATE NOCASE
    `).all().map((topic) => ({ ...topic, needsRevision: Boolean(topic.needsRevision) })),
    sessions: db.prepare(`
      SELECT s.id, s.subject, s.topic_id AS topicId,
        s.duration_minutes AS durationMinutes, s.studied_on AS date,
        s.created_at AS createdAt, t.title AS topicTitle, c.title AS chapter
      FROM study_sessions s
      LEFT JOIN syllabus_topics t ON t.id = s.topic_id
      LEFT JOIN syllabus_chapters c ON c.id = t.chapter_id
    `).all(),
    exams: db.prepare(`
      SELECT id, title, subject, due_date AS date FROM exams
    `).all(),
    planItems: db.prepare(`
      SELECT id, subject, topic, topic_id AS topicId,
        scheduled_date AS date, duration_minutes AS minutes, priority, kind, status,
        updated_at AS updatedAt
      FROM study_plan_items
    `).all(),
    tasks: db.prepare(`
      SELECT id, title, subject, topic, due_date AS date,
        completed, priority, updated_at AS updatedAt
      FROM tasks
    `).all(),
    quizAttempts: db.prepare(`
      SELECT id, subject, chapter, attempted_at AS attemptedAt
      FROM quiz_attempts ORDER BY attempted_at DESC
    `).all(),
    quizAnswers,
    legacyAttemptsExcluded,
    revisionHistory: db.prepare(`
      SELECT topic_id AS topicId, needs_revision AS needsRevision,
        changed_at AS changedAt
      FROM revision_history ORDER BY changed_at DESC
    `).all().map((entry) => ({ ...entry, needsRevision: Boolean(entry.needsRevision) })),
    feedback: db.prepare(`
      SELECT recommendation_id AS recommendationId, feedback AS value,
        updated_at AS updatedAt
      FROM ai_monitor_feedback
    `).all()
  });
}

app.get("/api/ai-monitor/summary", (_req, res) => {
  const monitor = buildAiMonitorData();
  return res.json({
    status: monitor.status,
    sufficientData: monitor.sufficientData,
    metrics: monitor.metrics,
    upcomingExam: monitor.upcomingExam,
    topicsNeedingAttention: monitor.topicsNeedingAttention,
    recentlyStudiedTopics: monitor.recentlyStudiedTopics,
    revisionUpdatesToday: monitor.metrics.revisionUpdatesToday,
    accuracy: monitor.accuracy,
    latestActivityDate: monitor.latestActivityDate,
    topRecommendation: monitor.recommendations[0] || null
  });
});

app.get("/api/ai-monitor/recommendations", (_req, res) => {
  const monitor = buildAiMonitorData();
  return res.json({
    recommendations: monitor.recommendations,
    status: monitor.status,
    sufficientData: monitor.sufficientData
  });
});

app.get("/api/ai-monitor/daily-report", (_req, res) => {
  const monitor = buildAiMonitorData();
  return res.json(monitor.dailyReport);
});

app.post("/api/ai-monitor/feedback", (req, res) => {
  const recommendationId = typeof req.body?.recommendationId === "string"
    ? req.body.recommendationId.trim()
    : "";
  const feedback = req.body?.feedback;
  const allowedFeedback = ["helpful", "not_helpful", "already_completed", "remind_me_later"];
  if (!recommendationId || recommendationId.length > 160 || !allowedFeedback.includes(feedback)) {
    return res.status(400).json({ error: "Choose a recommendation and valid feedback response." });
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_monitor_feedback (recommendation_id, feedback, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(recommendation_id) DO UPDATE SET
      feedback = excluded.feedback, updated_at = excluded.updated_at
  `).run(recommendationId, feedback, now, now);
  return res.json({ recommendationId, feedback, updatedAt: now });
});

app.post("/api/quizzes/submit", (req, res) => {
  const ids = Array.isArray(req.body?.answers) ? req.body.answers.map((answer) => answer?.id) : [];
  if (!ids.length || ids.length > 100 || ids.some((id) => typeof id !== "string")) {
    return res.status(400).json({ error: "Submit answers for 1 to 100 quiz questions." });
  }
  if (new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: "Each quiz question can only be answered once." });
  }
  const questions = db.prepare(`
    SELECT id, subject, chapter, topic, question, correct_index, explanation
    FROM practice_questions WHERE id IN (${ids.map(() => "?").join(",")})
  `).all(...ids);
  if (questions.length !== ids.length) return res.status(404).json({ error: "One or more quiz questions no longer exist." });
  const score = scoreQuiz(questions, req.body.answers);
  if (score.error) return res.status(400).json({ error: score.error });
  const subject = String(req.body.subject || "").trim().slice(0, 60);
  const chapter = String(req.body.chapter || "").trim().slice(0, 120);
  const attemptedAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const answersById = new Map(req.body.answers.map((answer) => [answer.id, answer]));
  const saveAttempt = db.transaction(() => {
    db.prepare(`
      INSERT INTO quiz_attempts (id, subject, chapter, score, total, percent, attempted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, subject, chapter, score.score, score.total, score.percent, attemptedAt);
    const insertResult = db.prepare(`
      INSERT INTO quiz_answer_results (
        id, attempt_id, question_id, question_text, subject, chapter, topic,
        answer_index, correct_index, is_correct, answered_at
      ) VALUES (
        @id, @attemptId, @questionId, @questionText, @subject, @chapter, @topic,
        @answerIndex, @correctIndex, @isCorrect, @answeredAt
      )
    `);
    req.body.answers.forEach((answer) => {
      const question = questionsById.get(answer.id);
      insertResult.run({
        id: crypto.randomUUID(),
        attemptId: id,
        questionId: question.id,
        questionText: question.question,
        subject: question.subject,
        chapter: question.chapter,
        topic: question.topic,
        answerIndex: answer.answerIndex,
        correctIndex: question.correct_index,
        isCorrect: Number(answer.answerIndex === question.correct_index),
        answeredAt: attemptedAt
      });
    });
    const activeProgress = db.prepare("SELECT question_ids_json FROM quiz_progress WHERE id = 1").get();
    if (activeProgress) {
      const activeIds = JSON.parse(activeProgress.question_ids_json);
      if (activeIds.length === ids.length && activeIds.every((questionId) => ids.includes(questionId))) {
        db.prepare("DELETE FROM quiz_progress WHERE id = 1").run();
      }
    }
  });
  saveAttempt();
  return res.json({ id, subject, chapter, ...score, attemptedAt });
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

app.put("/api/subjects/:name", (req, res) => {
  const previousName = req.params.name;
  if (!db.prepare("SELECT 1 FROM subjects WHERE name = ?").get(previousName)) {
    return res.status(404).json({ error: "Subject not found." });
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "Subject name is required." });
  if (name.length > 60) return res.status(400).json({ error: "Subject names must be 60 characters or fewer." });
  if (name !== previousName && db.prepare("SELECT 1 FROM subjects WHERE name = ?").get(name)) {
    return res.status(409).json({ error: "A subject with that name already exists." });
  }
  const renameSubject = db.transaction(() => {
    db.prepare("UPDATE subjects SET name = ? WHERE name = ?").run(name, previousName);
    db.prepare("UPDATE tasks SET subject = ? WHERE subject = ?").run(name, previousName);
    db.prepare("UPDATE exams SET subject = ? WHERE subject = ?").run(name, previousName);
    db.prepare("UPDATE study_sessions SET subject = ? WHERE subject = ?").run(name, previousName);
  });
  renameSubject();
  return res.json({ name });
});

app.get("/api/syllabus", (_req, res) => {
  const subjects = db.prepare("SELECT name FROM subjects ORDER BY name COLLATE NOCASE").all();
  const chapters = db.prepare(`
    SELECT id, subject_name AS subject, title FROM syllabus_chapters
    ORDER BY subject_name COLLATE NOCASE, created_at, title COLLATE NOCASE
  `).all();
  const topics = db.prepare(`
    SELECT t.id, t.chapter_id AS chapterId, t.title, t.status,
      t.needs_revision AS needsRevision,
      COALESCE(SUM(s.duration_minutes), 0) AS minutesSpent
    FROM syllabus_topics t
    LEFT JOIN study_sessions s ON s.topic_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at, t.title COLLATE NOCASE
  `).all().map((topic) => ({
    ...topic,
    needsRevision: Boolean(topic.needsRevision)
  }));
  const topicsByChapter = new Map();
  topics.forEach((topic) => {
    if (!topicsByChapter.has(topic.chapterId)) topicsByChapter.set(topic.chapterId, []);
    topicsByChapter.get(topic.chapterId).push(topic);
  });
  const chaptersBySubject = new Map();
  chapters.forEach((chapter) => {
    chapter.topics = topicsByChapter.get(chapter.id) || [];
    if (!chaptersBySubject.has(chapter.subject)) chaptersBySubject.set(chapter.subject, []);
    chaptersBySubject.get(chapter.subject).push(chapter);
  });

  let totalTopics = 0;
  let completedTopics = 0;
  let needsRevision = 0;
  const syllabusSubjects = subjects.map(({ name }) => {
    const subjectChapters = chaptersBySubject.get(name) || [];
    const subjectTopics = subjectChapters.flatMap((chapter) => chapter.topics);
    const subjectCompletedTopics = subjectTopics.filter((topic) => topic.status === "completed").length;
    const completedChapters = subjectChapters.filter((chapter) => (
      chapter.topics.length > 0 && chapter.topics.every((topic) => topic.status === "completed")
    )).length;
    const subjectNeedsRevision = subjectTopics.filter((topic) => topic.needsRevision).length;
    totalTopics += subjectTopics.length;
    completedTopics += subjectCompletedTopics;
    needsRevision += subjectNeedsRevision;
    return {
      name,
      chapters: subjectChapters,
      totalTopics: subjectTopics.length,
      completedTopics: subjectCompletedTopics,
      progressPercent: subjectTopics.length
        ? Math.round(subjectCompletedTopics / subjectTopics.length * 100)
        : 0,
      completedChapters,
      remainingChapters: subjectChapters.length - completedChapters,
      needsRevision: subjectNeedsRevision
    };
  });

  return res.json({
    subjects: syllabusSubjects,
    overall: {
      totalSubjects: syllabusSubjects.length,
      totalChapters: chapters.length,
      totalTopics,
      completedTopics,
      remainingTopics: totalTopics - completedTopics,
      progressPercent: totalTopics ? Math.round(completedTopics / totalTopics * 100) : 0,
      needsRevision
    }
  });
});

app.post("/api/chapters", (req, res) => {
  const titleResult = cleanSyllabusTitle(req.body, "Chapter");
  if (titleResult.error) return res.status(400).json({ error: titleResult.error });
  const subject = typeof req.body.subject === "string" ? req.body.subject.trim() : "";
  if (!subject) return res.status(400).json({ error: "Choose a subject for this chapter." });
  if (!db.prepare("SELECT 1 FROM subjects WHERE name = ?").get(subject)) {
    return res.status(404).json({ error: "Subject not found. Add the subject first." });
  }
  const chapter = {
    id: crypto.randomUUID(),
    subject,
    title: titleResult.title,
    createdAt: new Date().toISOString()
  };
  db.prepare(`
    INSERT INTO syllabus_chapters (id, subject_name, title, created_at)
    VALUES (@id, @subject, @title, @createdAt)
  `).run(chapter);
  return res.status(201).json(chapter);
});

app.put("/api/chapters/:id", (req, res) => {
  const titleResult = cleanSyllabusTitle(req.body, "Chapter");
  if (titleResult.error) return res.status(400).json({ error: titleResult.error });
  const result = db.prepare("UPDATE syllabus_chapters SET title = ? WHERE id = ?")
    .run(titleResult.title, req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Chapter not found." });
  return res.json(db.prepare(`
    SELECT id, subject_name AS subject, title FROM syllabus_chapters WHERE id = ?
  `).get(req.params.id));
});

app.delete("/api/chapters/:id", (req, res) => {
  const result = db.prepare("DELETE FROM syllabus_chapters WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Chapter not found." });
  return res.status(204).end();
});

app.post("/api/chapters/:id/topics", (req, res) => {
  const titleResult = cleanSyllabusTitle(req.body, "Topic");
  if (titleResult.error) return res.status(400).json({ error: titleResult.error });
  if (!db.prepare("SELECT 1 FROM syllabus_chapters WHERE id = ?").get(req.params.id)) {
    return res.status(404).json({ error: "Chapter not found." });
  }
  const now = new Date().toISOString();
  const topic = {
    id: crypto.randomUUID(),
    chapterId: req.params.id,
    title: titleResult.title,
    status: "not_started",
    needsRevision: false,
    minutesSpent: 0,
    createdAt: now,
    updatedAt: now
  };
  db.prepare(`
    INSERT INTO syllabus_topics (id, chapter_id, title, status, created_at, updated_at)
    VALUES (@id, @chapterId, @title, @status, @createdAt, @updatedAt)
  `).run(topic);
  return res.status(201).json(topic);
});

app.put("/api/topics/:id", (req, res) => {
  const titleResult = cleanSyllabusTitle(req.body, "Topic");
  if (titleResult.error) return res.status(400).json({ error: titleResult.error });
  const status = req.body.status;
  if (!["not_started", "in_progress", "completed"].includes(status)) {
    return res.status(400).json({ error: "Choose Not Started, In Progress, or Completed." });
  }
  if (typeof req.body.needsRevision !== "boolean") {
    return res.status(400).json({ error: "Revision status must be true or false." });
  }
  const existingTopic = db.prepare(`
    SELECT needs_revision AS needsRevision FROM syllabus_topics WHERE id = ?
  `).get(req.params.id);
  if (!existingTopic) return res.status(404).json({ error: "Topic not found." });
  const topicUpdate = db.transaction(() => {
    const result = db.prepare(`
      UPDATE syllabus_topics SET title = @title, status = @status,
        needs_revision = @needsRevision, updated_at = @updatedAt
      WHERE id = @id
    `).run({
      title: titleResult.title,
      status,
      needsRevision: Number(req.body.needsRevision),
      updatedAt: new Date().toISOString(),
      id: req.params.id
    });
    if (Boolean(existingTopic.needsRevision) !== req.body.needsRevision) {
      db.prepare(`
        INSERT INTO revision_history (id, topic_id, needs_revision, changed_at)
        VALUES (?, ?, ?, ?)
      `).run(crypto.randomUUID(), req.params.id, Number(req.body.needsRevision), new Date().toISOString());
    }
    return result;
  });
  const result = topicUpdate();
  if (!result.changes) return res.status(404).json({ error: "Topic not found." });
  return res.json(db.prepare(`
    SELECT id, chapter_id AS chapterId, title, status,
      needs_revision AS needsRevision
    FROM syllabus_topics WHERE id = ?
  `).get(req.params.id));
});

app.delete("/api/topics/:id", (req, res) => {
  const result = db.prepare("DELETE FROM syllabus_topics WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Topic not found." });
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
  const topicId = req.body?.topicId === undefined || req.body?.topicId === null
    ? ""
    : String(req.body.topicId);
  let subject = String(req.body?.subject || "").trim().slice(0, 60);
  if (topicId) {
    const topic = db.prepare(`
      SELECT t.id, c.subject_name AS subject
      FROM syllabus_topics t
      JOIN syllabus_chapters c ON c.id = t.chapter_id
      WHERE t.id = ?
    `).get(topicId);
    if (!topic) return res.status(404).json({ error: "Syllabus topic not found." });
    subject = topic.subject;
  }
  const session = {
    id: crypto.randomUUID(),
    subject,
    durationMinutes,
    date,
    topicId
  };
  db.prepare(`
    INSERT INTO study_sessions (id, subject, topic_id, duration_minutes, studied_on, created_at)
    VALUES (@id, @subject, @topicId, @durationMinutes, @date, @createdAt)
  `).run({ ...session, createdAt: new Date().toISOString() });
  const { topicId: _topicId, ...response } = session;
  return res.status(201).json(response);
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Offline Study Planner running at http://localhost:${PORT}`);
  console.log("For another device on the same Wi-Fi, use this computer's IPv4 address with the port above.");
});
