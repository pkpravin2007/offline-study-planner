(() => {
  const $ = (id) => document.getElementById(id);
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
    examForm: $("examForm")
  };
  const state = { tasks: [], exams: [], subjects: [], sessions: [], settings: { weeklyGoalMinutes: 600 }, report: null };
  let toastTimer;
  let noteTimer;
  let timerInterval;
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
        <button type="button" data-remove-subject="${escapeHtml(subject)}" aria-label="Remove ${escapeHtml(subject)}">×</button>
      </span>
    `).join("");
  }

  function renderTasks() {
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
    elements.empty.style.display = filtered.length ? "none" : "block";
    elements.tasks.style.display = filtered.length ? "flex" : "none";

    const completed = state.tasks.filter((task) => task.completed).length;
    const percent = state.tasks.length ? Math.round(completed / state.tasks.length * 100) : 0;
    $("total").textContent = state.tasks.length;
    $("completed").textContent = completed;
    $("pending").textContent = state.tasks.length - completed;
    $("percent").textContent = `${percent}%`;
    $("bar").style.width = `${percent}%`;
    $("progressText").textContent = state.tasks.length
      ? `${completed} of ${state.tasks.length} tasks completed`
      : "Every small step matters.";
  }

  function renderExams() {
    const exams = [...state.exams].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    elements.exams.innerHTML = exams.map((exam) => `
      <article class="exam-item">
        <div class="exam-date"><b>${escapeHtml(new Date(`${exam.date}T00:00:00`).getDate())}</b><span>${escapeHtml(new Date(`${exam.date}T00:00:00`).toLocaleDateString(undefined, { month: "short" }))}</span></div>
        <div class="exam-info"><b>${escapeHtml(exam.title)}</b><span>${escapeHtml(exam.subject || "General")}${exam.time ? ` · ${escapeHtml(exam.time)}` : ""}</span>${exam.details ? `<small>${escapeHtml(exam.details)}</small>` : ""}</div>
        <div class="actions"><button class="mini" data-exam-action="edit" data-id="${escapeHtml(exam.id)}" aria-label="Edit exam">✎</button><button class="mini" data-exam-action="delete" data-id="${escapeHtml(exam.id)}" aria-label="Delete exam">×</button></div>
      </article>
    `).join("");
    $("examEmpty").style.display = exams.length ? "none" : "block";
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
    const goal = report.weeklyGoalMinutes;
    const percent = Math.min(100, Math.round(report.weeklyMinutes / goal * 100));
    $("weeklyTime").textContent = formatMinutes(report.weeklyMinutes);
    $("weeklyGoalLabel").textContent = `of ${formatGoal(goal)}`;
    $("weeklyGoal").value = (goal / 60).toString();
    $("goalBar").style.width = `${percent}%`;
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
    try {
      const [tasks, notes, exams, subjects, sessions, settings, report] = await Promise.all([
        api("/api/tasks"),
        api("/api/notes"),
        api("/api/exams"),
        api("/api/subjects"),
        api("/api/sessions"),
        api("/api/settings"),
        api("/api/reports")
      ]);
      state.tasks = tasks;
      state.exams = exams;
      state.sessions = sessions;
      state.settings = settings;
      state.report = report;
      if (document.activeElement !== elements.notes) elements.notes.value = notes.content || "";
      $("noteStatus").textContent = "Saved in this device's SQLite database";
      $("status").textContent = "Connected · Local database";
      setSubjects(subjects);
      renderTasks();
      renderExams();
      renderCalendar();
      renderReport();
      checkReminders();
    } catch (error) {
      $("status").textContent = "Server not connected";
      $("noteStatus").textContent = "Start the local server to use your planner";
      elements.empty.style.display = "block";
      elements.empty.querySelector("h3").textContent = "Backend is not running";
      elements.empty.querySelector("p").textContent = "In the project folder, run npm.cmd start.";
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
    const button = event.target.closest("[data-remove-subject]");
    if (!button) return;
    const subject = button.dataset.removeSubject;
    if (!confirm(`Remove "${subject}" from your subject list? Existing tasks keep their subject.`)) return;
    try {
      await api(`/api/subjects/${encodeURIComponent(subject)}`, { method: "DELETE" });
      await load();
      toast("Subject removed");
    } catch (error) {
      toast(error.message);
    }
  });

  elements.notes.addEventListener("input", () => {
    $("noteStatus").textContent = "Saving…";
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      try {
        await api("/api/notes", { method: "PUT", body: JSON.stringify({ content: elements.notes.value }) });
        $("noteStatus").textContent = "Saved in this device's SQLite database";
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

  const now = new Date();
  $("weekday").textContent = now.toLocaleDateString(undefined, { weekday: "long" });
  $("today").textContent = now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
