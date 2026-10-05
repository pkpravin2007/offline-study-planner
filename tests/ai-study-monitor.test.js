const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeStudyActivity, calculateQuizAccuracy } = require("../aiStudyMonitor");

const today = "2026-05-13";

function answer(attemptId, isCorrect, topic = "Loops", attemptedAt = `${today}T10:00:00.000Z`) {
  return {
    attemptId,
    questionId: `${attemptId}-${topic}-${isCorrect}`,
    subject: "Java",
    chapter: "Basics",
    topic,
    isCorrect: Number(isCorrect),
    attemptedAt,
    attemptOrder: 1
  };
}

test("quiz accuracy uses only saved answer rows and detects repeated mistakes", () => {
  const accuracy = calculateQuizAccuracy([
    answer("a", true),
    answer("a", false),
    answer("b", false, "Loops", "2026-05-12T10:00:00.000Z")
  ], 1);
  assert.deepEqual(
    [accuracy.totalAttempted, accuracy.correctAnswers, accuracy.incorrectAnswers, accuracy.accuracyPercent],
    [3, 1, 2, 33.3]
  );
  assert.equal(accuracy.topics[0].repeatedIncorrect, true);
  assert.equal(accuracy.legacyAttemptsExcluded, 1);
});

test("monitor safely handles an empty database and missing profile", () => {
  const result = analyzeStudyActivity({ today });
  assert.equal(result.status, "getting-started");
  assert.equal(result.sufficientData, false);
  assert.equal(result.metrics.todayStudyMinutes, 0);
  assert.equal(result.metrics.quizAccuracyPercent, null);
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.dailyReport.sufficientData, false);
});

test("monitor flags low activity, unfinished tasks, weak topics, and exam risk", () => {
  const result = analyzeStudyActivity({
    today,
    profile: { availableMinutesPerDay: 120 },
    subjects: ["Java"],
    topics: [
      { id: "loops", subject: "Java", chapter: "Basics", title: "Loops", status: "in_progress", needsRevision: true },
      { id: "arrays", subject: "Java", chapter: "Basics", title: "Arrays", status: "not_started", needsRevision: false },
      { id: "classes", subject: "Java", chapter: "OOP", title: "Classes", status: "not_started", needsRevision: false }
    ],
    sessions: [{ date: today, durationMinutes: 20, subject: "Java" }],
    exams: [{ id: "exam", title: "Java exam", subject: "Java", date: "2026-05-20" }],
    tasks: [{ id: "task", title: "Review", date: "2026-05-12", completed: 0 }],
    quizAnswers: [answer("a", false), answer("b", false, "Loops", "2026-05-12T10:00:00.000Z")]
  });
  const ids = result.recommendations.map((item) => item.id);
  assert.equal(result.status, "exam-risk");
  assert.ok(ids.includes("low-study-activity"));
  assert.ok(ids.includes("incomplete-syllabus"));
  assert.ok(ids.includes("missed-study-plan"));
  assert.ok(ids.includes("exam-risk:exam"));
  assert.ok(ids.some((id) => id.startsWith("repeated-mistakes:")));
  assert.equal(result.metrics.todayStudyMinutes, 20);
  assert.equal(result.metrics.availableMinutesPerDay, 120);
  assert.equal(result.metrics.quizAccuracyPercent, 0);
});

test("accuracy bands, activity changes, and invalid/past exam dates are deterministic", () => {
  const noExam = analyzeStudyActivity({
    today,
    profile: { availableMinutesPerDay: 0 },
    sessions: [{ date: today, durationMinutes: 45 }],
    exams: [
      { id: "past", title: "Past exam", subject: "Java", date: "2026-05-12" },
      { id: "invalid", title: "Invalid exam", subject: "Java", date: "2026-02-31" }
    ],
    quizAnswers: [
      answer("recent", true),
      answer("recent", true, "Arrays")
    ]
  });
  assert.equal(noExam.upcomingExam, null);
  assert.equal(noExam.recommendations.some((item) => item.id === "low-study-activity"), false);
  assert.equal(noExam.recommendations.find((item) => item.id === "quiz-accuracy").problem,
    "Good performance. Continue revision and try slightly harder questions.");
  assert.equal(noExam.metrics.todayStudyMinutes, 45);
});

test("saved feedback defers local reminders without changing activity calculations", () => {
  const input = {
    today,
    profile: { availableMinutesPerDay: 60 },
    subjects: ["Java"]
  };
  const initial = analyzeStudyActivity(input);
  assert.ok(initial.recommendations.some((item) => item.id === "low-study-activity"));
  const deferred = analyzeStudyActivity({
    ...input,
    feedback: [{
      recommendationId: "low-study-activity",
      value: "remind_me_later",
      updatedAt: new Date().toISOString()
    }]
  });
  assert.equal(deferred.recommendations.some((item) => item.id === "low-study-activity"), false);
  assert.equal(deferred.metrics.todayStudyMinutes, 0);
});
