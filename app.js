/* ===================== State ===================== */
const STORAGE_KEY = "molly-panel-tasks-v1";
const SESSIONS_KEY = "molly-panel-sessions-v1";
const ACHIEVEMENTS_KEY = "molly-panel-achievements-v1";

const CATEGORIES_KEY = "molly-panel-categories-v1";
const DEFAULT_CATEGORIES = [
  { name: "Recruiting", color: "#7fa9d0" },
  { name: "Courses",    color: "#a897d9" },
  { name: "Personal",   color: "#e0a97e" },
  { name: "Learning",   color: "#8bbf8a" },
];
const CATEGORY_PALETTE = ["#7fa9d0", "#a897d9", "#e0a97e", "#8bbf8a", "#e08fa0", "#7fd0c0", "#d9c15a", "#b98ad9", "#8ab0d9", "#d97f7f"];

const PRIORITY_META = {
  high:            { label: "High",           color: "var(--pri-high)" },
  medium:          { label: "Medium",         color: "var(--pri-medium)" },
  low:             { label: "Low",            color: "var(--pri-low)" },
  "time-sensitive":{ label: "Time-sensitive", color: "var(--pri-timesensitive)" },
};

let tasks = loadTasks();
let sessions = loadJSON(SESSIONS_KEY, []);
let unlockedAchievements = loadJSON(ACHIEVEMENTS_KEY, {});
let categories = loadJSON(CATEGORIES_KEY, DEFAULT_CATEGORIES);
let calendarViewDate = new Date(); // month currently displayed
let selectedDate = null; // "YYYY-MM-DD" or null (show all)

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return [];
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return fallback;
}

function saveSessions() {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function saveAchievements() {
  localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(unlockedAchievements));
}

function saveCategories() {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
}

function getCategoryColor(name) {
  const c = categories.find(c => c.name === name);
  return c ? c.color : "#b0b0b0";
}

function addCategory(name) {
  name = (name || "").trim();
  if (!name) return null;
  const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.name;
  const color = CATEGORY_PALETTE[categories.length % CATEGORY_PALETTE.length];
  categories.push({ name, color });
  saveCategories();
  return name;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr() {
  return formatDate(new Date());
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ===================== Tabs ===================== */
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

/* ===================== Greeting ===================== */
function renderGreeting() {
  const now = new Date();
  const hour = now.getHours();
  let text;

  if (hour >= 5 && hour < 12) {
    text = "Good morning, Molly";
  } else if (hour >= 12 && hour < 17) {
    text = "Good afternoon, Molly";
  } else if (hour >= 17 && hour < 22) {
    text = "Good evening, Molly";
  } else {
    text = "Hey night owl, Molly";
  }

  document.getElementById("greeting-text").innerHTML = `${text} <span class="wave">:)</span>`;
  document.getElementById("greeting-date").textContent = now.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}

/* ===================== Calendar ===================== */
function renderCalendar() {
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();

  document.getElementById("cal-month-label").textContent =
    calendarViewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const datesWithTasks = new Set(tasks.filter(t => t.dueDate).map(t => t.dueDate));
  const today = todayStr();

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement("div");
    empty.className = "cal-day empty";
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    const dateStr = formatDate(dateObj);
    const cell = document.createElement("div");
    cell.className = "cal-day";
    if (dateStr === today) cell.classList.add("today");
    if (dateStr === selectedDate) cell.classList.add("selected");
    cell.innerHTML = `${d}`;
    if (datesWithTasks.has(dateStr)) {
      const dot = document.createElement("span");
      dot.className = "dot";
      cell.appendChild(dot);
    }
    cell.addEventListener("click", () => {
      selectedDate = (selectedDate === dateStr) ? null : dateStr;
      renderAll();
    });
    grid.appendChild(cell);
  }

  document.getElementById("cal-clear").style.display = selectedDate ? "block" : "none";
}

document.getElementById("cal-prev").addEventListener("click", () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
  renderCalendar();
});
document.getElementById("cal-next").addEventListener("click", () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
  renderCalendar();
});
document.getElementById("cal-clear").addEventListener("click", () => {
  selectedDate = null;
  renderAll();
});

/* ===================== Stats ===================== */
function renderStats() {
  const today = todayStr();
  const incomplete = tasks.filter(t => !t.completed);

  const awaiting = incomplete.filter(t => t.dueDate === today).length;
  const highPriority = incomplete.filter(t => t.priority === "high" && t.dueDate === today).length;

  const todaysMinutes = incomplete
    .filter(t => t.dueDate === today)
    .reduce((sum, t) => sum + (Number(t.estimate) || 0), 0);
  const hrs = Math.floor(todaysMinutes / 60);
  const mins = todaysMinutes % 60;
  const timeLabel = todaysMinutes === 0 ? "0h" : (hrs > 0 ? `${hrs}h ${mins ? mins + "m" : ""}`.trim() : `${mins}m`);

  const completedToday = tasks.filter(t => t.completed && t.completedOn === today).length;

  const workedMinutes = sessions
    .filter(s => s.date === today)
    .reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
  const workedLabel = formatMinutesLabel(workedMinutes);

  document.getElementById("stat-awaiting").textContent = awaiting;
  document.getElementById("stat-priority").textContent = highPriority;
  document.getElementById("stat-time").textContent = timeLabel;
  document.getElementById("stat-worked").textContent = workedLabel;
  document.getElementById("stat-done").textContent = completedToday;
}

function formatMinutesLabel(totalMinutes) {
  if (!totalMinutes) return "0h";
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return hrs > 0 ? `${hrs}h ${mins ? mins + "m" : ""}`.trim() : `${mins}m`;
}

/* ===================== Task list ===================== */
function populateCategorySelects() {
  const filterSelect = document.getElementById("category-filter");
  const currentFilter = filterSelect.value;
  filterSelect.innerHTML = `<option value="all">All categories</option>`;
  categories.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    filterSelect.appendChild(opt);
  });
  filterSelect.value = currentFilter || "all";

  const taskCatSelect = document.getElementById("task-category");
  const currentCat = taskCatSelect.value;
  taskCatSelect.innerHTML = "";
  categories.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    taskCatSelect.appendChild(opt);
  });
  if (currentCat) taskCatSelect.value = currentCat;
}

const newCategoryRow = document.getElementById("new-category-row");
const newCategoryInput = document.getElementById("new-category-input");

document.getElementById("add-category-btn").addEventListener("click", () => {
  const open = newCategoryRow.style.display !== "none";
  newCategoryRow.style.display = open ? "none" : "flex";
  if (!open) {
    newCategoryInput.value = "";
    newCategoryInput.focus();
  }
});

function confirmNewCategory() {
  const added = addCategory(newCategoryInput.value);
  if (!added) return;
  populateCategorySelects();
  document.getElementById("task-category").value = added;
  newCategoryRow.style.display = "none";
  newCategoryInput.value = "";
}

document.getElementById("new-category-confirm").addEventListener("click", confirmNewCategory);
newCategoryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    confirmNewCategory();
  }
});

let showCompletedAll = false;

document.getElementById("toggle-completed-btn").addEventListener("click", () => {
  showCompletedAll = !showCompletedAll;
  document.getElementById("toggle-completed-btn").textContent = showCompletedAll ? "Hide Old Completed" : "Show Completed";
  renderTasks();
});

function renderTasks() {
  const container = document.getElementById("tasks-categories");
  const filterCat = document.getElementById("category-filter").value;
  const titleEl = document.getElementById("tasks-title");

  titleEl.textContent = selectedDate
    ? `Tasks for ${new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}`
    : "All Tasks";

  let visible = tasks.slice();
  if (selectedDate) {
    visible = visible.filter(t => t.dueDate === selectedDate);
  } else if (!showCompletedAll) {
    const today = todayStr();
    visible = visible.filter(t => !t.completed || t.completedOn === today);
  }
  if (filterCat !== "all") visible = visible.filter(t => t.category === filterCat);

  container.innerHTML = "";

  if (visible.length === 0) {
    container.innerHTML = `<div class="empty-state">No tasks here yet — add one to get started ✨</div>`;
    return;
  }

  const priorityOrder = { high: 0, "time-sensitive": 1, medium: 2, low: 3 };
  const categoryNames = categories.map(c => c.name);
  const usedCategories = new Set(visible.map(t => t.category));
  usedCategories.forEach(cat => { if (!categoryNames.includes(cat)) categoryNames.push(cat); });

  categoryNames.forEach(cat => {
    const catTasks = visible
      .filter(t => t.category === cat)
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const pa = priorityOrder[a.priority] ?? 9;
        const pb = priorityOrder[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
      });

    if (catTasks.length === 0) return;

    const color = getCategoryColor(cat);
    const block = document.createElement("div");
    block.className = "category-block";
    block.innerHTML = `
      <div class="category-heading" style="color:${color}">
        <span class="category-dot" style="background:${color}"></span>
        ${escapeHtml(cat)}
        <span class="category-count">${catTasks.length}</span>
      </div>
      <div class="task-list"></div>
    `;
    const list = block.querySelector(".task-list");

    catTasks.forEach(t => list.appendChild(renderTaskItem(t)));
    container.appendChild(block);
  });
}

function renderTaskItem(t) {
  const pMeta = PRIORITY_META[t.priority] || PRIORITY_META.medium;
  const item = document.createElement("div");
  item.className = "task-item" + (t.completed ? " completed" : "");
  item.style.borderLeftColor = pMeta.color;

  const metaParts = [];
  if (t.recurringId) metaParts.push(`<span class="recurring-badge">↻ Recurring</span>`);
  if (t.link) metaParts.push(`<a href="${escapeAttr(t.link)}" target="_blank" rel="noopener">Link</a>`);

  const sideParts = [];
  if (t.dueDate) {
    const dateLabel = new Date(t.dueDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    sideParts.push(`<div class="task-due">Due ${dateLabel}${t.dueTime ? " · " + formatTime(t.dueTime) : ""}</div>`);
  }
  if (t.estimate) sideParts.push(`<div class="task-estimate">${t.estimate} min</div>`);

  item.innerHTML = `
    <div class="task-checkbox ${t.completed ? "checked" : ""}">${t.completed ? "✓" : ""}</div>
    <div class="task-body">
      <div class="task-title-row">
        <span class="task-title">${escapeHtml(t.title)}</span>
        <span class="priority-badge" style="background:${pMeta.color}">${pMeta.label}</span>
      </div>
      ${metaParts.length ? `<div class="task-meta">${metaParts.join("")}</div>` : ""}
      ${t.notes ? `<div class="task-notes">${escapeHtml(t.notes)}</div>` : ""}
    </div>
    ${sideParts.length ? `<div class="task-side">${sideParts.join("")}</div>` : ""}
  `;

  item.querySelector(".task-checkbox").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleComplete(t.id);
  });

  item.addEventListener("click", () => openModal(t.id));

  return item;
}

function formatTime(t) {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function escapeAttr(str) {
  return (str ?? "").replace(/"/g, "&quot;");
}

function toggleComplete(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.completed = !t.completed;
  t.completedOn = t.completed ? todayStr() : null;
  t.completedAt = t.completed ? new Date().toISOString() : null;
  saveTasks();
  renderAll();
  checkAchievements();
}

document.getElementById("category-filter").addEventListener("change", renderTasks);

/* ===================== Modal ===================== */
const overlay = document.getElementById("modal-overlay");
const form = document.getElementById("task-form");

const recurringCheckbox = document.getElementById("task-recurring");
const recurringOptions = document.getElementById("recurring-options");
const recurringSection = document.getElementById("recurring-section");
const dueDateRow = document.getElementById("due-date-row");
const recurringFrequency = document.getElementById("recurring-frequency");
const weekdaysField = document.getElementById("recurring-weekdays-field");
const recurringError = document.getElementById("recurring-error");
let selectedWeekdays = new Set();

recurringCheckbox.addEventListener("change", () => {
  const on = recurringCheckbox.checked;
  recurringOptions.style.display = on ? "flex" : "none";
  dueDateRow.style.display = on ? "none" : "grid";
});

recurringFrequency.addEventListener("change", () => {
  weekdaysField.style.display = recurringFrequency.value === "weekly" ? "block" : "none";
});

document.querySelectorAll(".weekday-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const day = btn.dataset.day;
    if (selectedWeekdays.has(day)) {
      selectedWeekdays.delete(day);
      btn.classList.remove("active");
    } else {
      selectedWeekdays.add(day);
      btn.classList.add("active");
    }
  });
});

function resetRecurringUI() {
  recurringCheckbox.checked = false;
  recurringOptions.style.display = "none";
  dueDateRow.style.display = "grid";
  recurringFrequency.value = "weekly";
  weekdaysField.style.display = "block";
  selectedWeekdays.clear();
  document.querySelectorAll(".weekday-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("recurring-start").value = selectedDate || todayStr();
  document.getElementById("recurring-until").value = "";
  document.getElementById("recurring-time").value = "";
  recurringError.style.display = "none";
}

function openModal(taskId = null) {
  form.reset();
  resetRecurringUI();
  document.getElementById("task-id").value = taskId || "";

  const t = taskId ? tasks.find(x => x.id === taskId) : null;
  const isSeriesEdit = !!(t && t.recurringId);

  const deleteBtn = document.getElementById("delete-task-btn");
  deleteBtn.style.display = taskId ? "inline-block" : "none";
  deleteBtn.textContent = isSeriesEdit ? "Delete This Occurrence" : "Delete";
  document.getElementById("delete-series-btn").style.display = isSeriesEdit ? "inline-block" : "none";

  document.getElementById("recurring-checkbox-row").style.display = isSeriesEdit ? "none" : "flex";
  document.getElementById("series-edit-note").style.display = isSeriesEdit ? "block" : "none";
  recurringSection.style.display = (!taskId || isSeriesEdit) ? "block" : "none";

  if (t) {
    document.getElementById("modal-title").textContent = "Edit Task";
    document.getElementById("task-title").value = t.title;
    document.getElementById("task-category").value = t.category;
    document.getElementById("task-priority").value = t.priority;
    document.getElementById("task-due-date").value = t.dueDate || "";
    document.getElementById("task-due-time").value = t.dueTime || "";
    document.getElementById("task-estimate").value = t.estimate || "";
    document.getElementById("task-link").value = t.link || "";
    document.getElementById("task-notes").value = t.notes || "";

    if (isSeriesEdit) {
      recurringOptions.style.display = "flex";
      dueDateRow.style.display = "none";
      recurringFrequency.value = t.recurringFrequency || "weekly";
      weekdaysField.style.display = recurringFrequency.value === "weekly" ? "block" : "none";
      selectedWeekdays = new Set(t.recurringWeekdays || []);
      document.querySelectorAll(".weekday-btn").forEach(b => {
        b.classList.toggle("active", selectedWeekdays.has(b.dataset.day));
      });
      document.getElementById("recurring-start").value = t.recurringStart || t.dueDate || "";
      document.getElementById("recurring-until").value = t.recurringUntil || "";
      document.getElementById("recurring-time").value = t.recurringTime || t.dueTime || "";
    }
  } else {
    document.getElementById("modal-title").textContent = "New Task";
    if (selectedDate) document.getElementById("task-due-date").value = selectedDate;
  }

  overlay.classList.add("open");
}

function closeModal() {
  overlay.classList.remove("open");
}

document.getElementById("add-task-btn").addEventListener("click", () => openModal());
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("cancel-task-btn").addEventListener("click", closeModal);
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

document.getElementById("delete-task-btn").addEventListener("click", () => {
  const id = document.getElementById("task-id").value;
  if (!id) return;
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  closeModal();
  renderAll();
});

document.getElementById("delete-series-btn").addEventListener("click", () => {
  const id = document.getElementById("task-id").value;
  const t = tasks.find(x => x.id === id);
  if (!t || !t.recurringId) return;
  tasks = tasks.filter(x => x.recurringId !== t.recurringId);
  saveTasks();
  closeModal();
  renderAll();
});

function generateRecurringDates(startStr, untilStr, frequency, weekdaySet) {
  const MAX_OCCURRENCES = 300;
  const dates = [];
  const start = new Date(startStr + "T00:00:00");
  const until = new Date(untilStr + "T00:00:00");

  if (frequency === "weekly") {
    const days = new Set(Array.from(weekdaySet).map(Number));
    const cursor = new Date(start);
    while (cursor <= until && dates.length < MAX_OCCURRENCES) {
      if (days.has(cursor.getDay())) dates.push(formatDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    const dayOfMonth = start.getDate();
    let cursor = new Date(start);
    while (cursor <= until && dates.length < MAX_OCCURRENCES) {
      dates.push(formatDate(cursor));
      const nextMonthIndex = cursor.getMonth() + 1;
      const nextYear = cursor.getFullYear() + Math.floor(nextMonthIndex / 12);
      const nextMonth = nextMonthIndex % 12;
      const daysInNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
      cursor = new Date(nextYear, nextMonth, Math.min(dayOfMonth, daysInNextMonth));
    }
  }
  return dates;
}

function showRecurringError(message) {
  recurringError.textContent = message;
  recurringError.style.display = "block";
}

function readRecurrenceForm() {
  const frequency = recurringFrequency.value;
  const start = document.getElementById("recurring-start").value;
  const until = document.getElementById("recurring-until").value;
  const time = document.getElementById("recurring-time").value;

  if (!start || !until) {
    showRecurringError("Please set both a start and until date.");
    return null;
  }
  if (until < start) {
    showRecurringError("Until date must be on or after the start date.");
    return null;
  }
  if (frequency === "weekly" && selectedWeekdays.size === 0) {
    showRecurringError("Pick at least one day of the week.");
    return null;
  }

  const dates = generateRecurringDates(start, until, frequency, selectedWeekdays);
  if (dates.length === 0) {
    showRecurringError("No occurrences found in that date range.");
    return null;
  }

  return { frequency, start, until, time, dates };
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("task-id").value;
  recurringError.style.display = "none";

  const baseData = {
    title: document.getElementById("task-title").value.trim(),
    category: document.getElementById("task-category").value,
    priority: document.getElementById("task-priority").value,
    estimate: document.getElementById("task-estimate").value,
    link: document.getElementById("task-link").value.trim(),
    notes: document.getElementById("task-notes").value.trim(),
  };

  if (!baseData.title) return;

  const existingTask = id ? tasks.find(x => x.id === id) : null;
  const isSeriesEdit = !!(existingTask && existingTask.recurringId);
  const isNewRecurring = !id && recurringCheckbox.checked;

  if (isNewRecurring || isSeriesEdit) {
    const rec = readRecurrenceForm();
    if (!rec) return;

    const recurringId = isSeriesEdit ? existingTask.recurringId : uid();
    const recurringMeta = {
      recurringId,
      recurringFrequency: rec.frequency,
      recurringWeekdays: rec.frequency === "weekly" ? Array.from(selectedWeekdays) : [],
      recurringStart: rec.start,
      recurringUntil: rec.until,
      recurringTime: rec.time,
    };

    if (isSeriesEdit) {
      const existingByDate = {};
      tasks.filter(t => t.recurringId === recurringId).forEach(t => { existingByDate[t.dueDate] = t; });

      const seriesTasks = rec.dates.map(dateStr => {
        const prior = existingByDate[dateStr];
        if (prior) {
          Object.assign(prior, baseData, recurringMeta, { dueDate: dateStr, dueTime: rec.time });
          return prior;
        }
        return {
          id: uid(),
          completed: false,
          completedOn: null,
          dueDate: dateStr,
          dueTime: rec.time,
          ...recurringMeta,
          ...baseData,
        };
      });

      tasks = tasks.filter(t => t.recurringId !== recurringId);
      tasks.push(...seriesTasks);
    } else {
      rec.dates.forEach(dateStr => {
        tasks.push({
          id: uid(),
          completed: false,
          completedOn: null,
          dueDate: dateStr,
          dueTime: rec.time,
          ...recurringMeta,
          ...baseData,
        });
      });
    }
  } else {
    const data = {
      ...baseData,
      dueDate: document.getElementById("task-due-date").value,
      dueTime: document.getElementById("task-due-time").value,
    };

    if (id) {
      Object.assign(existingTask, data);
    } else {
      tasks.push({
        id: uid(),
        completed: false,
        completedOn: null,
        ...data,
      });
    }
  }

  saveTasks();
  closeModal();
  renderAll();
});

/* ===================== Achievements ===================== */
const ACHIEVEMENT_CATEGORIES = ["Milestones", "Streaks", "Time Tracked", "Fun"];

const ACHIEVEMENTS = [
  { id: "first-task",   category: "Milestones",  title: "First Steps",       desc: "Complete your first task.",                          check: ctx => ctx.totalCompleted >= 1,        progress: ctx => [ctx.totalCompleted, 1] },
  { id: "momentum-10",  category: "Milestones",  title: "Getting Momentum",  desc: "Complete 10 tasks in total.",                        check: ctx => ctx.totalCompleted >= 10,       progress: ctx => [ctx.totalCompleted, 10] },
  { id: "quarter-25",   category: "Milestones",  title: "Quarter Century",   desc: "Complete 25 tasks in total.",                        check: ctx => ctx.totalCompleted >= 25,       progress: ctx => [ctx.totalCompleted, 25] },
  { id: "half-50",      category: "Milestones",  title: "Half Century",      desc: "Complete 50 tasks in total.",                        check: ctx => ctx.totalCompleted >= 50,       progress: ctx => [ctx.totalCompleted, 50] },
  { id: "century-100",  category: "Milestones",  title: "Century",           desc: "Complete 100 tasks in total.",                       check: ctx => ctx.totalCompleted >= 100,      progress: ctx => [ctx.totalCompleted, 100] },
  { id: "legend-250",   category: "Milestones",  title: "Task Legend",       desc: "Complete 250 tasks in total.",                       check: ctx => ctx.totalCompleted >= 250,      progress: ctx => [ctx.totalCompleted, 250] },
  { id: "task-master",  category: "Milestones",  title: "Task Master",       desc: "Complete every task due today.",                     check: ctx => ctx.todayAllDone },
  { id: "high-five",    category: "Milestones",  title: "High Five",         desc: "Complete 5 high-priority tasks.",                    check: ctx => ctx.highPriorityCompleted >= 5,  progress: ctx => [ctx.highPriorityCompleted, 5] },
  { id: "priority-pro", category: "Milestones",  title: "Priority Pro",      desc: "Complete 25 high-priority tasks.",                   check: ctx => ctx.highPriorityCompleted >= 25, progress: ctx => [ctx.highPriorityCompleted, 25] },
  { id: "well-rounded", category: "Milestones",  title: "Well Rounded",      desc: "Complete tasks in 4 different categories.",          check: ctx => ctx.distinctCategoriesCompleted >= 4, progress: ctx => [ctx.distinctCategoriesCompleted, 4] },
  { id: "habit",        category: "Milestones",  title: "Creature of Habit", desc: "Complete 10 occurrences from a recurring series.",   check: ctx => ctx.recurringCompletedCount >= 10, progress: ctx => [ctx.recurringCompletedCount, 10] },
  { id: "efficiency-20",category: "Milestones",  title: "Efficiency Expert", desc: "Finish 20 tasks within their estimated time.",       check: ctx => ctx.onTimeCompletedCount >= 20,  progress: ctx => [ctx.onTimeCompletedCount, 20] },
  { id: "cat-champion", category: "Milestones",  title: "Category Champion", desc: "Complete 20 tasks in a single category.",            check: ctx => ctx.maxCategoryCount >= 20,       progress: ctx => [ctx.maxCategoryCount, 20] },

  { id: "streak-3",     category: "Streaks",     title: "On a Roll",         desc: "Complete all due tasks on time, 3 days in a row.",   check: ctx => ctx.streak >= 3,                 progress: ctx => [ctx.streak, 3] },
  { id: "streak-7",     category: "Streaks",     title: "Unstoppable",       desc: "7-day on-time completion streak.",                   check: ctx => ctx.streak >= 7,                 progress: ctx => [ctx.streak, 7] },
  { id: "streak-14",    category: "Streaks",     title: "Two Weeks Strong",  desc: "14-day on-time completion streak.",                  check: ctx => ctx.streak >= 14,                progress: ctx => [ctx.streak, 14] },
  { id: "streak-30",    category: "Streaks",     title: "Unbreakable",       desc: "30-day on-time completion streak.",                  check: ctx => ctx.streak >= 30,                progress: ctx => [ctx.streak, 30] },
  { id: "perfect-week", category: "Streaks",     title: "Perfect Week",      desc: "100% on-time productivity in a single week.",        check: ctx => ctx.weeklyPerfect },
  { id: "reliable-2wk", category: "Streaks",     title: "Reliable",          desc: "80%+ productivity two weeks in a row.",              check: ctx => ctx.reliableTwoWeeks },
  { id: "steady-4wk",   category: "Streaks",     title: "Steady Hand",       desc: "80%+ productivity four weeks in a row.",             check: ctx => ctx.steadyFourWeeks },

  { id: "focus-1",      category: "Time Tracked", title: "Focused",          desc: "Finish your first timed work session.",              check: ctx => ctx.totalSessions >= 1,          progress: ctx => [ctx.totalSessions, 1] },
  { id: "deep-work",    category: "Time Tracked", title: "Deep Work",        desc: "Log 2+ hours of tracked time in a single day.",      check: ctx => ctx.maxDayMinutes >= 120,        progress: ctx => [ctx.maxDayMinutes, 120, true] },
  { id: "half-day",     category: "Time Tracked", title: "Half Day Hero",    desc: "Track 4+ hours of work in a single day.",            check: ctx => ctx.maxDayMinutes >= 240,        progress: ctx => [ctx.maxDayMinutes, 240, true] },
  { id: "full-shift",   category: "Time Tracked", title: "Full Shift",       desc: "Track 6+ hours of work in a single day.",            check: ctx => ctx.maxDayMinutes >= 360,        progress: ctx => [ctx.maxDayMinutes, 360, true] },
  { id: "marathon-day", category: "Time Tracked", title: "Marathon Day",     desc: "Track 8+ hours of work in a single day.",            check: ctx => ctx.maxDayMinutes >= 480,        progress: ctx => [ctx.maxDayMinutes, 480, true] },
  { id: "hours-10",     category: "Time Tracked", title: "10 Hour Club",     desc: "Track 10 hours of work in total.",                   check: ctx => ctx.totalTrackedMinutes >= 600,  progress: ctx => [ctx.totalTrackedMinutes, 600, true] },
  { id: "hours-50",     category: "Time Tracked", title: "50 Hour Club",     desc: "Track 50 hours of work in total.",                   check: ctx => ctx.totalTrackedMinutes >= 3000, progress: ctx => [ctx.totalTrackedMinutes, 3000, true] },
  { id: "hours-100",    category: "Time Tracked", title: "100 Hour Club",    desc: "Track 100 hours of work in total.",                  check: ctx => ctx.totalTrackedMinutes >= 6000, progress: ctx => [ctx.totalTrackedMinutes, 6000, true] },

  { id: "speed-runner",    category: "Fun", title: "Speed Runner",     desc: "Finish a task in under half its estimated time.",    check: ctx => ctx.speedRunner },
  { id: "early-bird",      category: "Fun", title: "Early Bird",       desc: "Complete a task before 8am.",                        check: ctx => ctx.earlyBird },
  { id: "night-owl",       category: "Fun", title: "Night Owl",        desc: "Complete a task after 11pm.",                        check: ctx => ctx.nightOwl },
  { id: "weekend-warrior", category: "Fun", title: "Weekend Warrior",  desc: "Complete a task on a Saturday or Sunday.",           check: ctx => ctx.weekendWarrior },
  { id: "multitasker",     category: "Fun", title: "Multitasker",      desc: "Track time in 3+ categories in a single day.",       check: ctx => ctx.multitaskerDay },
];

function computeStreak() {
  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < 60; i++) {
    const dateStr = formatDate(cursor);
    const due = tasks.filter(t => t.dueDate === dateStr);
    if (due.length > 0) {
      if (due.every(t => t.completed)) streak++;
      else break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function computeContext() {
  const today = todayStr();
  const totalCompleted = tasks.filter(t => t.completed).length;
  const highPriorityCompleted = tasks.filter(t => t.completed && t.priority === "high").length;
  const todaysDue = tasks.filter(t => t.dueDate === today);
  const todayAllDone = todaysDue.length > 0 && todaysDue.every(t => t.completed);
  const streak = computeStreak();
  const totalSessions = sessions.length;
  const dayTotals = {};
  sessions.forEach(s => { dayTotals[s.date] = (dayTotals[s.date] || 0) + (Number(s.minutes) || 0); });
  const maxDayMinutes = Math.max(0, ...Object.values(dayTotals));
  const totalTrackedMinutes = sessions.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
  const distinctCategoriesCompleted = new Set(tasks.filter(t => t.completed).map(t => t.category)).size;
  const recurringCompletedCount = tasks.filter(t => t.completed && t.recurringId).length;
  const earlyBird = tasks.some(t => t.completed && t.completedAt && new Date(t.completedAt).getHours() < 8);
  const nightOwl = tasks.some(t => t.completed && t.completedAt && new Date(t.completedAt).getHours() >= 23);

  const taskMinutes = (taskId) => sessions.filter(s => s.taskId === taskId).reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);

  const completedWithEstimateAndSessions = tasks.filter(t => t.completed && t.estimate && sessions.some(s => s.taskId === t.id));
  const onTimeCompletedCount = completedWithEstimateAndSessions.filter(t => taskMinutes(t.id) <= Number(t.estimate)).length;

  const speedRunner = tasks.some(t => {
    if (!t.completed || !t.estimate || Number(t.estimate) < 10) return false;
    const actual = taskMinutes(t.id);
    return actual > 0 && actual <= Number(t.estimate) / 2;
  });

  const categoryCounts = {};
  tasks.filter(t => t.completed).forEach(t => { categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1; });
  const maxCategoryCount = Math.max(0, ...Object.values(categoryCounts));

  const weekendWarrior = tasks.some(t => t.completed && t.completedOn && [0, 6].includes(new Date(t.completedOn + "T12:00:00").getDay()));

  const catsByDay = {};
  sessions.forEach(s => {
    catsByDay[s.date] = catsByDay[s.date] || new Set();
    catsByDay[s.date].add(s.category || "Uncategorized");
  });
  const multitaskerDay = Object.values(catsByDay).some(set => set.size >= 3);

  const week0 = computeWeekStats(0);
  const week1 = computeWeekStats(-1);
  const week2 = computeWeekStats(-2);
  const week3 = computeWeekStats(-3);
  const weeklyPerfect = week0.productivityPct === 100 && week0.trackedCompletedCount >= 3;
  const reliableTwoWeeks = [week0, week1].every(w => w.productivityPct !== null && w.productivityPct >= 80);
  const steadyFourWeeks = [week0, week1, week2, week3].every(w => w.productivityPct !== null && w.productivityPct >= 80);

  return {
    totalCompleted, highPriorityCompleted, todayAllDone, streak, totalSessions, maxDayMinutes,
    totalTrackedMinutes, distinctCategoriesCompleted, recurringCompletedCount, earlyBird, nightOwl, weeklyPerfect,
    onTimeCompletedCount, speedRunner, maxCategoryCount, weekendWarrior, multitaskerDay,
    reliableTwoWeeks, steadyFourWeeks,
  };
}

function checkAchievements() {
  const ctx = computeContext();
  const newlyUnlocked = [];
  ACHIEVEMENTS.forEach(a => {
    if (!unlockedAchievements[a.id] && a.check(ctx)) {
      unlockedAchievements[a.id] = new Date().toISOString();
      newlyUnlocked.push(a);
    }
  });
  if (newlyUnlocked.length) {
    saveAchievements();
    newlyUnlocked.forEach(a => showToast(a));
  }
  renderAchievements();
  updateCatAccessories();
  renderNextAchievement();
}

function updateCatAccessories() {
  const bow = document.querySelector(".cat-bow");
  const hat = document.querySelector(".cat-partyhat");
  const crown = document.querySelector(".cat-crown");
  if (!bow || !hat || !crown) return;

  const hasCrown = !!unlockedAchievements["century-100"];
  const hasHat = !!unlockedAchievements["quarter-25"];
  const hasBow = !!unlockedAchievements["momentum-10"];

  crown.classList.toggle("show", hasCrown);
  hat.classList.toggle("show", !hasCrown && hasHat);
  bow.classList.toggle("show", !hasCrown && !hasHat && hasBow);
}

function buildAchievementCard(a, ctx) {
  const unlockedAt = unlockedAchievements[a.id];

  let progressHtml = "";
  if (!unlockedAt && a.progress) {
    const [current, target, isMinutes] = a.progress(ctx);
    const pct = Math.min(100, Math.round((current / target) * 100));
    const label = isMinutes
      ? `${(current / 60).toFixed(1)}h / ${(target / 60).toFixed(1)}h`
      : `${Math.min(current, target)} / ${target}`;
    progressHtml = `
      <div class="achievement-progress">
        <div class="achievement-progress-bar"><div class="achievement-progress-fill" style="width:${pct}%"></div></div>
        <span class="achievement-progress-label">${label}</span>
      </div>
    `;
  }

  const card = document.createElement("div");
  card.className = "achievement-card" + (unlockedAt ? "" : " locked");
  card.innerHTML = `
    <div class="achievement-icon"></div>
    <div>
      <div class="achievement-title">${escapeHtml(a.title)}</div>
      <div class="achievement-desc">${escapeHtml(a.desc)}</div>
      ${unlockedAt ? `<div class="achievement-date">Unlocked ${new Date(unlockedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>` : progressHtml}
    </div>
  `;
  return card;
}

function renderAchievements() {
  const container = document.getElementById("achievements-grid");
  if (!container) return;
  container.innerHTML = "";

  const ctx = computeContext();
  let unlockedCount = 0;
  ACHIEVEMENTS.forEach(a => { if (unlockedAchievements[a.id]) unlockedCount++; });

  ACHIEVEMENT_CATEGORIES.forEach(category => {
    const items = ACHIEVEMENTS.filter(a => a.category === category);
    if (items.length === 0) return;

    const unlockedInSection = items.filter(a => unlockedAchievements[a.id]).length;

    const section = document.createElement("div");
    section.className = "achievement-section";
    section.innerHTML = `
      <div class="achievement-section-heading">
        <span>${escapeHtml(category)}</span>
        <span class="achievement-section-count">${unlockedInSection} / ${items.length}</span>
      </div>
      <div class="achievements-grid"></div>
    `;
    const grid = section.querySelector(".achievements-grid");
    items.forEach(a => grid.appendChild(buildAchievementCard(a, ctx)));
    container.appendChild(section);
  });

  const label = document.getElementById("achievements-count-label");
  if (label) label.textContent = `${unlockedCount} / ${ACHIEVEMENTS.length} unlocked`;
}

function showToast(achievement) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-icon"></div>
    <div>
      <div class="toast-title">Achievement Unlocked</div>
      <div class="toast-name">${escapeHtml(achievement.title)}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 4000);

  triggerCatCelebrate();
}

/* ===================== Timer ===================== */
let timerSeconds = 0;
let timerInterval = null;
let timerRunning = false;
let timerTaskId = "";
let timerAlerted = false;
let audioCtx = null;

function populateTimerTaskSelect() {
  const select = document.getElementById("pomodoro-task-select");
  const current = select.value;
  const today = todayStr();
  select.innerHTML = `<option value="">Select a task...</option>`;
  tasks.filter(t => !t.completed && t.dueDate === today).forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `${t.title} (${t.category})`;
    select.appendChild(opt);
  });
  if (current && tasks.some(t => t.id === current && !t.completed && t.dueDate === today)) {
    select.value = current;
  }
}

function currentTimerTask() {
  return tasks.find(t => t.id === timerTaskId);
}

function formatTimer(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  document.getElementById("timer-time").textContent = formatTimer(timerSeconds);

  const task = currentTimerTask();
  const bar = document.getElementById("timer-progress-bar");
  const estimateLabel = document.getElementById("timer-estimate-label");
  const alertBox = document.getElementById("timer-alert");

  if (task && task.estimate) {
    const estimateSeconds = Number(task.estimate) * 60;
    const pct = Math.min(100, (timerSeconds / estimateSeconds) * 100);
    bar.style.width = pct + "%";
    estimateLabel.textContent = `Estimated ${task.estimate} min`;

    if (timerSeconds >= estimateSeconds) {
      bar.classList.add("over");
      if (!timerAlerted) {
        timerAlerted = true;
        alertBox.classList.add("show");
        playBeep();
      }
    } else {
      bar.classList.remove("over");
    }
  } else {
    bar.style.width = "0%";
    bar.classList.remove("over");
    estimateLabel.textContent = task ? "No estimate set for this task" : "Pick a task to see its estimate";
  }
}

function playBeep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 720;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) { /* audio not available */ }
}

function renderSessionList() {
  const list = document.getElementById("session-list");
  if (!list) return;
  const today = todayStr();
  const todays = sessions.filter(s => s.date === today).slice().reverse();

  if (todays.length === 0) {
    list.innerHTML = `<div class="empty-state">No sessions logged today yet.</div>`;
    return;
  }

  list.innerHTML = todays.map(s => {
    const task = tasks.find(t => t.id === s.taskId);
    return `
      <div class="session-item">
        <span class="session-task">${escapeHtml(task ? task.title : "Deleted task")}</span>
        <span class="session-minutes">${s.minutes} min</span>
      </div>
    `;
  }).join("");
}

document.getElementById("pomodoro-task-select").addEventListener("change", (e) => {
  if (timerRunning) return;
  timerTaskId = e.target.value;
  timerSeconds = 0;
  timerAlerted = false;
  document.getElementById("timer-alert").classList.remove("show");
  document.getElementById("timer-toggle").disabled = !timerTaskId;
  document.getElementById("timer-complete").style.display = "none";
  updateTimerDisplay();
});

document.getElementById("timer-toggle").addEventListener("click", () => {
  if (!timerTaskId) return;
  timerRunning = !timerRunning;
  const btn = document.getElementById("timer-toggle");
  if (timerRunning) {
    btn.textContent = "Pause";
    document.getElementById("timer-complete").style.display = "inline-block";
    timerInterval = setInterval(() => {
      timerSeconds++;
      updateTimerDisplay();
    }, 1000);
  } else {
    btn.textContent = "Start";
    clearInterval(timerInterval);
  }
});

document.getElementById("timer-reset").addEventListener("click", () => {
  clearInterval(timerInterval);
  timerRunning = false;
  timerSeconds = 0;
  timerAlerted = false;
  document.getElementById("timer-toggle").textContent = "Start";
  document.getElementById("timer-alert").classList.remove("show");
  document.getElementById("timer-complete").style.display = "none";
  updateTimerDisplay();
});

document.getElementById("timer-complete").addEventListener("click", () => {
  const task = currentTimerTask();
  if (!task) return;

  clearInterval(timerInterval);
  timerRunning = false;

  const minutes = Math.max(1, Math.round(timerSeconds / 60));
  sessions.push({ id: uid(), taskId: task.id, category: task.category, date: todayStr(), minutes });
  saveSessions();

  task.completed = true;
  task.completedOn = todayStr();
  task.completedAt = new Date().toISOString();
  saveTasks();

  timerSeconds = 0;
  timerAlerted = false;
  timerTaskId = "";
  document.getElementById("timer-toggle").textContent = "Start";
  document.getElementById("timer-toggle").disabled = true;
  document.getElementById("timer-alert").classList.remove("show");
  document.getElementById("timer-complete").style.display = "none";
  document.getElementById("pomodoro-task-select").value = "";
  updateTimerDisplay();

  renderAll();
  checkAchievements();
});

/* ===================== Weekly summary ===================== */
function getWeekRange(offsetWeeks) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() + diffToMonday + offsetWeeks * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function inRange(dateStr, range) {
  const d = new Date(dateStr + "T12:00:00");
  return d >= range.start && d <= range.end;
}

function computeWeekStats(offsetWeeks) {
  const range = getWeekRange(offsetWeeks);
  const weekSessions = sessions.filter(s => inRange(s.date, range));
  const totalMinutes = weekSessions.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);

  const catTotals = {};
  weekSessions.forEach(s => {
    const cat = s.category || "Uncategorized";
    catTotals[cat] = (catTotals[cat] || 0) + (Number(s.minutes) || 0);
  });

  const weekCompleted = tasks.filter(t => t.completed && t.completedOn && inRange(t.completedOn, range) && t.estimate);
  const trackedCompleted = weekCompleted.filter(t => sessions.some(s => s.taskId === t.id));
  const onTime = trackedCompleted.filter(t => {
    const actual = sessions.filter(s => s.taskId === t.id).reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
    return actual <= Number(t.estimate);
  });
  const productivityPct = trackedCompleted.length ? Math.round((onTime.length / trackedCompleted.length) * 100) : null;

  return {
    range, totalMinutes, catTotals,
    weekCompletedCount: weekCompleted.length,
    trackedCompletedCount: trackedCompleted.length,
    onTimeCount: onTime.length,
    productivityPct,
  };
}

function renderSummary() {
  const summaryLabel = document.getElementById("summary-week-label");
  if (!summaryLabel) return;

  const thisWeek = computeWeekStats(0);
  const lastWeek = computeWeekStats(-1);

  summaryLabel.textContent = `${thisWeek.range.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${thisWeek.range.end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  document.getElementById("summary-total-hours").textContent = formatMinutesLabel(thisWeek.totalMinutes);

  const deltaMinutes = thisWeek.totalMinutes - lastWeek.totalMinutes;
  const deltaSign = deltaMinutes > 0 ? "+" : (deltaMinutes < 0 ? "-" : "");
  document.getElementById("summary-week-delta").textContent = `${deltaSign}${formatMinutesLabel(Math.abs(deltaMinutes))}`;

  document.getElementById("summary-productivity").textContent =
    thisWeek.productivityPct === null ? "No data" : `${thisWeek.productivityPct}% (${thisWeek.onTimeCount}/${thisWeek.trackedCompletedCount})`;
  document.getElementById("summary-productivity-last").textContent =
    lastWeek.productivityPct === null ? "No data" : `${lastWeek.productivityPct}% (${lastWeek.onTimeCount}/${lastWeek.trackedCompletedCount})`;

  renderPieChart(thisWeek.catTotals, thisWeek.totalMinutes);

  const streak = computeStreak();
  const avgLen = weekSessionsList(thisWeek.range).length
    ? Math.round(weekSessionsList(thisWeek.range).reduce((sum, s) => sum + (Number(s.minutes) || 0), 0) / weekSessionsList(thisWeek.range).length)
    : 0;
  const topCat = Object.entries(thisWeek.catTotals).sort((a, b) => b[1] - a[1])[0];

  document.getElementById("summary-extra").innerHTML = `
    <div class="summary-extra-item"><span>Tasks completed this week</span><strong>${thisWeek.weekCompletedCount}</strong></div>
    <div class="summary-extra-item"><span>Average session length</span><strong>${avgLen} min</strong></div>
    <div class="summary-extra-item"><span>Top category this week</span><strong>${topCat ? escapeHtml(topCat[0]) : "--"}</strong></div>
    <div class="summary-extra-item"><span>Current on-time streak</span><strong>${streak} day${streak === 1 ? "" : "s"}</strong></div>
  `;
}

function weekSessionsList(range) {
  return sessions.filter(s => inRange(s.date, range));
}

function renderPieChart(catTotals, totalMinutes) {
  const chart = document.getElementById("pie-chart");
  const legend = document.getElementById("pie-legend");
  if (!chart) return;

  const entries = Object.entries(catTotals).filter(([, m]) => m > 0);

  if (!totalMinutes || entries.length === 0) {
    chart.style.background = "var(--bg-panel-alt)";
    legend.innerHTML = `<div class="empty-state">No tracked time yet this week.</div>`;
    return;
  }

  let cursor = 0;
  const gradientParts = [];
  const legendParts = [];
  entries.sort((a, b) => b[1] - a[1]).forEach(([cat, minutes]) => {
    const pct = (minutes / totalMinutes) * 100;
    const color = getCategoryColor(cat);
    gradientParts.push(`${color} ${cursor}% ${cursor + pct}%`);
    legendParts.push(`
      <div class="legend-item">
        <span class="legend-dot" style="background:${color}"></span>
        <span class="legend-label">${escapeHtml(cat)}</span>
        <span class="legend-pct">${Math.round(pct)}%</span>
      </div>
    `);
    cursor += pct;
  });

  chart.style.background = `conic-gradient(${gradientParts.join(", ")})`;
  legend.innerHTML = legendParts.join("");
}

/* ===================== Render all ===================== */
function renderNextAchievement() {
  const card = document.getElementById("next-achievement-card");
  if (!card) return;

  const ctx = computeContext();
  let best = null;
  let bestPct = -1;

  ACHIEVEMENTS.forEach(a => {
    if (unlockedAchievements[a.id] || !a.progress) return;
    const [current, target, isMinutes] = a.progress(ctx);
    const pct = Math.min(100, (current / target) * 100);
    if (pct > bestPct) {
      bestPct = pct;
      best = { a, current, target, isMinutes };
    }
  });

  if (!best) {
    card.style.display = "none";
    return;
  }

  card.style.display = "flex";
  document.getElementById("next-achievement-title").textContent = best.a.title;
  document.getElementById("next-achievement-fill").style.width = Math.round(bestPct) + "%";
  document.getElementById("next-achievement-count").textContent = best.isMinutes
    ? `${(best.current / 60).toFixed(1)}h / ${(best.target / 60).toFixed(1)}h`
    : `${Math.min(best.current, best.target)} / ${best.target}`;
}

function renderAll() {
  renderGreeting();
  renderCalendar();
  renderStats();
  populateCategorySelects();
  renderTasks();
  populateTimerTaskSelect();
  renderSessionList();
  renderAchievements();
  renderSummary();
  renderNextAchievement();
}

renderAll();
checkAchievements();
initCatDrag();
updateCatAccessories();

/* ===================== Cat reactions ===================== */
function triggerCatReaction() {
  const img = document.getElementById("cat-img");
  const heart = document.getElementById("cat-heart");
  if (!img || !heart) return;
  img.classList.remove("squish");
  void img.offsetWidth;
  img.classList.add("squish");
  heart.classList.remove("pop");
  void heart.offsetWidth;
  heart.classList.add("pop");
}

function triggerCatCelebrate() {
  const img = document.getElementById("cat-img");
  if (!img) return;
  img.classList.remove("celebrate");
  void img.offsetWidth;
  img.classList.add("celebrate");
}

/* ===================== Draggable cat mascot ===================== */
function initCatDrag() {
  const cat = document.getElementById("pixel-cat");
  if (!cat) return;

  const CAT_POS_KEY = "molly-panel-cat-pos-v1";
  const saved = loadJSON(CAT_POS_KEY, null);

  if (saved) {
    cat.style.left = saved.left + "px";
    cat.style.top = saved.top + "px";
  } else {
    cat.style.left = (window.innerWidth - 130) + "px";
    cat.style.top = (window.innerHeight - 130) + "px";
  }

  let dragging = false;
  let moved = false;
  let offsetX = 0;
  let offsetY = 0;
  let startX = 0;
  let startY = 0;

  cat.addEventListener("pointerdown", (e) => {
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    cat.classList.add("dragging");
    cat.setPointerCapture(e.pointerId);
    const rect = cat.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
  });

  cat.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    if (Math.abs(e.clientX - startX) > 4 || Math.abs(e.clientY - startY) > 4) moved = true;
    let newLeft = e.clientX - offsetX;
    let newTop = e.clientY - offsetY;
    newLeft = Math.max(0, Math.min(window.innerWidth - cat.offsetWidth, newLeft));
    newTop = Math.max(0, Math.min(window.innerHeight - cat.offsetHeight, newTop));
    cat.style.left = newLeft + "px";
    cat.style.top = newTop + "px";
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    cat.classList.remove("dragging");
    localStorage.setItem(CAT_POS_KEY, JSON.stringify({
      left: parseFloat(cat.style.left),
      top: parseFloat(cat.style.top),
    }));
    if (!moved) triggerCatReaction();
  }

  cat.addEventListener("pointerup", endDrag);
  cat.addEventListener("pointercancel", endDrag);
}
