(() => {
  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function addDays(dateValue, offset) {
    if (!isValidDate(dateValue) || !Number.isInteger(offset)) return null;
    const date = new Date(`${dateValue}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  function daysBetween(startDate, endDate) {
    if (!isValidDate(startDate) || !isValidDate(endDate)) return null;
    return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000);
  }

  function getSubjectProgress(subject) {
    const chapters = Array.isArray(subject?.chapters) ? subject.chapters : [];
    const topics = chapters.flatMap((chapter) => Array.isArray(chapter.topics) ? chapter.topics : []);
    const completedTopics = topics.filter((topic) => topic.status === "completed").length;
    const incompleteTopics = topics.filter((topic) => topic.status !== "completed").length;
    const revisionTopics = topics.filter((topic) => topic.needsRevision).length;
    return {
      totalTopics: topics.length,
      completedTopics,
      incompleteTopics,
      revisionTopics,
      progressPercent: topics.length ? Math.round(completedTopics / topics.length * 100) : 0
    };
  }

  function buildSubjectSummaries(syllabus, exams, today) {
    const examsBySubject = new Map();
    (Array.isArray(exams) ? exams : []).filter((exam) => (
      typeof exam.subject === "string" && exam.subject.trim() && isValidDate(exam.date)
    )).forEach((exam) => {
      const key = exam.subject.trim().toLocaleLowerCase();
      const previous = examsBySubject.get(key);
      if (!previous
        || (exam.date >= today && previous.date < today)
        || ((exam.date >= today) === (previous.date >= today)
          && (exam.date >= today ? exam.date < previous.date : exam.date > previous.date))) {
        examsBySubject.set(key, exam);
      }
    });

    return (Array.isArray(syllabus?.subjects) ? syllabus.subjects : []).map((subject) => {
      const progress = getSubjectProgress(subject);
      const exam = examsBySubject.get(subject.name.trim().toLocaleLowerCase()) || null;
      return {
        name: subject.name,
        examDate: exam?.date || "",
        examTitle: exam?.title || "",
        daysRemaining: exam ? daysBetween(today, exam.date) : null,
        ...progress
      };
    });
  }

  function buildStudyRecommendations({ syllabus, exams, today, availableMinutesPerDay, blockMinutes = 30 }) {
    if (!isValidDate(today)) throw new Error("Choose a valid recommendation date.");
    if (!Number.isInteger(blockMinutes) || blockMinutes < 10) {
      throw new Error("Recommendation blocks must be at least 10 minutes.");
    }
    const dailyMinutes = Number.isInteger(availableMinutesPerDay) && availableMinutesPerDay > 0
      ? availableMinutesPerDay
      : 0;
    const summaries = buildSubjectSummaries(syllabus, exams, today);
    const summaryByName = new Map(summaries.map((subject) => [subject.name, subject]));
    const subjects = Array.isArray(syllabus?.subjects) ? syllabus.subjects : [];
    const candidates = subjects.flatMap((subject) => {
      const summary = summaryByName.get(subject.name);
      return (Array.isArray(subject.chapters) ? subject.chapters : []).flatMap((chapter) => (
        (Array.isArray(chapter.topics) ? chapter.topics : [])
          .filter((topic) => topic.status !== "completed" || topic.needsRevision)
          .map((topic) => {
            const daysRemaining = summary?.daysRemaining >= 0 ? summary.daysRemaining : null;
            const examUrgency = daysRemaining !== null && daysRemaining >= 0
              ? 120 / (daysRemaining + 1)
              : 0;
            const priorityScore = examUrgency
              + (summary?.incompleteTopics || 0) * 2
              + (topic.needsRevision ? 20 : 0)
              + (topic.status === "in_progress" ? 3 : 0);
            return {
              subject: subject.name,
              chapter: chapter.title,
              topic: topic.title,
              topicId: String(topic.id || ""),
              status: topic.status,
              needsRevision: Boolean(topic.needsRevision),
              examDate: daysRemaining === null ? "" : summary.examDate,
              examTitle: daysRemaining === null ? "" : summary.examTitle,
              daysRemaining,
              priorityScore
            };
          })
      ));
    }).sort((left, right) => (
      right.priorityScore - left.priorityScore
      || (left.daysRemaining ?? Infinity) - (right.daysRemaining ?? Infinity)
      || left.subject.localeCompare(right.subject)
      || left.topic.localeCompare(right.topic)
    ));
    const dailyCapacity = dailyMinutes
      ? Math.max(1, Math.floor(dailyMinutes / blockMinutes))
      : 0;
    return {
      dailyMinutes,
      items: candidates.slice(0, dailyCapacity)
    };
  }

  function priorityScore(candidate, remainingBySubject, scheduledDate) {
    const days = candidate.examDate ? daysBetween(scheduledDate, candidate.examDate) : null;
    const urgency = days !== null && days >= 0 ? 120 / (days + 1) : 0;
    const incompleteCount = remainingBySubject.get(candidate.subject) || 0;
    return urgency + incompleteCount * 2 + (candidate.needsRevision ? 1 : 0);
  }

  function scheduleStudyPlan({
    syllabus,
    exams,
    availableMinutesPerDay,
    startDate,
    days,
    blockMinutes = 30,
    excludedTopicIds = [],
    existingItems = []
  }) {
    if (!isValidDate(startDate)) throw new Error("Choose a valid plan start date.");
    if (!Number.isInteger(days) || days < 1 || days > 31) throw new Error("Plan length must be between 1 and 31 days.");
    if (!Number.isInteger(blockMinutes) || blockMinutes < 10 || blockMinutes > 120) {
      throw new Error("Study blocks must be between 10 and 120 minutes.");
    }
    const dailyMinutes = Number.isInteger(availableMinutesPerDay) && availableMinutesPerDay > 0
      ? availableMinutesPerDay
      : 0;
    const endDate = addDays(startDate, days - 1);
    const subjectSummaries = buildSubjectSummaries(syllabus, exams, startDate);
    const subjectByName = new Map(subjectSummaries.map((subject) => [subject.name, subject]));
    const excluded = new Set(excludedTopicIds.map(String));
    const candidates = (Array.isArray(syllabus?.subjects) ? syllabus.subjects : []).flatMap((subject) => (
      (Array.isArray(subject.chapters) ? subject.chapters : []).flatMap((chapter) => (
        (Array.isArray(chapter.topics) ? chapter.topics : [])
          .filter((topic) => topic.status !== "completed" || topic.needsRevision)
          .filter((topic) => !excluded.has(String(topic.id || "")))
          .map((topic) => ({
            subject: subject.name,
            topic: topic.title,
            topicId: String(topic.id || ""),
            chapter: chapter.title,
            needsRevision: Boolean(topic.needsRevision),
            examDate: subjectByName.get(subject.name)?.examDate || "",
            minutes: topic.needsRevision && topic.status === "completed"
              ? Math.min(20, blockMinutes)
              : blockMinutes
          }))
      ))
    ));
    const remainingBySubject = new Map(subjectSummaries.map((subject) => [subject.name, subject.incompleteTopics]));
    const dailyCapacity = new Map(Array.from({ length: days }, (_, offset) => {
      const date = addDays(startDate, offset);
      const occupiedMinutes = existingItems
        .filter((item) => item.status !== "skipped" && item.date === date)
        .reduce((total, item) => total + (Number(item.minutes) || 0), 0);
      return [date, Math.max(0, dailyMinutes - occupiedMinutes)];
    }));
    const items = [];

    for (let offset = 0; offset < days && candidates.length && dailyMinutes > 0; offset += 1) {
      const scheduledDate = addDays(startDate, offset);
      let remainingMinutes = dailyCapacity.get(scheduledDate) || 0;
      while (remainingMinutes >= 10 && candidates.length) {
        const eligible = candidates
          .filter((candidate) => !candidate.examDate || candidate.examDate !== scheduledDate)
          .sort((left, right) => {
            const scoreDifference = priorityScore(right, remainingBySubject, scheduledDate)
              - priorityScore(left, remainingBySubject, scheduledDate);
            if (scoreDifference) return scoreDifference;
            return left.subject.localeCompare(right.subject) || left.topic.localeCompare(right.topic);
          });
        if (!eligible.length) break;
        const candidate = eligible[0];
        const duration = Math.min(candidate.minutes, remainingMinutes);
        if (duration < 10) break;
        candidates.splice(candidates.indexOf(candidate), 1);
        items.push({
          subject: candidate.subject,
          topic: candidate.topic,
          topicId: candidate.topicId,
          chapter: candidate.chapter,
          date: scheduledDate,
          minutes: duration,
          priority: candidate.needsRevision
            || (candidate.examDate && (daysBetween(scheduledDate, candidate.examDate) ?? Infinity) <= 3)
            ? "high"
            : "medium",
          kind: candidate.needsRevision ? "revision" : "study",
          examDate: candidate.examDate,
          status: "planned"
        });
        remainingMinutes -= duration;
        remainingBySubject.set(candidate.subject, Math.max(0, (remainingBySubject.get(candidate.subject) || 0) - 1));
      }
    }

    const unscheduledTopics = candidates.length;
    const requiredMinutes = items.reduce((total, item) => total + item.minutes, 0)
      + candidates.reduce((total, candidate) => total + candidate.minutes, 0);
    const capacityMinutes = [...dailyCapacity.values()].reduce((total, minutes) => total + minutes, 0);
    const warning = !dailyMinutes && unscheduledTopics
      ? "Daily study availability is zero. Update your profile before scheduling topics."
      : unscheduledTopics
        ? `${unscheduledTopics} topic${unscheduledTopics === 1 ? "" : "s"} will not fit before the end of this plan (${requiredMinutes} minutes of work versus ${capacityMinutes} available minutes), or have an exam date that leaves no study day before the exam.`
        : "";

    return {
      startDate,
      endDate,
      days,
      blockMinutes,
      dailyMinutes,
      subjectSummaries,
      items,
      unscheduledTopics,
      requiredMinutes,
      capacityMinutes,
      warning
    };
  }

  const engine = {
    isValidDate,
    addDays,
    daysBetween,
    getSubjectProgress,
    buildSubjectSummaries,
    buildStudyRecommendations,
    scheduleStudyPlan
  };
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
  globalThis.StudyPlanEngine = engine;
})();
