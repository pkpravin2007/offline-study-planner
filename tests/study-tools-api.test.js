const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const Database = require("better-sqlite3");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

let child;
let baseUrl;
let temporaryDirectory;
let databasePath;

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = response.status === 204 ? null : await response.json();
  return { status: response.status, body };
}

function localDateOffset(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function startServer(port) {
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), STUDY_PLANNER_DB: databasePath },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let startupOutput = "";
  child.stdout.on("data", (chunk) => { startupOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { startupOutput += chunk.toString(); });
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(healthy, true, `Local server did not start. ${startupOutput}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
}

test("local study tools APIs persist materials, flashcard revision, quiz progress, and real study sessions", async (t) => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "study-planner-api-"));
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  databasePath = path.join(temporaryDirectory, "planner.sqlite");
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
    CREATE TABLE practice_questions (
      id TEXT PRIMARY KEY, education_level TEXT NOT NULL, class_level INTEGER,
      course TEXT NOT NULL DEFAULT '', semester INTEGER, subject TEXT NOT NULL,
      chapter TEXT NOT NULL, question TEXT NOT NULL, options_json TEXT NOT NULL,
      correct_index INTEGER NOT NULL, explanation TEXT NOT NULL DEFAULT '',
      source_label TEXT NOT NULL DEFAULT 'Student-created',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE quiz_attempts (
      id TEXT PRIMARY KEY, subject TEXT NOT NULL DEFAULT '', chapter TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL, total INTEGER NOT NULL, percent INTEGER NOT NULL, attempted_at TEXT NOT NULL
    );
    INSERT INTO practice_questions VALUES (
      'legacy-question', 'school', 10, '', NULL, 'Legacy', 'Chapter',
      'Legacy question?', '["A","B","C","D"]', 0, '', 'Student-created',
      '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'
    );
    INSERT INTO quiz_attempts VALUES ('legacy-attempt', 'Legacy', 'Chapter', 1, 2, 50, '2025-01-01T00:00:00.000Z');
  `);
  legacyDb.close();
  t.after(async () => {
    await stopServer();
    if (temporaryDirectory && fs.existsSync(temporaryDirectory)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  await startServer(port);
  const legacyQuestion = (await request("/api/questions")).body.find((question) => question.id === "legacy-question");
  assert.equal(legacyQuestion.topic, "");
  const emptyMonitor = await request("/api/ai-monitor/summary");
  assert.equal(emptyMonitor.status, 200);
  assert.equal(emptyMonitor.body.sufficientData, false);
  assert.equal(emptyMonitor.body.metrics.quizAccuracyPercent, null);
  assert.equal((await request("/api/ai-monitor/daily-report")).body.sufficientData, false);

  const material = await request("/api/materials", {
    method: "POST",
    body: JSON.stringify({
      educationLevel: "school",
      classLevel: 10,
      subject: "Science",
      chapter: "Cells",
      title: "Cell notes",
      type: "notes",
      content: "Student-created cell notes"
    })
  });
  assert.equal(material.status, 201);
  assert.equal((await request("/api/materials")).body[0].content, "Student-created cell notes");

  const flashcard = await request("/api/flashcards", {
    method: "POST",
    body: JSON.stringify({
      subject: "Science",
      chapter: "Cells",
      question: "What surrounds a cell?",
      answer: "The cell membrane."
    })
  });
  assert.equal(flashcard.status, 201);
  assert.equal(flashcard.body.known, false);
  const markedKnown = await request(`/api/flashcards/${flashcard.body.id}/review`, {
    method: "POST",
    body: JSON.stringify({ known: true })
  });
  assert.equal(markedKnown.body.known, true);
  assert.equal(markedKnown.body.reviewCount, 1);
  const markedForPractice = await request(`/api/flashcards/${flashcard.body.id}/review`, {
    method: "POST",
    body: JSON.stringify({ known: false })
  });
  assert.equal(markedForPractice.body.known, false);
  assert.equal(markedForPractice.body.reviewCount, 2);
  const flashcards = await request("/api/flashcards?subject=Science&chapter=Cells");
  assert.equal(flashcards.body[0].lastReviewedAt, markedForPractice.body.lastReviewedAt);

  const questionData = (subject, chapter, topic, question, correctIndex) => ({
    educationLevel: "school",
    classLevel: 10,
    subject,
    chapter,
    topic,
    question,
    options: ["A", "B", "C", "D"],
    correctIndex,
    explanation: "Saved explanation."
  });
  const firstQuestion = await request("/api/questions", {
    method: "POST",
    body: JSON.stringify(questionData("Science", "Cells", "Cell membrane", "First question?", 1))
  });
  const secondQuestion = await request("/api/questions", {
    method: "POST",
    body: JSON.stringify(questionData("Science", "Cells", "Cell membrane", "Second question?", 0))
  });
  const thirdQuestion = await request("/api/questions", {
    method: "POST",
    body: JSON.stringify(questionData("Math", "Algebra", "Equations", "Third question?", 2))
  });
  const fourthQuestion = await request("/api/questions", {
    method: "POST",
    body: JSON.stringify(questionData("Math", "Algebra", "Functions", "Fourth question?", 3))
  });
  const fifthQuestion = await request("/api/questions", {
    method: "POST",
    body: JSON.stringify(questionData("Science", "Plants", "Photosynthesis", "Fifth question?", 0))
  });
  const ids = [
    firstQuestion.body.id,
    secondQuestion.body.id,
    thirdQuestion.body.id,
    fourthQuestion.body.id,
    fifthQuestion.body.id
  ];
  assert.equal(firstQuestion.body.topic, "Cell membrane");
  const started = await request("/api/quizzes/progress", {
    method: "POST",
    body: JSON.stringify({ questionIds: ids, subject: "Science", chapter: "Cells" })
  });
  assert.equal(started.body.questions.length, 5);
  const savedProgress = await request("/api/quizzes/progress", {
    method: "PUT",
    body: JSON.stringify({ currentIndex: 1, answers: { [ids[0]]: 1 } })
  });
  assert.equal(savedProgress.body.currentIndex, 1);
  assert.equal(savedProgress.body.answers[ids[0]], 1);
  const resumed = await request("/api/quizzes/progress");
  assert.equal(resumed.body.questions[1].question, "Second question?");
  assert.equal(resumed.body.answers[ids[0]], 1);

  const submitAnswers = async (answerIndexes) => request("/api/quizzes/submit", {
    method: "POST",
    body: JSON.stringify({
      subject: "",
      chapter: "",
      answers: ids.map((id, index) => ({ id, answerIndex: answerIndexes[index] }))
    })
  });
  const firstResult = await submitAnswers([1, 3, 1, 3, 1]);
  assert.equal(firstResult.body.score, 2);
  assert.deepEqual(firstResult.body.results.map((answer) => answer.correct), [true, false, false, true, false]);
  assert.equal((await request("/api/quizzes/progress")).body, null);
  const secondResult = await submitAnswers([1, 3, 1, 3, 1]);
  const thirdResult = await submitAnswers([1, 3, 2, 3, 1]);
  assert.equal(secondResult.body.score, 2);
  assert.equal(thirdResult.body.score, 3);

  const accuracy = await request("/api/quiz-accuracy");
  assert.equal(accuracy.body.totalAttempted, 15);
  assert.equal(accuracy.body.correctAnswers, 7);
  assert.equal(accuracy.body.incorrectAnswers, 8);
  assert.equal(accuracy.body.accuracyPercent, 46.7);
  assert.equal(accuracy.body.legacyAttemptsExcluded, 1);
  const mathAccuracy = accuracy.body.subjects.find((subject) => subject.subject === "Math");
  const scienceAccuracy = accuracy.body.subjects.find((subject) => subject.subject === "Science");
  assert.deepEqual(
    [mathAccuracy.correctAnswers, mathAccuracy.incorrectAnswers, mathAccuracy.accuracyPercent],
    [4, 2, 66.7]
  );
  assert.deepEqual(
    [scienceAccuracy.correctAnswers, scienceAccuracy.incorrectAnswers, scienceAccuracy.accuracyPercent],
    [3, 6, 33.3]
  );
  const functionAccuracy = accuracy.body.topics.find((topic) => topic.topic === "Functions");
  const equationAccuracy = accuracy.body.topics.find((topic) => topic.topic === "Equations");
  const cellAccuracy = accuracy.body.topics.find((topic) => topic.topic === "Cell membrane");
  const photosynthesisAccuracy = accuracy.body.topics.find((topic) => topic.topic === "Photosynthesis");
  assert.equal(functionAccuracy.accuracyPercent, 100);
  assert.equal(accuracy.body.strongTopics.some((topic) => topic.topic === "Functions"), true);
  assert.equal(equationAccuracy.accuracyPercent, 33.3);
  assert.equal(equationAccuracy.recommendation, "Revise this topic before attempting more questions.");
  assert.equal(cellAccuracy.accuracyPercent, 50);
  assert.equal(cellAccuracy.repeatedIncorrect, true);
  assert.equal(cellAccuracy.recommendation, "Practice this topic with more questions.");
  assert.equal(photosynthesisAccuracy.accuracyPercent, 0);
  assert.equal(photosynthesisAccuracy.recommendation, "Revise this topic before attempting more questions.");
  assert.deepEqual(accuracy.body.recentTrend, {
    previousPercent: 40,
    currentPercent: 60,
    percentagePointChange: 20,
    direction: "improving"
  });
  assert.equal(accuracy.body.recentAttempts.length, 3);
  assert.equal((await request("/api/quizzes/attempts")).body[0].percent, 60);

  await stopServer();
  await startServer(port);
  const accuracyAfterRestart = await request("/api/quiz-accuracy");
  assert.deepEqual(accuracyAfterRestart.body, accuracy.body);
  assert.equal((await request("/api/quizzes/attempts")).body.length, 4);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const session = await request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ subject: "Science", durationMinutes: 35, date: today })
  });
  assert.equal(session.status, 201);
  assert.equal((await request("/api/sessions")).body[0].durationMinutes, 35);
  const report = await request("/api/reports");
  assert.equal(report.body.days.find((day) => day.date === today).minutes, 35);

  await request("/api/profile", {
    method: "PUT",
    body: JSON.stringify({
      educationLevel: "school",
      classLevel: 10,
      availableMinutesPerDay: 120
    })
  });
  await request("/api/subjects", {
    method: "POST",
    body: JSON.stringify({ name: "Monitor Subject" })
  });
  const chapter = await request("/api/chapters", {
    method: "POST",
    body: JSON.stringify({ subject: "Monitor Subject", title: "Monitor Chapter" })
  });
  const monitorTopics = [];
  for (const title of ["Topic One", "Topic Two", "Topic Three"]) {
    const created = await request(`/api/chapters/${chapter.body.id}/topics`, {
      method: "POST",
      body: JSON.stringify({ title })
    });
    monitorTopics.push(created.body);
  }
  await request(`/api/topics/${monitorTopics[0].id}`, {
    method: "PUT",
    body: JSON.stringify({
      title: monitorTopics[0].title,
      status: "in_progress",
      needsRevision: true
    })
  });
  const linkedSession = await request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ topicId: monitorTopics[0].id, durationMinutes: 20, date: today })
  });
  assert.equal(linkedSession.status, 201);
  await request("/api/exams", {
    method: "POST",
    body: JSON.stringify({
      title: "Monitor exam",
      subject: "Monitor Subject",
      date: localDateOffset(7)
    })
  });
  await request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: "Overdue monitor task",
      subject: "Monitor Subject",
      date: localDateOffset(-1)
    })
  });

  const monitorSummary = await request("/api/ai-monitor/summary");
  assert.equal(monitorSummary.body.metrics.todayStudyMinutes, 55);
  assert.equal(monitorSummary.body.metrics.availableMinutesPerDay, 120);
  assert.equal(monitorSummary.body.metrics.quizAccuracyPercent, 46.7);
  assert.equal(monitorSummary.body.metrics.totalQuestionsAttempted, 15);
  assert.equal(monitorSummary.body.metrics.completedSessions, 2);
  assert.equal(monitorSummary.body.metrics.revisionUpdatesToday, 1);
  assert.equal(monitorSummary.body.recentlyStudiedTopics[0].topic, "Topic One");
  assert.equal(monitorSummary.body.status, "exam-risk");
  assert.equal(monitorSummary.body.upcomingExam.title, "Monitor exam");
  assert.equal(monitorSummary.body.topicsNeedingAttention.some((topic) => topic.topic === "Cell membrane"), true);
  const monitorRecommendations = await request("/api/ai-monitor/recommendations");
  assert.equal(monitorRecommendations.body.recommendations.some((item) => item.id === "low-study-activity"), true);
  assert.equal(monitorRecommendations.body.recommendations.some((item) => item.id === "incomplete-syllabus"), true);
  assert.equal(monitorRecommendations.body.recommendations.some((item) => item.id === "missed-study-plan"), true);
  assert.equal(monitorRecommendations.body.recommendations.some((item) => item.id === "exam-risk:" + monitorSummary.body.upcomingExam.id), true);
  assert.equal(monitorRecommendations.body.recommendations.some((item) => item.id.startsWith("repeated-mistakes:")), true);
  const monitorDailyReport = await request("/api/ai-monitor/daily-report");
  assert.equal(monitorDailyReport.body.totalStudyMinutes, 55);
  assert.equal(monitorDailyReport.body.completedSessions, 2);
  assert.equal(monitorDailyReport.body.quizAttempts, 3);
  assert.equal(monitorDailyReport.body.quizAccuracyPercent, 46.7);
  assert.equal(monitorDailyReport.body.topicsNeedingRevision.length, 1);
  assert.equal(monitorDailyReport.body.revisionHistoryUpdatesToday, 1);
  assert.equal(monitorDailyReport.body.recentlyStudiedTopics[0].topic, "Topic One");

  const feedback = await request("/api/ai-monitor/feedback", {
    method: "POST",
    body: JSON.stringify({
      recommendationId: "low-study-activity",
      feedback: "remind_me_later"
    })
  });
  assert.equal(feedback.status, 200);
  assert.equal(feedback.body.feedback, "remind_me_later");
  assert.equal((await request("/api/ai-monitor/recommendations")).body.recommendations
    .some((item) => item.id === "low-study-activity"), false);
  assert.equal((await request("/api/ai-monitor/feedback", {
    method: "POST",
    body: JSON.stringify({ recommendationId: "invalid", feedback: "skip" })
  })).status, 400);

  await stopServer();
  await startServer(port);
  const monitorAfterRestart = await request("/api/ai-monitor/summary");
  assert.equal(monitorAfterRestart.body.metrics.totalQuestionsAttempted, 15);
  assert.equal(monitorAfterRestart.body.metrics.todayStudyMinutes, 55);
  assert.equal(monitorAfterRestart.body.metrics.revisionUpdatesToday, 1);
  assert.equal((await request("/api/ai-monitor/recommendations")).body.recommendations
    .some((item) => item.id === "low-study-activity"), false);
});
