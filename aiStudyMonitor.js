const crypto = require("node:crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
const INACTIVITY_DAYS = 3;
const EXAM_RISK_DAYS = 14;

function validDateKey(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDate(value) {
  if (typeof value !== "string") return "";
  if (validDateKey(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : dayKey(parsed);
}

function percentage(correctAnswers, totalAttempted) {
  return totalAttempted ? Math.round(correctAnswers / totalAttempted * 1000) / 10 : 0;
}

function summarizeAccuracyGroup(group) {
  const totalAttempted = group.correctAnswers + group.incorrectAnswers;
  const accuracyPercent = percentage(group.correctAnswers, totalAttempted);
  const recommendation = accuracyPercent < 50
    ? "Revise this topic before attempting more questions."
    : accuracyPercent <= 75
      ? "Practice this topic with more questions."
      : "Review this topic and try a slightly harder practice quiz.";
  return { ...group, totalAttempted, accuracyPercent, recommendation };
}

function calculateQuizAccuracy(rows, legacyAttemptsExcluded = 0) {
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
  ).map((topic) => ({ ...topic, repeatedIncorrect: topic.incorrectAnswers >= 2 }));
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
        accuracyPercent: percentage(attempt.correctAnswers, totalAttempted),
        attemptOrder: attempt.attemptOrder
      };
    })
    .sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt)
      || right.attemptOrder - left.attemptOrder);
  const recentAttempts = attempts.slice(0, 5).map(({ attemptOrder: _attemptOrder, ...attempt }) => attempt);
  const latestAttempt = attempts[0] || null;
  const previousAttempt = attempts[1] || null;
  const totalAttempted = rows.length;
  const correctAnswers = rows.filter((row) => row.isCorrect).length;
  return {
    totalAttempted,
    correctAnswers,
    incorrectAnswers: totalAttempted - correctAnswers,
    accuracyPercent: percentage(correctAnswers, totalAttempted),
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
  };
}

function topicId(subject, chapter, topic) {
  return crypto.createHash("sha256").update(`${subject}\u0000${chapter}\u0000${topic}`).digest("hex").slice(0, 24);
}

function generateRecommendations(context, metrics, accuracy, upcomingExam) {
  const recommendations = [];
  const add = (recommendation) => recommendations.push({
    id: recommendation.id,
    type: recommendation.type,
    title: recommendation.title,
    problem: recommendation.problem,
    why: recommendation.why,
    action: recommendation.action,
    actionLabel: recommendation.actionLabel,
    href: recommendation.href,
    priority: recommendation.priority,
    topic: recommendation.topic || null
  });
  const remainingTopics = context.topics.filter((topic) => topic.status !== "completed");
  const incompleteRatio = context.topics.length ? remainingTopics.length / context.topics.length : 0;

  if (metrics.availableMinutesPerDay > 0
    && metrics.todayStudyMinutes < metrics.availableMinutesPerDay * 0.5) {
    add({
      id: "low-study-activity",
      type: "activity",
      title: "A short focused session may help",
      problem: "Your study time is lower than your planned study time. Try completing one focused study session.",
      why: `You recorded ${metrics.todayStudyMinutes} of ${metrics.availableMinutesPerDay} available minutes today; under half of the saved daily target.`,
      action: "Start one focused study session and log it when finished.",
      actionLabel: "Start a focus session",
      href: "#focus-panel",
      priority: 60
    });
  }

  if (remainingTopics.length && (remainingTopics.length >= 3 || (remainingTopics.length >= 2 && incompleteRatio >= 0.5))) {
    const topicPriority = (topic) => {
      const plan = context.planItems.find((item) => item.topicId === topic.id);
      return plan?.priority === "high" ? 3 : plan?.priority === "medium" ? 2 : plan?.priority === "low" ? 1 : 0;
    };
    const nextTopic = [...remainingTopics]
      .filter((topic) => !upcomingExam?.subject || topic.subject === upcomingExam.subject)
      .sort((left, right) => topicPriority(right) - topicPriority(left))[0] || null;
    add({
      id: "incomplete-syllabus",
      type: "syllabus",
      title: "Incomplete syllabus topics",
      problem: "You have several incomplete topics. Prioritize the topics related to your nearest exam.",
      why: `${remainingTopics.length} of ${context.topics.length} saved syllabus topics are not marked complete.`,
      action: nextTopic
        ? `Continue ${nextTopic.subject} · ${nextTopic.title}, related to your nearest exam.`
        : "Choose one incomplete topic and mark progress in your syllabus.",
      actionLabel: "Review syllabus",
      href: "#syllabus-panel",
      priority: 70,
      topic: nextTopic
    });
  }

  const recentAttempts = accuracy.recentAttempts.slice(0, 3);
  const recentQuestionCount = recentAttempts.reduce((sum, attempt) => sum + attempt.totalAttempted, 0);
  const recentCorrectCount = recentAttempts.reduce((sum, attempt) => sum + attempt.correctAnswers, 0);
  const recentAccuracy = recentQuestionCount ? percentage(recentCorrectCount, recentQuestionCount) : null;
  if (recentAccuracy !== null) {
    const low = recentAccuracy < 50;
    const medium = recentAccuracy <= 75;
    add({
      id: "quiz-accuracy",
      type: "quiz",
      title: "Quiz / Practice Accuracy",
      problem: low
        ? "Your recent quiz accuracy is low. Revise the topic and try another practice quiz."
        : medium
          ? "You understand the basics, but more practice is recommended."
          : "Good performance. Continue revision and try slightly harder questions.",
      why: `Recent saved quiz answers show ${recentCorrectCount} correct out of ${recentQuestionCount} (${recentAccuracy}%). This reflects practice answers only, not complete knowledge.`,
      action: low
        ? "Review a topic with low accuracy, then try another practice quiz."
        : medium
          ? "Attempt another practice quiz on the same subject."
          : "Review the topic, then try a slightly harder practice quiz.",
      actionLabel: "Open practice quiz",
      href: "#quiz-panel",
      priority: low ? 95 : medium ? 65 : 25
    });
  }

  accuracy.topics.filter((topic) => topic.repeatedIncorrect).forEach((topic) => {
    add({
      id: `repeated-mistakes:${topicId(topic.subject, topic.chapter, topic.topic)}`,
      type: "mistakes",
      title: `${topic.subject} · ${topic.topic} needs more practice`,
      problem: "This topic needs more practice. Review the concept and attempt another quiz.",
      why: `${topic.incorrectAnswers} incorrect answers are saved for this topic.`,
      action: `Revise ${topic.topic}, then attempt more questions on it.`,
      actionLabel: "Practice this topic",
      href: "#quiz-panel",
      priority: 90 + Math.max(0, 50 - topic.accuracyPercent) / 10,
      topic
    });
  });

  const overduePlans = context.planItems.filter((item) => (
    item.status === "planned" && validDateKey(item.date) && item.date < context.today
  ));
  const overdueTasks = context.tasks.filter((task) => (
    !task.completed && validDateKey(task.date) && task.date < context.today
  ));
  if (overduePlans.length || overdueTasks.length) {
    add({
      id: "missed-study-plan",
      type: "plan",
      title: "Unfinished study tasks",
      problem: "You have unfinished study tasks. Reschedule them instead of ignoring them.",
      why: `${overduePlans.length + overdueTasks.length} saved task${overduePlans.length + overdueTasks.length === 1 ? "" : "s"} from a past date remain incomplete.`,
      action: "Choose a new date for unfinished tasks in your saved plan.",
      actionLabel: "Review study plan",
      href: "#planner-panel",
      priority: 75
    });
  }

  if (upcomingExam && upcomingExam.daysRemaining <= EXAM_RISK_DAYS && upcomingExam.remainingTopics > 0
    && upcomingExam.progressPercent < 60) {
    add({
      id: `exam-risk:${upcomingExam.id}`,
      type: "exam",
      title: `${upcomingExam.title} is approaching`,
      problem: "Your exam is approaching and some syllabus remains incomplete. Increase revision priority.",
      why: `${upcomingExam.daysRemaining === 0 ? "The exam is today" : `The exam is in ${upcomingExam.daysRemaining} day${upcomingExam.daysRemaining === 1 ? "" : "s"}`}; ${upcomingExam.remainingTopics} topic${upcomingExam.remainingTopics === 1 ? "" : "s"} remain in ${upcomingExam.subject || "the saved syllabus"}.`,
      action: "Prioritize an incomplete topic related to this exam.",
      actionLabel: "Review syllabus",
      href: "#syllabus-panel",
      priority: 100 + Math.max(0, EXAM_RISK_DAYS - upcomingExam.daysRemaining) * 2,
      topic: remainingTopics.find((topic) => !upcomingExam.subject || topic.subject === upcomingExam.subject) || null
    });
  }

  context.topics.filter((topic) => topic.needsRevision).forEach((topic) => {
    const latestRevision = context.revisionHistory
      .filter((entry) => entry.topicId === topic.id && entry.needsRevision)
      .sort((left, right) => right.changedAt.localeCompare(left.changedAt))[0];
    add({
      id: `revision:${topic.id}`,
      type: "revision",
      title: `${topic.subject} · ${topic.title} is marked for revision`,
      problem: "This topic is in your Need Revision list.",
      why: latestRevision
        ? `You marked it Need Revision on ${localDate(latestRevision.changedAt)}.`
        : "It is currently marked Need Revision in your saved syllabus.",
      action: `Review ${topic.title} and update its revision status when ready.`,
      actionLabel: "Start revision",
      href: "#syllabus-panel",
      priority: 80,
      topic
    });
  });

  const activityDates = [
    ...context.sessions.map((session) => session.date),
    ...context.quizAttempts.map((attempt) => localDate(attempt.attemptedAt)),
    ...context.planItems.filter((item) => item.status === "completed").map((item) => localDate(item.updatedAt)),
    ...context.topics.filter((topic) => topic.status === "completed" || topic.needsRevision)
      .map((topic) => localDate(topic.updatedAt))
  ].filter((date) => validDateKey(date) && date <= context.today);
  const latestActivityDate = activityDates.sort().at(-1) || null;
  const inactiveDays = latestActivityDate
    ? Math.floor((Date.parse(`${context.today}T00:00:00Z`) - Date.parse(`${latestActivityDate}T00:00:00Z`)) / DAY_MS)
    : null;
  if (inactiveDays !== null && inactiveDays >= INACTIVITY_DAYS) {
    add({
      id: "study-inactivity",
      type: "inactivity",
      title: "A gentle study reminder",
      problem: "Your study activity has been inactive recently. Start with a short focused session.",
      why: `Your latest saved study activity was ${inactiveDays} days ago.`,
      action: "Start with a short session on one topic you already know.",
      actionLabel: "Start a focus session",
      href: "#focus-panel",
      priority: 55
    });
  }

  const feedbackById = new Map(context.feedback.map((entry) => [entry.recommendationId, entry]));
  return recommendations
    .map((recommendation) => {
      const feedback = feedbackById.get(recommendation.id);
      if (!feedback) return { ...recommendation, feedback: null };
      const ageMs = Date.now() - Date.parse(feedback.updatedAt);
      if (feedback.value === "already_completed" && ageMs < DAY_MS) return null;
      if (feedback.value === "remind_me_later" && ageMs < 4 * 60 * 60 * 1000) return null;
      return {
        ...recommendation,
        priority: recommendation.priority + (feedback.value === "helpful" ? 5 : feedback.value === "not_helpful" ? -10 : 0),
        feedback: feedback.value
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

function analyzeStudyActivity(input) {
  const today = validDateKey(input.today) ? input.today : dayKey(new Date());
  const context = {
    today,
    profile: input.profile || null,
    subjects: input.subjects || [],
    topics: input.topics || [],
    sessions: input.sessions || [],
    exams: input.exams || [],
    planItems: input.planItems || [],
    tasks: input.tasks || [],
    quizAttempts: input.quizAttempts || [],
    revisionHistory: input.revisionHistory || [],
    feedback: input.feedback || []
  };
  const accuracy = calculateQuizAccuracy(input.quizAnswers || [], input.legacyAttemptsExcluded || 0);
  const validTopics = context.topics.filter((topic) => (
    topic && typeof topic.subject === "string" && typeof topic.title === "string"
  ));
  context.topics = validTopics;
  const completedTopics = validTopics.filter((topic) => topic.status === "completed").length;
  const remainingTopics = validTopics.length - completedTopics;
  const needsRevisionTopics = validTopics.filter((topic) => Boolean(topic.needsRevision));
  const progressPercent = validTopics.length ? Math.round(completedTopics / validTopics.length * 100) : 0;
  const todaySessions = context.sessions.filter((session) => session.date === today);
  const todayStudyMinutes = todaySessions.reduce((sum, session) => sum + (Number(session.durationMinutes) || 0), 0);
  const todayPlan = context.planItems.filter((item) => (
    item.date === today && item.status !== "skipped"
  ));
  const availableMinutesPerDay = Number(context.profile?.availableMinutesPerDay) > 0
    ? Number(context.profile.availableMinutesPerDay)
    : 0;
  const upcoming = context.exams
    .filter((exam) => validDateKey(exam.date) && exam.date >= today)
    .map((exam) => {
      const subjectTopics = exam.subject
        ? validTopics.filter((topic) => topic.subject === exam.subject)
        : validTopics;
      const completed = subjectTopics.filter((topic) => topic.status === "completed").length;
      const examProgress = subjectTopics.length ? Math.round(completed / subjectTopics.length * 100) : 0;
      const daysRemaining = Math.floor((Date.parse(`${exam.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
      return {
        ...exam,
        daysRemaining,
        progressPercent: exam.subject ? examProgress : progressPercent,
        remainingTopics: exam.subject ? subjectTopics.length - completed : remainingTopics
      };
    })
    .sort((left, right) => left.daysRemaining - right.daysRemaining || left.title.localeCompare(right.title));
  const upcomingExam = upcoming[0] || null;
  const completedTopicsToday = new Set(context.planItems
    .filter((item) => item.status === "completed" && item.topicId && localDate(item.updatedAt) === today)
    .map((item) => item.topicId)).size;
  const pendingTasksToday = context.tasks.filter((task) => (
    !task.completed && validDateKey(task.date) && task.date <= today
  )).length;
  const metrics = {
    todayStudyMinutes,
    availableMinutesPerDay,
    todayTargetMinutes: todayPlan.length
      ? todayPlan.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0)
      : availableMinutesPerDay,
    plannedStudyMinutes: todayPlan.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0),
    completedSessions: todaySessions.length,
    completedTopics,
    completedTopicsToday,
    totalTopics: validTopics.length,
    remainingTopics,
    needsRevisionCount: needsRevisionTopics.length,
    revisionUpdatesToday: context.revisionHistory.filter((entry) => localDate(entry.changedAt) === today).length,
    recentlyStudiedTopics: [...context.sessions]
      .filter((session) => validDateKey(session.date) && session.date <= today && session.topicId && session.topicTitle)
      .sort((left, right) => right.date.localeCompare(left.date)
        || (right.createdAt || "").localeCompare(left.createdAt || ""))
      .filter((session, index, rows) => rows.findIndex((candidate) => candidate.topicId === session.topicId) === index)
      .slice(0, 5)
      .map((session) => ({
        topicId: session.topicId,
        subject: session.subject,
        chapter: session.chapter,
        topic: session.topicTitle,
        date: session.date
      })),
    progressPercent,
    quizAttemptsToday: context.quizAttempts.filter((attempt) => localDate(attempt.attemptedAt) === today).length,
    quizAccuracyPercent: accuracy.totalAttempted ? accuracy.accuracyPercent : null,
    totalQuestionsAttempted: accuracy.totalAttempted,
    correctAnswers: accuracy.correctAnswers,
    pendingTasksToday
  };
  const recommendations = generateRecommendations(context, metrics, accuracy, upcomingExam);
  const sufficientData = Boolean(
    validTopics.length || context.sessions.length || accuracy.totalAttempted
  );
  const topAttentionTopics = [
    ...accuracy.topics.filter((topic) => topic.accuracyPercent <= 75 || topic.repeatedIncorrect),
    ...needsRevisionTopics.map((topic) => ({
      subject: topic.subject,
      chapter: topic.chapter,
      topic: topic.title,
      accuracyPercent: null,
      source: "revision"
    }))
  ].filter((topic, index, all) => all.findIndex((candidate) => (
    candidate.subject === topic.subject && candidate.topic === topic.topic
  )) === index).slice(0, 8);
  const latestActivityDates = [
    ...context.sessions.map((session) => session.date),
    ...context.quizAttempts.map((attempt) => localDate(attempt.attemptedAt)),
    ...context.planItems.filter((item) => item.status === "completed").map((item) => localDate(item.updatedAt)),
    ...context.topics.filter((topic) => topic.status === "completed" || topic.needsRevision)
      .map((topic) => localDate(topic.updatedAt))
  ].filter((date) => validDateKey(date) && date <= today).sort();

  return {
    today,
    status: !sufficientData
      ? "getting-started"
      : upcomingExam && upcomingExam.daysRemaining <= EXAM_RISK_DAYS
        && upcomingExam.remainingTopics > 0 && upcomingExam.progressPercent < 60
        ? "exam-risk"
        : recommendations.some((recommendation) => recommendation.priority >= 60)
          ? "needs-attention"
          : "on-track",
    sufficientData,
    metrics,
    upcomingExam,
    accuracy,
    strongTopics: accuracy.strongTopics,
    topicsNeedingAttention: topAttentionTopics,
    recentlyStudiedTopics: metrics.recentlyStudiedTopics,
    latestActivityDate: latestActivityDates.at(-1) || null,
    recommendations,
    dailyReport: {
      date: today,
      sufficientData,
      totalStudyMinutes: todayStudyMinutes,
      plannedStudyMinutes: metrics.plannedStudyMinutes,
      availableMinutesPerDay,
      completedSessions: todaySessions.length,
      completedTopics: completedTopicsToday,
      pendingTopics: remainingTopics,
      quizAttempts: metrics.quizAttemptsToday,
      quizAccuracyPercent: metrics.quizAccuracyPercent,
      revisionHistoryUpdatesToday: metrics.revisionUpdatesToday,
      recentlyStudiedTopics: metrics.recentlyStudiedTopics,
      strongTopics: accuracy.strongTopics,
      topicsNeedingRevision: needsRevisionTopics.map((topic) => ({
        id: topic.id,
        subject: topic.subject,
        chapter: topic.chapter,
        topic: topic.title
      })),
      nextRecommendedActivity: recommendations[0] || null
    }
  };
}

module.exports = {
  analyzeStudyActivity,
  calculateQuizAccuracy,
  validDateKey
};
