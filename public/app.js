(() => {
  const $ = (id) => document.getElementById(id);
  const dashboard = $("dashboard");
  [
    ".welcome",
    ".dashboard-stats",
    "#accuracy-panel",
    "#ai-monitor-card",
    "#ai-monitor-panel",
    "#dashboardRevisionPanel",
    "#planner-panel",
    "#exams-panel",
    "#syllabus-panel",
    "#dashboard-activity",
    ".overview-grid",
    ".grid",
    "#academic-panel",
    "#materials-panel",
    "#subjectOptions",
    "footer"
  ].forEach((selector) => dashboard.append(dashboard.querySelector(selector)));
  const elements = {
    tasks: $("tasks"),
    empty: $("empty"),
    dialog: $("dialog"),
    form: $("form"),
    taskId: $("taskId"),
    title: $("title"),
    subject: $("subject"),
    topic: $("topic"),
    priority: $("priority"),
    recurrence: $("recurrence"),
    date: $("date"),
    time: $("time"),
    details: $("details"),
    search: $("search"),
    subjectFilter: $("subjectFilter"),
    statusFilter: $("statusFilter"),
    notes: $("notes"),
    toast: $("toast"),
    exams: $("exams"),
    examDialog: $("examDialog"),
    examForm: $("examForm"),
    profileForm: $("profileForm"),
    profileSubmit: $("saveProfile"),
    syllabusSubjects: $("syllabusSubjects"),
    studySessionForm: $("studySessionForm"),
    syllabusDialog: $("syllabusDialog"),
    syllabusEditForm: $("syllabusEditForm")
  };
  const state = { tasks: [], exams: [], subjects: [], sessions: [], settings: { weeklyGoalMinutes: 600 }, report: null, profile: null, syllabus: null, planBlocks: [], planResult: null, planItems: [], planMetadata: null, materials: [], checklist: [], flashcards: [], flashcardOrder: [], flashcardIndex: 0, flashcardShowingAnswer: false, questions: [], quizQuestions: [], quizAnswers: {}, quizProgress: null, quizAttempts: [], quizAccuracy: null, aiMonitorSummary: null, aiMonitorRecommendations: null, aiMonitorDailyReport: null, materialScopeReady: false, loadStatus: "loading" };
  let toastTimer;
  let noteTimer;
  let timerInterval;
  let quizSaveQueue = Promise.resolve();
  let timerSeconds = 25 * 60;
  let timerEndAt = 0;
  let selectedDate = dateKey(new Date());
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        message = (await response.json()).error || message;
      } catch {
        // Keep the HTTP status message when the server did not return JSON.
      }
      throw new Error(message);
    }
    return response.status === 204 ? null : response.json();
  }

  function formatDate(date) {
    return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function setSubjects(subjects) {
    state.subjects = [...new Set(subjects.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $("subjectOptions").innerHTML = state.subjects.map((subject) => `<option value="${escapeHtml(subject)}"></option>`).join("");
    const oldFilter = elements.subjectFilter.value;
    elements.subjectFilter.innerHTML = '<option value="all">All subjects</option>'
      + state.subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("");
    elements.subjectFilter.value = state.subjects.includes(oldFilter) ? oldFilter : "all";
    $("subjects").innerHTML = state.subjects.map((subject) => `
      <span class="subject-chip">${escapeHtml(subject)}
        <button type="button" data-edit-subject="${escapeHtml(subject)}" aria-label="Rename ${escapeHtml(subject)}">✎</button>
        <button type="button" data-remove-subject="${escapeHtml(subject)}" aria-label="Remove ${escapeHtml(subject)}">×</button>
      </span>
    `).join("");
    $("subjectSetupEmpty").hidden = state.subjects.length > 0;
  }

  function renderSyllabus(data) {
    state.syllabus = data;
    $("syllabusLoading").hidden = true;
    $("syllabusError").hidden = true;
    $("syllabusContent").hidden = false;

    const overall = data.overall;
    $("syllabusCompletedTopics").textContent = `${overall.completedTopics} / ${overall.totalTopics}`;
    $("syllabusRemainingTopics").textContent = overall.totalTopics
      ? `${overall.remainingTopics} remaining`
      : "Add topics to start tracking";
    $("syllabusOverallPercent").textContent = `${overall.progressPercent}%`;
    $("syllabusOverallBar").style.width = `${overall.progressPercent}%`;
    $("syllabusOverallBar").parentElement.setAttribute("aria-valuenow", String(overall.progressPercent));
    $("syllabusRevisionCount").textContent = overall.needsRevision;

    const subjectSelect = $("studySubject");
    const selectedSubject = subjectSelect.value;
    subjectSelect.innerHTML = '<option value="">Choose subject</option>'
      + state.subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("");
    subjectSelect.value = state.subjects.includes(selectedSubject) ? selectedSubject : "";

    const topicSelect = $("studyTopic");
    const selectedTopic = topicSelect.value;
    const allTopics = data.subjects.flatMap((subject) => subject.chapters.flatMap((chapter) => (
      chapter.topics.map((topic) => ({ ...topic, subject: subject.name }))
    )));
    topicSelect.innerHTML = '<option value="">General session</option>'
      + allTopics.map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.subject)} · ${escapeHtml(topic.title)}</option>`).join("");
    if (allTopics.some((topic) => topic.id === selectedTopic)) topicSelect.value = selectedTopic;
    if (topicSelect.value) {
      const topic = allTopics.find((item) => item.id === topicSelect.value);
      if (topic) subjectSelect.value = topic.subject;
    }

    $("syllabusEmpty").hidden = data.subjects.length > 0;
    elements.syllabusSubjects.innerHTML = data.subjects.map((subject) => `
      <article class="syllabus-subject glass" data-syllabus-subject="${escapeHtml(subject.name)}">
        <div class="syllabus-subject-head">
          <div class="syllabus-subject-title">
            <span class="bubble cyan" aria-hidden="true">▤</span>
            <span><h3>${escapeHtml(subject.name)}</h3><small>${subject.completedChapters} of ${subject.chapters.length} chapters complete · ${subject.remainingChapters} remaining</small></span>
          </div>
          <div class="subject-progress"><b>${subject.progressPercent}%</b><div class="track" role="progressbar" aria-label="${escapeHtml(subject.name)} topic progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${subject.progressPercent}"><div style="width:${subject.progressPercent}%"></div></div><small>${subject.completedTopics}/${subject.totalTopics} topics</small></div>
          <div class="actions">
            <button class="mini" type="button" data-syllabus-action="edit-subject" data-subject="${escapeHtml(subject.name)}" aria-label="Rename ${escapeHtml(subject.name)}">✎</button>
            <button class="mini" type="button" data-syllabus-action="delete-subject" data-subject="${escapeHtml(subject.name)}" aria-label="Delete ${escapeHtml(subject.name)}">×</button>
            <button class="outline compact" type="button" data-syllabus-action="add-chapter" data-subject="${escapeHtml(subject.name)}">＋ Chapter</button>
          </div>
        </div>
        ${subject.chapters.length ? `
          <div class="syllabus-chapters">${subject.chapters.map((chapter) => {
            const chapterCompleted = chapter.topics.length > 0 && chapter.topics.every((topic) => topic.status === "completed");
            return `
              <section class="syllabus-chapter" data-chapter-id="${escapeHtml(chapter.id)}">
                <div class="chapter-heading">
                  <span><b>${escapeHtml(chapter.title)}</b><small>${chapter.topics.length
                    ? `${chapter.topics.filter((topic) => topic.status === "completed").length} / ${chapter.topics.length} topics complete`
                    : "No topics added yet"}${chapterCompleted ? " · Complete" : ""}</small></span>
                  <span class="actions">
                    <button class="mini" type="button" data-syllabus-action="edit-chapter" data-id="${escapeHtml(chapter.id)}" aria-label="Rename chapter">✎</button>
                    <button class="mini" type="button" data-syllabus-action="delete-chapter" data-id="${escapeHtml(chapter.id)}" aria-label="Delete chapter">×</button>
                    <button class="outline compact" type="button" data-syllabus-action="add-topic" data-id="${escapeHtml(chapter.id)}">＋ Topic</button>
                  </span>
                </div>
                ${chapter.topics.length ? `<div class="syllabus-topics">${chapter.topics.map((topic) => `
                  <div class="syllabus-topic${topic.needsRevision ? " needs-revision" : ""}" data-topic-id="${escapeHtml(topic.id)}">
                    <div class="topic-name"><span class="topic-status-mark ${escapeHtml(topic.status)}" aria-hidden="true"></span><span><b>${escapeHtml(topic.title)}</b><small>${topic.minutesSpent ? `${topic.minutesSpent} minutes studied` : "No study time logged"}${topic.needsRevision ? " · Needs revision" : ""}</small></span></div>
                    <label class="topic-status-label"><span class="sr-only">Progress for ${escapeHtml(topic.title)}</span><select data-topic-status="${escapeHtml(topic.id)}"><option value="not_started"${topic.status === "not_started" ? " selected" : ""}>Not Started</option><option value="in_progress"${topic.status === "in_progress" ? " selected" : ""}>In Progress</option><option value="completed"${topic.status === "completed" ? " selected" : ""}>Completed</option></select></label>
                    <label class="revision-control"><input type="checkbox" data-topic-revision="${escapeHtml(topic.id)}"${topic.needsRevision ? " checked" : ""}><span>Revise</span></label>
                    <span class="actions"><button class="mini" type="button" data-syllabus-action="edit-topic" data-id="${escapeHtml(topic.id)}" aria-label="Rename topic">✎</button><button class="mini" type="button" data-syllabus-action="delete-topic" data-id="${escapeHtml(topic.id)}" aria-label="Delete topic">×</button></span>
                  </div>
                `).join("")}</div>` : ""}
              </section>
            `;
          }).join("")}</div>
        ` : '<p class="syllabus-no-chapters">No chapters yet. Add chapters from your own syllabus.</p>'}
      </article>
    `).join("");
  }

  function openSyllabusDialog(action, { id = "", subject = "", title = "" } = {}) {
    const config = {
      "edit-subject": ["Rename subject", "Subject name", subject],
      "add-chapter": ["Add chapter", "Chapter title", ""],
      "edit-chapter": ["Rename chapter", "Chapter title", title],
      "add-topic": ["Add topic", "Topic title", ""],
      "edit-topic": ["Rename topic", "Topic title", title]
    }[action];
    if (!config) return;
    $("syllabusDialogTitle").textContent = config[0];
    $("syllabusDialogLabel").textContent = config[1];
    $("syllabusDialogAction").value = action;
    $("syllabusDialogId").value = id;
    $("syllabusDialogSubject").value = subject;
    $("syllabusDialogValue").value = config[2];
    elements.syllabusDialog.showModal();
    $("syllabusDialogValue").focus();
  }

  function setProfileEducationFields(educationLevel) {
    const school = educationLevel === "school";
    const college = educationLevel === "college";
    $("schoolProfileFields").hidden = !school;
    $("collegeProfileFields").hidden = !college;
    $("classLevel").disabled = !school;
    ["course", "department", "yearOfStudy", "semester"].forEach((id) => {
      $(id).disabled = !college;
    });
  }

  function renderProfile(profile) {
    state.profile = profile;
    if (profile) {
      $("educationLevel").value = profile.educationLevel;
      $("classLevel").value = profile.classLevel === null ? "" : String(profile.classLevel);
      $("course").value = profile.course || "";
      $("department").value = profile.department || "";
      $("yearOfStudy").value = profile.yearOfStudy === null ? "" : String(profile.yearOfStudy);
      $("semester").value = profile.semester === null ? "" : String(profile.semester);
      $("availableHours").value = String(profile.availableMinutesPerDay / 60);
      $("profileStatus").textContent = "Profile saved on this device.";
      elements.profileSubmit.textContent = "Update profile";
      const education = profile.educationLevel === "school"
        ? `Class ${profile.classLevel} student`
        : [profile.course, profile.yearOfStudy ? `Year ${profile.yearOfStudy}` : ""].filter(Boolean).join(" · ");
      $("headerProfileTitle").textContent = education || "Student profile";
      $("greetingName").textContent = profile.educationLevel === "school"
        ? `Class ${profile.classLevel}`
        : profile.course || "student";
      const academicDetail = profile.educationLevel === "college" && profile.semester
        ? `Semester ${profile.semester} · `
        : "";
      $("headerProfileDetail").textContent = `${academicDetail}${formatMinutes(profile.availableMinutesPerDay)} available daily · Edit`;
    } else {
      elements.profileForm.reset();
      $("availableHours").value = "2";
      $("profileStatus").textContent = "No profile saved yet.";
      elements.profileSubmit.textContent = "Save profile";
      $("headerProfileTitle").textContent = "Student profile";
      $("headerProfileDetail").textContent = "Set up your study space · Edit";
      $("greetingName").textContent = "there";
    }
    setProfileEducationFields($("educationLevel").value);
    elements.profileForm.dataset.dirty = "false";
  }

  function renderPlanDraft() {
    const draft = $("plannerDraft");
    const rows = $("plannerRows");
    draft.hidden = state.planBlocks.length === 0;
    const days = new Map();
    state.planBlocks.forEach((block, index) => {
      if (!days.has(block.date)) days.set(block.date, []);
      days.get(block.date).push({ ...block, index });
    });
    rows.innerHTML = [...days.entries()].map(([date, blocks]) => `
      <section class="planner-day">
        <h4>${escapeHtml(formatDate(date))}</h4>
        <ul>${blocks.map((block) => `
          <li class="planner-block">
            <label class="planner-block-select"><input type="checkbox" data-plan-select="${block.index}"${block.selected ? " checked" : ""}><span class="sr-only">Select ${escapeHtml(block.topic)}</span></label>
            <span class="planner-block-copy"><b>${escapeHtml(block.subject)} · ${escapeHtml(block.topic)}</b><small>${block.minutes} min · ${block.kind === "revision" ? "Revision" : "Study"} · ${escapeHtml(block.priority)} priority${block.chapter ? ` · ${escapeHtml(block.chapter)}` : ""}</small>${block.examDate ? `<small class="planner-exam-hint">Exam: ${escapeHtml(formatDate(block.examDate))}</small>` : ""}</span>
          </li>`).join("")}</ul>
      </section>`).join("");
    const selectedCount = state.planBlocks.filter((block) => block.selected).length;
    $("plannerDraftSummary").textContent = `${state.planBlocks.length} blocks · ${selectedCount} selected · ${state.planResult?.dailyMinutes || 0} minutes/day · ${state.planResult?.startDate || ""} – ${state.planResult?.endDate || ""}`;
    syncPlanSelection();
  }

  function syncPlanSelection() {
    const checkboxes = [...$("plannerRows").querySelectorAll("[data-plan-select]")];
    const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
    $("savePlan").disabled = selected === 0;
    $("planSelectAll").checked = checkboxes.length > 0 && selected === checkboxes.length;
    $("planSelectAll").disabled = checkboxes.length === 0;
  }

  function renderPlanSubjects(subjects) {
    $("plannerSubjects").innerHTML = subjects.length ? subjects.map((subject) => {
      const examLabel = subject.daysRemaining === null
        ? "Exam date not set"
        : subject.daysRemaining < 0
          ? `Exam passed ${Math.abs(subject.daysRemaining)} day${Math.abs(subject.daysRemaining) === 1 ? "" : "s"} ago`
          : subject.daysRemaining === 0
            ? "Exam today"
            : `${subject.daysRemaining} day${subject.daysRemaining === 1 ? "" : "s"} until exam`;
      return `<article class="planner-subject-card"><b>${escapeHtml(subject.name)}</b><span>${subject.examDate ? `${escapeHtml(formatDate(subject.examDate))} · ${escapeHtml(subject.examTitle)}` : escapeHtml(examLabel)}</span><small>${escapeHtml(examLabel)} · ${subject.incompleteTopics} incomplete · ${subject.completedTopics}/${subject.totalTopics} topics complete (${subject.progressPercent}%)</small></article>`;
    }).join("") : '<p class="empty-copy">Add subjects and syllabus topics to build a plan.</p>';
  }

  function renderSavedPlan() {
    const items = state.planItems;
    const today = dateKey(new Date());
    const completed = items.filter((item) => item.status === "completed").length;
    const pending = items.filter((item) => item.status === "planned").length;
    const skipped = items.filter((item) => item.status === "skipped").length;
    const todayItems = items.filter((item) => item.date === today);
    const todayMinutes = todayItems.reduce((total, item) => total + item.minutes, 0);
    $("savedPlanSummary").textContent = items.length
      ? `${todayItems.length} blocks today · ${todayMinutes} min scheduled · ${pending} planned overall · ${completed} completed · ${skipped} skipped`
      : "No saved study blocks yet. Build and save a schedule to keep it on this device.";
    const renderItem = (item) => `
      <article class="planner-saved-item${item.status !== "planned" ? ` is-${item.status}` : ""}" data-saved-plan-id="${escapeHtml(item.id)}">
        <div class="planner-saved-item-main">
          <div><b>${escapeHtml(item.subject)} · ${escapeHtml(item.topic)}</b><small>${escapeHtml(formatDate(item.date))} · ${item.minutes} min · ${item.kind === "revision" ? "Revision" : "Study"} · ${escapeHtml(item.priority)} priority</small>${item.examDate ? `<small class="planner-exam-hint">Exam ${escapeHtml(formatDate(item.examDate))}</small>` : ""}</div>
          <span class="planner-state ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
        </div>
        ${item.status === "planned" ? `<div class="planner-item-actions"><button type="button" class="outline compact" data-plan-action="complete" data-id="${escapeHtml(item.id)}">Complete</button><button type="button" class="outline compact" data-plan-action="skip" data-id="${escapeHtml(item.id)}">Skip</button><form class="planner-reschedule" data-reschedule-id="${escapeHtml(item.id)}"><label><span class="sr-only">New date for ${escapeHtml(item.topic)}</span><input type="date" data-reschedule-date required min="${dateKey(new Date())}" value="${escapeHtml(item.date)}"></label><button class="outline compact" type="submit">Reschedule</button></form></div>` : ""}
      </article>`;
    const groupedItems = new Map();
    [...items].sort((left, right) => (
      Number(right.date === today) - Number(left.date === today) || left.date.localeCompare(right.date)
    )).forEach((item) => {
      if (!groupedItems.has(item.date)) groupedItems.set(item.date, []);
      groupedItems.get(item.date).push(item);
    });
    $("savedPlanItems").innerHTML = [...groupedItems.entries()].map(([date, dayItems]) => `
      <section class="saved-plan-day">
        <h4>${date === today ? "Today" : escapeHtml(new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" }))} · ${escapeHtml(formatDate(date))}</h4>
        ${dayItems.map(renderItem).join("")}
      </section>
    `).join("");
  }

  function renderDashboardSummary() {
    const today = dateKey(new Date());
    const upcomingExam = state.exams
      .filter((exam) => exam.date >= today)
      .sort((left, right) => left.date.localeCompare(right.date) || (left.time || "").localeCompare(right.time || ""))[0];
    const todayMinutes = state.sessions
      .filter((session) => session.date === today)
      .reduce((total, session) => total + session.durationMinutes, 0);
    const totalStudyMinutes = state.sessions.reduce((total, session) => total + session.durationMinutes, 0);
    const syllabus = state.syllabus?.overall;
    const todayPlan = state.planItems.filter((item) => item.date === today && item.status !== "skipped");
    const todayPlanMinutes = todayPlan.reduce((total, item) => total + item.minutes, 0);
    const targetMinutes = todayPlan.length
      ? todayPlanMinutes
      : state.profile?.availableMinutesPerDay || 0;
    const dueTasks = state.tasks.filter((task) => !task.completed && task.date === today).length;

    $("syllabusMetric").textContent = syllabus ? `${syllabus.progressPercent}%` : "—";
    $("syllabusMetricCaption").textContent = syllabus
      ? `${syllabus.completedTopics} of ${syllabus.totalTopics} topics complete`
      : "progress from saved topics";
    $("remainingTopicsMetric").textContent = syllabus ? syllabus.remainingTopics : "—";
    $("revisionTopicsMetric").textContent = syllabus ? syllabus.needsRevision : "—";
    $("dailyTargetMetric").textContent = targetMinutes ? formatMinutes(targetMinutes) : "Not set";
    $("dailyTargetCaption").textContent = todayPlan.length
      ? `${todayPlan.length} saved plan block${todayPlan.length === 1 ? "" : "s"}`
      : state.profile ? "daily availability · no plan saved" : "set availability in your profile";
    $("upcomingExamMetric").textContent = upcomingExam ? upcomingExam.title : "None";
    $("upcomingExamCaption").textContent = upcomingExam
      ? `${upcomingExam.subject ? `${upcomingExam.subject} · ` : ""}${formatDate(upcomingExam.date)}`
      : "no upcoming exam saved";
    $("studyTimeMetric").textContent = formatMinutes(todayMinutes);
    $("focusSessionSummary").textContent = state.sessions.length
      ? `${state.sessions.length} completed session${state.sessions.length === 1 ? "" : "s"} · ${formatMinutes(totalStudyMinutes)} total study time recorded`
      : "No completed study sessions recorded yet.";
    const accuracy = state.quizAccuracy;
    $("quizPerformanceMetric").textContent = accuracy?.totalAttempted
      ? `${accuracy.accuracyPercent}%`
      : "No answers";
    $("quizPerformanceCaption").textContent = accuracy?.totalAttempted
      ? `${accuracy.correctAnswers}/${accuracy.totalAttempted} saved answers correct`
      : "complete a quiz to start tracking";
    renderQuizAccuracy();
    const revisionTopics = (state.syllabus?.subjects || []).flatMap((subject) => (
      subject.chapters.flatMap((chapter) => chapter.topics
        .filter((topic) => topic.needsRevision)
        .map((topic) => ({ subject: subject.name, chapter: chapter.title, topic: topic.title })))
    ));
    $("dashboardRevisionTopics").innerHTML = revisionTopics.length
      ? revisionTopics.slice(0, 8).map((topic) => `<article class="dashboard-revision-item"><b>${escapeHtml(topic.subject)} · ${escapeHtml(topic.topic)}</b><small>${escapeHtml(topic.chapter)}</small></article>`).join("")
      : '<p class="empty-copy">No topics are currently marked Need Revision.</p>';
    $("todaySummary").textContent = targetMinutes
      ? `${formatMinutes(todayMinutes)} studied · ${formatMinutes(targetMinutes)} target · ${dueTasks} task${dueTasks === 1 ? "" : "s"} due today`
      : `${todayPlan.length} saved plan block${todayPlan.length === 1 ? "" : "s"} · ${dueTasks} task${dueTasks === 1 ? "" : "s"} due today`;
  }

  function monitorStatusLabel(status) {
    return ({
      "on-track": "On Track",
      "needs-attention": "Needs Attention",
      "exam-risk": "Exam Risk",
      "getting-started": "Getting Started"
    })[status] || "Status unavailable";
  }

  async function refreshAiMonitor() {
    const [summary, recommendations, dailyReport] = await Promise.all([
      api("/api/ai-monitor/summary").catch((error) => ({ error: error.message })),
      api("/api/ai-monitor/recommendations").catch((error) => ({ error: error.message })),
      api("/api/ai-monitor/daily-report").catch((error) => ({ error: error.message }))
    ]);
    state.aiMonitorSummary = summary;
    state.aiMonitorRecommendations = recommendations;
    state.aiMonitorDailyReport = dailyReport;
    renderAiMonitor();
  }

  function renderAiMonitor() {
    const summary = state.aiMonitorSummary;
    const recommendationData = state.aiMonitorRecommendations;
    const report = state.aiMonitorDailyReport;
    const error = [summary, recommendationData, report].find((data) => data?.error);
    const cardRecommendation = $("aiMonitorCardRecommendation");
    const recommendationList = $("aiMonitorRecommendations");

    if (error) {
      const message = `Monitor unavailable: ${error.error}`;
      $("aiMonitorCardStatus").textContent = "Unavailable";
      $("aiMonitorStatus").textContent = "Unavailable";
      $("aiMonitorCardStatus").className = "ai-monitor-status getting-started";
      $("aiMonitorStatus").className = "ai-monitor-status getting-started";
      ["aiMonitorCardStudy", "aiMonitorCardTarget", "aiMonitorCardSyllabus", "aiMonitorCardAccuracy",
        "aiMonitorStudyTime", "aiMonitorTarget", "aiMonitorSyllabus", "aiMonitorAccuracy", "aiMonitorExam",
        "aiMonitorAttentionCount"].forEach((id) => { $(id).textContent = "—"; });
      cardRecommendation.textContent = message;
      recommendationList.innerHTML = `<p class="ai-monitor-empty">${escapeHtml(message)}</p>`;
      $("aiMonitorDailyReport").innerHTML = `<p class="ai-monitor-empty">${escapeHtml(message)}</p>`;
      $("aiMonitorStrongTopics").innerHTML = "";
      $("aiMonitorWeakTopics").innerHTML = "";
      $("aiMonitorRecentTopics").innerHTML = "";
      console.error(message);
      return;
    }

    const metrics = summary.metrics;
    const accuracyText = metrics.quizAccuracyPercent === null
      ? "No saved answers"
      : `${metrics.quizAccuracyPercent}%`;
    const targetText = metrics.todayTargetMinutes
      ? formatMinutes(metrics.todayTargetMinutes)
      : "Not set";
    const statusText = monitorStatusLabel(summary.status);
    $("aiMonitorCardStatus").textContent = statusText;
    $("aiMonitorStatus").textContent = statusText;
    $("aiMonitorCardStatus").className = `ai-monitor-status ${summary.status}`;
    $("aiMonitorStatus").className = `ai-monitor-status ${summary.status}`;
    $("aiMonitorCardStudy").textContent = formatMinutes(metrics.todayStudyMinutes);
    $("aiMonitorCardTarget").textContent = targetText;
    $("aiMonitorCardSyllabus").textContent = `${metrics.progressPercent}%`;
    $("aiMonitorCardAccuracy").textContent = accuracyText;
    $("aiMonitorStudyTime").textContent = formatMinutes(metrics.todayStudyMinutes);
    $("aiMonitorTarget").textContent = targetText;
    $("aiMonitorSyllabus").textContent = `${metrics.progressPercent}% · ${metrics.remainingTopics} remaining`;
    $("aiMonitorAccuracy").textContent = accuracyText;
    $("aiMonitorExam").textContent = summary.upcomingExam
      ? `${summary.upcomingExam.title} · ${summary.upcomingExam.daysRemaining === 0 ? "today" : `${summary.upcomingExam.daysRemaining} days`}`
      : "No upcoming exam saved";
    $("aiMonitorAttentionCount").textContent = String(summary.topicsNeedingAttention.length);

    const recommendations = recommendationData.recommendations || [];
    const topRecommendation = summary.topRecommendation;
    cardRecommendation.textContent = topRecommendation
      ? `${topRecommendation.problem} Next: ${topRecommendation.action}`
      : summary.sufficientData
        ? "No immediate issues detected. Continue with your saved study plan."
        : "Not enough study data yet. Complete a few study sessions or quizzes to generate recommendations.";
    recommendationList.innerHTML = recommendations.length
      ? recommendations.map((item) => `
        <article class="ai-monitor-recommendation">
          <h4>${escapeHtml(item.title)}</h4>
          <p><b>Problem:</b> ${escapeHtml(item.problem)}</p>
          <p><b>Why it matters:</b> ${escapeHtml(item.why)}</p>
          <p><b>Recommended action:</b> ${escapeHtml(item.action)}</p>
          <div class="ai-monitor-recommendation-actions">
            <a class="primary" href="${escapeHtml(item.href)}">${escapeHtml(item.actionLabel)}</a>
            <button class="ai-monitor-feedback" type="button" data-monitor-feedback="helpful" data-recommendation-id="${escapeHtml(item.id)}">Helpful</button>
            <button class="ai-monitor-feedback" type="button" data-monitor-feedback="not_helpful" data-recommendation-id="${escapeHtml(item.id)}">Not Helpful</button>
            <button class="ai-monitor-feedback" type="button" data-monitor-feedback="already_completed" data-recommendation-id="${escapeHtml(item.id)}">Already Completed</button>
            <button class="ai-monitor-feedback" type="button" data-monitor-feedback="remind_me_later" data-recommendation-id="${escapeHtml(item.id)}">Remind Me Later</button>
          </div>
        </article>
      `).join("")
      : `<p class="ai-monitor-empty">${summary.sufficientData
        ? "No immediate study issues detected from your saved data."
        : "Not enough study data yet. Complete a few study sessions or quizzes to generate recommendations."}</p>`;

    const reportStats = [
      ["Total study time", formatMinutes(report.totalStudyMinutes)],
      ["Planned study time", report.plannedStudyMinutes ? formatMinutes(report.plannedStudyMinutes) : "No saved plan for today"],
      ["Completed sessions", report.completedSessions],
      ["Topics completed today", report.completedTopics],
      ["Pending topics", report.pendingTopics],
      ["Quiz attempts today", report.quizAttempts],
      ["Quiz / Practice Accuracy", report.quizAccuracyPercent === null ? "No saved answers" : `${report.quizAccuracyPercent}%`],
      ["Revision updates today", report.revisionHistoryUpdatesToday],
      ["Questions answered correctly", `${summary.accuracy.correctAnswers} / ${summary.accuracy.totalAttempted}`],
      ["Next recommended activity", report.nextRecommendedActivity?.action || "Continue your saved study plan"]
    ];
    $("aiMonitorDailyReport").innerHTML = report.sufficientData
      ? reportStats.map(([label, value]) => `<article class="ai-monitor-report-stat"><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></article>`).join("")
      : '<p class="ai-monitor-empty">Not enough study data yet. Complete a few study sessions or quizzes to generate recommendations.</p>';

    const renderTopics = (topics, emptyMessage, valueFor) => topics.length
      ? topics.slice(0, 6).map((topic) => `<div class="ai-monitor-topic-chip">${escapeHtml(topic.subject)} · ${escapeHtml(topic.topic)}${valueFor(topic)}</div>`).join("")
      : `<p class="ai-monitor-empty">${emptyMessage}</p>`;
    $("aiMonitorStrongTopics").innerHTML = renderTopics(
      summary.accuracy.strongTopics,
      "No consistently strong topics recorded yet.",
      (topic) => ` · ${topic.accuracyPercent}%`
    );
    $("aiMonitorWeakTopics").innerHTML = renderTopics(
      [...summary.accuracy.topicsNeedingPractice, ...(report.topicsNeedingRevision || []).map((topic) => ({
        subject: topic.subject,
        topic: topic.topic,
        accuracyPercent: null
      }))].filter((topic, index, all) => all.findIndex((candidate) => (
        candidate.subject === topic.subject && candidate.topic === topic.topic
      )) === index),
      "No quiz practice or revision topics need attention yet.",
      (topic) => topic.accuracyPercent === null
        ? " · marked for revision"
        : ` · ${topic.accuracyPercent}% accuracy`
    );
    $("aiMonitorRecentTopics").innerHTML = renderTopics(
      summary.recentlyStudiedTopics || [],
      "No linked syllabus topics have study sessions yet.",
      (topic) => ` · ${escapeHtml(topic.date)}`
    );
  }

  $("aiMonitorRecommendations").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-monitor-feedback]");
    if (!button) return;
    button.disabled = true;
    try {
      await api("/api/ai-monitor/feedback", {
        method: "POST",
        body: JSON.stringify({
          recommendationId: button.dataset.recommendationId,
          feedback: button.dataset.monitorFeedback
        })
      });
      await refreshAiMonitor();
      toast("Recommendation feedback saved on this device");
    } catch (error) {
      button.disabled = false;
      toast(`Feedback could not be saved: ${error.message}`);
    }
  });

  function accuracyBar(value) {
    const percent = Math.max(0, Math.min(100, Number(value) || 0));
    return `<div class="accuracy-track" role="progressbar" aria-label="Quiz practice accuracy" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>`;
  }

  function accuracyRecommendation(value) {
    if (value < 50) return "Revise this topic.";
    if (value <= 75) return "Practice this topic more.";
    return "Review, then try a slightly harder practice quiz.";
  }

  function renderQuizAccuracy() {
    const accuracy = state.quizAccuracy;
    const empty = '<p class="empty-copy">Complete a saved practice quiz to see actual answer results here.</p>';
    if (!accuracy) {
      $("overallAccuracyValue").textContent = "—";
      $("overallAccuracyCount").textContent = "Accuracy unavailable";
      $("accuracyCorrectCount").textContent = "—";
      $("accuracyIncorrectCount").textContent = "—";
      $("accuracyTrendValue").textContent = "—";
      $("accuracyTrendCaption").textContent = "Trend unavailable";
      ["subjectAccuracyList", "topicAccuracyList", "recentAccuracyList", "strongTopicsList", "practiceTopicsList"]
        .forEach((id) => { $(id).innerHTML = empty; });
      return;
    }

    $("overallAccuracyValue").textContent = accuracy.totalAttempted ? `${accuracy.accuracyPercent}%` : "—";
    $("overallAccuracyCount").textContent = accuracy.totalAttempted
      ? `${accuracy.totalAttempted} questions attempted`
      : "No saved quiz answers yet";
    $("accuracyCorrectCount").textContent = accuracy.correctAnswers;
    $("accuracyIncorrectCount").textContent = accuracy.incorrectAnswers;
    if (accuracy.recentTrend) {
      const trend = accuracy.recentTrend;
      const change = Math.abs(trend.percentagePointChange);
      const sign = trend.percentagePointChange > 0 ? "+" : "";
      $("accuracyTrendValue").textContent = `${sign}${trend.percentagePointChange} pp`;
      $("accuracyTrendValue").className = `accuracy-trend ${trend.direction}`;
      $("accuracyTrendCaption").textContent = `${trend.direction} · previous quiz ${trend.previousPercent}% → latest ${trend.currentPercent}%`;
    } else {
      $("accuracyTrendValue").textContent = "—";
      $("accuracyTrendValue").className = "accuracy-trend";
      $("accuracyTrendCaption").textContent = "Complete another quiz to compare";
    }

    $("subjectAccuracyList").innerHTML = accuracy.subjects.length
      ? accuracy.subjects.map((subject) => `
        <article class="accuracy-row"><div class="accuracy-row-head"><b>${escapeHtml(subject.subject)}</b><strong>${subject.accuracyPercent}%</strong></div>${accuracyBar(subject.accuracyPercent)}<small>${subject.correctAnswers} correct · ${subject.incorrectAnswers} incorrect · ${subject.totalAttempted} attempted</small></article>`
      ).join("")
      : empty;

    $("topicAccuracyList").innerHTML = accuracy.topics.length
      ? accuracy.topics.slice(0, 8).map((topic) => `
        <article class="accuracy-row"><div class="accuracy-row-head"><b>${escapeHtml(topic.subject)} · ${escapeHtml(topic.topic)}</b><strong>${topic.accuracyPercent}%</strong></div>${accuracyBar(topic.accuracyPercent)}<small>${escapeHtml(topic.chapter || "Chapter not set")} · ${topic.correctAnswers} correct · ${topic.incorrectAnswers} incorrect${topic.repeatedIncorrect ? " · repeatedly missed" : ""}</small></article>`
      ).join("")
      : empty;

    $("recentAccuracyList").innerHTML = accuracy.recentAttempts.length
      ? accuracy.recentAttempts.map((attempt) => `
        <article class="accuracy-row"><div class="accuracy-row-head"><b>${escapeHtml(attempt.subjects.join(", ") || "Practice quiz")}</b><strong>${attempt.accuracyPercent}%</strong></div><small>${attempt.correctAnswers}/${attempt.totalAttempted} correct · ${escapeHtml(attempt.chapters.join(", ") || "All chapters")} · ${escapeHtml(new Date(attempt.attemptedAt).toLocaleString())}</small></article>`
      ).join("")
      : empty;

    $("strongTopicsList").innerHTML = accuracy.strongTopics.length
      ? accuracy.strongTopics.slice(0, 8).map((topic) => `
        <article class="accuracy-row accuracy-strong"><div class="accuracy-row-head"><b>${escapeHtml(topic.subject)} · ${escapeHtml(topic.topic)}</b><strong>${topic.accuracyPercent}%</strong></div>${accuracyBar(topic.accuracyPercent)}<small>${topic.correctAnswers}/${topic.totalAttempted} correct across saved answers</small></article>`
      ).join("")
      : '<p class="empty-copy">No topic has at least three saved answers above 75% yet.</p>';

    $("practiceTopicsList").innerHTML = accuracy.topicsNeedingPractice.length
      ? accuracy.topicsNeedingPractice.slice(0, 8).map((topic) => `
        <article class="accuracy-row${topic.repeatedIncorrect ? " accuracy-needs-practice" : ""}"><div class="accuracy-row-head"><b>${escapeHtml(topic.subject)} · ${escapeHtml(topic.topic)}</b><strong>${topic.accuracyPercent}%</strong></div>${accuracyBar(topic.accuracyPercent)}<small>${topic.correctAnswers} correct · ${topic.incorrectAnswers} incorrect · ${topic.repeatedIncorrect ? "Repeated incorrect answers. " : ""}${escapeHtml(topic.recommendation || accuracyRecommendation(topic.accuracyPercent))}</small></article>`
      ).join("")
      : '<p class="empty-copy">No saved topics currently meet the practice recommendation rules.</p>';
  }

  function currentPlanFingerprint() {
    const subjects = (state.syllabus?.subjects || []).map((subject) => ({
      name: subject.name,
      topics: subject.chapters.flatMap((chapter) => chapter.topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        status: topic.status,
        needsRevision: Boolean(topic.needsRevision)
      }))).sort((a, b) => String(a.id).localeCompare(String(b.id)))
    })).sort((a, b) => a.name.localeCompare(b.name));
    const exams = state.exams.map((exam) => ({
      subject: exam.subject || "",
      title: exam.title || "",
      date: exam.date || ""
    })).sort((a, b) => `${a.subject}:${a.date}:${a.title}`.localeCompare(`${b.subject}:${b.date}:${b.title}`));
    return JSON.stringify({ availableMinutesPerDay: state.profile?.availableMinutesPerDay || 0, subjects, exams });
  }

  function handledPlanTopicIds(today = dateKey(new Date())) {
    return state.planItems
      .filter((item) => (item.status !== "planned" || item.date < today) && item.topicId)
      .map((item) => item.topicId);
  }

  function updatePlanCoverageWarning() {
    if (!state.planMetadata) return;
    const estimate = window.StudyPlanEngine.scheduleStudyPlan({
      syllabus: state.syllabus,
      exams: state.exams,
      availableMinutesPerDay: state.profile?.availableMinutesPerDay || 0,
      startDate: dateKey(new Date()),
      days: state.planMetadata.days,
      blockMinutes: state.planMetadata.blockMinutes || 30,
      excludedTopicIds: state.planItems.map((item) => item.topicId).filter(Boolean),
      existingItems: state.planItems
    });
    $("plannerWarning").textContent = estimate.warning
      ? `Saved plan coverage: ${estimate.warning}`
      : "";
    $("plannerWarning").hidden = !estimate.warning;
  }

  async function recalculateSavedPlanIfNeeded() {
    const metadata = state.planMetadata;
    if (!metadata) return;
    const today = dateKey(new Date());
    if (metadata.fingerprint === currentPlanFingerprint() && metadata.startDate >= today) {
      updatePlanCoverageWarning();
      return;
    }
    const startDate = dateKey(new Date());
    const result = window.StudyPlanEngine.scheduleStudyPlan({
      syllabus: state.syllabus,
      exams: state.exams,
      availableMinutesPerDay: state.profile?.availableMinutesPerDay || 0,
      startDate,
      days: metadata.days,
      blockMinutes: metadata.blockMinutes || 30,
      excludedTopicIds: handledPlanTopicIds(startDate),
      existingItems: state.planItems.filter((item) => item.status === "completed")
    });
    await api("/api/study-plan/recalculate", {
      method: "POST",
      body: JSON.stringify({
        ...result,
        fingerprint: currentPlanFingerprint(),
        items: result.items
      })
    });
    const saved = await api("/api/study-plan");
    state.planItems = saved.items;
    state.planMetadata = saved.metadata;
    renderSavedPlan();
    $("savedPlanMessage").textContent = result.warning
      ? `Future plan recalculated. ${result.warning}`
      : "Future study plan recalculated from your updated profile, progress, or exam dates.";
    $("savedPlanMessage").hidden = false;
    updatePlanCoverageWarning();
  }

  function renderFlashcards() {
    const selectedSubject = $("flashcardSubjectFilter").value;
    const subjects = [...new Set(state.flashcards.map((card) => card.subject))]
      .sort((left, right) => left.localeCompare(right));
    $("flashcardSubjectFilter").innerHTML = '<option value="">All subjects</option>'
      + subjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("");
    $("flashcardSubjectFilter").value = subjects.includes(selectedSubject) ? selectedSubject : "";
    const previousChapter = $("flashcardChapterFilter").value;
    const chapters = [...new Set(state.flashcards
      .filter((card) => !$("flashcardSubjectFilter").value || card.subject === $("flashcardSubjectFilter").value)
      .map((card) => card.chapter))]
      .sort((left, right) => left.localeCompare(right));
    $("flashcardChapterFilter").innerHTML = '<option value="">All chapters</option>'
      + chapters.map((chapter) => `<option value="${escapeHtml(chapter)}">${escapeHtml(chapter)}</option>`).join("");
    $("flashcardChapterFilter").value = chapters.includes(previousChapter) ? previousChapter : "";
    const cards = state.flashcards.filter((card) => (
      (!$("flashcardSubjectFilter").value || card.subject === $("flashcardSubjectFilter").value)
      && (!$("flashcardChapterFilter").value || card.chapter === $("flashcardChapterFilter").value)
    ));
    const order = state.flashcardOrder.filter((id) => cards.some((card) => card.id === id));
    cards.forEach((card) => { if (!order.includes(card.id)) order.push(card.id); });
    state.flashcardOrder = order;
    const deck = order.map((id) => cards.find((card) => card.id === id)).filter(Boolean);
    const knownCount = deck.filter((card) => card.known).length;
    const reviewCount = deck.reduce((total, card) => total + card.reviewCount, 0);
    $("flashcardProgress").textContent = deck.length
      ? `${knownCount}/${deck.length} known · ${reviewCount} reviews`
      : "No cards in this deck";
    $("flashcardStudy").hidden = deck.length === 0;
    $("flashcardEmpty").hidden = deck.length > 0;
    if (!deck.length) return;
    state.flashcardIndex = Math.max(0, Math.min(state.flashcardIndex, deck.length - 1));
    const card = deck[state.flashcardIndex];
    $("flashcardPosition").textContent = `Card ${state.flashcardIndex + 1} of ${deck.length}`;
    $("flashcardPrompt").textContent = card.question;
    $("flashcardAnswerText").textContent = card.answer;
    $("flashcardAnswerText").hidden = !state.flashcardShowingAnswer;
    $("flashcardReveal").textContent = state.flashcardShowingAnswer ? "Hide answer" : "Show answer";
    $("flashcardMeta").textContent = `${card.subject} · ${card.chapter} · ${card.known ? "Known" : "Needs practice"} · ${card.reviewCount} reviews`;
    $("flashcardPrevious").disabled = state.flashcardIndex === 0;
    $("flashcardNext").disabled = state.flashcardIndex === deck.length - 1;
    $("flashcardKnown").setAttribute("aria-pressed", String(card.known));
    $("flashcardManageActions").innerHTML = `
      <button class="outline compact" type="button" data-flashcard-action="edit" data-id="${escapeHtml(card.id)}">Edit card</button>
      <button class="mini" type="button" data-flashcard-action="delete" data-id="${escapeHtml(card.id)}" aria-label="Delete flashcard">×</button>`;
  }

  function renderMaterials() {
    $("materialsList").innerHTML = state.materials.length ? state.materials.map((material) => `
      <article class="material-item" data-material-id="${escapeHtml(material.id)}">
        <div class="material-item-head"><div><span class="materials-tag">${escapeHtml(material.type)}</span><h4>${escapeHtml(material.title)}</h4><small>${escapeHtml(material.educationLevel === "school" ? `Class ${material.classLevel}` : `${material.course}${material.semester ? ` · Semester ${material.semester}` : ""}`)} · ${escapeHtml(material.subject)} · ${escapeHtml(material.chapter)}</small></div><span class="materials-source-label">${escapeHtml(material.sourceLabel)}</span></div>
        <details><summary>Read material</summary><p class="material-content">${escapeHtml(material.content)}</p></details>
        <div class="materials-item-actions"><button class="outline compact" type="button" data-material-action="edit" data-id="${escapeHtml(material.id)}">Edit</button><button class="mini" type="button" data-material-action="delete" data-id="${escapeHtml(material.id)}" aria-label="Delete ${escapeHtml(material.title)}">×</button></div>
      </article>`).join("") : '<p class="empty-copy">No saved study materials yet. Add your own notes, summary, or text above.</p>';

    $("checklistItems").innerHTML = state.checklist.length ? state.checklist.map((item) => `
      <article class="checklist-item" data-checklist-id="${escapeHtml(item.id)}">
        <label><input type="checkbox" data-checklist-toggle="${escapeHtml(item.id)}"${item.completed ? " checked" : ""}><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.educationLevel === "school" ? (item.classLevel ? `Class ${item.classLevel}` : "School · class not specified") : `${item.course}${item.semester ? ` · Semester ${item.semester}` : ""}`)} · ${escapeHtml(item.subject)} · ${escapeHtml(item.chapter)}</small></span></label>
        <div class="materials-item-actions"><button class="outline compact" type="button" data-checklist-edit="${escapeHtml(item.id)}">Edit</button><button class="mini" type="button" data-checklist-delete="${escapeHtml(item.id)}" aria-label="Delete checklist item">×</button></div>
      </article>`).join("") : "";
    $("checklistEmpty").hidden = state.checklist.length > 0;

    $("questionBankList").innerHTML = state.questions.length ? state.questions.map((question) => `
      <article class="question-bank-item" data-question-id="${escapeHtml(question.id)}">
        <div><b>${escapeHtml(question.question)}</b><small>${escapeHtml(question.subject)} · ${escapeHtml(question.chapter)}${question.topic ? ` · ${escapeHtml(question.topic)}` : ""} · ${escapeHtml(question.sourceLabel)}</small><ol type="A">${question.options.map((option, index) => `<li${index === question.correctIndex ? ' class="correct-option"' : ""}>${escapeHtml(option)}${index === question.correctIndex ? " · Answer" : ""}</li>`).join("")}</ol>${question.explanation ? `<p>${escapeHtml(question.explanation)}</p>` : ""}</div>
        <div class="materials-item-actions"><button class="outline compact" type="button" data-question-action="edit" data-id="${escapeHtml(question.id)}">Edit</button><button class="mini" type="button" data-question-action="delete" data-id="${escapeHtml(question.id)}" aria-label="Delete question">×</button></div>
      </article>`).join("") : '<p class="empty-copy">No student-created questions yet. Add questions to start practicing.</p>';

    const quizSubject = state.quizProgress?.subject || $("quizSubject").value;
    const quizSubjects = [...new Set(state.questions.map((question) => question.subject))].sort((a, b) => a.localeCompare(b));
    $("quizSubject").innerHTML = '<option value="">All subjects</option>'
      + quizSubjects.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("");
    $("quizSubject").value = quizSubjects.includes(quizSubject) ? quizSubject : "";
    if (state.quizProgress?.chapter) $("quizChapter").value = state.quizProgress.chapter;
    updateQuizChapters();

    $("quizAttempts").innerHTML = state.quizAttempts.length
      ? `<h4>Recent quiz scores</h4>${state.quizAttempts.slice(0, 5).map((attempt) => `<p><b>${escapeHtml(attempt.score)}/${escapeHtml(attempt.total)} (${escapeHtml(attempt.percent)}%)</b> · ${escapeHtml(attempt.subject || "All subjects")}${attempt.chapter ? ` · ${escapeHtml(attempt.chapter)}` : ""} · ${escapeHtml(new Date(attempt.attemptedAt).toLocaleDateString())}</p>`).join("")}`
      : '<p class="empty-copy">Quiz scores you save will appear here.</p>';

    const recommendation = window.StudyPlanEngine.buildStudyRecommendations({
      syllabus: state.syllabus,
      exams: state.exams,
      today: dateKey(new Date()),
      availableMinutesPerDay: state.profile?.availableMinutesPerDay || 0
    });
    $("revisionRecommendations").innerHTML = !recommendation.dailyMinutes
      ? '<p class="empty-copy">Set your available daily study time in your profile to see local recommendations.</p>'
      : recommendation.items.length ? recommendation.items.map((topic, index) => `
        <article class="revision-recommendation"><b>${index + 1}. ${escapeHtml(topic.subject)} · ${escapeHtml(topic.topic)}</b><small>${escapeHtml(topic.chapter)} · ${topic.needsRevision ? "Need Revision" : escapeHtml(topic.status.replace("_", " "))}${topic.examDate ? ` · ${escapeHtml(topic.examTitle || "Exam")} ${topic.daysRemaining === 0 ? "today" : `in ${topic.daysRemaining} day${topic.daysRemaining === 1 ? "" : "s"}`}` : " · no upcoming exam date"}</small></article>`).join("")
        : '<p class="empty-copy">No incomplete or flagged topics in your saved syllabus. Add or update topics to get recommendations.</p>';

    renderFlashcards();
    renderQuizQuestions();
    renderMaterialsChapterOptions();
    renderDashboardSummary();
  }

  function updateMaterialEducationFields() {
    const school = $("materialEducation").value === "school";
    $("materialClassField").hidden = !school;
    $("materialCourseField").hidden = school;
    $("materialSemesterField").hidden = school;
    $("materialClass").required = school;
    $("materialCourse").required = !school;
  }

  function materialEducationData() {
    const educationLevel = $("materialEducation").value;
    return educationLevel === "school"
      ? { educationLevel, classLevel: Number($("materialClass").value) }
      : {
        educationLevel,
        classLevel: null,
        course: $("materialCourse").value.trim(),
        semester: $("materialSemester").value ? Number($("materialSemester").value) : null
      };
  }

  function renderMaterialsChapterOptions() {
    const selectedSubject = $("materialSubject").value.trim()
      || $("checklistSubject").value.trim()
      || $("questionSubject").value.trim();
    const names = (state.syllabus?.subjects || [])
      .filter((subject) => !selectedSubject || subject.name === selectedSubject)
      .flatMap((subject) => subject.chapters.map((chapter) => chapter.title));
    $("materialChapterOptions").innerHTML = [...new Set(names)].sort((a, b) => a.localeCompare(b))
      .map((chapter) => `<option value="${escapeHtml(chapter)}"></option>`).join("");
  }

  function updateQuizChapters() {
    const subject = $("quizSubject").value;
    const previous = $("quizChapter").value;
    const chapters = [...new Set(state.questions
      .filter((question) => !subject || question.subject === subject)
      .map((question) => question.chapter))]
      .sort((a, b) => a.localeCompare(b));
    $("quizChapter").innerHTML = '<option value="">All chapters</option>'
      + chapters.map((chapter) => `<option value="${escapeHtml(chapter)}">${escapeHtml(chapter)}</option>`).join("");
    $("quizChapter").value = chapters.includes(previous) ? previous : "";
  }

  function renderQuizQuestions() {
    const hasQuiz = Boolean(state.quizProgress && state.quizQuestions.length);
    $("quizForm").hidden = !hasQuiz;
    if (!hasQuiz) {
      $("quizProgressStatus").textContent = "Choose a subject or chapter and load saved questions to begin.";
      $("quizQuestions").innerHTML = "";
      return;
    }
    state.quizProgress.currentIndex = Math.min(state.quizProgress.currentIndex, state.quizQuestions.length - 1);
    const index = state.quizProgress.currentIndex;
    const question = state.quizQuestions[index];
    const answeredCount = Object.keys(state.quizAnswers).length;
    $("quizQuestionPosition").textContent = `QUESTION ${index + 1} OF ${state.quizQuestions.length} · ${answeredCount} ANSWERED`;
    $("quizProgressStatus").textContent = "Your answers and current question are saved locally as you work.";
    $("quizPrevious").disabled = index === 0;
    $("quizNext").disabled = index === state.quizQuestions.length - 1;
    $("quizQuestions").innerHTML = `
      <fieldset class="quiz-question"><legend>${index + 1}. ${escapeHtml(question.question)}</legend><small>${escapeHtml(question.subject)} · ${escapeHtml(question.chapter)}</small>
        ${question.options.map((option, optionIndex) => `<label><input type="radio" name="quiz-answer" value="${optionIndex}"${state.quizAnswers[question.id] === optionIndex ? " checked" : ""}><span>${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</span></label>`).join("")}
      </fieldset>`;
  }

  function resetMaterialForm() {
    $("materialForm").reset();
    $("materialId").value = "";
    $("materialSave").textContent = "Save material";
    $("materialCancel").hidden = true;
    if (state.profile) {
      $("materialEducation").value = state.profile.educationLevel;
      $("materialClass").value = state.profile.classLevel ? String(state.profile.classLevel) : "";
      $("materialCourse").value = state.profile.course || "";
      $("materialSemester").value = state.profile.semester ? String(state.profile.semester) : "";
    }
    updateMaterialEducationFields();
  }

  function editMaterial(material) {
    $("materialId").value = material.id;
    $("materialEducation").value = material.educationLevel;
    $("materialClass").value = material.classLevel ? String(material.classLevel) : "";
    $("materialCourse").value = material.course || "";
    $("materialSemester").value = material.semester ? String(material.semester) : "";
    $("materialSubject").value = material.subject;
    $("materialChapter").value = material.chapter;
    $("materialType").value = material.type;
    $("materialTitle").value = material.title;
    $("materialContent").value = material.content;
    $("materialSave").textContent = "Update material";
    $("materialCancel").hidden = false;
    updateMaterialEducationFields();
    $("materialTitle").focus();
  }

  function resetFlashcardForm() {
    const subject = $("flashcardSubject").value;
    const chapter = $("flashcardChapter").value;
    $("flashcardForm").reset();
    $("flashcardId").value = "";
    $("flashcardSubject").value = subject;
    $("flashcardChapter").value = chapter;
    $("flashcardSave").textContent = "Add flashcard";
    $("flashcardCancel").hidden = true;
  }

  function editFlashcard(card) {
    $("flashcardId").value = card.id;
    $("flashcardSubject").value = card.subject;
    $("flashcardChapter").value = card.chapter;
    $("flashcardQuestion").value = card.question;
    $("flashcardAnswer").value = card.answer;
    $("flashcardSave").textContent = "Update flashcard";
    $("flashcardCancel").hidden = false;
    $("flashcardQuestion").focus();
  }

  function currentFlashcard() {
    const id = state.flashcardOrder[state.flashcardIndex];
    return state.flashcards.find((card) => card.id === id);
  }

  $("flashcardForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("flashcardId").value;
    try {
      const card = await api(id ? `/api/flashcards/${encodeURIComponent(id)}` : "/api/flashcards", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({
          subject: $("flashcardSubject").value.trim(),
          chapter: $("flashcardChapter").value.trim(),
          question: $("flashcardQuestion").value.trim(),
          answer: $("flashcardAnswer").value.trim()
        })
      });
      resetFlashcardForm();
      if (id) state.flashcards = state.flashcards.map((item) => item.id === id ? card : item);
      else state.flashcards.push(card);
      state.flashcardIndex = 0;
      renderFlashcards();
      toast(id ? "Flashcard updated" : "Flashcard saved locally");
    } catch (error) {
      toast(error.message);
    }
  });

  $("flashcardCancel").addEventListener("click", resetFlashcardForm);
  $("flashcardSubjectFilter").addEventListener("change", () => {
    state.flashcardIndex = 0;
    state.flashcardShowingAnswer = false;
    renderFlashcards();
  });
  $("flashcardChapterFilter").addEventListener("change", () => {
    state.flashcardIndex = 0;
    state.flashcardShowingAnswer = false;
    renderFlashcards();
  });
  $("flashcardPrevious").addEventListener("click", () => {
    state.flashcardIndex = Math.max(0, state.flashcardIndex - 1);
    state.flashcardShowingAnswer = false;
    renderFlashcards();
  });
  $("flashcardNext").addEventListener("click", () => {
    state.flashcardIndex = Math.min(state.flashcardOrder.length - 1, state.flashcardIndex + 1);
    state.flashcardShowingAnswer = false;
    renderFlashcards();
  });
  $("flashcardShuffle").addEventListener("click", () => {
    const subject = $("flashcardSubjectFilter").value;
    const chapter = $("flashcardChapterFilter").value;
    state.flashcardOrder = state.flashcards
      .filter((card) => (!subject || card.subject === subject) && (!chapter || card.chapter === chapter))
      .map((card) => card.id);
    for (let index = state.flashcardOrder.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [state.flashcardOrder[index], state.flashcardOrder[swapIndex]] =
        [state.flashcardOrder[swapIndex], state.flashcardOrder[index]];
    }
    state.flashcardIndex = 0;
    state.flashcardShowingAnswer = false;
    renderFlashcards();
  });
  $("flashcardReveal").addEventListener("click", () => {
    state.flashcardShowingAnswer = !state.flashcardShowingAnswer;
    renderFlashcards();
  });
  $("flashcardKnown").addEventListener("click", () => reviewCurrentFlashcard(true));
  $("flashcardUnknown").addEventListener("click", () => reviewCurrentFlashcard(false));
  async function reviewCurrentFlashcard(known) {
    const card = currentFlashcard();
    if (!card) return;
    try {
      const updated = await api(`/api/flashcards/${encodeURIComponent(card.id)}/review`, {
        method: "POST",
        body: JSON.stringify({ known })
      });
      state.flashcards = state.flashcards.map((item) => item.id === card.id ? updated : item);
      renderFlashcards();
    } catch (error) {
      toast(error.message);
    }
  }
  $("flashcardStudy").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-flashcard-action]");
    if (!button) return;
    const card = state.flashcards.find((item) => item.id === button.dataset.id);
    if (!card) return;
    if (button.dataset.flashcardAction === "edit") return editFlashcard(card);
    if (!confirm("Delete this flashcard and its review history?")) return;
    try {
      await api(`/api/flashcards/${encodeURIComponent(card.id)}`, { method: "DELETE" });
      state.flashcards = state.flashcards.filter((item) => item.id !== card.id);
      state.flashcardOrder = state.flashcardOrder.filter((id) => id !== card.id);
      state.flashcardIndex = Math.max(0, Math.min(state.flashcardIndex, state.flashcardOrder.length - 1));
      renderFlashcards();
      toast("Flashcard deleted");
    } catch (error) {
      toast(error.message);
    }
  });

  function editQuestion(question) {
    $("questionId").value = question.id;
    $("materialEducation").value = question.educationLevel;
    $("materialClass").value = question.classLevel ? String(question.classLevel) : "";
    $("materialCourse").value = question.course || "";
    $("materialSemester").value = question.semester ? String(question.semester) : "";
    $("questionSubject").value = question.subject;
    $("questionChapter").value = question.chapter;
    $("questionTopic").value = question.topic || "";
    $("questionText").value = question.question;
    question.options.forEach((option, index) => { $(`questionOption${index}`).value = option; });
    $("questionAnswer").value = String(question.correctIndex);
    $("questionExplanation").value = question.explanation || "";
    $("questionSave").textContent = "Update question";
    $("questionCancel").hidden = false;
    updateMaterialEducationFields();
    $("questionText").focus();
  }

  function renderDeadlines() {
    const list = $("deadlines");
    const empty = $("deadlineEmpty");
    if (state.loadStatus === "loading") {
      list.textContent = "Loading deadlines…";
      list.className = "deadline-list loading-state";
      empty.hidden = true;
      return;
    }
    if (state.loadStatus === "error") {
      list.textContent = "Deadlines are unavailable until the planner reconnects.";
      list.className = "deadline-list loading-state";
      empty.hidden = true;
      return;
    }

    const today = new Date();
    const todayDate = dateKey(today);
    const [year, month, day] = todayDate.split("-").map(Number);
    const todayUtc = Date.UTC(year, month - 1, day);
    const deadlines = state.tasks
      .filter((task) => !task.completed && task.date)
      .map((task) => {
        const [dueYear, dueMonth, dueDay] = task.date.split("-").map(Number);
        const daysAway = Math.round((Date.UTC(dueYear, dueMonth - 1, dueDay) - todayUtc) / 86400000);
        return { task, daysAway };
      })
      .sort((a, b) => a.task.date.localeCompare(b.task.date)
        || (a.task.time || "").localeCompare(b.task.time || "")
        || a.task.title.localeCompare(b.task.title))
      .slice(0, 4);

    list.className = "deadline-list";
    empty.hidden = deadlines.length > 0;
    list.innerHTML = deadlines.map(({ task, daysAway }) => {
      const stateClass = daysAway < 0 ? "overdue" : daysAway === 0 ? "today" : "";
      const when = daysAway < 0
        ? `${Math.abs(daysAway)} ${Math.abs(daysAway) === 1 ? "day" : "days"} overdue`
        : daysAway === 0
          ? "Due today"
          : daysAway === 1
            ? "Tomorrow"
            : `In ${daysAway} days`;
      const subject = task.subject || task.topic || "Study task";
      const time = task.time ? ` · ${task.time}` : "";
      return `
        <article class="deadline-item ${stateClass}">
          <span class="deadline-mark" aria-hidden="true">${daysAway < 0 ? "!" : "◷"}</span>
          <span class="deadline-main"><b>${escapeHtml(task.title)}</b><small>${escapeHtml(subject)} · ${escapeHtml(formatDate(task.date))}${escapeHtml(time)}</small></span>
          <span class="deadline-when">${escapeHtml(when)}</span>
        </article>
      `;
    }).join("");
  }

  function renderTasks() {
    if (state.loadStatus === "loading") {
      elements.tasks.textContent = "Loading your study plan…";
      elements.tasks.className = "tasks loading-state";
      elements.tasks.setAttribute("aria-busy", "true");
      elements.tasks.hidden = false;
      elements.empty.hidden = true;
      $("emptyAdd").hidden = false;
      $("retryLoad").hidden = true;
      renderDeadlines();
      return;
    }
    if (state.loadStatus === "error") {
      elements.tasks.textContent = "";
      elements.tasks.className = "tasks";
      elements.tasks.setAttribute("aria-busy", "false");
      elements.tasks.hidden = true;
      elements.empty.hidden = false;
      elements.empty.querySelector("h3").textContent = "Planner unavailable";
      elements.empty.querySelector("p").textContent = "Reconnect to your planner to load and save your study plan.";
      $("emptyAdd").hidden = true;
      $("retryLoad").hidden = false;
      renderDeadlines();
      return;
    }

    const query = elements.search.value.trim().toLowerCase();
    const subject = elements.subjectFilter.value;
    const status = elements.statusFilter.value;
    const filtered = state.tasks.filter((task) => (
      (!query || [task.title, task.subject, task.topic, task.details]
        .some((value) => String(value || "").toLowerCase().includes(query)))
      && (subject === "all" || task.subject === subject)
      && (status === "all" || (status === "completed" ? task.completed : !task.completed))
    ));

    elements.tasks.innerHTML = filtered.map((task) => {
      const due = task.date
        ? `<span class="due">◷ ${escapeHtml(task.date === dateKey(new Date()) ? "Today" : formatDate(task.date))}${task.time ? ` · ${escapeHtml(task.time)}` : ""}</span>`
        : "";
      const recurrence = task.recurrence && task.recurrence !== "none"
        ? `<span class="tag repeat-tag">↻ ${escapeHtml(task.recurrence)}</span>`
        : "";
      return `
        <article class="task ${task.completed ? "done" : ""}">
          <input class="check" type="checkbox" data-action="toggle" data-id="${escapeHtml(task.id)}"
            ${task.completed ? "checked" : ""} aria-label="Mark ${escapeHtml(task.title)} complete">
          <div>
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="meta">
              ${task.subject ? `<span class="tag">${escapeHtml(task.subject)}</span>` : ""}
              ${task.topic ? `<span class="tag topic-tag">${escapeHtml(task.topic)}</span>` : ""}
              <span class="tag ${escapeHtml(task.priority)}">${escapeHtml(task.priority[0].toUpperCase() + task.priority.slice(1))} priority</span>
              ${recurrence}${due}
            </div>
            ${task.details ? `<p class="details">${escapeHtml(task.details)}</p>` : ""}
          </div>
          <div class="actions">
            <button class="mini" data-action="edit" data-id="${escapeHtml(task.id)}" title="Edit task" aria-label="Edit task">✎</button>
            <button class="mini" data-action="delete" data-id="${escapeHtml(task.id)}" title="Delete task" aria-label="Delete task">×</button>
          </div>
        </article>
      `;
    }).join("");
    elements.tasks.className = "tasks";
    elements.tasks.setAttribute("aria-busy", "false");
    elements.tasks.hidden = filtered.length === 0;
    elements.empty.hidden = filtered.length > 0;
    elements.empty.querySelector("h3").textContent = state.tasks.length
      ? "No matching tasks"
      : "Your plan starts here";
    elements.empty.querySelector("p").textContent = state.tasks.length
      ? "Try another search or adjust your filters."
      : "Add a study task to get started.";
    $("emptyAdd").hidden = false;
    $("retryLoad").hidden = true;

    const completed = state.tasks.filter((task) => task.completed).length;
    $("taskSummary").textContent = `${state.tasks.length} tasks · ${completed} completed · ${state.tasks.length - completed} pending`;
    renderDashboardSummary();
    renderDeadlines();
  }

  function renderExams() {
    if (state.loadStatus === "loading") {
      elements.exams.textContent = "Loading exams…";
      $("examEmpty").hidden = true;
      return;
    }
    if (state.loadStatus === "error") {
      elements.exams.textContent = "";
      $("examEmpty").textContent = "Exams are unavailable until the planner reconnects.";
      $("examEmpty").hidden = false;
      return;
    }
    const exams = [...state.exams].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    elements.exams.innerHTML = exams.map((exam) => {
      const daysRemaining = window.StudyPlanEngine.daysBetween(dateKey(new Date()), exam.date);
      const countdown = daysRemaining === null
        ? "Date unavailable"
        : daysRemaining < 0
          ? `Passed ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} ago`
          : daysRemaining === 0
            ? "Exam today"
            : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`;
      const examDate = new Date(`${exam.date}T00:00:00`);
      return `
        <article class="exam-item">
          <div class="exam-date"><b>${escapeHtml(examDate.getDate())}</b><span>${escapeHtml(examDate.toLocaleDateString(undefined, { month: "short" }))}</span></div>
          <div class="exam-info"><b>${escapeHtml(exam.title)}</b><span>${escapeHtml(exam.subject || "General")}${exam.time ? ` · ${escapeHtml(exam.time)}` : ""}</span><small class="exam-countdown">${escapeHtml(countdown)} · ${escapeHtml(formatDate(exam.date))}</small>${exam.details ? `<small>${escapeHtml(exam.details)}</small>` : ""}</div>
          <div class="actions"><button class="mini" data-exam-action="edit" data-id="${escapeHtml(exam.id)}" aria-label="Edit exam">✎</button><button class="mini" data-exam-action="delete" data-id="${escapeHtml(exam.id)}" aria-label="Delete exam">×</button></div>
        </article>
      `;
    }).join("");
    $("examEmpty").textContent = "No upcoming exams added yet.";
    $("examEmpty").hidden = exams.length > 0;
  }

  function eventsFor(date) {
    const tasks = state.tasks
      .filter((task) => task.date === date)
      .map((task) => ({ type: "task", id: task.id, title: task.title, subject: task.subject, time: task.time }));
    const exams = state.exams
      .filter((exam) => exam.date === date)
      .map((exam) => ({ type: "exam", id: exam.id, title: exam.title, subject: exam.subject, time: exam.time }));
    return [...exams, ...tasks].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }

  function renderAgenda() {
    const date = selectedDate;
    $("agendaTitle").textContent = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric"
    });
    const events = eventsFor(date);
    $("agenda").innerHTML = events.length ? events.map((event) => `
      <button class="agenda-item" type="button" data-agenda-type="${event.type}" data-id="${escapeHtml(event.id)}">
        <span class="event-dot ${event.type}"></span><span><b>${escapeHtml(event.title)}</b><small>${escapeHtml(event.type === "exam" ? "Exam" : "Task")}${event.subject ? ` · ${escapeHtml(event.subject)}` : ""}${event.time ? ` · ${escapeHtml(event.time)}` : ""}</small></span>
      </button>
    `).join("") : '<p class="hint">Nothing scheduled for this day.</p>';
  }

  function renderCalendar() {
    $("monthLabel").textContent = calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const firstWeekday = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay();
    const dayCount = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
    const headers = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      .map((name) => `<span class="calendar-weekday">${name}</span>`);
    const cells = Array.from({ length: firstWeekday }, () => '<span class="calendar-blank"></span>');
    for (let number = 1; number <= dayCount; number += 1) {
      const date = dateKey(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), number));
      const events = eventsFor(date);
      const classes = [
        "calendar-day",
        date === dateKey(new Date()) ? "today" : "",
        date === selectedDate ? "selected" : ""
      ].filter(Boolean).join(" ");
      cells.push(`<button class="${classes}" type="button" data-calendar-date="${date}" aria-label="${escapeHtml(formatDate(date))}, ${events.length} events" aria-pressed="${date === selectedDate}"><span>${number}</span>${events.length ? `<i class="event-dots">${events.slice(0, 3).map((event) => `<em class="${event.type}"></em>`).join("")}</i>` : ""}</button>`);
    }
    $("calendar").innerHTML = [...headers, ...cells].join("");
    renderAgenda();
  }

  function renderReport() {
    if (!state.report) return;
    const report = state.report;
    const maxMinutes = Math.max(60, ...report.days.map((day) => day.minutes));
    $("reportChart").innerHTML = report.days.map((day) => {
      const label = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
      const height = Math.max(day.minutes ? 8 : 2, Math.round(day.minutes / maxMinutes * 100));
      return `<div class="chart-day" title="${escapeHtml(formatDate(day.date))}: ${day.minutes} minutes"><span>${day.minutes ? `${day.minutes}m` : ""}</span><div class="chart-track"><i style="height:${height}%"></i></div><small>${escapeHtml(label)}</small></div>`;
    }).join("");
    $("reportChart").classList.remove("loading-state");
    const goal = report.weeklyGoalMinutes;
    const percent = Math.min(100, Math.round(report.weeklyMinutes / goal * 100));
    $("weeklyTime").textContent = formatMinutes(report.weeklyMinutes);
    $("weeklyGoalLabel").textContent = `of ${formatGoal(goal)}`;
    $("weeklyGoal").value = (goal / 60).toString();
    $("goalBar").style.width = `${percent}%`;
    $("goalBar").parentElement.setAttribute("aria-valuenow", String(percent));
    $("goalHint").textContent = report.weeklyMinutes >= goal
      ? "Weekly goal reached. Great work!"
      : `${formatMinutes(goal - report.weeklyMinutes)} to reach this week's goal.`;
    $("streak").textContent = `${report.streak} ${report.streak === 1 ? "day" : "days"}`;
  }

  function formatMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours ? `${hours}h ${remainder}m` : `${remainder} min`;
  }

  function formatGoal(minutes) {
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? "hour" : "hours"}`;
  }

  async function load() {
    state.loadStatus = "loading";
    $("status").textContent = "Loading planner…";
    elements.notes.disabled = true;
    $("noteStatus").textContent = "Loading notes…";
    $("reportChart").textContent = "Loading study report…";
    $("reportChart").classList.add("loading-state");
    if (!elements.profileForm.dataset.dirty || elements.profileForm.dataset.dirty !== "true") {
      $("profileStatus").textContent = "Loading student profile…";
    }
    renderTasks();
    renderExams();
    try {
      const [tasks, notes, exams, subjects, sessions, settings, report, profile, syllabus, savedPlan, materials, checklist, flashcards, questions, quizAttempts, quizProgress, quizAccuracy] = await Promise.all([
        api("/api/tasks"),
        api("/api/notes"),
        api("/api/exams"),
        api("/api/subjects"),
        api("/api/sessions"),
        api("/api/settings"),
        api("/api/reports"),
        api("/api/profile"),
        api("/api/syllabus"),
        api("/api/study-plan"),
        api("/api/materials"),
        api("/api/revision-checklist"),
        api("/api/flashcards"),
        api("/api/questions"),
        api("/api/quizzes/attempts"),
        api("/api/quizzes/progress"),
        api("/api/quiz-accuracy")
      ]);
      state.tasks = tasks;
      state.exams = exams;
      state.sessions = sessions;
      state.settings = settings;
      state.report = report;
      state.planItems = savedPlan.items;
      state.planMetadata = savedPlan.metadata;
      state.materials = materials;
      state.checklist = checklist;
      state.flashcards = flashcards;
      state.questions = questions;
      state.quizAttempts = quizAttempts;
      state.quizProgress = quizProgress;
      state.quizQuestions = quizProgress?.questions || [];
      state.quizAnswers = quizProgress?.answers || {};
      state.quizAccuracy = quizAccuracy;
      state.loadStatus = "ready";
      if (elements.profileForm.dataset.dirty !== "true") renderProfile(profile);
      if (!state.materialScopeReady) {
        $("materialEducation").value = profile?.educationLevel || "school";
        $("materialClass").value = profile?.classLevel ? String(profile.classLevel) : "";
        $("materialCourse").value = profile?.course || "";
        $("materialSemester").value = profile?.semester ? String(profile.semester) : "";
        state.materialScopeReady = true;
      }
      updateMaterialEducationFields();
      if (document.activeElement !== elements.notes) elements.notes.value = notes.content || "";
      elements.notes.disabled = false;
      $("noteStatus").textContent = "Saved in this device's SQLite database";
      $("status").textContent = "Connected · Local database";
      setSubjects(subjects);
      renderSyllabus(syllabus);
      renderPlanSubjects(window.StudyPlanEngine.buildSubjectSummaries(syllabus, exams, dateKey(new Date())));
      renderSavedPlan();
      renderMaterials();
      renderTasks();
      renderExams();
      renderCalendar();
      renderReport();
      renderDashboardSummary();
      checkReminders();
      await recalculateSavedPlanIfNeeded();
      await refreshAiMonitor();
    } catch (error) {
      state.loadStatus = "error";
      $("profileStatus").textContent = `Profile unavailable: ${error.message}`;
      $("syllabusLoading").hidden = true;
      $("syllabusContent").hidden = true;
      $("syllabusError").hidden = false;
      $("syllabusError").textContent = `Syllabus unavailable: ${error.message}`;
      $("status").textContent = "Could not load planner";
      elements.notes.disabled = false;
      $("noteStatus").textContent = `Notes unavailable: ${error.message}`;
      renderTasks();
      $("goalHint").textContent = "Weekly report unavailable until the planner reconnects.";
      $("weeklyTime").textContent = "—";
      $("weeklyGoalLabel").textContent = "Goal unavailable";
      $("streak").textContent = "—";
      renderExams();
      $("calendar").textContent = "Calendar unavailable until the planner reconnects.";
      $("agenda").textContent = "";
      $("reportChart").textContent = "Study report unavailable until the planner reconnects.";
      $("reportChart").classList.add("loading-state");
      console.error(error);
    }
  }

  function taskData() {
    return {
      title: elements.title.value.trim(),
      subject: elements.subject.value.trim(),
      topic: elements.topic.value.trim(),
      priority: elements.priority.value,
      recurrence: elements.recurrence.value,
      date: elements.date.value,
      time: elements.time.value,
      details: elements.details.value.trim(),
      completed: !!state.tasks.find((task) => task.id === elements.taskId.value)?.completed
    };
  }

  function openTask(task) {
    elements.form.reset();
    elements.taskId.value = task?.id || "";
    $("dialogTitle").textContent = task ? "Edit study task" : "Add a study task";
    elements.title.value = task?.title || "";
    elements.subject.value = task?.subject || "";
    elements.topic.value = task?.topic || "";
    elements.priority.value = task?.priority || "medium";
    elements.recurrence.value = task?.recurrence || "none";
    elements.date.value = task?.date || dateKey(new Date());
    elements.time.value = task?.time || "";
    elements.details.value = task?.details || "";
    elements.dialog.showModal();
  }

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = elements.taskId.value;
    try {
      await api(id ? `/api/tasks/${encodeURIComponent(id)}` : "/api/tasks", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(taskData())
      });
      elements.dialog.close();
      toast(id ? "Task updated" : "Task added");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  elements.tasks.addEventListener("change", async (event) => {
    if (!event.target.matches('[data-action="toggle"]')) return;
    const task = state.tasks.find((item) => item.id === event.target.dataset.id);
    if (!task) return;
    try {
      await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PUT",
        body: JSON.stringify({ ...task, completed: event.target.checked })
      });
      toast(event.target.checked && task.recurrence !== "none" ? "Done — next repeat added" : "Task updated");
      await load();
    } catch (error) {
      toast(error.message);
      await load();
    }
  });

  elements.tasks.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.dataset.action === "toggle") return;
    const task = state.tasks.find((item) => item.id === button.dataset.id);
    if (!task) return;
    if (button.dataset.action === "edit") return openTask(task);
    if (!confirm(`Delete "${task.title}"?`)) return;
    try {
      await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      toast("Task deleted");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  $("add").addEventListener("click", () => openTask());
  $("emptyAdd").addEventListener("click", () => openTask());
  $("retryLoad").addEventListener("click", load);
  ["close", "cancel"].forEach((id) => $(id).addEventListener("click", () => elements.dialog.close()));
  [elements.search, elements.subjectFilter, elements.statusFilter].forEach((control) => {
    control.addEventListener("input", renderTasks);
  });

  $("calendar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-calendar-date]");
    if (!button) return;
    selectedDate = button.dataset.calendarDate;
    renderCalendar();
  });
  $("prevMonth").addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  $("nextMonth").addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  $("agenda").addEventListener("click", (event) => {
    const button = event.target.closest("[data-agenda-type]");
    if (!button) return;
    const record = button.dataset.agendaType === "exam"
      ? state.exams.find((exam) => exam.id === button.dataset.id)
      : state.tasks.find((task) => task.id === button.dataset.id);
    if (button.dataset.agendaType === "exam") openExam(record);
    else if (record) openTask(record);
  });

  function openExam(exam) {
    elements.examForm.reset();
    $("examId").value = exam?.id || "";
    $("examDialogTitle").textContent = exam ? "Edit exam" : "Add an exam";
    $("examTitle").value = exam?.title || "";
    $("examSubject").value = exam?.subject || "";
    $("examDate").value = exam?.date || dateKey(new Date());
    $("examTime").value = exam?.time || "";
    $("examDetails").value = exam?.details || "";
    elements.examDialog.showModal();
  }

  $("addExam").addEventListener("click", () => openExam());
  ["examClose", "examCancel"].forEach((id) => $(id).addEventListener("click", () => elements.examDialog.close()));
  elements.examForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("examId").value;
    const exam = {
      title: $("examTitle").value.trim(),
      subject: $("examSubject").value.trim(),
      date: $("examDate").value,
      time: $("examTime").value,
      details: $("examDetails").value.trim()
    };
    try {
      await api(id ? `/api/exams/${encodeURIComponent(id)}` : "/api/exams", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(exam)
      });
      elements.examDialog.close();
      toast(id ? "Exam updated" : "Exam added");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  elements.exams.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-exam-action]");
    if (!button) return;
    const exam = state.exams.find((item) => item.id === button.dataset.id);
    if (!exam) return;
    if (button.dataset.examAction === "edit") return openExam(exam);
    if (!confirm(`Delete "${exam.title}"?`)) return;
    try {
      await api(`/api/exams/${encodeURIComponent(exam.id)}`, { method: "DELETE" });
      toast("Exam deleted");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  $("goalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const weeklyGoalMinutes = Math.round(Number($("weeklyGoal").value) * 60);
    try {
      state.settings = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ weeklyGoalMinutes })
      });
      await load();
      toast("Weekly goal saved");
    } catch (error) {
      toast(error.message);
    }
  });

  $("subjectForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("newSubject");
    try {
      await api("/api/subjects", { method: "POST", body: JSON.stringify({ name: input.value.trim() }) });
      input.value = "";
      await load();
      toast("Subject added");
    } catch (error) {
      toast(error.message);
    }
  });

  $("subjects").addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-subject]");
    if (editButton) {
      openSyllabusDialog("edit-subject", { subject: editButton.dataset.editSubject });
      return;
    }
    const button = event.target.closest("[data-remove-subject]");
    if (!button) return;
    const subject = button.dataset.removeSubject;
    if (!confirm(`Remove "${subject}" and its syllabus chapters and topics? Existing tasks and exams keep their recorded text.`)) return;
    try {
      await api(`/api/subjects/${encodeURIComponent(subject)}`, { method: "DELETE" });
      await load();
      toast("Subject removed");
    } catch (error) {
      toast(error.message);
    }
  });

  elements.syllabusSubjects.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-syllabus-action]");
    if (!button) return;
    const action = button.dataset.syllabusAction;
    const id = button.dataset.id;
    const subject = button.dataset.subject;
    const currentSubject = state.syllabus?.subjects.find((item) => item.name === subject);
    const currentChapter = state.syllabus?.subjects
      .flatMap((item) => item.chapters)
      .find((item) => item.id === id);
    const currentTopic = state.syllabus?.subjects
      .flatMap((item) => item.chapters)
      .flatMap((item) => item.topics)
      .find((item) => item.id === id);

    try {
      if (action === "edit-subject") {
        openSyllabusDialog(action, { subject });
        return;
      } else if (action === "delete-subject") {
        if (!confirm(`Delete "${subject}" and all of its syllabus chapters and topics?`)) return;
        await api(`/api/subjects/${encodeURIComponent(subject)}`, { method: "DELETE" });
      } else if (action === "add-chapter") {
        if (!currentSubject) return;
        openSyllabusDialog(action, { subject });
        return;
      } else if (action === "edit-chapter") {
        if (!currentChapter) return;
        openSyllabusDialog(action, { id, title: currentChapter.title });
        return;
      } else if (action === "delete-chapter") {
        if (!currentChapter || !confirm(`Delete "${currentChapter.title}" and all its topics?`)) return;
        await api(`/api/chapters/${encodeURIComponent(id)}`, { method: "DELETE" });
      } else if (action === "add-topic") {
        const chapter = state.syllabus?.subjects
          .flatMap((item) => item.chapters)
          .find((item) => item.id === id);
        if (!chapter) return;
        openSyllabusDialog(action, { id });
        return;
      } else if (action === "edit-topic") {
        if (!currentTopic) return;
        openSyllabusDialog(action, { id, title: currentTopic.title });
        return;
      } else if (action === "delete-topic") {
        if (!currentTopic || !confirm(`Delete "${currentTopic.title}"? Logged study sessions remain in your reports.`)) return;
        await api(`/api/topics/${encodeURIComponent(id)}`, { method: "DELETE" });
      }
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  elements.syllabusEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!elements.syllabusEditForm.reportValidity()) return;
    const action = $("syllabusDialogAction").value;
    const id = $("syllabusDialogId").value;
    const subject = $("syllabusDialogSubject").value;
    const title = $("syllabusDialogValue").value.trim();
    try {
      if (action === "edit-subject") {
        await api(`/api/subjects/${encodeURIComponent(subject)}`, {
          method: "PUT",
          body: JSON.stringify({ name: title })
        });
      } else if (action === "add-chapter") {
        await api("/api/chapters", {
          method: "POST",
          body: JSON.stringify({ subject, title })
        });
      } else if (action === "edit-chapter") {
        await api(`/api/chapters/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ title })
        });
      } else if (action === "add-topic") {
        await api(`/api/chapters/${encodeURIComponent(id)}/topics`, {
          method: "POST",
          body: JSON.stringify({ title })
        });
      } else if (action === "edit-topic") {
        const topic = state.syllabus?.subjects
          .flatMap((item) => item.chapters)
          .flatMap((chapter) => chapter.topics)
          .find((item) => item.id === id);
        if (!topic) throw new Error("Topic not found. Reload the syllabus and try again.");
        await api(`/api/topics/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({
            title,
            status: topic.status,
            needsRevision: topic.needsRevision
          })
        });
      } else {
        throw new Error("Choose a valid syllabus action.");
      }
      elements.syllabusDialog.close();
      await load();
      toast(action.startsWith("add-") ? "Syllabus item added" : "Syllabus item updated");
    } catch (error) {
      toast(error.message);
    }
  });

  ["syllabusDialogClose", "syllabusDialogCancel"].forEach((id) => {
    $(id).addEventListener("click", () => elements.syllabusDialog.close());
  });

  elements.syllabusSubjects.addEventListener("change", async (event) => {
    const statusSelect = event.target.closest("[data-topic-status]");
    const revisionInput = event.target.closest("[data-topic-revision]");
    if (!statusSelect && !revisionInput) return;
    const topicId = statusSelect
      ? statusSelect.dataset.topicStatus
      : revisionInput.dataset.topicRevision;
    const topic = state.syllabus?.subjects
      .flatMap((item) => item.chapters)
      .flatMap((item) => item.topics)
      .find((item) => item.id === topicId);
    if (!topic) return;
    try {
      await api(`/api/topics/${encodeURIComponent(topicId)}`, {
        method: "PUT",
        body: JSON.stringify({
          title: topic.title,
          status: statusSelect ? statusSelect.value : topic.status,
          needsRevision: revisionInput ? revisionInput.checked : topic.needsRevision
        })
      });
      await load();
    } catch (error) {
      toast(error.message);
      await load();
    }
  });

  $("studyTopic").addEventListener("change", () => {
    const topicId = $("studyTopic").value;
    if (!topicId) return;
    const topic = state.syllabus?.subjects
      .flatMap((item) => item.chapters.flatMap((chapter) => (
        chapter.topics.map((entry) => ({ ...entry, subject: item.name }))
      )))
      .find((item) => item.id === topicId);
    if (topic) $("studySubject").value = topic.subject;
  });

  elements.studySessionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!elements.studySessionForm.reportValidity()) return;
    const topicId = $("studyTopic").value;
    try {
      await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          durationMinutes: Number($("studyMinutes").value),
          date: $("studyDate").value,
          subject: $("studySubject").value,
          ...(topicId ? { topicId } : {})
        })
      });
      toast("Study session saved");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  elements.profileForm.addEventListener("input", () => {
    elements.profileForm.dataset.dirty = "true";
    $("profileStatus").textContent = "Unsaved profile changes.";
  });

  $("educationLevel").addEventListener("change", () => {
    setProfileEducationFields($("educationLevel").value);
    elements.profileForm.dataset.dirty = "true";
    $("profileStatus").textContent = "Unsaved profile changes.";
  });

  elements.profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!elements.profileForm.reportValidity()) {
      $("profileStatus").textContent = "Check the highlighted fields and try again.";
      return;
    }

    const educationLevel = $("educationLevel").value;
    const profile = {
      educationLevel,
      classLevel: educationLevel === "school" ? Number($("classLevel").value) : null,
      course: educationLevel === "college" ? $("course").value.trim() : "",
      department: educationLevel === "college" ? $("department").value.trim() : "",
      yearOfStudy: educationLevel === "college" ? Number($("yearOfStudy").value) : null,
      semester: educationLevel === "college" && $("semester").value
        ? Number($("semester").value)
        : null,
      availableMinutesPerDay: Math.round(Number($("availableHours").value) * 60)
    };
    elements.profileSubmit.disabled = true;
    $("profileStatus").textContent = "Saving profile…";
    try {
      const savedProfile = await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify(profile)
      });
      renderProfile(savedProfile);
    } catch (error) {
      $("profileStatus").textContent = `Could not save profile: ${error.message}`;
    } finally {
      elements.profileSubmit.disabled = false;
    }
  });

  elements.notes.addEventListener("input", () => {
    $("noteStatus").textContent = "Saving note…";
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      try {
        await api("/api/notes", { method: "PUT", body: JSON.stringify({ content: elements.notes.value }) });
        $("noteStatus").textContent = "All changes saved";
      } catch (error) {
        $("noteStatus").textContent = `Could not save: ${error.message}`;
      }
    }, 400);
  });

  $("clear").addEventListener("click", async () => {
    const completed = state.tasks.filter((task) => task.completed);
    if (!completed.length) return toast("No completed tasks to clear");
    if (!confirm(`Delete ${completed.length} completed tasks?`)) return;
    try {
      for (const task of completed) {
        await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      }
      await load();
      toast("Completed tasks cleared");
    } catch (error) {
      toast(error.message);
    }
  });

  $("export").addEventListener("click", () => {
    const backup = {
      app: "StudyFlow Offline Study Planner",
      version: 2,
      exportedAt: new Date().toISOString(),
      tasks: state.tasks,
      exams: state.exams,
      subjects: state.subjects,
      sessions: state.sessions,
      settings: state.settings,
      notes: elements.notes.value
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `studyflow-backup-${dateKey(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast("Full planner backup exported");
  });

  $("import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (!backup || typeof backup !== "object" || !Array.isArray(backup.tasks)) {
        throw new Error("This is not a valid StudyFlow backup.");
      }
      const exams = Array.isArray(backup.exams) ? backup.exams : [];
      if (!confirm(`Import ${backup.tasks.length} tasks and ${exams.length} exams? Existing items will be kept.`)) return;
      for (const subject of Array.isArray(backup.subjects) ? backup.subjects : []) {
        await api("/api/subjects", { method: "POST", body: JSON.stringify({ name: subject }) });
      }
      for (const task of backup.tasks) {
        if (task.title) await api("/api/tasks", { method: "POST", body: JSON.stringify(task) });
      }
      for (const exam of exams) {
        if (exam.title) await api("/api/exams", { method: "POST", body: JSON.stringify(exam) });
      }
      for (const session of Array.isArray(backup.sessions) ? backup.sessions : []) {
        await api("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ durationMinutes: session.durationMinutes, subject: session.subject, date: session.date })
        });
      }
      if (typeof backup.notes === "string") {
        await api("/api/notes", { method: "PUT", body: JSON.stringify({ content: backup.notes }) });
      }
      if (backup.settings?.weeklyGoalMinutes) {
        await api("/api/settings", {
          method: "PUT",
          body: JSON.stringify({ weeklyGoalMinutes: backup.settings.weeklyGoalMinutes })
        });
      }
      await load();
      toast("Planner backup imported");
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  });

  function renderTimer() {
    const minutes = Math.floor(timerSeconds / 60);
    const seconds = timerSeconds % 60;
    $("timer").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    $("timerPause").disabled = !timerInterval;
    $("timerStart").disabled = Boolean(timerInterval);
    $("focusDuration").disabled = Boolean(timerInterval);
  }

  $("timerStart").addEventListener("click", () => {
    if (!timerInterval) timerEndAt = Date.now() + timerSeconds * 1000;
    $("timerStatus").textContent = "Focus time — you’ve got this.";
    timerInterval = setInterval(async () => {
      timerSeconds = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
      renderTimer();
      if (timerSeconds) return;
      clearInterval(timerInterval);
      timerInterval = null;
      const durationMinutes = Number($("focusDuration").value);
      try {
        await api("/api/sessions", {
          method: "POST",
          body: JSON.stringify({
            durationMinutes,
            subject: $("focusSubject").value.trim(),
            date: dateKey(new Date())
          })
        });
        $("timerStatus").textContent = "Focus session saved. Take a short break!";
        toast("Focus session saved");
        await load();
      } catch (error) {
        $("timerStatus").textContent = `Session could not be saved: ${error.message}`;
      }
      timerSeconds = durationMinutes * 60;
      renderTimer();
    }, 250);
    renderTimer();
  });

  $("timerPause").addEventListener("click", () => {
    if (!timerInterval) return;
    timerSeconds = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
    clearInterval(timerInterval);
    timerInterval = null;
    $("timerStatus").textContent = "Timer paused. Resume when you’re ready.";
    renderTimer();
  });

  $("timerReset").addEventListener("click", () => {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSeconds = Number($("focusDuration").value) * 60;
    $("timerStatus").textContent = "Ready when you are.";
    renderTimer();
  });

  $("focusDuration").addEventListener("change", () => {
    if (timerInterval) return;
    timerSeconds = Number($("focusDuration").value) * 60;
    renderTimer();
  });

  function checkReminders() {
    if (localStorage.getItem("studyflow-reminders") !== "enabled" || !("Notification" in window) || Notification.permission !== "granted") return;
    const now = Date.now();
    const sent = new Set();
    try {
      const saved = JSON.parse(localStorage.getItem("studyflow-reminders-sent") || "[]");
      if (!Array.isArray(saved)) throw new Error("Reminder history is not a list.");
      saved.forEach((key) => { if (typeof key === "string") sent.add(key); });
    } catch (error) {
      console.error("Could not read reminder history:", error);
      localStorage.removeItem("studyflow-reminders-sent");
    }
    const upcoming = [
      ...state.tasks.filter((task) => !task.completed && task.date).map((task) => ({ ...task, kind: "Task" })),
      ...state.exams.map((exam) => ({ ...exam, kind: "Exam" }))
    ];
    for (const item of upcoming) {
      const when = new Date(`${item.date}T${item.time || "09:00"}:00`).getTime();
      const key = `${item.kind}:${item.id}:${item.date}:${item.time || ""}`;
      const remindAt = when - 15 * 60 * 1000;
      if (now < remindAt || now >= when || sent.has(key)) continue;
      new Notification(`${item.kind} coming up`, {
        body: `${item.title}${item.time ? ` · ${item.time}` : ""}`,
        tag: key
      });
      sent.add(key);
    }
    localStorage.setItem("studyflow-reminders-sent", JSON.stringify([...sent].slice(-200)));
  }

  $("reminders").addEventListener("click", async () => {
    if (!("Notification" in window)) return toast("This browser does not support notifications");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return toast("Notification permission was not granted");
    localStorage.setItem("studyflow-reminders", "enabled");
    $("reminders").textContent = "Reminders enabled";
    checkReminders();
    toast("Reminders enabled while this planner is open");
  });

  $("materialEducation").addEventListener("change", updateMaterialEducationFields);
  ["materialSubject", "checklistSubject", "questionSubject"].forEach((id) => {
    $(id).addEventListener("input", renderMaterialsChapterOptions);
  });
  $("quizSubject").addEventListener("change", updateQuizChapters);

  $("materialForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("materialId").value;
    const body = {
      ...materialEducationData(),
      subject: $("materialSubject").value.trim(),
      chapter: $("materialChapter").value.trim(),
      type: $("materialType").value,
      title: $("materialTitle").value.trim(),
      content: $("materialContent").value
    };
    try {
      await api(id ? `/api/materials/${encodeURIComponent(id)}` : "/api/materials", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(body)
      });
      resetMaterialForm();
      toast(id ? "Study material updated" : "Study material saved locally");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  $("materialCancel").addEventListener("click", resetMaterialForm);
  $("materialsList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-material-action]");
    if (!button) return;
    const material = state.materials.find((item) => item.id === button.dataset.id);
    if (!material) return;
    if (button.dataset.materialAction === "edit") return editMaterial(material);
    if (!confirm(`Delete "${material.title}"?`)) return;
    try {
      await api(`/api/materials/${encodeURIComponent(material.id)}`, { method: "DELETE" });
      toast("Study material deleted");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  function resetChecklistForm() {
    $("checklistForm").reset();
    $("checklistId").value = "";
    $("checklistSave").textContent = "Add checklist item";
    $("checklistCancel").hidden = true;
  }

  $("checklistForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("checklistId").value;
    const body = {
      ...materialEducationData(),
      subject: $("checklistSubject").value.trim(),
      chapter: $("checklistChapter").value.trim(),
      title: $("checklistTitleInput").value.trim(),
      completed: Boolean(state.checklist.find((item) => item.id === id)?.completed)
    };
    try {
      await api(id ? `/api/revision-checklist/${encodeURIComponent(id)}` : "/api/revision-checklist", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(body)
      });
      resetChecklistForm();
      toast(id ? "Checklist item updated" : "Checklist item added");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  $("checklistCancel").addEventListener("click", resetChecklistForm);
  $("checklistItems").addEventListener("change", async (event) => {
    const checkbox = event.target.closest("[data-checklist-toggle]");
    if (!checkbox) return;
    const item = state.checklist.find((entry) => entry.id === checkbox.dataset.checklistToggle);
    if (!item) return;
    try {
      await api(`/api/revision-checklist/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          educationLevel: item.educationLevel,
          classLevel: item.classLevel,
          course: item.course,
          semester: item.semester,
          subject: item.subject,
          chapter: item.chapter,
          title: item.title,
          completed: checkbox.checked
        })
      });
      item.completed = checkbox.checked;
      renderMaterials();
    } catch (error) {
      toast(error.message);
      await load();
    }
  });
  $("checklistItems").addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-checklist-edit]");
    if (editButton) {
      const item = state.checklist.find((entry) => entry.id === editButton.dataset.checklistEdit);
      if (!item) return;
      $("checklistId").value = item.id;
      $("materialEducation").value = item.educationLevel;
      $("materialClass").value = item.classLevel ? String(item.classLevel) : "";
      $("materialCourse").value = item.course || "";
      $("materialSemester").value = item.semester ? String(item.semester) : "";
      $("checklistSubject").value = item.subject;
      $("checklistChapter").value = item.chapter;
      $("checklistTitleInput").value = item.title;
      $("checklistSave").textContent = "Update checklist item";
      $("checklistCancel").hidden = false;
      updateMaterialEducationFields();
      return;
    }
    const deleteButton = event.target.closest("[data-checklist-delete]");
    if (!deleteButton) return;
    try {
      await api(`/api/revision-checklist/${encodeURIComponent(deleteButton.dataset.checklistDelete)}`, { method: "DELETE" });
      toast("Checklist item deleted");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  function questionFormData() {
    return {
      ...materialEducationData(),
      subject: $("questionSubject").value.trim(),
      chapter: $("questionChapter").value.trim(),
      topic: $("questionTopic").value.trim(),
      question: $("questionText").value.trim(),
      options: [0, 1, 2, 3].map((index) => $(`questionOption${index}`).value.trim()),
      correctIndex: Number($("questionAnswer").value),
      explanation: $("questionExplanation").value.trim()
    };
  }

  function resetQuestionForm() {
    $("questionForm").reset();
    $("questionId").value = "";
    $("questionSave").textContent = "Save question";
    $("questionCancel").hidden = true;
    $("questionAnswer").value = "";
  }

  $("questionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("questionId").value;
    try {
      await api(id ? `/api/questions/${encodeURIComponent(id)}` : "/api/questions", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(questionFormData())
      });
      resetQuestionForm();
      toast(id ? "Practice question updated" : "Practice question saved locally");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  $("questionCancel").addEventListener("click", resetQuestionForm);
  $("questionBankList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-question-action]");
    if (!button) return;
    const question = state.questions.find((item) => item.id === button.dataset.id);
    if (!question) return;
    if (button.dataset.questionAction === "edit") return editQuestion(question);
    if (!confirm("Delete this practice question?")) return;
    try {
      await api(`/api/questions/${encodeURIComponent(question.id)}`, { method: "DELETE" });
      if (state.quizProgress?.questionIds.includes(question.id)) {
        await api("/api/quizzes/progress", { method: "DELETE" });
        state.quizProgress = null;
        state.quizQuestions = [];
        state.quizAnswers = {};
      } else {
        state.quizQuestions = state.quizQuestions.filter((item) => item.id !== question.id);
      }
      toast("Practice question deleted");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  $("quizFilter").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.quizProgress && !confirm("Start a new quiz? Your saved in-progress answers will be replaced.")) return;
    const query = new URLSearchParams();
    if ($("quizSubject").value) query.set("subject", $("quizSubject").value);
    if ($("quizChapter").value) query.set("chapter", $("quizChapter").value);
    try {
      const questions = await api(`/api/quizzes/questions${query.size ? `?${query}` : ""}`);
      $("quizResult").hidden = true;
      if (!questions.length) {
        if (state.quizProgress) await api("/api/quizzes/progress", { method: "DELETE" });
        state.quizProgress = null;
        state.quizQuestions = [];
        state.quizAnswers = {};
        renderQuizQuestions();
        toast("No student-created questions match this selection");
        return;
      }
      const chosenQuestions = questions.slice(0, 100);
      const progress = await api("/api/quizzes/progress", {
        method: "POST",
        body: JSON.stringify({
          questionIds: chosenQuestions.map((question) => question.id),
          subject: $("quizSubject").value,
          chapter: $("quizChapter").value
        })
      });
      state.quizProgress = progress;
      state.quizQuestions = progress.questions;
      state.quizAnswers = progress.answers;
      renderQuizQuestions();
      if (questions.length > chosenQuestions.length) {
        $("quizProgressStatus").textContent = "Showing the first 100 matching questions per quiz.";
      }
    } catch (error) {
      toast(error.message);
    }
  });

  function persistQuizProgress() {
    if (!state.quizProgress) return Promise.resolve();
    const currentIndex = state.quizProgress.currentIndex;
    const answers = { ...state.quizAnswers };
    const operation = quizSaveQueue.catch(() => {}).then(async () => {
      const saved = await api("/api/quizzes/progress", {
        method: "PUT",
        body: JSON.stringify({ currentIndex, answers })
      });
      state.quizProgress = saved;
      $("quizProgressStatus").textContent = "Progress saved locally.";
      return saved;
    });
    quizSaveQueue = operation;
    return operation;
  }

  $("quizForm").addEventListener("change", async (event) => {
    if (!event.target.matches('input[name="quiz-answer"]')) return;
    const question = state.quizQuestions[state.quizProgress?.currentIndex || 0];
    if (!question) return;
    state.quizAnswers[question.id] = Number(event.target.value);
    renderQuizQuestions();
    try {
      await persistQuizProgress();
      renderQuizQuestions();
    } catch (error) {
      $("quizProgressStatus").textContent = `Progress could not be saved: ${error.message}`;
    }
  });

  async function moveQuizQuestion(offset) {
    if (!state.quizProgress) return;
    const target = state.quizProgress.currentIndex + offset;
    if (target < 0 || target >= state.quizQuestions.length) return;
    state.quizProgress.currentIndex = target;
    renderQuizQuestions();
    try {
      await persistQuizProgress();
    } catch (error) {
      $("quizProgressStatus").textContent = `Progress could not be saved: ${error.message}`;
    }
  }

  $("quizPrevious").addEventListener("click", () => moveQuizQuestion(-1));
  $("quizNext").addEventListener("click", () => moveQuizQuestion(1));

  $("quizForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const unanswered = state.quizQuestions.findIndex((question) => !Number.isInteger(state.quizAnswers[question.id]));
    if (unanswered !== -1) {
      state.quizProgress.currentIndex = unanswered;
      renderQuizQuestions();
      toast("Answer every question before finishing the quiz");
      return;
    }
    const answers = state.quizQuestions.map((question) => {
      return { id: question.id, answerIndex: state.quizAnswers[question.id] };
    });
    try {
      await quizSaveQueue.catch(() => {});
      const result = await api("/api/quizzes/submit", {
        method: "POST",
        body: JSON.stringify({
          subject: $("quizSubject").value,
          chapter: $("quizChapter").value,
          answers
        })
      });
      $("quizResult").innerHTML = `<h4>Your score: ${result.score}/${result.total} (${result.percent}%)</h4>${result.results.map((answer, index) => `
        <article class="quiz-answer ${answer.correct ? "correct" : "incorrect"}"><b>${answer.correct ? "Correct" : "Incorrect"} · ${escapeHtml(state.quizQuestions[index]?.question || "")}</b><p>Your answer: ${escapeHtml(state.quizQuestions[index]?.options[answers[index].answerIndex] || "")}</p><p>Correct answer: ${escapeHtml(state.quizQuestions[index]?.options[answer.correctIndex] || "")}</p>${answer.explanation ? `<small>${escapeHtml(answer.explanation)}</small>` : ""}</article>`).join("")}`;
      $("quizResult").hidden = false;
      state.quizProgress = null;
      state.quizQuestions = [];
      state.quizAnswers = {};
      state.quizAttempts = await api("/api/quizzes/attempts");
      state.quizAccuracy = await api("/api/quiz-accuracy");
      renderQuizQuestions();
      renderMaterials();
      await refreshAiMonitor();
    } catch (error) {
      toast(error.message);
    }
  });

  $("plannerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.loadStatus !== "ready") {
      $("plannerStatus").textContent = "Wait for your saved planner data to finish loading, then try again.";
      return;
    }
    const startDate = $("planStartDate").value;
    const dayCount = Number($("planDays").value);
    const blockMinutes = Number($("planBlockMinutes").value);
    if (!startDate || ![7, 14].includes(dayCount) || ![25, 30, 45, 60].includes(blockMinutes)) {
      $("plannerStatus").textContent = "Choose a valid start date, plan length, and study block.";
      return;
    }
    if (startDate < dateKey(new Date())) {
      $("plannerStatus").textContent = "The plan start date cannot be in the past.";
      return;
    }
    try {
      state.planResult = window.StudyPlanEngine.scheduleStudyPlan({
        syllabus: state.syllabus,
        exams: state.exams,
        availableMinutesPerDay: state.profile?.availableMinutesPerDay || 0,
        startDate,
        days: dayCount,
        blockMinutes,
        excludedTopicIds: handledPlanTopicIds(),
        existingItems: state.planItems.filter((item) => item.status === "completed")
      });
      state.planBlocks = state.planResult.items.map((item) => ({ ...item, selected: true }));
      $("plannerWarning").textContent = state.planResult.warning;
      $("plannerWarning").hidden = !state.planResult.warning;
      renderPlanDraft();
      $("plannerStatus").textContent = state.planBlocks.length
        ? `Preview ready: ${state.planBlocks.length} block${state.planBlocks.length === 1 ? "" : "s"}. Choose which items to save.`
        : state.planResult.dailyMinutes === 0
          ? "No schedule generated. Set a non-zero daily study time in your student profile."
            : !state.planResult.subjectSummaries.some((subject) => subject.totalTopics > 0)
              ? "Add syllabus topics to your subjects before building a study schedule."
              : state.planResult.subjectSummaries.every((subject) => !subject.incompleteTopics && !subject.revisionTopics)
                ? "All saved syllabus topics are complete. Add revision flags or update topic progress to plan more study."
                : "No eligible topics fit this date range. Check the exam dates and plan horizon.";
    } catch (error) {
      state.planBlocks = [];
      state.planResult = null;
      renderPlanDraft();
      $("plannerStatus").textContent = error.message;
    }
  });

  $("plannerRows").addEventListener("change", (event) => {
    if (event.target.matches("[data-plan-select]")) {
      const block = state.planBlocks[Number(event.target.dataset.planSelect)];
      if (block) block.selected = event.target.checked;
      syncPlanSelection();
    }
  });

  $("planSelectAll").addEventListener("change", () => {
    $("plannerRows").querySelectorAll("[data-plan-select]").forEach((checkbox) => {
      checkbox.checked = $("planSelectAll").checked;
      const block = state.planBlocks[Number(checkbox.dataset.planSelect)];
      if (block) block.selected = checkbox.checked;
    });
    syncPlanSelection();
  });

  $("savePlan").addEventListener("click", async () => {
    const selected = [...$("plannerRows").querySelectorAll("[data-plan-select]:checked")]
      .map((checkbox) => Number(checkbox.dataset.planSelect))
      .filter((index) => Number.isInteger(index) && state.planBlocks[index]);
    if (!selected.length) return;
    const button = $("savePlan");
    button.disabled = true;
    button.textContent = "Saving…";
    $("plannerStatus").textContent = `Saving ${selected.length} selected plan item${selected.length === 1 ? "" : "s"} locally…`;
    try {
      await api("/api/study-plan", {
        method: "PUT",
        body: JSON.stringify({
          ...state.planResult,
          fingerprint: currentPlanFingerprint(),
          items: selected.map((index) => state.planBlocks[index])
        })
      });
      const saved = await api("/api/study-plan");
      state.planItems = saved.items;
      state.planMetadata = saved.metadata;
      renderSavedPlan();
      $("savedPlanMessage").hidden = true;
      updatePlanCoverageWarning();
      $("plannerStatus").textContent = `${selected.length} plan item${selected.length === 1 ? "" : "s"} saved locally.`;
      toast("Study plan saved on this device");
    } catch (error) {
      $("plannerStatus").textContent = `Could not save the plan: ${error.message}`;
      toast(error.message);
    } finally {
      button.textContent = "Save schedule";
      syncPlanSelection();
    }
  });

  $("savedPlanItems").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-plan-action]");
    if (!button) return;
    const status = button.dataset.planAction === "complete" ? "completed" : "skipped";
    try {
      await api(`/api/study-plan/${encodeURIComponent(button.dataset.id)}`, {
        method: "PUT",
        body: JSON.stringify({ status })
      });
      const item = state.planItems.find((planItem) => planItem.id === button.dataset.id);
      if (item) item.status = status;
      renderSavedPlan();
      updatePlanCoverageWarning();
      toast(status === "completed" ? "Plan item completed" : "Plan item skipped");
    } catch (error) {
      toast(error.message);
    }
  });

  $("savedPlanItems").addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-reschedule-id]");
    if (!form) return;
    event.preventDefault();
    const date = form.querySelector("[data-reschedule-date]").value;
    try {
      await api(`/api/study-plan/${encodeURIComponent(form.dataset.rescheduleId)}`, {
        method: "PUT",
        body: JSON.stringify({ date })
      });
      const item = state.planItems.find((planItem) => planItem.id === form.dataset.rescheduleId);
      if (item) item.date = date;
      state.planItems.sort((left, right) => left.date.localeCompare(right.date));
      renderSavedPlan();
      updatePlanCoverageWarning();
      toast("Plan item rescheduled");
    } catch (error) {
      toast(error.message);
    }
  });

  const sectionLinks = [...document.querySelectorAll("[data-section-link]")];
  const navMenuToggle = $("navMenuToggle");
  function closeMobileNavigation() {
    document.body.classList.remove("nav-open");
    navMenuToggle.setAttribute("aria-expanded", "false");
    navMenuToggle.setAttribute("aria-label", "Open navigation menu");
  }
  navMenuToggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("nav-open");
    navMenuToggle.setAttribute("aria-expanded", String(isOpen));
    navMenuToggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
  });
  sectionLinks.forEach((link) => link.addEventListener("click", closeMobileNavigation));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileNavigation();
  });
  function syncSectionNavigation() {
    const hash = window.location.hash || "#dashboard";
    const currentLink = sectionLinks.find((link) => link.getAttribute("href") === hash) || sectionLinks[0];
    sectionLinks.forEach((link) => {
      const active = link === currentLink;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    $("pageTitle").textContent = currentLink.dataset.sectionName;
    closeMobileNavigation();
  }
  window.addEventListener("hashchange", syncSectionNavigation);
  syncSectionNavigation();

  const now = new Date();
  $("weekday").textContent = now.toLocaleDateString(undefined, { weekday: "long" });
  $("today").textContent = now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  $("studyDate").value = dateKey(now);
  $("planStartDate").value = dateKey(now);
  $("planStartDate").min = dateKey(now);
  $("reminders").textContent = localStorage.getItem("studyflow-reminders") === "enabled"
    ? "Reminders enabled"
    : "Enable reminders";
  $("focusDuration").value = "25";
  renderTimer();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch((error) => console.error("Offline cache registration failed:", error));
  }
  setInterval(checkReminders, 60 * 1000);
  load();
})();
