const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addDays,
  daysBetween,
  getSubjectProgress,
  buildSubjectSummaries,
  buildStudyRecommendations,
  scheduleStudyPlan
} = require("../public/study-plan-engine");

function makeSubject(name, topics) {
  return {
    name,
    chapters: [{
      title: `${name} chapter`,
      topics: topics.map((topic, index) => ({
        id: `${name}-${index}`,
        title: topic.title || `Topic ${index + 1}`,
        status: topic.status || "not_started",
        needsRevision: Boolean(topic.needsRevision)
      }))
    }]
  };
}

test("date math handles year boundaries, leap days, missing and malformed dates", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(daysBetween("2026-10-04", "2026-10-05"), 1);
  assert.equal(daysBetween("2026-10-05", "2026-10-04"), -1);
  assert.equal(daysBetween("2026-10-04", ""), null);
  assert.equal(addDays("2026-02-30", 1), null);
});

test("subject progress is derived from saved topics and handles empty and complete syllabuses", () => {
  assert.deepEqual(getSubjectProgress(makeSubject("Math", [
    { status: "completed" },
    { status: "in_progress", needsRevision: true },
    { status: "not_started" }
  ])), {
    totalTopics: 3,
    completedTopics: 1,
    incompleteTopics: 2,
    revisionTopics: 1,
    progressPercent: 33
  });
  assert.equal(getSubjectProgress(makeSubject("Empty", [])).progressPercent, 0);
  assert.equal(getSubjectProgress(makeSubject("Done", [{ status: "completed" }])).progressPercent, 100);
});

test("subject exam summaries show days remaining, past dates and missing dates safely", () => {
  const syllabus = { subjects: [makeSubject("Math", [{ }]), makeSubject("Science", [{ }]), makeSubject("History", [{ }])] };
  const summaries = buildSubjectSummaries(syllabus, [
    { subject: "Math", title: "Math exam", date: "2026-10-10" },
    { subject: "Science", title: "Old science exam", date: "2026-10-01" }
  ], "2026-10-04");
  assert.equal(summaries[0].daysRemaining, 6);
  assert.equal(summaries[1].daysRemaining, -3);
  assert.equal(summaries[1].examTitle, "Old science exam");
  assert.equal(summaries[2].examDate, "");
  assert.equal(summaries[2].daysRemaining, null);
});

test("scheduler prioritizes urgent exams and more remaining topics within daily time", () => {
  const syllabus = { subjects: [
    makeSubject("Later", [{ title: "Later topic" }]),
    makeSubject("Soon", [{ title: "Soon 1" }, { title: "Soon 2" }])
  ] };
  const plan = scheduleStudyPlan({
    syllabus,
    exams: [
      { subject: "Later", date: "2026-10-20", title: "Later exam" },
      { subject: "Soon", date: "2026-10-06", title: "Soon exam" }
    ],
    availableMinutesPerDay: 30,
    startDate: "2026-10-04",
    days: 3,
    blockMinutes: 30
  });
  assert.equal(plan.items[0].subject, "Soon");
  assert.ok(plan.items.every((item) => item.minutes <= 30));
  assert.deepEqual([...new Set(plan.items.map((item) => item.date))], ["2026-10-04", "2026-10-05", "2026-10-06"]);
});

test("subjects with more incomplete topics take precedence when exam dates are equal", () => {
  const plan = scheduleStudyPlan({
    syllabus: { subjects: [
      makeSubject("One topic", [{ title: "Only topic" }]),
      makeSubject("Many topics", [{ title: "Topic A" }, { title: "Topic B" }, { title: "Topic C" }])
    ] },
    exams: [
      { subject: "One topic", date: "2026-10-10", title: "Exam A" },
      { subject: "Many topics", date: "2026-10-10", title: "Exam B" }
    ],
    availableMinutesPerDay: 30,
    startDate: "2026-10-04",
    days: 1,
    blockMinutes: 30
  });
  assert.equal(plan.items[0].subject, "Many topics");
});

test("scheduler warns when workload exceeds capacity, and safely handles zero time", () => {
  const syllabus = { subjects: [makeSubject("Math", [
    { }, { }, { }, { }
  ])] };
  const limited = scheduleStudyPlan({
    syllabus, exams: [], availableMinutesPerDay: 30, startDate: "2026-10-04", days: 2, blockMinutes: 30
  });
  assert.equal(limited.items.length, 2);
  assert.equal(limited.unscheduledTopics, 2);
  assert.match(limited.warning, /will not fit/);

  const noTime = scheduleStudyPlan({
    syllabus, exams: [], availableMinutesPerDay: 0, startDate: "2026-10-04", days: 7, blockMinutes: 30
  });
  assert.equal(noTime.items.length, 0);
  assert.match(noTime.warning, /zero/);
});

test("completed topics are omitted unless revision is requested and exam-day topics are not scheduled", () => {
  const syllabus = { subjects: [makeSubject("Math", [
    { title: "Done", status: "completed" },
    { title: "Review", status: "completed", needsRevision: true },
    { title: "Exam-day topic" }
  ])] };
  const plan = scheduleStudyPlan({
    syllabus,
    exams: [{ subject: "Math", title: "Exam", date: "2026-10-04" }],
    availableMinutesPerDay: 60,
    startDate: "2026-10-04",
    days: 2,
    blockMinutes: 30
  });
  assert.deepEqual(new Set(plan.items.map((item) => item.topic)), new Set(["Exam-day topic", "Review"]));
  assert.equal(plan.items.find((item) => item.topic === "Review").kind, "revision");
  assert.ok(plan.items.every((item) => item.date === "2026-10-05"));
});

test("completed plan time reduces that day's remaining available schedule time", () => {
  const plan = scheduleStudyPlan({
    syllabus: { subjects: [makeSubject("Math", [{ title: "New topic" }])] },
    exams: [],
    availableMinutesPerDay: 45,
    startDate: "2026-10-04",
    days: 1,
    blockMinutes: 30,
    existingItems: [{ date: "2026-10-04", minutes: 30, status: "completed" }]
  });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].minutes, 15);
  assert.equal(plan.capacityMinutes, 15);
});

test("local recommendations prioritize nearer exams and flagged revision topics within daily availability", () => {
  const syllabus = {
    subjects: [
      makeSubject("History", [{ title: "Early cities" }]),
      makeSubject("Math", [
        { title: "Equations", status: "in_progress" },
        { title: "Graphs", status: "completed", needsRevision: true }
      ])
    ]
  };
  const recommendation = buildStudyRecommendations({
    syllabus,
    exams: [
      { subject: "History", title: "History exam", date: "2026-10-30" },
      { subject: "Math", title: "Math exam", date: "2026-10-08" }
    ],
    today: "2026-10-05",
    availableMinutesPerDay: 60
  });
  assert.equal(recommendation.dailyMinutes, 60);
  assert.equal(recommendation.items.length, 2);
  assert.equal(recommendation.items[0].topic, "Graphs");
  assert.equal(recommendation.items[0].examDate, "2026-10-08");
  assert.equal(recommendation.items[0].needsRevision, true);
  assert.equal(recommendation.items[1].topic, "Equations");
});

test("recommendations are limited by real available time and omit completed topics", () => {
  const recommendation = buildStudyRecommendations({
    syllabus: { subjects: [makeSubject("Math", [
      { title: "Done", status: "completed" },
      { title: "Next" },
      { title: "Later" }
    ])] },
    exams: [],
    today: "2026-10-05",
    availableMinutesPerDay: 30
  });
  assert.deepEqual(recommendation.items.map((item) => item.topic), ["Later"]);
  assert.deepEqual(buildStudyRecommendations({
    syllabus: { subjects: [] }, exams: [], today: "2026-10-05", availableMinutesPerDay: 0
  }), { dailyMinutes: 0, items: [] });
});

test("past exams do not appear as upcoming recommendation context", () => {
  const result = buildStudyRecommendations({
    syllabus: { subjects: [makeSubject("Math", [{ title: "Review" }])] },
    exams: [{ subject: "Math", title: "Past exam", date: "2026-10-01" }],
    today: "2026-10-05",
    availableMinutesPerDay: 30
  });
  assert.equal(result.items[0].examDate, "");
  assert.equal(result.items[0].daysRemaining, null);
});
