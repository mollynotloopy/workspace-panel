/* ===================== State ===================== */
const STORAGE_KEY = "molly-panel-tasks-v1";
const SESSIONS_KEY = "molly-panel-sessions-v1";
const ACHIEVEMENTS_KEY = "molly-panel-achievements-v1";
const TASKS_CREATED_KEY = "molly-panel-tasks-created-v1";

const PRIORITY_QUEUE_KEY = "molly-panel-priority-queue-v1";
const TEMPLATES_KEY = "molly-panel-templates-v1";
const REVIEWS_KEY = "molly-panel-reviews-v1";
const BUDGET_KEY = "molly-panel-day-budget-v1";
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

/* ===================== Cloud sync (Artifact only) ===================== */
let cloudDocRef = null;
let cloudReady = false;
let cloudApplyingRemote = false;
let cloudPushTimer = null;

let tasks = loadTasks();
let sessions = loadJSON(SESSIONS_KEY, []);
let unlockedAchievements = loadJSON(ACHIEVEMENTS_KEY, {});
let categories = loadJSON(CATEGORIES_KEY, DEFAULT_CATEGORIES);
let priorityQueueOrder = loadJSON(PRIORITY_QUEUE_KEY, []);
let templates = loadJSON(TEMPLATES_KEY, []);
let reviews = loadJSON(REVIEWS_KEY, {});
const PREFS_KEY = "molly-panel-prefs-v1";
const PREF_DEFAULTS = { pomoWork: 25, pomoBreak: 5, remind: false, remindLead: 15, morning: false, morningTime: "08:00" };
let prefs = { ...PREF_DEFAULTS, ...loadJSON(PREFS_KEY, {}) };
function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  schedulePush();
}

function saveTemplates() {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  schedulePush();
}
function saveReviews() {
  localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
  schedulePush();
}

let tasksCreatedCount = loadJSON(TASKS_CREATED_KEY, null);
if (tasksCreatedCount === null) {
  tasksCreatedCount = tasks.length;
}
function saveTasksCreatedCount() {
  localStorage.setItem(TASKS_CREATED_KEY, JSON.stringify(tasksCreatedCount));
  schedulePush();
}
saveTasksCreatedCount();

function updateSyncStatus(state) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  el.classList.remove("synced", "offline");
  if (state === "synced") {
    el.classList.add("synced");
    el.innerHTML = `<span class="sync-dot"></span> Synced across devices${firebaseUser && firebaseUser.email ? " · " + escapeHtml(firebaseUser.email) : ""}`;
    el.style.display = "flex";
  } else if (state === "signin") {
    el.classList.add("offline");
    el.innerHTML = `<button type="button" class="signin-btn" id="signin-btn">Sign in with Google to sync across devices</button>`;
    el.style.display = "flex";
    document.getElementById("signin-btn").addEventListener("click", firebaseSignIn);
  } else if (state === "offline") {
    el.classList.add("offline");
    el.innerHTML = `<span class="sync-dot"></span> Sync unavailable — saving locally only`;
    el.style.display = "flex";
  } else {
    el.style.display = "none";
  }
}

function collectCloudState() {
  return JSON.parse(JSON.stringify({
    tasks, sessions, unlockedAchievements, categories,
    priorityQueueOrder, tasksCreatedCount, timerBankedSeconds, templates, reviews, prefs,
    updatedAt: new Date().toISOString(),
  }));
}

function pushToCloud() {
  if (!cloudDocRef) return;
  cloudDocRef.set(collectCloudState())
    .then(() => updateSyncStatus("synced"))
    .catch(() => updateSyncStatus("offline"));
}

function schedulePush() {
  if (!cloudReady || cloudApplyingRemote || !cloudDocRef) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(pushToCloud, 500);
}

function applyCloudState(data) {
  if (!data) return;
  cloudApplyingRemote = true;
  if (Array.isArray(data.tasks)) { tasks = data.tasks; localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); }
  if (Array.isArray(data.sessions)) { sessions = data.sessions; localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); }
  if (data.unlockedAchievements) { unlockedAchievements = data.unlockedAchievements; localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(unlockedAchievements)); }
  if (Array.isArray(data.categories)) { categories = data.categories; localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories)); }
  if (Array.isArray(data.priorityQueueOrder)) { priorityQueueOrder = data.priorityQueueOrder; localStorage.setItem(PRIORITY_QUEUE_KEY, JSON.stringify(priorityQueueOrder)); }
  if (typeof data.tasksCreatedCount === "number") { tasksCreatedCount = data.tasksCreatedCount; localStorage.setItem(TASKS_CREATED_KEY, JSON.stringify(tasksCreatedCount)); }
  if (data.timerBankedSeconds) { timerBankedSeconds = data.timerBankedSeconds; localStorage.setItem(TIMER_BANK_KEY, JSON.stringify(timerBankedSeconds)); }
  if (Array.isArray(data.templates)) { templates = data.templates; localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates)); }
  if (data.reviews && typeof data.reviews === "object") { reviews = data.reviews; localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews)); }
  if (data.prefs && typeof data.prefs === "object") { prefs = { ...PREF_DEFAULTS, ...data.prefs }; localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
  const migrated = migrateFreeSessions();
  renderAll();
  checkAchievements();
  cloudApplyingRemote = false;
  if (migrated) schedulePush();
  updateSyncStatus("synced");
}

let cloudUnsub = null;
let firebaseUser = null;
const FIREBASE_SDK_URL = "https://www.gstatic.com/firebasejs/10.14.1/";

function attachCloudDoc(docRef) {
  if (cloudUnsub) { try { cloudUnsub(); } catch (e) { /* already closed */ } cloudUnsub = null; }
  cloudDocRef = docRef;
  cloudReady = false;
  let seeded = false;

  cloudUnsub = docRef.onSnapshot((snap) => {
    if (snap.metadata && snap.metadata.hasPendingWrites) return;
    if (!snap.exists) {
      if (snap.metadata && snap.metadata.fromCache) return;
      cloudReady = true;
      if (!seeded) {
        seeded = true;
        pushToCloud();
      }
      return;
    }
    const remote = snap.data() || {};
    const remoteEmpty = !(remote.tasks || []).length && !(remote.sessions || []).length;
    const localHasData = tasks.length > 0 || sessions.length > 0;
    if (!seeded && remoteEmpty && localHasData) {
      seeded = true;
      cloudReady = true;
      pushToCloud();
      return;
    }
    seeded = true;
    applyCloudState(remote);
    cloudReady = true;
  }, () => {
    updateSyncStatus("offline");
  });
}

async function initClaudeSync() {
  let db;
  try {
    db = await window.claude.use("db");
  } catch (e) {
    db = null;
  }
  if (!db) {
    updateSyncStatus("offline");
    return;
  }
  attachCloudDoc(db.doc("state/app"));
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(el);
  });
}

function firebaseIsConfigured() {
  return !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);
}

function firebaseSignIn() {
  const provider = new firebase.auth.GoogleAuthProvider();
  return firebase.auth().signInWithPopup(provider).catch((err) => {
    const blocked = err && err.code === "auth/popup-blocked";
    const closed = err && err.code === "auth/popup-closed-by-user";
    if (closed) return;
    showSimpleToast("Couldn't sign in", blocked ? "Allow pop-ups for this site, then try again." : ((err && err.message) || "Please try again."));
  });
}

function firebaseSignOut() {
  return firebase.auth().signOut();
}

function renderAccountSection() {
  const section = document.getElementById("account-section");
  if (!section) return;
  if (!firebaseIsConfigured()) { section.style.display = "none"; return; }
  section.style.display = "block";
  const note = document.getElementById("account-note");
  const btn = document.getElementById("account-btn");
  if (firebaseUser) {
    note.textContent = `Signed in as ${firebaseUser.email || "your Google account"}. Your panel syncs to this account on every device. Signing out leaves a copy in this browser.`;
    btn.textContent = "Sign out";
    btn.onclick = firebaseSignOut;
  } else {
    note.textContent = "Sign in to sync your panel across devices.";
    btn.textContent = "Sign in with Google";
    btn.onclick = firebaseSignIn;
  }
}

async function initFirebaseSync() {
  if (!firebaseIsConfigured()) return;
  try {
    if (!window.firebase) {
      await loadScriptOnce(FIREBASE_SDK_URL + "firebase-app-compat.js");
      await loadScriptOnce(FIREBASE_SDK_URL + "firebase-auth-compat.js");
      await loadScriptOnce(FIREBASE_SDK_URL + "firebase-firestore-compat.js");
    }
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
  } catch (e) {
    updateSyncStatus("offline");
    return;
  }
  renderAccountSection();
  firebase.auth().onAuthStateChanged((user) => {
    firebaseUser = user || null;
    renderAccountSection();
    if (!user) {
      if (cloudUnsub) { try { cloudUnsub(); } catch (e) { /* already closed */ } cloudUnsub = null; }
      cloudDocRef = null;
      cloudReady = false;
      updateSyncStatus("signin");
      return;
    }
    attachCloudDoc(firebase.firestore().doc("users/" + user.uid + "/state/app"));
  });
}

async function initCloudSync() {
  if (window.claude && typeof window.claude.use === "function") return initClaudeSync();
  return initFirebaseSync();
}

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
  schedulePush();
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
  schedulePush();
}

function saveAchievements() {
  localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(unlockedAchievements));
  schedulePush();
}

function saveCategories() {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
  schedulePush();
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

  const datesCategoryColors = {};
  tasks.filter(t => t.dueDate).forEach(t => {
    const color = getCategoryColor(t.category);
    if (!datesCategoryColors[t.dueDate]) datesCategoryColors[t.dueDate] = new Set();
    datesCategoryColors[t.dueDate].add(color);
  });
  tasks.filter(t => t.completed && t.completedOn).forEach(t => {
    const color = getCategoryColor(t.category);
    if (!datesCategoryColors[t.completedOn]) datesCategoryColors[t.completedOn] = new Set();
    datesCategoryColors[t.completedOn].add(color);
  });
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
    const dayColors = datesCategoryColors[dateStr];
    if (dayColors && dayColors.size) {
      const dotsWrap = document.createElement("div");
      dotsWrap.className = "cal-dots";
      Array.from(dayColors).slice(0, 4).forEach(color => {
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = color;
        dotsWrap.appendChild(dot);
      });
      cell.appendChild(dotsWrap);
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
    .filter(t => t.dueDate === today || (t.dueDate && t.dueDate < today) || (t.dayMinutes && t.dayMinutes[today] > 0))
    .reduce((sum, t) => sum + minutesOn(t, today), 0);
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

  const overdueOpen = incomplete.filter(t => t.dueDate && t.dueDate < today).length;
  const planned = completedToday + awaiting + overdueOpen;
  document.getElementById("day-progress-label").textContent = planned === 0
    ? "Nothing on the list today"
    : `${completedToday} of ${planned} done today`;
  document.getElementById("day-progress-fill").style.width = planned === 0 ? "0%" : Math.round((completedToday / planned) * 100) + "%";
  const streak = computeDayStreak();
  const streakEl = document.getElementById("day-streak");
  streakEl.textContent = streak >= 2 ? `${streak}-day streak` : "";
  streakEl.style.display = streak >= 2 ? "inline-block" : "none";
}

function formatMinutesLabel(totalMinutes) {
  if (!totalMinutes) return "0h";
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return hrs > 0 ? `${hrs}h ${mins ? mins + "m" : ""}`.trim() : `${mins}m`;
}

/* ===================== Priority Queue ===================== */
function savePriorityQueue() {
  localStorage.setItem(PRIORITY_QUEUE_KEY, JSON.stringify(priorityQueueOrder));
  schedulePush();
}

let pqDragId = null;

const PQ_SHORT = { high: "HIGH", medium: "MED", low: "LOW", "time-sensitive": "TIME" };

function renderPriorityQueue() {
  const list = document.getElementById("priority-queue-list");
  const empty = document.getElementById("priority-queue-empty");
  const today = todayStr();

  const eligible = tasks.filter(t => isWorkableToday(t, today));
  const eligibleIds = new Set(eligible.map(t => t.id));

  const beforeOrder = priorityQueueOrder.join("|");
  priorityQueueOrder = priorityQueueOrder.filter(id => eligibleIds.has(id));
  eligible.forEach(t => { if (!priorityQueueOrder.includes(t.id)) priorityQueueOrder.push(t.id); });
  if (priorityQueueOrder.join("|") !== beforeOrder) savePriorityQueue();

  const byId = new Map(eligible.map(t => [t.id, t]));
  const ordered = priorityQueueOrder.map(id => byId.get(id)).filter(Boolean);

  list.innerHTML = "";
  empty.style.display = ordered.length === 0 ? "block" : "none";

  const budgetHours = Number(loadJSON(BUDGET_KEY, 6)) || 6;
  const budgetInput = document.getElementById("day-budget-hours");
  if (document.activeElement !== budgetInput) budgetInput.value = budgetHours;
  const workedToday = sessions.filter(x => x.date === today).reduce((sum, x) => sum + (Number(x.minutes) || 0), 0);
  const remaining = Math.max(0, Math.round(budgetHours * 60) - workedToday);
  const estOf = t => t.dayMinutes ? minutesOn(t, today) : (Number(t.estimate) || 30);
  let cum = 0;
  let divider = null;
  const overflow = [];

  ordered.forEach((t, i) => {
    cum += estOf(t);
    const overBudget = cum > remaining;
    if (overBudget && !divider) {
      divider = document.createElement("div");
      divider.className = "pq-divider";
      list.appendChild(divider);
    }
    if (overBudget) overflow.push(t);
    const pMeta = PRIORITY_META[t.priority] || PRIORITY_META.medium;
    const dueD = t.dueDate || today;
    const isOverdue = dueD < today;
    const lateDays = Math.round((new Date(today + "T00:00:00") - new Date(dueD + "T00:00:00")) / 86400000);
    const dateLabel = new Date(dueD + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const stepNow = openStepFor(t, today);

    const row = document.createElement("div");
    row.className = "priority-queue-item" + (overBudget ? " pq-over" : "");
    row.draggable = true;
    row.dataset.id = t.id;
    row.innerHTML = `
      <span class="pq-rank">${i + 1}</span>
      <span class="pq-title" title="${escapeAttr(t.title)}">${escapeHtml(t.title)}${stepNow ? `<small class="pq-step">&#9656; ${escapeHtml(stepNow.text)}</small>` : ""}</span>
      <span class="pq-due${isOverdue ? " overdue" : ""}" title="${dateLabel}">${isOverdue ? lateDays + "d late" : "today"}</span>
      <span class="pq-priority" style="background:${pMeta.color}" title="${pMeta.label}">${PQ_SHORT[t.priority] || "MED"}</span>
      <button type="button" class="pq-start" title="Start the timer on this task">&#9654;</button>
    `;
    row.querySelector(".pq-start").addEventListener("click", (e) => {
      e.stopPropagation();
      startTimerForTask(t.id);
    });

    row.addEventListener("dragstart", (e) => {
      pqDragId = t.id;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      list.querySelectorAll(".priority-queue-item").forEach(el => el.classList.remove("drag-over"));
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (t.id !== pqDragId) row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!pqDragId || pqDragId === t.id) return;
      const fromIdx = priorityQueueOrder.indexOf(pqDragId);
      const toIdx = priorityQueueOrder.indexOf(t.id);
      if (fromIdx === -1 || toIdx === -1) return;
      priorityQueueOrder.splice(fromIdx, 1);
      priorityQueueOrder.splice(toIdx, 0, pqDragId);
      savePriorityQueue();
      renderPriorityQueue();
      populateTimerTaskSelect();
    });

    row.addEventListener("click", () => openModal(t.id));

    list.appendChild(row);
  });

  const total = ordered.reduce((sum, t) => sum + estOf(t), 0);
  const summary = document.getElementById("day-budget-summary");
  summary.classList.toggle("over", total > remaining);
  summary.textContent = ordered.length === 0 ? ""
    : total <= remaining ? `${formatMinutesLabel(total)} planned · ${formatMinutesLabel(remaining - total)} free`
    : `${formatMinutesLabel(total)} planned · over by ${formatMinutesLabel(total - remaining)}`;

  if (divider) {
    const overMin = overflow.reduce((sum, t) => sum + estOf(t), 0);
    divider.innerHTML = `<span>Won't fit today &middot; ${overflow.length} task${overflow.length === 1 ? "" : "s"} (${formatMinutesLabel(overMin)})</span><button type="button" class="pq-push-btn">Push to tomorrow</button>`;
    divider.querySelector(".pq-push-btn").addEventListener("click", () => pushToTomorrow(overflow));
  }
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

function groupBlock({ key, label, count, headingClass = "", headingStyle = "", dotStyle = "", dotClass = "", items, showCategory = false, actionsHtml = "" }) {
  const block = document.createElement("div");
  block.className = "category-block" + (collapsedGroups.has(key) ? " collapsed" : "");
  block.innerHTML = `
    <div class="category-heading ${headingClass}" style="${headingStyle}">
      <span class="group-caret">&#9662;</span>
      <span class="category-dot ${dotClass}" style="${dotStyle}"></span>
      ${label}
      <span class="category-count">${count}</span>
      <span class="group-actions">${actionsHtml}</span>
    </div>
    <div class="task-list"></div>
  `;
  const list = block.querySelector(".task-list");
  items.forEach(t => list.appendChild(renderTaskItem(t, showCategory)));
  block.querySelector(".category-heading").addEventListener("click", () => {
    if (collapsedGroups.has(key)) collapsedGroups.delete(key); else collapsedGroups.add(key);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(collapsedGroups)));
    block.classList.toggle("collapsed", collapsedGroups.has(key));
  });
  return block;
}

function renderTasks() {
  const container = document.getElementById("tasks-categories");
  const filterCat = document.getElementById("category-filter").value;
  const titleEl = document.getElementById("tasks-title");
  const searching = searchTerm.length > 0;

  titleEl.textContent = searching
    ? "Search results"
    : selectedDate
      ? `Tasks for ${new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}`
      : "All Tasks";

  const today = todayStr();
  const viewingToday = selectedDate === today;
  const showOverdue = searching || !selectedDate || viewingToday;

  let visible = tasks.filter(t => !t.archived || searching || (selectedDate && t.completedOn === selectedDate));
  if (searching) {
    visible = visible.filter(t =>
      (t.title || "").toLowerCase().includes(searchTerm) ||
      (t.notes || "").toLowerCase().includes(searchTerm) ||
      (t.category || "").toLowerCase().includes(searchTerm));
  } else if (selectedDate) {
    const inWindow = t => !t.completed && t.startDate && t.dueDate && t.startDate <= selectedDate && selectedDate <= t.dueDate;
    visible = viewingToday
      ? visible.filter(t => t.dueDate === selectedDate || t.completedOn === selectedDate || inWindow(t) || (!t.completed && t.dueDate && t.dueDate < today))
      : visible.filter(t => t.dueDate === selectedDate || t.completedOn === selectedDate || inWindow(t));
  } else if (!showCompletedAll) {
    visible = visible.filter(t => !t.completed || t.completedOn === today);
  }
  if (filterCat !== "all") visible = visible.filter(t => t.category === filterCat);
  if (statusFilter !== "all") visible = visible.filter(t => !t.completed && getTaskStatus(t) === statusFilter);

  container.innerHTML = "";

  let overdueTasks = [];
  if (showOverdue) {
    overdueTasks = visible.filter(t => !t.completed && t.dueDate && t.dueDate < today);
    const overdueIds = new Set(overdueTasks.map(t => t.id));
    visible = visible.filter(t => !overdueIds.has(t.id));
  }

  if (visible.length === 0 && overdueTasks.length === 0) {
    container.innerHTML = searching
      ? `<div class="empty-state">No tasks match &ldquo;${escapeHtml(searchTerm)}&rdquo;</div>`
      : statusFilter !== "all"
        ? `<div class="empty-state">Nothing here with that status.</div>`
        : `<div class="empty-state">No tasks here yet — type one into Quick add above, or press <kbd>n</kbd> ✨</div>`;
    return;
  }

  if (overdueTasks.length > 0) {
    overdueTasks.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
    const movable = overdueTasks.filter(t => !t.recurringId);
    const missedRecurring = overdueTasks.filter(t => t.recurringId);
    const actions = [];
    if (movable.length) actions.push(`<button type="button" class="group-action-btn" data-act="move-today">Move ${movable.length} to today</button>`);
    if (missedRecurring.length) actions.push(`<button type="button" class="group-action-btn" data-act="skip-recurring">Skip ${missedRecurring.length} missed recurring</button>`);
    const block = groupBlock({
      key: "overdue", label: "Overdue", count: overdueTasks.length,
      headingClass: "overdue-heading", dotClass: "overdue-dot", items: overdueTasks,
      actionsHtml: actions.join(""),
    });
    block.querySelectorAll(".group-action-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const snap = snapshotState();
        if (btn.dataset.act === "move-today") {
          movable.forEach(t => { t.dueDate = today; });
          saveTasks();
          renderAll();
          showUndoToast(`Moved ${movable.length} overdue task${movable.length === 1 ? "" : "s"} to today`, snap);
        } else {
          removeTasksAndRecord(missedRecurring.map(t => t.id));
          renderAll();
          showUndoToast(`Skipped ${missedRecurring.length} missed recurring task${missedRecurring.length === 1 ? "" : "s"}`, snap);
        }
      });
    });
    container.appendChild(block);
  }

  if (visible.length === 0) return;

  const priorityOrder = { high: 0, "time-sensitive": 1, medium: 2, low: 3 };
  const categoryNames = categories.map(c => c.name);
  const usedCategories = new Set(visible.map(t => t.category));
  usedCategories.forEach(cat => { if (!categoryNames.includes(cat)) categoryNames.push(cat); });

  const sortIncomplete = (a, b) => {
    const pa = priorityOrder[a.priority] ?? 9;
    const pb = priorityOrder[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
  };

  const completedTasks = [];

  categoryNames.forEach(cat => {
    const allCatTasks = visible.filter(t => t.category === cat);
    allCatTasks.forEach(t => { if (t.completed) completedTasks.push(t); });
    const catTasks = allCatTasks.filter(t => !t.completed).sort(sortIncomplete);

    if (catTasks.length === 0) return;

    const color = getCategoryColor(cat);
    container.appendChild(groupBlock({
      key: "cat:" + cat, label: escapeHtml(cat), count: catTasks.length,
      headingStyle: `color:${color}`, dotStyle: `background:${color}`, items: catTasks,
    }));
  });

  if (completedTasks.length > 0) {
    completedTasks.sort((a, b) => (b.completedOn || b.dueDate || "").localeCompare(a.completedOn || a.dueDate || ""));
    container.appendChild(groupBlock({
      key: "completed", label: "Completed", count: completedTasks.length,
      headingClass: "completed-heading", dotClass: "completed-dot", items: completedTasks, showCategory: true,
    }));
  }
}

function dueLabelInfo(t) {
  const d = new Date(t.dueDate + "T00:00:00");
  const td = new Date(todayStr() + "T00:00:00");
  const diff = Math.round((d - td) / 86400000);
  const dateLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = t.dueTime ? " · " + formatTime(t.dueTime) : "";
  if (t.completed) return { text: `Due ${dateLabel}${time}`, cls: "" };
  if (diff < 0) return { text: `${-diff}d overdue · ${dateLabel}`, cls: " overdue" };
  if (diff === 0) return { text: `Due today${time}`, cls: " today" };
  if (diff === 1) return { text: `Due tomorrow${time}`, cls: "" };
  return { text: `Due ${dateLabel}${time}`, cls: "" };
}

function renderTaskItem(t, showCategory) {
  const pMeta = PRIORITY_META[t.priority] || PRIORITY_META.medium;
  const status = getTaskStatus(t);
  const item = document.createElement("div");
  const partDone = !t.completed && isBigTask(t) && t.dueDate > todayStr() && t.dayDone && t.dayDone[todayStr()];
  item.className = "task-item" + (t.completed ? " completed" : "") + (partDone ? " part-done" : "") + ` status-${status}`;
  item.style.borderLeftColor = pMeta.color;

  const metaParts = [];
  if (showCategory) {
    const catColor = getCategoryColor(t.category);
    metaParts.push(`<span class="recurring-badge" style="color:${catColor}">${escapeHtml(t.category)}</span>`);
  }
  if (t.startDate && t.dueDate && t.startDate < t.dueDate && !t.completed) {
    const sd = new Date(t.startDate + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
    metaParts.push(`<span class="recurring-badge start-badge" title="Working window: ${t.startDate} to ${t.dueDate}">${t.startDate > todayStr() ? "Starts " + sd : "Started " + sd}</span>`);
  }
  if (t.recurringId) {
    const changed = Object.keys(t.recurringOverrides || {});
    metaParts.push(`<span class="recurring-badge"${changed.length ? ` title="Edited separately: ${changed.join(", ")}"` : ""}>↻ Recurring${changed.length ? " · edited" : ""}</span>`);
  }
  if (t.link) metaParts.push(`<a href="${escapeAttr(t.link)}" target="_blank" rel="noopener">Link</a>`);

  const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
  const subsDone = subs.filter(x => x.done).length;
  const subsOpen = expandedTasks.has(t.id);
  const bst = (!t.completed && subs.length) ? bigStatsFor(subs) : null;
  if (bst && (isBigTask(t) || subs.some(x => x.day))) {
    metaParts.push(`<span class="recurring-badge big-state ${bst.state}" title="Progress of the checklist">${bst.pct}% · ${bigStateLabel(bst)}</span>`);
    if (bst.state === "behind") metaParts.push(`<button type="button" class="catchup-chip" title="Move missed steps onto the lightest upcoming days">Catch up</button>`);
  }
  if (subs.length) {
    metaParts.push(`<button type="button" class="sub-chip${subsDone === subs.length ? " all-done" : ""}" title="Show checklist">&#9745; ${subsDone}/${subs.length}</button>`);
  }
  const subsHtml = subs.length && subsOpen
    ? `<div class="subtask-list">${subs.map((x, i) => `<div class="sub-row${x.done ? " is-done" : ""}" data-i="${i}"><span class="sub-box${x.done ? " done" : ""}">&#10003;</span><span class="sub-text">${escapeHtml(x.text)}${x.minutes ? ` <em class="sub-mintag">${formatMinutesLabel(x.minutes)}</em>` : ""}</span>${x.day ? `<span class="sub-daytag${!x.done && x.day < todayStr() ? " late" : ""}">${new Date(x.day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" })}</span>` : ""}</div>`).join("")}</div>`
    : "";

  const today = todayStr();
  const sideParts = [];
  if (t.dueDate) {
    const info = dueLabelInfo(t);
    sideParts.push(`<div class="task-due${info.cls}">${info.text}</div>`);
  }
  if (t.estimate) sideParts.push(`<div class="task-estimate">${t.estimate} min</div>`);

  let snoozeTarget = null;
  if (!t.completed && t.dueDate && t.dueDate <= today) {
    snoozeTarget = t.dueDate < today ? { label: "→ Today", date: today } : { label: "→ Tomorrow", date: addDaysStr(1) };
    sideParts.push(`<button type="button" class="snooze-btn" title="Reschedule">${snoozeTarget.label}</button>`);
  }

  item.innerHTML = `
    <div class="task-checkbox status-${status}${partDone ? " part-done-box" : ""}" title="${partDone ? "Today's part is done — click to undo" : isBigTask(t) && !t.completed && t.dueDate > todayStr() ? "Mark today's part done" : STATUS_META[status].label + " — click to change"}">${partDone ? "✓" : STATUS_META[status].icon}</div>
    <div class="task-body">
      <div class="task-title-row">
        <span class="task-title">${escapeHtml(t.title)}</span>
        ${status === "ongoing" ? `<span class="status-badge status-badge-ongoing">Ongoing</span>` : ""}
        <span class="priority-badge" style="background:${pMeta.color}">${pMeta.label}</span>
      </div>
      ${metaParts.length ? `<div class="task-meta">${metaParts.join("")}</div>` : ""}
      ${t.notes ? `<div class="task-notes">${escapeHtml(t.notes)}</div>` : ""}
      ${subsHtml}
    </div>
    ${sideParts.length ? `<div class="task-side">${sideParts.join("")}</div>` : ""}
  `;

  item.querySelector(".task-checkbox").addEventListener("click", (e) => {
    e.stopPropagation();
    cycleTaskStatus(t.id);
  });

  const cuChip = item.querySelector(".catchup-chip");
  if (cuChip) cuChip.addEventListener("click", (e) => { e.stopPropagation(); catchUpTask(t); });
  const subChip = item.querySelector(".sub-chip");
  if (subChip) {
    subChip.addEventListener("click", (e) => {
      e.stopPropagation();
      if (expandedTasks.has(t.id)) expandedTasks.delete(t.id); else expandedTasks.add(t.id);
      renderTasks();
    });
  }
  item.querySelectorAll(".sub-row").forEach(row => {
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const step = t.subtasks[parseInt(row.dataset.i, 10)];
      if (!step) return;
      step.done = !step.done;
      saveTasks();
      renderTasks();
      if (t.subtasks.every(x => x.done)) showSimpleToast("Checklist complete", `All steps of “${t.title}” are done. Mark the task complete when you're ready.`);
    });
  });

  const snoozeBtn = item.querySelector(".snooze-btn");
  if (snoozeBtn && snoozeTarget) {
    snoozeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const snap = snapshotState();
      if (t.recurringId) markOccurrenceOverrides(t, { ...t, dueDate: snoozeTarget.date });
      t.dueDate = snoozeTarget.date;
      saveTasks();
      renderAll();
      showUndoToast(`Moved “${t.title}” to ${snoozeTarget.label.replace("→ ", "").toLowerCase()}`, snap);
    });
  }

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

function getTaskStatus(t) {
  return t.status || (t.completed ? "completed" : "not-started");
}

const STATUS_ORDER = ["not-started", "ongoing", "completed"];
const STATUS_META = {
  "not-started": { label: "Not Started", icon: "" },
  "ongoing": { label: "Ongoing", icon: "◐" },
  "completed": { label: "Completed", icon: "✓" },
};

function isBigTask(t) { return !!(t.startDate && t.dueDate && t.startDate < t.dueDate); }
function toggleDayDone(t, day) {
  t.dayDone = t.dayDone || {};
  if (t.dayDone[day]) delete t.dayDone[day]; else t.dayDone[day] = true;
  if (!Object.keys(t.dayDone).length) delete t.dayDone;
  saveTasks();
  renderAll();
  if (t.dayDone && t.dayDone[day]) {
    showSimpleToast("Today's part done", `“${t.title}” stays open until its due date. Set Status to Completed in the task when it's all finished.`);
    if (typeof catCheer === "function") catCheer(t);
  }
}
function cycleTaskStatus(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  if (isBigTask(t) && !t.completed && t.dueDate > todayStr()) { toggleDayDone(t, todayStr()); return; }
  const cur = getTaskStatus(t);
  const next = STATUS_ORDER[(STATUS_ORDER.indexOf(cur) + 1) % STATUS_ORDER.length];
  t.status = next;
  t.completed = next === "completed";
  t.completedOn = t.completed ? todayStr() : null;
  t.completedAt = t.completed ? new Date().toISOString() : null;

  if (t.completed && timerBankedSeconds[t.id]) {
    const minutes = Math.max(1, Math.round(timerBankedSeconds[t.id] / 60));
    sessions.push({ id: uid(), taskId: t.id, category: t.category, date: todayStr(), minutes });
    saveSessions();
    delete timerBankedSeconds[t.id];
    saveTimerBank();
    if (timerTaskId === t.id) {
      timerSeconds = 0;
      document.getElementById("timer-toggle").disabled = true;
      document.getElementById("timer-complete").style.display = "none";
      document.getElementById("pomodoro-task-select").value = "";
      timerTaskId = "";
      updateTimerDisplay();
    }
  }

  saveTasks();
  renderAll();
  checkAchievements();
  if (t.completed) catCheer(t);
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

let editScope = "none";

function setEditScope(scope) {
  editScope = scope;
  document.querySelectorAll(".edit-scope-btn").forEach(b => b.classList.toggle("active", b.dataset.scope === scope));
  const series = scope === "series";
  recurringSection.style.display = series ? "block" : "none";
  document.getElementById("series-edit-note").style.display = series ? "block" : "none";
  dueDateRow.style.display = series ? "none" : "grid";
  document.getElementById("subtasks-field").style.display = series ? "none" : "block";
  document.getElementById("start-field").style.display = series ? "none" : "block";
  if (series) document.getElementById("day-plan-field").style.display = "none"; else renderDayPlan();
  document.querySelector(".template-save-row").style.display = series ? "none" : "block";
  document.getElementById("edit-scope-hint").textContent = series
    ? "Changes apply to every occurrence. Anything you edited on a single day is kept."
    : "Changes apply only to this day's task, like a note or moving just this date.";
}

document.querySelectorAll(".edit-scope-btn").forEach(btn => {
  btn.addEventListener("click", () => setEditScope(btn.dataset.scope));
});

function markOccurrenceOverrides(t, data) {
  t.recurringOrigDate = t.recurringOrigDate || t.dueDate;
  const ov = t.recurringOverrides || {};
  ["title", "category", "priority", "estimate", "link", "notes", "dueDate", "dueTime"].forEach(k => {
    if (String(t[k] ?? "") !== String(data[k] ?? "")) ov[k] = true;
  });
  t.recurringOverrides = ov;
}

function openModal(taskId = null) {
  form.reset();
  resetRecurringUI();
  document.getElementById("task-id").value = taskId || "";

  const t = taskId ? tasks.find(x => x.id === taskId) : null;
  const isSeriesEdit = !!(t && t.recurringId);

  document.getElementById("task-status-select").value = t ? getTaskStatus(t) : "not-started";
  document.getElementById("task-actual-minutes").value = "";

  const deleteBtn = document.getElementById("delete-task-btn");
  deleteBtn.style.display = taskId ? "inline-block" : "none";
  deleteBtn.textContent = isSeriesEdit ? "Delete This Occurrence" : "Delete";
  document.getElementById("delete-series-btn").style.display = isSeriesEdit ? "inline-block" : "none";

  document.getElementById("recurring-checkbox-row").style.display = isSeriesEdit ? "none" : "flex";
  document.getElementById("series-edit-note").style.display = "none";
  recurringSection.style.display = (!taskId || isSeriesEdit) ? "block" : "none";
  document.getElementById("edit-scope").style.display = isSeriesEdit ? "block" : "none";
  editScope = isSeriesEdit ? "this" : "none";
  document.getElementById("subtasks-field").style.display = "block";
  document.getElementById("start-field").style.display = "block";
  document.getElementById("task-start-date").value = "";
  modalDayMinutes = t && t.dayMinutes ? { ...t.dayMinutes } : {};
  dayPlanManual = new Set(Object.keys(modalDayMinutes));
  {
    const stepSum = t && Array.isArray(t.subtasks) ? t.subtasks.reduce((n, x) => n + (Number(x.minutes) || 0), 0) : 0;
    estimateManual = !!(t && t.estimate && Number(t.estimate) !== stepSum);
  }
  document.querySelector(".template-save-row").style.display = "block";
  modalSubtasks = t && Array.isArray(t.subtasks) ? t.subtasks.map(x => ({ ...x })) : [];
  renderSubtaskEditor();
  document.getElementById("subtask-new").value = "";
  document.getElementById("template-row").style.display = (!taskId && templates.length) ? "block" : "none";
  document.getElementById("template-select").value = "";

  if (t) {
    document.getElementById("modal-title").textContent = "Edit Task";
    document.getElementById("task-title").value = t.title;
    document.getElementById("task-category").value = t.category;
    document.getElementById("task-priority").value = t.priority;
    document.getElementById("task-due-date").value = t.dueDate || "";
    document.getElementById("task-start-date").value = t.startDate || "";
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
      setEditScope("this");
    }
  } else {
    document.getElementById("modal-title").textContent = "New Task";
    if (selectedDate) document.getElementById("task-due-date").value = selectedDate;
  }

  renderSubtaskEditor();
  renderDayPlan();
  updateEstimateTools();
  document.getElementById("respread-note").style.display = "none";
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
  const target = tasks.find(t => t.id === id);
  const snap = snapshotState();
  removeTasksAndRecord([id]);
  closeModal();
  renderAll();
  checkAchievements();
  showUndoToast(`Deleted “${target ? target.title : "task"}”`, snap);
});

document.getElementById("delete-series-btn").addEventListener("click", () => {
  const id = document.getElementById("task-id").value;
  const t = tasks.find(x => x.id === id);
  if (!t || !t.recurringId) return;
  const snap = snapshotState();
  const ids = tasks.filter(x => x.recurringId === t.recurringId).map(x => x.id);
  removeTasksAndRecord(ids);
  closeModal();
  renderAll();
  checkAchievements();
  showUndoToast(`Deleted the whole “${t.title}” series (${ids.length} tasks)`, snap);
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
  const wasCompleted = existingTask ? existingTask.completed : false;
  const isSeriesEdit = !!(existingTask && existingTask.recurringId) && editScope === "series";
  const isNewRecurring = !id && recurringCheckbox.checked;
  let newTaskRef = null;

  if (isNewRecurring || isSeriesEdit) {
    const rec = readRecurrenceForm();
    if (!rec) return;

    const recurringId = isSeriesEdit ? existingTask.recurringId : uid();
    const excludedDates = isSeriesEdit ? (existingTask.recurringExcludedDates || []) : [];
    const recurringMeta = {
      recurringId,
      recurringFrequency: rec.frequency,
      recurringWeekdays: rec.frequency === "weekly" ? Array.from(selectedWeekdays) : [],
      recurringStart: rec.start,
      recurringUntil: rec.until,
      recurringTime: rec.time,
      recurringExcludedDates: excludedDates,
    };

    if (isSeriesEdit) {
      const existingByDate = {};
      tasks.filter(t => t.recurringId === recurringId).forEach(t => { existingByDate[t.recurringOrigDate || t.dueDate] = t; });

      let newOccurrenceCount = 0;
      const seriesTasks = rec.dates.filter(dateStr => !excludedDates.includes(dateStr)).map(dateStr => {
        const prior = existingByDate[dateStr];
        if (prior) {
          const ov = prior.recurringOverrides || {};
          const merged = { ...baseData };
          Object.keys(ov).forEach(k => { delete merged[k]; });
          Object.assign(prior, merged, recurringMeta);
          if (!ov.dueDate) prior.dueDate = dateStr;
          if (!ov.dueTime) prior.dueTime = rec.time;
          return prior;
        }
        newOccurrenceCount++;
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
      tasksCreatedCount += newOccurrenceCount;
      saveTasksCreatedCount();
    } else {
      rec.dates.forEach(dateStr => {
        const occ = {
          id: uid(),
          completed: false,
          completedOn: null,
          dueDate: dateStr,
          dueTime: rec.time,
          ...recurringMeta,
          ...baseData,
        };
        const steps = cleanSubtasks(modalSubtasks, true);
        if (steps.length) occ.subtasks = steps;
        tasks.push(occ);
      });
      tasksCreatedCount += rec.dates.length;
      saveTasksCreatedCount();
    }
  } else {
    const data = {
      ...baseData,
      dueDate: document.getElementById("task-due-date").value,
      dueTime: document.getElementById("task-due-time").value,
      startDate: readStartDate(document.getElementById("task-due-date").value),
    };
    data.dayMinutes = cleanDayMinutes(data.startDate, data.dueDate);

    if (id) {
      if (existingTask.recurringId) markOccurrenceOverrides(existingTask, data);
      Object.assign(existingTask, data);
    } else {
      newTaskRef = {
        id: uid(),
        completed: false,
        completedOn: null,
        ...data,
      };
      tasks.push(newTaskRef);
      tasksCreatedCount++;
      saveTasksCreatedCount();
    }
  }

  const statusValue = document.getElementById("task-status-select").value;
  const completedNow = statusValue === "completed";
  const manualMinutes = parseInt(document.getElementById("task-actual-minutes").value, 10);
  const targetTask = existingTask || (!isNewRecurring ? newTaskRef : null);

  if (targetTask) {
    targetTask.status = statusValue;
    if (completedNow && !wasCompleted) {
      targetTask.completed = true;
      targetTask.completedOn = todayStr();
      targetTask.completedAt = new Date().toISOString();
    } else if (!completedNow && wasCompleted) {
      targetTask.completed = false;
      targetTask.completedOn = null;
      targetTask.completedAt = null;
    }
    if (manualMinutes > 0) {
      sessions.push({ id: uid(), taskId: targetTask.id, category: targetTask.category, date: todayStr(), minutes: manualMinutes });
      saveSessions();
    }
    if (editScope !== "series") {
      const steps = cleanSubtasks(modalSubtasks, false);
      if (steps.length) targetTask.subtasks = steps; else delete targetTask.subtasks;
    }
  }

  saveTasks();
  closeModal();
  renderAll();
  checkAchievements();
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
  { id: "punctual-10",  category: "Milestones",  title: "Punctual",         desc: "Complete 10 tasks on or before their due date.",      check: ctx => ctx.onTimeByDueDateCount >= 10,   progress: ctx => [ctx.onTimeByDueDateCount, 10] },
  { id: "punctual-50",  category: "Milestones",  title: "Always On Time",   desc: "Complete 50 tasks on or before their due date.",      check: ctx => ctx.onTimeByDueDateCount >= 50,   progress: ctx => [ctx.onTimeByDueDateCount, 50] },
  { id: "organizer-50", category: "Milestones",  title: "Getting Organized",desc: "Create 50 tasks in total.",                           check: ctx => ctx.tasksCreatedCount >= 50,      progress: ctx => [ctx.tasksCreatedCount, 50] },
  { id: "planner-150",  category: "Milestones",  title: "Master Planner",  desc: "Create 150 tasks in total.",                          check: ctx => ctx.tasksCreatedCount >= 150,     progress: ctx => [ctx.tasksCreatedCount, 150] },

  { id: "streak-3",     category: "Streaks",     title: "On a Roll",         desc: "Complete all due tasks on time, 3 days in a row.",   check: ctx => ctx.streak >= 3,                 progress: ctx => [ctx.streak, 3] },
  { id: "streak-7",     category: "Streaks",     title: "Unstoppable",       desc: "7-day on-time completion streak.",                   check: ctx => ctx.streak >= 7,                 progress: ctx => [ctx.streak, 7] },
  { id: "streak-14",    category: "Streaks",     title: "Two Weeks Strong",  desc: "14-day on-time completion streak.",                  check: ctx => ctx.streak >= 14,                progress: ctx => [ctx.streak, 14] },
  { id: "streak-30",    category: "Streaks",     title: "Unbreakable",       desc: "30-day on-time completion streak.",                  check: ctx => ctx.streak >= 30,                progress: ctx => [ctx.streak, 30] },
  { id: "perfect-week", category: "Streaks",     title: "Perfect Week",      desc: "100% on-time productivity in a single week.",        check: ctx => ctx.weeklyPerfect },
  { id: "reliable-2wk", category: "Streaks",     title: "Reliable",          desc: "80%+ productivity two weeks in a row.",              check: ctx => ctx.reliableTwoWeeks },
  { id: "steady-4wk",   category: "Streaks",     title: "Steady Hand",       desc: "80%+ productivity four weeks in a row.",             check: ctx => ctx.steadyFourWeeks },

  { id: "focus-1",      category: "Time Tracked", title: "Focused",          desc: "Finish your first timed work session.",              check: ctx => ctx.totalSessions >= 1,          progress: ctx => [ctx.totalSessions, 1] },
  { id: "deep-work",    category: "Time Tracked", title: "Deep Work",        desc: "Log 2+ hours of tracked time in a single day.",      check: ctx => ctx.maxDayMinutes >= 120,        progress: ctx => [ctx.todayTrackedMinutes, 120, true] },
  { id: "half-day",     category: "Time Tracked", title: "Half Day Hero",    desc: "Track 4+ hours of work in a single day.",            check: ctx => ctx.maxDayMinutes >= 240,        progress: ctx => [ctx.todayTrackedMinutes, 240, true] },
  { id: "full-shift",   category: "Time Tracked", title: "Full Shift",       desc: "Track 6+ hours of work in a single day.",            check: ctx => ctx.maxDayMinutes >= 360,        progress: ctx => [ctx.todayTrackedMinutes, 360, true] },
  { id: "marathon-day", category: "Time Tracked", title: "Marathon Day",     desc: "Track 8+ hours of work in a single day.",            check: ctx => ctx.maxDayMinutes >= 480,        progress: ctx => [ctx.todayTrackedMinutes, 480, true] },
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
  const todayTrackedMinutes = dayTotals[today] || 0;
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

  const onTimeByDueDateCount = tasks.filter(t => t.completed && t.dueDate && t.completedOn && t.completedOn <= t.dueDate).length;

  return {
    totalCompleted, highPriorityCompleted, todayAllDone, streak, totalSessions, maxDayMinutes, todayTrackedMinutes,
    totalTrackedMinutes, distinctCategoriesCompleted, recurringCompletedCount, earlyBird, nightOwl, weeklyPerfect,
    onTimeCompletedCount, speedRunner, maxCategoryCount, weekendWarrior, multitaskerDay,
    reliableTwoWeeks, steadyFourWeeks, onTimeByDueDateCount, tasksCreatedCount,
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

const CONFETTI_COLORS = ["#f0b93c", "#8fb6d9", "#e08fa0", "#8bbf8a", "#a897d9"];

function spawnConfetti(container) {
  for (let i = 0; i < 14; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.left = (40 + Math.random() * 20) + "%";
    piece.style.setProperty("--dx", (Math.random() * 160 - 80) + "px");
    piece.style.setProperty("--dr", (Math.random() * 360 - 180) + "deg");
    piece.style.animationDelay = (Math.random() * 0.15) + "s";
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 1100);
  }
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
  spawnConfetti(toast);
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
let timerStartTimestamp = null;

const TIMER_BANK_KEY = "molly-panel-timer-bank-v1";
let timerBankedSeconds = loadJSON(TIMER_BANK_KEY, {});

function saveTimerBank() {
  localStorage.setItem(TIMER_BANK_KEY, JSON.stringify(timerBankedSeconds));
  schedulePush();
}

function bankCurrentTime() {
  if (!timerTaskId) return;
  if (timerSeconds > 0) {
    timerBankedSeconds[timerTaskId] = timerSeconds;
  } else {
    delete timerBankedSeconds[timerTaskId];
  }
  saveTimerBank();
}

function updateBankedHint() {
  const hint = document.getElementById("timer-banked-hint");
  const banked = timerTaskId ? timerBankedSeconds[timerTaskId] : null;
  if (banked && !timerRunning) {
    hint.textContent = `Resuming from ${formatTimer(banked)} already logged on this task`;
    hint.style.display = "block";
  } else {
    hint.style.display = "none";
  }
}

const TIMER_AUTO_PAUSE_SECONDS = 90 * 60;

function syncTimerFromClock() {
  if (!timerRunning || timerStartTimestamp === null) return;
  timerSeconds = Math.floor((Date.now() - timerStartTimestamp) / 1000);
  if (timerSeconds >= TIMER_AUTO_PAUSE_SECONDS) {
    autoPauseTimer();
    return;
  }
  updateTimerDisplay();
  if (typeof pomodoroCheck === "function") pomodoroCheck();
}

function autoPauseTimer() {
  timerSeconds = TIMER_AUTO_PAUSE_SECONDS;
  clearInterval(timerInterval);
  timerRunning = false;
  timerStartTimestamp = null;
  bankCurrentTime();
  document.getElementById("timer-toggle").textContent = "Start";
  updateTimerDisplay();
  saveTaskTimerState();
  const mins = Math.round(TIMER_AUTO_PAUSE_SECONDS / 60);
  showSimpleToast("Timer Auto-Paused", `It ran for ${mins} min straight — still working? Your time so far is saved.`);
}

function showSimpleToast(title, message) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast toast-info";
  toast.innerHTML = `
    <div class="toast-icon"></div>
    <div>
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-name">${escapeHtml(message)}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    syncTimerFromClock();
    checkDateRollover();
  }
});

function populateTimerTaskSelect() {
  const select = document.getElementById("pomodoro-task-select");
  const current = select.value;
  const today = todayStr();
  select.innerHTML = `<option value="">Select a task...</option>`;
  const eligible = tasks.filter(t => isWorkableToday(t, today));
  const orderIndex = new Map(priorityQueueOrder.map((id, i) => [id, i]));
  eligible
    .sort((a, b) => {
      const ia = orderIndex.has(a.id) ? orderIndex.get(a.id) : Infinity;
      const ib = orderIndex.has(b.id) ? orderIndex.get(b.id) : Infinity;
      return ia - ib;
    })
    .forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      const overdueTag = t.dueDate && t.dueDate < today ? " — Overdue" : "";
      const st = openStepFor(t, today);
      opt.textContent = `${t.title} (${t.category})${overdueTag}${st ? " ▸ " + st.text : ""}`;
      select.appendChild(opt);
    });
  if (current && eligible.some(t => t.id === current)) {
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
  updateBankedHint();

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
    const label = s.name
      ? `${s.name} (${s.category})`
      : (task ? task.title : "Deleted task");
    return `
      <div class="session-item">
        <span class="session-task">${escapeHtml(label)}</span>
        <span class="session-minutes">${s.minutes} min</span>
      </div>
    `;
  }).join("");
}

document.getElementById("pomodoro-task-select").addEventListener("change", (e) => {
  if (timerRunning) {
    syncTimerFromClock();
    clearInterval(timerInterval);
    timerRunning = false;
    timerStartTimestamp = null;
    document.getElementById("timer-toggle").textContent = "Start";
  }
  bankCurrentTime();

  timerTaskId = e.target.value;
  timerSeconds = timerTaskId ? (timerBankedSeconds[timerTaskId] || 0) : 0;
  timerAlerted = false;
  document.getElementById("timer-alert").classList.remove("show");
  document.getElementById("timer-toggle").disabled = !timerTaskId;
  document.getElementById("timer-complete").style.display = timerSeconds > 0 ? "inline-block" : "none";
  updateTimerDisplay();
  saveTaskTimerState();
});

document.getElementById("timer-toggle").addEventListener("click", () => {
  if (!timerTaskId) return;
  timerRunning = !timerRunning;
  const btn = document.getElementById("timer-toggle");
  if (timerRunning) {
    btn.textContent = "Pause";
    document.getElementById("timer-complete").style.display = "inline-block";
    timerStartTimestamp = Date.now() - timerSeconds * 1000;
    timerInterval = setInterval(syncTimerFromClock, 1000);
    updateBankedHint();
  } else {
    btn.textContent = "Start";
    clearInterval(timerInterval);
    timerSeconds = Math.floor((Date.now() - timerStartTimestamp) / 1000);
    timerStartTimestamp = null;
    bankCurrentTime();
    updateTimerDisplay();
  }
  saveTaskTimerState();
});

document.getElementById("timer-reset").addEventListener("click", () => {
  clearInterval(timerInterval);
  timerRunning = false;
  timerSeconds = 0;
  timerStartTimestamp = null;
  timerAlerted = false;
  if (timerTaskId) {
    delete timerBankedSeconds[timerTaskId];
    saveTimerBank();
  }
  document.getElementById("timer-toggle").textContent = "Start";
  document.getElementById("timer-alert").classList.remove("show");
  document.getElementById("timer-complete").style.display = "none";
  updateTimerDisplay();
  saveTaskTimerState();
});

document.getElementById("timer-complete").addEventListener("click", () => {
  const task = currentTimerTask();
  if (!task) return;

  syncTimerFromClock();
  clearInterval(timerInterval);
  timerRunning = false;
  timerStartTimestamp = null;

  const minutes = Math.max(1, Math.round(timerSeconds / 60));
  sessions.push({ id: uid(), taskId: task.id, category: task.category, date: todayStr(), minutes });
  saveSessions();

  task.completed = true;
  task.status = "completed";
  task.completedOn = todayStr();
  task.completedAt = new Date().toISOString();
  saveTasks();

  delete timerBankedSeconds[task.id];
  saveTimerBank();

  timerSeconds = 0;
  timerAlerted = false;
  timerTaskId = "";
  document.getElementById("timer-toggle").textContent = "Start";
  document.getElementById("timer-toggle").disabled = true;
  document.getElementById("timer-alert").classList.remove("show");
  document.getElementById("timer-complete").style.display = "none";
  document.getElementById("pomodoro-task-select").value = "";
  updateTimerDisplay();
  saveTaskTimerState();

  renderAll();
  checkAchievements();
  catCheer(task);
});

/* ===================== Free timer ===================== */
const FREE_TIMER_KEY = "molly-panel-free-timer-v1";
const FREE_TIMER_AUTO_PAUSE_SECONDS = 3 * 60 * 60;
let freeTimer = loadJSON(FREE_TIMER_KEY, null);
if (!freeTimer || typeof freeTimer.accumulated !== "number") freeTimer = { accumulated: 0, startedAt: null };
let freeTimerInterval = null;
let freeResetArmed = null;

function saveFreeTimer() {
  localStorage.setItem(FREE_TIMER_KEY, JSON.stringify(freeTimer));
}

function freeElapsedSeconds() {
  const live = freeTimer.startedAt ? Math.floor((Date.now() - freeTimer.startedAt) / 1000) : 0;
  return freeTimer.accumulated + live;
}

function renderFreeTimer() {
  const elapsed = freeElapsedSeconds();
  document.getElementById("free-timer-time").textContent = formatTimer(elapsed);
  document.getElementById("free-timer-toggle").textContent =
    freeTimer.startedAt ? "Pause" : (freeTimer.accumulated > 0 ? "Resume" : "Start");
  document.getElementById("free-timer-finish").style.display = elapsed > 0 ? "inline-block" : "none";
}

function tickFreeTimer() {
  if (!freeTimer.startedAt) return;
  if (freeElapsedSeconds() >= FREE_TIMER_AUTO_PAUSE_SECONDS) {
    clearInterval(freeTimerInterval);
    freeTimer = { accumulated: FREE_TIMER_AUTO_PAUSE_SECONDS, startedAt: null };
    saveFreeTimer();
    renderFreeTimer();
    showSimpleToast("Free Timer Auto-Paused", `It ran for ${FREE_TIMER_AUTO_PAUSE_SECONDS / 3600} hours straight — still working? Your time so far is kept.`);
    return;
  }
  renderFreeTimer();
}

function startFreeTimerInterval() {
  clearInterval(freeTimerInterval);
  freeTimerInterval = setInterval(tickFreeTimer, 1000);
}

function pauseFreeTimer() {
  if (!freeTimer.startedAt) return;
  freeTimer = { accumulated: freeElapsedSeconds(), startedAt: null };
  clearInterval(freeTimerInterval);
  saveFreeTimer();
}

function populateFreeCategorySelect() {
  const sel = document.getElementById("free-session-category");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = "";
  categories.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
  if (current && categories.some(c => c.name === current)) sel.value = current;
}

document.querySelectorAll(".timer-mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.timerMode;
    document.querySelectorAll(".timer-mode-btn").forEach(b => b.classList.toggle("active", b === btn));
    document.getElementById("task-timer-mode").style.display = mode === "task" ? "block" : "none";
    document.getElementById("free-timer-mode").style.display = mode === "free" ? "block" : "none";
  });
});

document.getElementById("free-timer-toggle").addEventListener("click", () => {
  if (freeTimer.startedAt) {
    pauseFreeTimer();
  } else {
    freeTimer.startedAt = Date.now();
    saveFreeTimer();
    startFreeTimerInterval();
  }
  document.getElementById("free-session-form").style.display = "none";
  renderFreeTimer();
});

document.getElementById("free-timer-reset").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  if (freeElapsedSeconds() > 0 && !freeResetArmed) {
    btn.textContent = "Sure? Click again";
    freeResetArmed = setTimeout(() => {
      freeResetArmed = null;
      btn.textContent = "Reset";
    }, 3000);
    return;
  }
  clearTimeout(freeResetArmed);
  freeResetArmed = null;
  btn.textContent = "Reset";
  clearInterval(freeTimerInterval);
  freeTimer = { accumulated: 0, startedAt: null };
  saveFreeTimer();
  document.getElementById("free-session-form").style.display = "none";
  renderFreeTimer();
});

document.getElementById("free-timer-finish").addEventListener("click", () => {
  pauseFreeTimer();
  const minutes = Math.max(1, Math.round(freeTimer.accumulated / 60));
  document.getElementById("free-session-summary").textContent = `You timed ${formatMinutesLabel(minutes)} — nice work!`;
  populateFreeCategorySelect();
  const form = document.getElementById("free-session-form");
  form.style.display = "block";
  renderFreeTimer();
  document.getElementById("free-session-name").focus();
});

document.getElementById("free-session-cancel").addEventListener("click", () => {
  document.getElementById("free-session-form").style.display = "none";
});

document.getElementById("free-session-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("free-session-name").value.trim();
  const category = document.getElementById("free-session-category").value;
  if (!name || !category) return;
  const minutes = Math.max(1, Math.round(freeTimer.accumulated / 60));

  const today = todayStr();
  const task = makeCompletedFreeTask(name, category, today, new Date().toISOString());
  tasks.push(task);
  tasksCreatedCount++;
  saveTasks();
  saveTasksCreatedCount();

  sessions.push({ id: uid(), taskId: task.id, name, category, date: today, minutes });
  saveSessions();

  freeTimer = { accumulated: 0, startedAt: null };
  saveFreeTimer();
  document.getElementById("free-session-name").value = "";
  document.getElementById("free-session-form").style.display = "none";
  renderFreeTimer();
  renderAll();
  checkAchievements();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") tickFreeTimer();
});

renderFreeTimer();
if (freeTimer.startedAt) {
  startFreeTimerInterval();
  tickFreeTimer();
}

function makeCompletedFreeTask(name, category, dateStr, completedAtIso) {
  return {
    id: uid(),
    title: name,
    category,
    priority: "medium",
    estimate: "",
    link: "",
    notes: "Logged from the Free Timer",
    dueDate: dateStr,
    dueTime: "",
    completed: true,
    status: "completed",
    completedOn: dateStr,
    completedAt: completedAtIso,
    fromFreeTimer: true,
  };
}

function migrateFreeSessions() {
  let changed = false;
  sessions.forEach(s => {
    if (!s.taskId && s.name) {
      const task = makeCompletedFreeTask(s.name, s.category, s.date, new Date(s.date + "T12:00:00").toISOString());
      tasks.push(task);
      tasksCreatedCount++;
      s.taskId = task.id;
      changed = true;
    }
  });
  if (changed) {
    saveTasks();
    saveTasksCreatedCount();
    saveSessions();
  }
  return changed;
}

/* ===================== Task timer persistence + cross-tab sync ===================== */
const TASK_TIMER_KEY = "molly-panel-task-timer-v1";

function saveTaskTimerState() {
  localStorage.setItem(TASK_TIMER_KEY, JSON.stringify({
    taskId: timerTaskId,
    running: timerRunning,
    startTimestamp: timerStartTimestamp,
    seconds: timerSeconds,
  }));
}

function applyTaskTimerState() {
  const s = loadJSON(TASK_TIMER_KEY, null);
  const today = todayStr();
  const toggleBtn = document.getElementById("timer-toggle");
  const completeBtn = document.getElementById("timer-complete");
  const select = document.getElementById("pomodoro-task-select");

  clearInterval(timerInterval);
  timerRunning = false;
  timerStartTimestamp = null;
  timerAlerted = false;
  document.getElementById("timer-alert").classList.remove("show");

  const valid = s && s.taskId && tasks.some(t => t.id === s.taskId && isWorkableToday(t, today));
  if (!valid) {
    timerTaskId = "";
    timerSeconds = 0;
    select.value = "";
    toggleBtn.disabled = true;
    toggleBtn.textContent = "Start";
    completeBtn.style.display = "none";
    updateTimerDisplay();
    return;
  }

  timerTaskId = s.taskId;
  select.value = s.taskId;
  toggleBtn.disabled = false;

  if (s.running && s.startTimestamp) {
    timerRunning = true;
    timerStartTimestamp = s.startTimestamp;
    timerSeconds = Math.floor((Date.now() - timerStartTimestamp) / 1000);
    toggleBtn.textContent = "Pause";
    completeBtn.style.display = "inline-block";
    timerInterval = setInterval(syncTimerFromClock, 1000);
    syncTimerFromClock();
  } else {
    timerSeconds = s.seconds || timerBankedSeconds[s.taskId] || 0;
    toggleBtn.textContent = "Start";
    completeBtn.style.display = timerSeconds > 0 ? "inline-block" : "none";
  }
  updateTimerDisplay();
}

function reloadStateFromStorage() {
  tasks = loadTasks();
  sessions = loadJSON(SESSIONS_KEY, []);
  unlockedAchievements = loadJSON(ACHIEVEMENTS_KEY, {});
  categories = loadJSON(CATEGORIES_KEY, DEFAULT_CATEGORIES);
  priorityQueueOrder = loadJSON(PRIORITY_QUEUE_KEY, []);
  tasksCreatedCount = loadJSON(TASKS_CREATED_KEY, tasks.length);
  timerBankedSeconds = loadJSON(TIMER_BANK_KEY, {});
  templates = loadJSON(TEMPLATES_KEY, []);
  reviews = loadJSON(REVIEWS_KEY, {});
  prefs = { ...PREF_DEFAULTS, ...loadJSON(PREFS_KEY, {}) };
  renderAll();
  applyTaskTimerState();
}

window.addEventListener("storage", (e) => {
  if (e.key === TASK_TIMER_KEY) {
    applyTaskTimerState();
  } else if (e.key === FREE_TIMER_KEY) {
    const s = loadJSON(FREE_TIMER_KEY, null);
    freeTimer = (s && typeof s.accumulated === "number") ? s : { accumulated: 0, startedAt: null };
    clearInterval(freeTimerInterval);
    if (freeTimer.startedAt) startFreeTimerInterval();
    renderFreeTimer();
  } else if ([STORAGE_KEY, SESSIONS_KEY, ACHIEVEMENTS_KEY, CATEGORIES_KEY, PRIORITY_QUEUE_KEY, TASKS_CREATED_KEY, TIMER_BANK_KEY, TEMPLATES_KEY, REVIEWS_KEY, PREFS_KEY].includes(e.key) || e.key === null) {
    reloadStateFromStorage();
  }
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

  renderDailyBars(thisWeek.range);
}

function renderDailyBars(range) {
  const box = document.getElementById("daily-bars");
  if (!box) return;
  const today = todayStr();
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(range.start);
    d.setDate(d.getDate() + i);
    const ds = formatDate(d);
    const minutes = sessions.filter(x => x.date === ds).reduce((sum, x) => sum + (Number(x.minutes) || 0), 0);
    const done = tasks.filter(t => t.completed && t.completedOn === ds).length;
    days.push({ ds, label: labels[i], minutes, done });
  }
  const max = Math.max(60, ...days.map(d => d.minutes));
  const total = days.reduce((sum, d) => sum + d.minutes, 0);
  document.getElementById("daily-bars-total").textContent = total ? `${formatMinutesLabel(total)} this week` : "No time tracked yet this week";
  box.innerHTML = days.map(d => {
    const pct = Math.round((d.minutes / max) * 100);
    return `
      <div class="daily-bar-col${d.ds === today ? " is-today" : ""}${d.ds > today ? " is-future" : ""}" title="${d.ds}: ${formatMinutesLabel(d.minutes) === "0h" ? "0m" : formatMinutesLabel(d.minutes)} tracked, ${d.done} task${d.done === 1 ? "" : "s"} done">
        <span class="daily-bar-value">${d.minutes ? formatMinutesLabel(d.minutes) : ""}</span>
        <div class="daily-bar-track"><div class="daily-bar-fill" style="height:${d.minutes ? Math.max(pct, 4) : 0}%"></div></div>
        <span class="daily-bar-label">${d.label}</span>
        <span class="daily-bar-done">${d.done ? "✓" + d.done : ""}</span>
      </div>`;
  }).join("");
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

/* ===================== Upgrade: filters, quick add, undo, shortcuts, backup ===================== */
const COLLAPSED_KEY = "molly-panel-collapsed-v1";
const LAST_BACKUP_KEY = "molly-panel-last-backup-v1";
let collapsedGroups = new Set(loadJSON(COLLAPSED_KEY, []));
let searchTerm = "";
let statusFilter = "all";

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function addDaysStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

function nextWeekdayStr(idx) {
  const d = new Date();
  let diff = (idx - d.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

function computeDayStreak() {
  const today = todayStr();
  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < 90; i++) {
    const dateStr = formatDate(cursor);
    const due = tasks.filter(t => t.dueDate === dateStr);
    if (due.length > 0) {
      if (due.every(t => t.completed)) streak++;
      else if (dateStr !== today) break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/* ---------- undo ---------- */
function snapshotState() {
  return JSON.stringify({
    tasks, sessions, unlockedAchievements, categories,
    priorityQueueOrder, tasksCreatedCount, timerBankedSeconds, templates, reviews,
  });
}

function restoreSnapshot(json) {
  const s = JSON.parse(json);
  tasks = s.tasks || [];
  sessions = s.sessions || [];
  unlockedAchievements = s.unlockedAchievements || {};
  categories = s.categories || DEFAULT_CATEGORIES;
  priorityQueueOrder = s.priorityQueueOrder || [];
  tasksCreatedCount = typeof s.tasksCreatedCount === "number" ? s.tasksCreatedCount : tasks.length;
  timerBankedSeconds = s.timerBankedSeconds || {};
  if (s.templates) templates = s.templates;
  if (s.reviews) reviews = s.reviews;
  saveTasks(); saveSessions(); saveAchievements(); saveCategories();
  savePriorityQueue(); saveTasksCreatedCount(); saveTimerBank(); saveTemplates(); saveReviews();
  applyTaskTimerState();
  renderAll();
}

function showUndoToast(message, snapshotBefore) {
  const container = document.getElementById("toast-container");
  container.querySelectorAll(".toast-undo").forEach(t => t.remove());
  const toast = document.createElement("div");
  toast.className = "toast toast-info toast-undo";
  toast.innerHTML = `
    <div class="toast-icon"></div>
    <div>
      <div class="toast-title">Done</div>
      <div class="toast-name">${escapeHtml(message)}</div>
    </div>
    <button type="button" class="toast-undo-btn">Undo</button>
  `;
  toast.querySelector(".toast-undo-btn").addEventListener("click", () => {
    restoreSnapshot(snapshotBefore);
    toast.remove();
    showSimpleToast("Undone", "Everything is back the way it was.");
  });
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 8000);
}

function removeTasksAndRecord(ids) {
  const idSet = new Set(ids);
  tasks.filter(t => idSet.has(t.id) && t.recurringId).forEach(removed => {
    tasks.forEach(sib => {
      if (sib.recurringId === removed.recurringId && !idSet.has(sib.id)) {
        sib.recurringExcludedDates = sib.recurringExcludedDates || [];
        const gone = removed.recurringOrigDate || removed.dueDate;
        if (!sib.recurringExcludedDates.includes(gone)) sib.recurringExcludedDates.push(gone);
      }
    });
  });
  tasks = tasks.filter(t => !idSet.has(t.id));
  sessions = sessions.filter(s => !idSet.has(s.taskId));
  saveTasks();
  saveSessions();
}

/* ---------- search + status filter ---------- */
document.getElementById("task-search").addEventListener("input", (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  renderTasks();
});
document.getElementById("status-filter").addEventListener("change", (e) => {
  statusFilter = e.target.value;
  renderTasks();
});

/* ---------- quick add ---------- */
function parseQuickAdd(text) {
  const today = todayStr();
  const res = { title: "", category: null, categoryGuess: null, priority: "medium", dueDate: null, estimate: "" };
  let s = " " + text + " ";

  s = s.replace(/\snext week\s/i, () => { res.dueDate = nextWeekdayStr(1); return " "; });
  s = s.replace(/\sin (\d{1,3}) days?\s/i, (m, n) => { res.dueDate = addDaysStr(parseInt(n, 10)); return " "; });

  const kept = [];
  s.trim().split(/\s+/).filter(Boolean).forEach(tok => {
    const low = tok.toLowerCase();
    let m;
    if ((m = low.match(/^!(high|h|medium|med|m|low|l|ts|time|time-sensitive)$/))) {
      const k = m[1];
      res.priority = (k === "high" || k === "h") ? "high"
        : (k === "low" || k === "l") ? "low"
        : (k === "ts" || k === "time" || k === "time-sensitive") ? "time-sensitive"
        : "medium";
    } else if (tok.length > 1 && tok[0] === "#") {
      const q = low.slice(1);
      const cat = categories.find(c => c.name.toLowerCase() === q) || categories.find(c => c.name.toLowerCase().startsWith(q));
      if (cat) res.category = cat.name; else res.categoryGuess = tok.slice(1);
    } else if ((m = low.match(/^(\d+(?:\.\d+)?)(m|min|mins|h|hr|hrs)$/))) {
      const n = parseFloat(m[1]);
      res.estimate = String(Math.max(1, Math.round(m[2][0] === "h" ? n * 60 : n)));
    } else if (low === "today") {
      res.dueDate = today;
    } else if (low === "tomorrow" || low === "tmr" || low === "tmrw") {
      res.dueDate = addDaysStr(1);
    } else if (WEEKDAY_NAMES.includes(low)) {
      res.dueDate = nextWeekdayStr(WEEKDAY_NAMES.indexOf(low));
    } else if ((m = low.match(/^(\d{1,2})\/(\d{1,2})$/)) && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
      const now = new Date();
      let d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
      if (formatDate(d) < today) d = new Date(now.getFullYear() + 1, +m[1] - 1, +m[2]);
      res.dueDate = formatDate(d);
    } else {
      kept.push(tok);
    }
  });

  res.title = kept.join(" ").trim();
  return res;
}

function quickAddResolved(parsed) {
  return {
    ...parsed,
    category: parsed.category || (categories[0] && categories[0].name) || "Personal",
    dueDate: parsed.dueDate || selectedDate || todayStr(),
  };
}

function renderQuickAddPreview() {
  const box = document.getElementById("quick-add-preview");
  const text = document.getElementById("quick-add-input").value;
  if (!text.trim()) { box.innerHTML = ""; return; }
  const p = parseQuickAdd(text);
  const r = quickAddResolved(p);
  const chips = [];
  chips.push(`<span class="qa-chip qa-title">${p.title ? escapeHtml(p.title) : "&hellip;needs a title"}</span>`);
  chips.push(`<span class="qa-chip" style="border-color:${getCategoryColor(r.category)}">${escapeHtml(r.category)}</span>`);
  const info = dueLabelInfo({ dueDate: r.dueDate, completed: false });
  chips.push(`<span class="qa-chip">${info.text.replace(/^Due /, "")}</span>`);
  chips.push(`<span class="qa-chip">${(PRIORITY_META[r.priority] || PRIORITY_META.medium).label}</span>`);
  if (r.estimate) chips.push(`<span class="qa-chip">${r.estimate} min</span>`);
  if (p.categoryGuess) chips.push(`<span class="qa-chip qa-warn">no category “${escapeHtml(p.categoryGuess)}”</span>`);
  box.innerHTML = chips.join("");
}

document.getElementById("quick-add-input").addEventListener("input", renderQuickAddPreview);

document.getElementById("quick-add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("quick-add-input");
  const parsed = parseQuickAdd(input.value);
  if (!parsed.title) { input.focus(); return; }
  const r = quickAddResolved(parsed);
  const snap = snapshotState();
  tasks.push({
    id: uid(), title: r.title, category: r.category, priority: r.priority,
    estimate: r.estimate, link: "", notes: "", dueDate: r.dueDate, dueTime: "",
    completed: false, completedOn: null, status: "not-started",
  });
  tasksCreatedCount++;
  saveTasks();
  saveTasksCreatedCount();
  input.value = "";
  renderQuickAddPreview();
  renderAll();
  checkAchievements();
  showUndoToast(`Added “${r.title}”`, snap);
  input.focus();
});

/* ---------- date quick picks in the task modal ---------- */
document.getElementById("date-quick").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-qd]");
  if (!b) return;
  const v = b.dataset.qd;
  document.getElementById("task-due-date").value =
    v === "none" ? "" : v === "mon" ? nextWeekdayStr(1) : addDaysStr(parseInt(v, 10));
});

/* ---------- priority queue helpers ---------- */
document.getElementById("pq-auto-sort").addEventListener("click", () => {
  const order = { high: 0, "time-sensitive": 1, medium: 2, low: 3 };
  const byId = new Map(tasks.map(t => [t.id, t]));
  priorityQueueOrder.sort((a, b) => {
    const ta = byId.get(a), tb = byId.get(b);
    if (!ta || !tb) return 0;
    const pa = order[ta.priority] ?? 9, pb = order[tb.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return (ta.dueDate || "9999").localeCompare(tb.dueDate || "9999");
  });
  savePriorityQueue();
  renderPriorityQueue();
  populateTimerTaskSelect();
  showSimpleToast("Queue sorted", "High priority and oldest due dates first.");
});

function startTimerForTask(id) {
  switchTab("pomodoro");
  document.querySelector('.timer-mode-btn[data-timer-mode="task"]').click();
  const sel = document.getElementById("pomodoro-task-select");
  if (!Array.from(sel.options).some(o => o.value === id)) return;
  if (timerTaskId !== id) {
    sel.value = id;
    sel.dispatchEvent(new Event("change"));
  }
  if (!timerRunning) document.getElementById("timer-toggle").click();
}

function switchTab(name) {
  const btn = document.querySelector(`.tab[data-tab="${name}"]`);
  if (btn) btn.click();
}

/* ---------- settings + backup ---------- */
function backupAgeDays() {
  const last = localStorage.getItem(LAST_BACKUP_KEY);
  if (!last) return null;
  return Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
}

function updateBackupStatus() {
  const age = backupAgeDays();
  const el = document.getElementById("backup-status");
  el.textContent = age === null
    ? "You haven't exported a backup yet. A backup file lets you restore everything if a browser clears its data."
    : age === 0 ? "Last backup: today." : `Last backup: ${age} day${age === 1 ? "" : "s"} ago.`;
  const stale = tasks.length > 0 && (age === null || age > 14);
  document.getElementById("settings-dot").style.display = stale ? "block" : "none";
}

function openSettings() {
  updateBackupStatus();
  renderTemplatesList();
  document.getElementById("settings-overlay").classList.add("open");
}
function closeSettings() {
  document.getElementById("settings-overlay").classList.remove("open");
  resetImportUI();
}

document.getElementById("open-settings").addEventListener("click", openSettings);
document.getElementById("settings-close").addEventListener("click", closeSettings);
document.getElementById("settings-overlay").addEventListener("click", (e) => {
  if (e.target.id === "settings-overlay") closeSettings();
});

function markBackupDone() {
  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  updateBackupStatus();
  if (typeof renderMoveBanner === "function") renderMoveBanner();
}

async function exportBackup() {
  const payload = {
    app: "molly-panel", version: 1, exportedAt: new Date().toISOString(),
    data: { tasks, sessions, unlockedAchievements, categories, priorityQueueOrder, tasksCreatedCount, timerBankedSeconds, templates, reviews },
  };
  const json = JSON.stringify(payload, null, 2);
  const filename = `molly-panel-backup-${todayStr()}.json`;
  const fallback = document.getElementById("backup-fallback");
  const showFallback = () => {
    fallback.value = json;
    fallback.style.display = "block";
    const note = document.getElementById("import-note");
    note.textContent = "A download couldn't start here. Copy the text below and save it as a .json file.";
    note.style.display = "block";
  };
  fallback.style.display = "none";
  try {
    if (window.claude && typeof window.claude.use === "function") {
      const dl = await window.claude.use("downloads");
      if (!dl) { showFallback(); return; }
      await dl.save({ filename, data: json });
      markBackupDone();
      showSimpleToast("Backup saved", `${tasks.length} tasks and ${sessions.length} sessions exported.`);
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    markBackupDone();
    showSimpleToast("Backup saved", `${tasks.length} tasks and ${sessions.length} sessions exported.`);
  } catch (err) {
    if (err && err.code === "declined") return;
    showFallback();
  }
}

let pendingImport = null;

function resetImportUI() {
  pendingImport = null;
  document.getElementById("import-backup-btn").textContent = "Import backup";
  const note = document.getElementById("import-note");
  note.style.display = "none";
  note.textContent = "";
  document.getElementById("import-backup-file").value = "";
}

function mergeById(current, incoming) {
  const have = new Set(current.map(x => x.id));
  return current.concat((incoming || []).filter(x => x && !have.has(x.id)));
}

function applyImport(data, merge) {
  const snap = snapshotState();
  let summaryMsg;
  if (merge) {
    const beforeTasks = tasks.length;
    tasks = mergeById(tasks, Array.isArray(data.tasks) ? data.tasks : []);
    sessions = mergeById(sessions, Array.isArray(data.sessions) ? data.sessions : []);
    const incomingAch = data.unlockedAchievements && typeof data.unlockedAchievements === "object" ? data.unlockedAchievements : {};
    unlockedAchievements = { ...incomingAch, ...unlockedAchievements };
    (Array.isArray(data.categories) ? data.categories : []).forEach(c => {
      if (c && c.name && !categories.some(x => x.name === c.name)) categories.push(c);
    });
    templates = mergeById(templates, Array.isArray(data.templates) ? data.templates : []);
    reviews = { ...(data.reviews && typeof data.reviews === "object" ? data.reviews : {}), ...reviews };
    timerBankedSeconds = { ...(data.timerBankedSeconds || {}), ...timerBankedSeconds };
    tasksCreatedCount = Math.max(tasksCreatedCount, typeof data.tasksCreatedCount === "number" ? data.tasksCreatedCount : 0, tasks.length);
    summaryMsg = `Merged in ${tasks.length - beforeTasks} new tasks`;
  } else {
    tasks = Array.isArray(data.tasks) ? data.tasks : [];
    sessions = Array.isArray(data.sessions) ? data.sessions : [];
    unlockedAchievements = data.unlockedAchievements && typeof data.unlockedAchievements === "object" ? data.unlockedAchievements : {};
    categories = Array.isArray(data.categories) && data.categories.length ? data.categories : DEFAULT_CATEGORIES;
    priorityQueueOrder = Array.isArray(data.priorityQueueOrder) ? data.priorityQueueOrder : [];
    tasksCreatedCount = typeof data.tasksCreatedCount === "number" ? data.tasksCreatedCount : tasks.length;
    timerBankedSeconds = data.timerBankedSeconds && typeof data.timerBankedSeconds === "object" ? data.timerBankedSeconds : {};
    templates = Array.isArray(data.templates) ? data.templates : [];
    reviews = data.reviews && typeof data.reviews === "object" ? data.reviews : {};
    summaryMsg = `Imported ${tasks.length} tasks and ${sessions.length} sessions`;
  }
  saveTasks(); saveSessions(); saveAchievements(); saveCategories();
  savePriorityQueue(); saveTasksCreatedCount(); saveTimerBank(); saveTemplates(); saveReviews();
  applyTaskTimerState();
  renderAll();
  checkAchievements();
  closeSettings();
  showUndoToast(summaryMsg, snap);
}

document.getElementById("export-backup-btn").addEventListener("click", exportBackup);

document.getElementById("import-backup-btn").addEventListener("click", () => {
  if (pendingImport) {
    const data = pendingImport;
    const merge = document.getElementById("import-merge").checked;
    resetImportUI();
    applyImport(data, merge);
    return;
  }
  document.getElementById("import-backup-file").click();
});

document.getElementById("import-backup-file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  const note = document.getElementById("import-note");
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      const data = obj && obj.data ? obj.data : obj;
      if (!data || !Array.isArray(data.tasks)) throw new Error("not a backup");
      pendingImport = data;
      note.textContent = `Found ${data.tasks.length} tasks and ${(data.sessions || []).length} sessions. Click “Confirm import” to ${document.getElementById("import-merge").checked ? "add anything new to" : "replace everything on"} this device (you can undo right after).`;
      note.style.display = "block";
      document.getElementById("import-backup-btn").textContent = "Confirm import";
    } catch (err) {
      pendingImport = null;
      note.textContent = "That file doesn't look like a Molly's Panel backup.";
      note.style.display = "block";
    }
  };
  reader.readAsText(file);
});

/* ---------- keyboard shortcuts ---------- */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Escape") {
    if (document.getElementById("focus-overlay").classList.contains("open")) closeFocus();
    else if (document.getElementById("palette-overlay").classList.contains("open")) closePalette();
    else if (document.getElementById("review-overlay").classList.contains("open")) closeReview();
    else if (document.getElementById("settings-overlay").classList.contains("open")) closeSettings();
    else if (overlay.classList.contains("open")) closeModal();
    return;
  }
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
  if (document.querySelector(".modal-overlay.open")) return;
  switch (e.key) {
    case "n": e.preventDefault(); openModal(); break;
    case "q": e.preventDefault(); switchTab("workspace"); document.getElementById("quick-add-input").focus(); break;
    case "/": e.preventDefault(); switchTab("workspace"); document.getElementById("task-search").focus(); break;
    case "1": switchTab("workspace"); break;
    case "2": switchTab("pomodoro"); break;
    case "3": switchTab("achievements"); break;
    case "w": switchTab("week"); break;
    case "f": e.preventDefault(); openFocus(); break;
    case "?": e.preventDefault(); openSettings(); break;
  }
});

updateBackupStatus();

/* ---------- move-to-Artifact banner ---------- */
const ARTIFACT_URL = "https://claude.ai/artifact/UB1FRKUtSHMCskt4t1YzJP";
const MIGRATED_KEY = "molly-panel-migrated-v1";
const STANDALONE_URL = "https://mollynotloopy.github.io/workspace-panel/";
const STANDALONE_READY = false;

function renderMoveBanner() {
  const banner = document.getElementById("move-banner");
  if (!banner) return;
  const text = document.getElementById("move-banner-text");
  const actions = document.getElementById("move-banner-actions");
  actions.innerHTML = "";
  const dismissed = localStorage.getItem(MIGRATED_KEY) === "1";
  if (!(window.claude && STANDALONE_READY) || dismissed) {
    banner.style.display = "none";
    return;
  }
  banner.style.display = "flex";
  text.innerHTML = `<strong>Your panel has a new home.</strong> The standalone site works in any browser and syncs when you sign in with Google. This Claude copy keeps working, but it no longer syncs with the new site.`;
  const open = document.createElement("button");
  open.type = "button";
  open.className = "btn-primary";
  open.textContent = "Open the new site";
  open.addEventListener("click", () => window.open(STANDALONE_URL, "_blank", "noopener"));
  actions.appendChild(open);
  const hide = document.createElement("button");
  hide.type = "button";
  hide.className = "btn-secondary";
  hide.textContent = "Dismiss";
  hide.addEventListener("click", () => { localStorage.setItem(MIGRATED_KEY, "1"); renderMoveBanner(); });
  actions.appendChild(hide);
}
renderMoveBanner();

/* ===================== Upgrade 2: checklists, templates, day budget, weekly review ===================== */
const expandedTasks = new Set();
let modalSubtasks = [];

function cleanSubtasks(arr, fresh) {
  return (arr || [])
    .filter(x => x && String(x.text || "").trim())
    .map(x => {
      const o = { id: fresh ? uid() : (x.id || uid()), text: String(x.text).trim(), done: fresh ? false : !!x.done };
      if (!fresh && x.day && /^\d{4}-\d{2}-\d{2}$/.test(x.day)) o.day = x.day;
      if (!fresh && Number(x.minutes) > 0) o.minutes = Math.round(Number(x.minutes));
      return o;
    });
}

// days a step can be assigned to, based on the form's start/due dates
function stepDayOptions(current) {
  const start = document.getElementById("task-start-date").value;
  const due = document.getElementById("task-due-date").value;
  const from = start || due || todayStr();
  const to = due || dateShift(from, 6);
  const out = [];
  if (from <= to) {
    for (let d = from, n = 0; d <= to && n < 45; d = dateShift(d, 1), n++) out.push(d);
  }
  if (current && !out.includes(current)) out.push(current);
  return out.sort();
}

let stepDragFrom = null;
function renderSubtaskEditor() {
  const box = document.getElementById("subtask-editor");
  box.innerHTML = "";
  modalSubtasks.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = "subtask-row";
    row.innerHTML = `
      <span class="sub-grip" draggable="true" title="Drag to reorder">&#8942;&#8942;</span>
      <span class="sub-box${step.done ? " done" : ""}" title="Mark step done">&#10003;</span>
      <input type="text" value="${escapeAttr(step.text)}" maxlength="120" />
      <input type="number" class="sub-min" min="0" max="960" step="5" placeholder="min" title="Minutes for this step" value="${step.minutes || ""}" />
      <select class="sub-day" title="Day to work on this step"></select>
      <button type="button" class="sub-del" title="Remove step">&times;</button>
    `;
    const grip = row.querySelector(".sub-grip");
    grip.addEventListener("dragstart", (e) => {
      stepDragFrom = i; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", "step"); e.dataTransfer.setDragImage(row, 12, 12); } catch (_) {}
    });
    grip.addEventListener("dragend", () => { stepDragFrom = null; box.querySelectorAll(".dragging,.drag-over").forEach(r => r.classList.remove("dragging", "drag-over")); });
    row.addEventListener("dragover", (e) => { if (stepDragFrom != null) { e.preventDefault(); row.classList.add("drag-over"); } });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = stepDragFrom; stepDragFrom = null;
      if (from == null || from === i) { renderSubtaskEditor(); return; }
      const [m] = modalSubtasks.splice(from, 1);
      modalSubtasks.splice(i, 0, m);
      renderSubtaskEditor();
    });
    const daySel = row.querySelector(".sub-day");
    const fillDays = () => {
      daySel.innerHTML = `<option value="">Any day</option>` + stepDayOptions(step.day).map(d =>
        `<option value="${d}"${d === step.day ? " selected" : ""}>${new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</option>`).join("");
    };
    fillDays();
    daySel.addEventListener("mousedown", fillDays);
    daySel.addEventListener("change", () => { if (daySel.value) step.day = daySel.value; else delete step.day; syncDayPlanFromSteps(); });
    const minInput = row.querySelector(".sub-min");
    minInput.addEventListener("input", () => {
      const v = parseInt(minInput.value, 10);
      if (v > 0) step.minutes = v; else delete step.minutes;
      syncEstimateFromSteps();
      syncDayPlanFromSteps();
    });
    row.querySelector(".sub-box").addEventListener("click", () => {
      step.done = !step.done;
      renderSubtaskEditor();
    });
    const input = row.querySelector("input");
    input.addEventListener("input", () => { step.text = input.value; });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); document.getElementById("subtask-new").focus(); }
    });
    row.querySelector(".sub-del").addEventListener("click", () => {
      modalSubtasks.splice(i, 1);
      renderSubtaskEditor();
      syncEstimateFromSteps();
      syncDayPlanFromSteps();
    });
    box.appendChild(row);
  });
  updateBigProgress();
}

["task-start-date", "task-due-date"].forEach(id => {
  document.getElementById(id).addEventListener("change", () => { if (modalSubtasks.length) renderSubtaskEditor(); offerRespread(); });
});
document.getElementById("start-clear").addEventListener("click", () => { if (modalSubtasks.length) renderSubtaskEditor(); offerRespread(); });

function addSubtaskFromInput() {
  const input = document.getElementById("subtask-new");
  const text = input.value.trim();
  if (!text) return;
  modalSubtasks.push({ id: uid(), text, done: false });
  input.value = "";
  renderSubtaskEditor();
  updateEstimateTools();
  input.focus();
}
document.getElementById("subtask-add-btn").addEventListener("click", addSubtaskFromInput);
document.getElementById("subtask-new").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addSubtaskFromInput(); }
});

/* ---------- templates ---------- */
function populateTemplateSelects() {
  ["template-select", "quick-template-select"].forEach(id => {
    const sel = document.getElementById(id);
    const first = sel.options[0].cloneNode(true);
    sel.innerHTML = "";
    sel.appendChild(first);
    templates.forEach(tpl => {
      const opt = document.createElement("option");
      opt.value = tpl.id;
      opt.textContent = tpl.name;
      sel.appendChild(opt);
    });
    sel.style.display = (id === "quick-template-select" && templates.length === 0) ? "none" : "";
  });
}

function renderTemplatesList() {
  const box = document.getElementById("templates-list");
  if (!box) return;
  if (templates.length === 0) {
    box.innerHTML = `<p class="settings-note">No templates yet.</p>`;
    return;
  }
  box.innerHTML = "";
  templates.forEach(tpl => {
    const row = document.createElement("div");
    row.className = "template-item";
    const steps = (tpl.subtasks || []).length;
    row.innerHTML = `
      <span class="template-name">${escapeHtml(tpl.name)}</span>
      <span class="template-meta">${escapeHtml(tpl.category || "")}${tpl.estimate ? " · " + tpl.estimate + " min" : ""}${steps ? " · " + steps + " steps" : ""}</span>
      <button type="button" class="sub-del" title="Delete template">&times;</button>
    `;
    row.querySelector(".sub-del").addEventListener("click", () => {
      templates = templates.filter(x => x.id !== tpl.id);
      saveTemplates();
      populateTemplateSelects();
      renderTemplatesList();
    });
    box.appendChild(row);
  });
}

function categoryOrDefault(name) {
  return categories.some(c => c.name === name) ? name : ((categories[0] && categories[0].name) || "Personal");
}

document.getElementById("save-template-btn").addEventListener("click", () => {
  const title = document.getElementById("task-title").value.trim();
  if (!title) {
    showSimpleToast("Add a title first", "A template uses the task title as its name.");
    return;
  }
  const tpl = {
    id: uid(), name: title, title,
    category: document.getElementById("task-category").value,
    priority: document.getElementById("task-priority").value,
    estimate: document.getElementById("task-estimate").value,
    link: document.getElementById("task-link").value.trim(),
    notes: document.getElementById("task-notes").value.trim(),
    subtasks: cleanSubtasks(modalSubtasks, true).map(x => x.text),
  };
  const at = templates.findIndex(x => x.name.toLowerCase() === title.toLowerCase());
  if (at >= 0) { tpl.id = templates[at].id; templates[at] = tpl; } else templates.push(tpl);
  saveTemplates();
  populateTemplateSelects();
  renderTemplatesList();
  showSimpleToast("Template saved", `“${title}” is now under Templates.`);
});

document.getElementById("template-select").addEventListener("change", (e) => {
  const tpl = templates.find(x => x.id === e.target.value);
  if (!tpl) return;
  document.getElementById("task-title").value = tpl.title || tpl.name;
  document.getElementById("task-category").value = categoryOrDefault(tpl.category);
  document.getElementById("task-priority").value = tpl.priority || "medium";
  document.getElementById("task-estimate").value = tpl.estimate || "";
  document.getElementById("task-link").value = tpl.link || "";
  document.getElementById("task-notes").value = tpl.notes || "";
  modalSubtasks = (tpl.subtasks || []).map(text => ({ id: uid(), text, done: false }));
  renderSubtaskEditor();
});

document.getElementById("quick-template-select").addEventListener("change", (e) => {
  const tpl = templates.find(x => x.id === e.target.value);
  e.target.value = "";
  if (!tpl) return;
  const snap = snapshotState();
  const task = {
    id: uid(), title: tpl.title || tpl.name, category: categoryOrDefault(tpl.category),
    priority: tpl.priority || "medium", estimate: tpl.estimate || "", link: tpl.link || "",
    notes: tpl.notes || "", dueDate: selectedDate || todayStr(), dueTime: "",
    completed: false, completedOn: null, status: "not-started",
  };
  const steps = (tpl.subtasks || []).map(text => ({ id: uid(), text, done: false }));
  if (steps.length) task.subtasks = steps;
  tasks.push(task);
  tasksCreatedCount++;
  saveTasks();
  saveTasksCreatedCount();
  renderAll();
  checkAchievements();
  showUndoToast(`Added “${task.title}” from a template`, snap);
});

/* ---------- day budget ---------- */
function pushToTomorrow(list) {
  const snap = snapshotState();
  const tomorrow = addDaysStr(1);
  list.forEach(t => {
    if (t.recurringId) markOccurrenceOverrides(t, { ...t, dueDate: tomorrow });
    t.dueDate = tomorrow;
  });
  saveTasks();
  renderAll();
  showUndoToast(`Pushed ${list.length} task${list.length === 1 ? "" : "s"} to tomorrow`, snap);
}

document.getElementById("day-budget-hours").addEventListener("change", (e) => {
  let v = parseFloat(e.target.value);
  if (!(v > 0)) v = 6;
  v = Math.min(16, Math.max(0.5, v));
  localStorage.setItem(BUDGET_KEY, JSON.stringify(v));
  e.target.value = v;
  renderPriorityQueue();
});

/* ---------- weekly review ---------- */
let reviewWeekOffset = 0;
let reviewSaveTimer = null;

function weekKeyFor(offset) {
  return formatDate(getWeekRange(offset).start);
}

function openReview(offset) {
  reviewWeekOffset = offset;
  const key = weekKeyFor(offset);
  reviews[key] = { ...(reviews[key] || {}), seen: true };
  saveReviews();
  document.getElementById("review-overlay").classList.add("open");
  renderReview();
  renderReviewNudge();
}

function closeReview() {
  document.getElementById("review-overlay").classList.remove("open");
}

function renderReview() {
  document.querySelectorAll("[data-review-week]").forEach(b =>
    b.classList.toggle("active", parseInt(b.dataset.reviewWeek, 10) === reviewWeekOffset));
  const range = getWeekRange(reviewWeekOffset);
  const startStr = formatDate(range.start);
  const endStr = formatDate(range.end);
  const today = todayStr();
  const key = startStr;
  const fm = m => (m ? formatMinutesLabel(m) : "0m");
  const nextMonday = (() => { const d = new Date(range.end); d.setDate(d.getDate() + 1); return formatDate(d); })();
  const nextSunday = (() => { const d = new Date(range.end); d.setDate(d.getDate() + 7); return formatDate(d); })();
  const label = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const doneTasks = tasks.filter(t => t.completed && t.completedOn && t.completedOn >= startStr && t.completedOn <= endStr);
  const weekSessions = sessions.filter(x => x.date >= startStr && x.date <= endStr);
  const minutes = weekSessions.reduce((sum, x) => sum + (Number(x.minutes) || 0), 0);
  const byCat = {};
  weekSessions.forEach(x => { byCat[x.category] = (byCat[x.category] || 0) + (Number(x.minutes) || 0); });
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  const byDay = {};
  weekSessions.forEach(x => { byDay[x.date] = (byDay[x.date] || 0) + (Number(x.minutes) || 0); });
  const bestDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  const withDue = doneTasks.filter(t => t.dueDate);
  const onTime = withDue.filter(t => t.completedOn <= t.dueDate).length;
  const onTimePct = withDue.length ? Math.round((onTime / withDue.length) * 100) : null;

  const cutoff = endStr < today ? endStr : today;
  const slipped = tasks.filter(t => !t.completed && t.dueDate && t.dueDate >= startStr && t.dueDate <= cutoff);
  const movable = slipped.filter(t => !t.recurringId);
  const missedRecurring = slipped.filter(t => t.recurringId);
  const nextWeek = tasks.filter(t => !t.completed && t.dueDate && t.dueDate >= nextMonday && t.dueDate <= nextSunday);
  const nextMinutes = nextWeek.reduce((sum, t) => sum + (Number(t.estimate) || 0), 0);
  const nextByDay = {};
  nextWeek.forEach(t => { nextByDay[t.dueDate] = (nextByDay[t.dueDate] || 0) + 1; });
  const busiest = Object.entries(nextByDay).sort((a, b) => b[1] - a[1])[0];

  const body = document.getElementById("review-body");
  body.innerHTML = `
    <p class="review-range">${label(startStr)} – ${label(endStr)}</p>
    <div class="review-stats">
      <div><strong>${doneTasks.length}</strong><span>tasks done</span></div>
      <div><strong>${fm(minutes)}</strong><span>tracked</span></div>
      <div><strong>${onTimePct === null ? "–" : onTimePct + "%"}</strong><span>on time</span></div>
      <div><strong>${bestDay ? new Date(bestDay[0] + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" }) : "–"}</strong><span>best day${bestDay ? " (" + fm(bestDay[1]) + ")" : ""}</span></div>
    </div>
    ${topCat ? `<p class="review-line">Most time went to <strong>${escapeHtml(topCat[0])}</strong> (${fm(topCat[1])}).</p>` : ""}

    <h3>Wins</h3>
    ${doneTasks.length ? `<ul class="review-list">${doneTasks.slice(0, 8).map(t => `<li>${escapeHtml(t.title)}</li>`).join("")}${doneTasks.length > 8 ? `<li class="review-more">+ ${doneTasks.length - 8} more</li>` : ""}</ul>` : `<p class="review-line">Nothing completed yet this week.</p>`}

    <h3>Slipped (${slipped.length})</h3>
    ${slipped.length ? `<ul class="review-list">${slipped.slice(0, 10).map(t => `<li>${escapeHtml(t.title)} <span class="review-due">due ${label(t.dueDate)}</span></li>`).join("")}${slipped.length > 10 ? `<li class="review-more">+ ${slipped.length - 10} more</li>` : ""}</ul>
      <div class="review-actions">
        ${movable.length ? `<button type="button" class="btn-primary" id="review-carry">Carry ${movable.length} to ${label(nextMonday)}</button>` : ""}
        ${missedRecurring.length ? `<button type="button" class="btn-secondary" id="review-skip">Skip ${missedRecurring.length} missed recurring</button>` : ""}
      </div>` : `<p class="review-line">Nothing slipped. Nice.</p>`}

    <h3>Next week</h3>
    <p class="review-line">${nextWeek.length ? `${nextWeek.length} task${nextWeek.length === 1 ? "" : "s"} due, about ${fm(nextMinutes)} estimated${busiest ? `. Busiest day: ${new Date(busiest[0] + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" })} (${busiest[1]})` : ""}.` : "Nothing scheduled yet."}</p>

    <h3>Reflection</h3>
    <textarea id="review-notes" rows="4" placeholder="What went well? What will you change next week?">${escapeHtml((reviews[key] && reviews[key].text) || "")}</textarea>
  `;

  const carry = document.getElementById("review-carry");
  if (carry) carry.addEventListener("click", () => {
    const snap = snapshotState();
    movable.forEach(t => { t.dueDate = nextMonday; });
    saveTasks();
    renderAll();
    renderReview();
    showUndoToast(`Carried ${movable.length} task${movable.length === 1 ? "" : "s"} to ${label(nextMonday)}`, snap);
  });
  const skip = document.getElementById("review-skip");
  if (skip) skip.addEventListener("click", () => {
    const snap = snapshotState();
    removeTasksAndRecord(missedRecurring.map(t => t.id));
    renderAll();
    renderReview();
    showUndoToast(`Skipped ${missedRecurring.length} missed recurring task${missedRecurring.length === 1 ? "" : "s"}`, snap);
  });
  document.getElementById("review-notes").addEventListener("input", (e) => {
    clearTimeout(reviewSaveTimer);
    const text = e.target.value;
    reviewSaveTimer = setTimeout(() => {
      reviews[key] = { ...(reviews[key] || {}), text, seen: true, savedAt: new Date().toISOString() };
      saveReviews();
    }, 400);
  });
}

function renderReviewNudge() {
  const nudge = document.getElementById("review-nudge");
  if (!nudge) return;
  const day = new Date().getDay();
  const offset = day === 0 ? 0 : day === 1 ? -1 : null;
  const key = offset === null ? null : weekKeyFor(offset);
  const show = key !== null && !(reviews[key] && reviews[key].seen);
  nudge.style.display = show ? "inline-block" : "none";
  nudge.dataset.offset = offset === null ? "0" : String(offset);
}

document.getElementById("open-review").addEventListener("click", () => openReview(new Date().getDay() === 1 ? -1 : 0));
document.getElementById("review-nudge").addEventListener("click", (e) => openReview(parseInt(e.currentTarget.dataset.offset, 10) || 0));
document.getElementById("review-close").addEventListener("click", closeReview);
document.getElementById("review-overlay").addEventListener("click", (e) => { if (e.target.id === "review-overlay") closeReview(); });
document.querySelectorAll("[data-review-week]").forEach(btn => {
  btn.addEventListener("click", () => { reviewWeekOffset = parseInt(btn.dataset.reviewWeek, 10); renderReview(); });
});

/* ===================== Week plan ===================== */
let weekOffset = 0;

function openStepFor(t, today) {
  // first unfinished step planned for today or earlier
  return (t.subtasks || []).find(x => !x.done && x.day && x.day <= today) || null;
}
function isWorkableToday(t, today) {
  if (t.completed || t.archived) return false;
  if (!t.dueDate) return !!openStepFor(t, today);
  if (t.dueDate <= today) return true;
  if (openStepFor(t, today)) return true;
  return !!(t.startDate && t.startDate <= today);
}

function readStartDate(dueDate) {
  const start = document.getElementById("task-start-date").value;
  if (!start) return "";
  if (dueDate && start > dueDate) {
    showSimpleToast("Start date moved", "Start was after the due date, so it was cleared.");
    return "";
  }
  return start;
}

document.getElementById("start-clear").addEventListener("click", () => {
  document.getElementById("task-start-date").value = "";
});

function dateShift(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

function autoPlanTask(t) {
  const snap = snapshotState();
  const open = (t.subtasks || []).filter(x => !x.done);
  if (!open.length) return;
  const today = todayStr();
  const doneMin = (t.subtasks || []).filter(x => x.done).reduce((a, x) => a + (Number(x.minutes) || 0), 0);
  const have = open.reduce((a, x) => a + (Number(x.minutes) || 0), 0);
  const total = Number(t.estimate) || have;
  // 1. minutes per step (keep ones already set, split what's left evenly across the rest)
  const blank = open.filter(x => !(Number(x.minutes) > 0));
  if (blank.length) {
    const left = Math.max(5 * blank.length, total - doneMin - have);
    const each = Math.max(5, Math.floor(left / blank.length / 5) * 5);
    blank.forEach((x, i) => { x.minutes = i === blank.length - 1 ? Math.max(5, left - each * (blank.length - 1)) : each; });
  }
  // 2. days: spread steps without a day across the remaining window
  const from = t.startDate > today ? t.startDate : today;
  const days = [];
  for (let d = from < t.dueDate ? from : t.startDate, n = 0; d <= t.dueDate && n < 60; d = dateShift(d, 1), n++) days.push(d);
  const free = open.filter(x => !x.day);
  free.forEach((x, i) => { x.day = days[Math.min(days.length - 1, Math.floor(i * days.length / free.length))]; });
  // 3. per-day minutes follow the steps, total follows the steps
  const dm = {};
  (t.subtasks || []).forEach(x => { if (x.day && Number(x.minutes) > 0) dm[x.day] = (dm[x.day] || 0) + Number(x.minutes); });
  if (Object.keys(dm).length) t.dayMinutes = dm;
  t.estimate = (t.subtasks || []).reduce((a, x) => a + (Number(x.minutes) || 0), 0) || t.estimate;
  saveTasks();
  renderAll();
  showUndoToast(`Planned “${t.title}”: ${open.length} steps across ${days.length} days`, snap);
}

function renderWeek() {
  const panel = document.getElementById("week");
  if (!panel) return;
  syncWeekControls();
  if (weekView.mode === "month") { renderMonth(); return; }
  const range = getWeekRange(weekOffset);
  const startStr = formatDate(range.start);
  const days = Array.from({ length: 7 }, (_, i) => dateShift(startStr, i));
  const endStr = days[6];
  const today = todayStr();
  const fmt = (d, o) => new Date(d + "T12:00:00").toLocaleDateString(undefined, o);

  const capInput = document.getElementById("week-capacity");
  if (document.activeElement !== capInput) capInput.value = weekCapacityHours();
  document.getElementById("week-range-label").textContent =
    `${fmt(startStr, { month: "short", day: "numeric" })} – ${fmt(endStr, { month: "short", day: "numeric" })}` +
    (weekOffset === 0 ? " · this week" : weekOffset === 1 ? " · next week" : weekOffset === -1 ? " · last week" : "");

  // header strip
  const strip = document.getElementById("week-daybar");
  strip.innerHTML = days.map(d =>
    `<div class="week-dayhead${d === today ? " is-today" : ""}"><strong>${fmt(d, { weekday: "short" })}</strong><span>${fmt(d, { month: "short", day: "numeric" })}</span></div>`
  ).join("");

  // multi-day bars
  renderWeekSummary(days, today);
  const span = tasks.filter(t => weekVisible(t) && t.startDate && t.dueDate && t.startDate < t.dueDate && t.startDate <= endStr && t.dueDate >= startStr);
  span.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.dueDate.localeCompare(b.dueDate));
  const bars = document.getElementById("week-bars");
  bars.innerHTML = "";
  document.getElementById("week-bars-empty").style.display = span.length ? "none" : "block";
  span.forEach(t => {
    const i0 = Math.max(0, days.indexOf(t.startDate < startStr ? startStr : t.startDate));
    const i1 = days.indexOf(t.dueDate > endStr ? endStr : t.dueDate);
    const color = getCategoryColor(t.category);
    const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
    const subsDone = subs.filter(x => x.done).length;
    const bst = !t.completed && subs.length ? bigStatsFor(subs) : null;
    const bar = document.createElement("button");
    bar.type = "button";
    bar.className = "week-bar" + (t.completed ? " is-done" : "") +
      (t.startDate < startStr ? " cut-left" : "") + (t.dueDate > endStr ? " cut-right" : "");
    bar.style.gridColumn = `${i0 + 1} / ${i1 + 2}`;
    bar.style.borderColor = color;
    bar.style.background = `linear-gradient(90deg, ${color}33, ${color}1a)`;
    bar.title = `${t.title}: start ${t.startDate}, due ${t.dueDate}`;
    const sumSteps = subs.reduce((a, x) => a + (Number(x.minutes) || 0), 0);
    const total = Number(t.estimate) || sumSteps;
    const needsPlan = !t.completed && subs.some(x => !x.done && (!x.day || !x.minutes)) && total > 0;
    bar.innerHTML = `
      <span class="week-bar-title">${escapeHtml(t.title)}</span>
      <span class="week-bar-meta">${subs.length ? `&#9745; ${subsDone}/${subs.length} · ` : ""}due ${fmt(t.dueDate, { weekday: "short" })}${total ? " · <b>total " + formatMinutesLabel(total) + "</b>" : ""}${t.dayMinutes && t.dayMinutes[today] > 0 ? " · " + formatMinutesLabel(t.dayMinutes[today]) + " today" : ""}${t.completed && subs.some(x => !x.done) ? ` · <span class="week-catchup week-reopen" role="button" title="This task was marked complete but has unfinished steps">Reopen</span>` : ""}${bst ? ` · ${bst.pct}% · <span class="week-state ${bst.state}">${bigStateLabel(bst)}</span>` : ""}${bst && bst.state === "behind" ? ` · <span class="week-catchup" role="button" title="Move missed steps onto the lightest upcoming days">Catch up</span>` : ""}${needsPlan ? ` · <span class="week-autoplan" role="button" title="Split the total across the steps and spread the steps over the days">Auto-plan steps</span>` : ""}</span>${bst ? `<i class="week-bar-prog" style="width:${bst.pct}%"></i>` : ""}`;
    const ro = bar.querySelector(".week-reopen");
    if (ro) ro.addEventListener("click", (e) => { e.stopPropagation(); t.completed = false; t.status = "ongoing"; t.completedOn = null; t.completedAt = null; saveTasks(); renderAll(); });
    const cu = bar.querySelector(".week-catchup:not(.week-reopen)");
    if (cu) cu.addEventListener("click", (e) => { e.stopPropagation(); catchUpTask(t); });
    const ap = bar.querySelector(".week-autoplan");
    if (ap) ap.addEventListener("click", (e) => { e.stopPropagation(); autoPlanTask(t); });
    bar.addEventListener("click", () => openModal(t.id));
    bars.appendChild(bar);
  });

  // day columns
  const box = document.getElementById("week-days");
  box.innerHTML = "";
  days.forEach(d => {
    const due = tasks.filter(t => weekVisible(t) && (t.dueDate === d || (t.completed && t.completedOn === d && t.dueDate !== d)));
    const open = due.filter(t => !t.completed);
    const mins = loadOn(d);
    const capMin = Math.round(weekCapacityHours() * 60);
    const over = d >= today && mins > capMin;
    const pct = capMin ? Math.min(100, Math.round(mins / capMin * 100)) : 0;
    const working = tasks.filter(t => weekVisible(t) && !t.completed && t.startDate && t.dueDate && t.startDate <= d && d < t.dueDate);
    const col = document.createElement("div");
    col.className = "week-day" + (d === today ? " is-today" : "") + (d < today ? " is-past" : "");
    col.innerHTML = `
      <div class="week-day-head">
        <strong>${fmt(d, { weekday: "short" })} ${fmt(d, { day: "numeric" })}</strong>
        <span>${open.length ? open.length + " task" + (open.length === 1 ? "" : "s") + (mins ? " · " + formatMinutesLabel(mins) : "") : mins ? formatMinutesLabel(mins) + " planned" : "free"}</span>
      </div>
      ${d >= today || mins ? `<div class="week-cap${over ? " over" : ""}" title="${formatMinutesLabel(mins)} planned of ${formatMinutesLabel(capMin)}"><i style="width:${pct}%"></i></div>` : ""}
      ${over ? `<button type="button" class="week-rebalance" title="Move the lowest-priority tasks to lighter days">Over by ${formatMinutesLabel(mins - capMin)} &middot; Rebalance</button>` : ""}
      <div class="week-day-list"></div>
      <button type="button" class="week-day-add" title="Add a task on this day">+ add</button>`;
    const rb = col.querySelector(".week-rebalance");
    if (rb) rb.addEventListener("click", () => rebalanceDay(d, days));
    col.addEventListener("dragover", (e) => { if (weekDragId || weekDragStep) { e.preventDefault(); col.classList.add("drop-target"); } });
    col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("drop-target"); });
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drop-target");
      if (weekDragStep) { const ds = weekDragStep; weekDragStep = null; moveStepToDay(ds.tid, ds.idx, d); return; }
      const id = weekDragId; weekDragId = null;
      const t = tasks.find(x => x.id === id);
      if (t && t.dueDate !== d) moveTaskToDate(t, d, `Moved “${t.title}” to ${fmt(d, { weekday: "long" })}`);
    });
    col.querySelector(".week-day-add").addEventListener("click", () => { openModal(); document.getElementById("task-due-date").value = d; });
    const list = col.querySelector(".week-day-list");
    working.forEach(t => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "week-working";
      chip.title = "Working window — click to edit";
      const am = t.dayMinutes && t.dayMinutes[d] > 0 ? t.dayMinutes[d] : 0;
      const dd = !!(t.dayDone && t.dayDone[d]);
      if (dd) chip.classList.add("day-done");
      chip.innerHTML = `<span class="week-chip-box${dd ? " on" : ""}" title="Mark this day's part done">${dd ? "&#10003;" : ""}</span> ${escapeHtml(t.title)}${am ? ` <b>${formatMinutesLabel(am)}</b>` : ""}`;
      chip.querySelector(".week-chip-box").addEventListener("click", (e) => { e.stopPropagation(); toggleDayDone(t, d); });
      chip.addEventListener("click", () => openModal(t.id));
      list.appendChild(chip);
    });
    const steps = [];
    tasks.forEach(t => (t.subtasks || []).forEach((x, si) => { if (x.day === d && weekVisible(t) && !t.completed && !(weekView.hideDone && x.done)) steps.push({ t, x, si }); }));
    steps.sort((a, b) => (a.x.done - b.x.done));
    steps.forEach(({ t, x, si }) => {
      const row = document.createElement("div");
      row.className = "week-step" + (x.done ? " is-done" : "");
      if (!x.done) {
        row.draggable = true;
        row.addEventListener("dragstart", (e) => { weekDragStep = { tid: t.id, idx: si }; weekDragId = null; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", x.text); } catch (_) {} });
        row.addEventListener("dragend", () => { weekDragStep = null; row.classList.remove("dragging"); document.querySelectorAll(".week-day.drop-target").forEach(c => c.classList.remove("drop-target")); });
      }
      row.innerHTML = `<span class="sub-box${x.done ? " done" : ""}">&#10003;</span><span class="week-step-text">${escapeHtml(x.text)}<small>${escapeHtml(t.title)}${x.minutes ? " · " + formatMinutesLabel(x.minutes) : ""}</small></span>`;
      row.querySelector(".sub-box").addEventListener("click", (e) => {
        e.stopPropagation();
        x.done = !x.done;
        saveTasks();
        renderTasks();
        renderWeek();
      });
      row.addEventListener("click", () => openModal(t.id));
      list.appendChild(row);
    });
    due.sort((a, b) => (a.completed - b.completed) || (a.dueTime || "99").localeCompare(b.dueTime || "99"));
    due.forEach(t => {
      const status = getTaskStatus(t);
      const row = document.createElement("div");
      row.className = "week-task" + (t.completed ? " is-done" : "");
      if (!t.completed) {
        row.draggable = true;
        row.addEventListener("dragstart", (e) => { weekDragId = t.id; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", t.id); } catch (_) {} });
        row.addEventListener("dragend", () => { weekDragId = null; row.classList.remove("dragging"); document.querySelectorAll(".week-day.drop-target").forEach(c => c.classList.remove("drop-target")); });
      }
      const cc = getCategoryColor(t.category);
      row.style.background = `${cc}33`;
      row.style.borderColor = cc;
      row.title = `${t.category || "No category"}${t.estimate ? " · " + t.estimate + " min" : ""}`;
      row.innerHTML = `
        <span class="task-checkbox status-${status}" title="${STATUS_META[status].label} — click to change">${STATUS_META[status].icon}</span>
        <span class="week-task-title">${escapeHtml(t.title)}<small class="week-task-sub"><span class="week-cat-dot" style="background:${cc}"></span><span class="week-cat-name">${escapeHtml(t.category || "")}</span>${(t.dayMinutes && t.dayMinutes[d] > 0) ? `<b>${formatMinutesLabel(t.dayMinutes[d])} today</b>` : t.estimate ? `<b>${formatMinutesLabel(t.estimate)}</b>` : ""}</small></span>
        ${t.startDate && t.startDate < t.dueDate && t.dueDate === d ? `<span class="week-due-tag">due</span>` : ""}`;
      row.querySelector(".task-checkbox").addEventListener("click", (e) => { e.stopPropagation(); cycleTaskStatus(t.id); });
      row.addEventListener("click", () => openModal(t.id));
      list.appendChild(row);
    });
    if (!due.length && !working.length && !steps.length) {
      const empty = document.createElement("div");
      empty.className = "week-day-empty";
      empty.textContent = "—";
      list.appendChild(empty);
    }
    box.appendChild(col);
  });
}

document.getElementById("week-prev").addEventListener("click", () => { if (weekView.mode === "month") monthOffset--; else weekOffset--; renderWeek(); });
document.getElementById("week-next").addEventListener("click", () => { if (weekView.mode === "month") monthOffset++; else weekOffset++; renderWeek(); });
document.getElementById("week-today").addEventListener("click", () => { weekOffset = 0; monthOffset = 0; renderWeek(); });
document.getElementById("week-add-task").addEventListener("click", () => {
  openModal();
  const today = todayStr();
  const weekStart = formatDate(getWeekRange(weekOffset).start);
  document.getElementById("task-due-date").value = (weekOffset === 0 ? today : weekStart);
});
document.getElementById("week-add-big").addEventListener("click", () => {
  openModal();
  const today = todayStr();
  const range = getWeekRange(weekOffset);
  const weekStart = formatDate(range.start);
  const start = weekOffset === 0 ? today : weekStart;
  document.getElementById("task-start-date").value = start;
  const fri = dateShift(weekStart, 4);
  document.getElementById("task-due-date").value = fri >= start ? fri : dateShift(start, 2);
});

/* ===================== Upgrade 3: capacity, goals, pomodoro, focus, insights ===================== */
let weekDragId = null;

function weekCapacityHours() {
  return Number(loadJSON(BUDGET_KEY, 6)) || 6;
}

document.getElementById("week-capacity").addEventListener("change", (e) => {
  let v = parseFloat(e.target.value);
  if (!(v > 0)) v = 6;
  v = Math.min(16, Math.max(0.5, v));
  localStorage.setItem(BUDGET_KEY, JSON.stringify(v));
  e.target.value = v;
  renderPriorityQueue();
  renderWeek();
});
document.getElementById("day-budget-hours").addEventListener("change", () => renderWeek());

/* ---------- move / rebalance ---------- */
function moveTaskToDate(t, date, message) {
  const snap = snapshotState();
  if (t.recurringId) markOccurrenceOverrides(t, { ...t, dueDate: date });
  t.dueDate = date;
  if (t.startDate && t.startDate > date) delete t.startDate;
  saveTasks();
  renderAll();
  showUndoToast(message, snap);
}

function rebalanceDay(d, days) {
  const today = todayStr();
  const cap = Math.round(weekCapacityHours() * 60);
  const est = t => Number(t.estimate) || 0;
  const open = day => tasks.filter(t => !t.completed && !t.archived && t.dueDate === day && !t.dayMinutes);
  const load = {};
  days.forEach(x => { load[x] = loadOn(x); });
  const rank = { low: 1, medium: 2, "time-sensitive": 3, high: 3 };
  const candidates = open(d).filter(t => est(t) > 0 && t.priority !== "time-sensitive" && !t.dueTime)
    .sort((a, b) => (rank[a.priority] || 2) - (rank[b.priority] || 2) || est(b) - est(a));
  const targets = days.filter(x => x !== d && x >= today);
  const snap = snapshotState();
  let moved = 0;
  for (const t of candidates) {
    if (load[d] <= cap) break;
    const fits = targets
      .filter(x => load[x] + est(t) <= cap && !(t.startDate && false))
      .sort((a, b) => load[a] - load[b] || a.localeCompare(b));
    if (!fits.length) continue;
    const to = fits[0];
    if (t.recurringId) markOccurrenceOverrides(t, { ...t, dueDate: to });
    load[d] -= est(t); load[to] += est(t);
    t.dueDate = to;
    if (t.startDate && t.startDate > to) delete t.startDate;
    moved++;
  }
  if (!moved) {
    showSimpleToast("Nothing to move", "No other day this week has room, or the tasks on this day have fixed times or no estimates.");
    return;
  }
  saveTasks();
  renderAll();
  showUndoToast(`Moved ${moved} task${moved === 1 ? "" : "s"} to lighter days`, snap);
}

/* ---------- weekly goals (stored inside reviews[weekKey].goals so they sync + back up) ---------- */
function currentGoals() {
  const r = reviews[weekKeyFor(weekOffset)];
  return (r && Array.isArray(r.goals)) ? r.goals : [];
}
function saveGoals(goals) {
  const key = weekKeyFor(weekOffset);
  reviews[key] = { ...(reviews[key] || {}), goals };
  saveReviews();
  renderWeekGoals();
}
function renderWeekGoals() {
  const list = document.getElementById("week-goal-list");
  if (!list) return;
  const goals = currentGoals();
  const done = goals.filter(g => g.done).length;
  document.getElementById("week-goals-count").textContent = goals.length ? `${done}/${goals.length} done` : "What matters most this week?";
  list.innerHTML = "";
  goals.forEach((g, i) => {
    const row = document.createElement("div");
    row.className = "week-goal" + (g.done ? " is-done" : "");
    row.innerHTML = `<span class="sub-box${g.done ? " done" : ""}">&#10003;</span><span class="week-goal-text">${escapeHtml(g.text)}</span><button type="button" class="sub-del" title="Remove goal">&times;</button>`;
    row.querySelector(".sub-box").addEventListener("click", () => {
      const next = goals.map((x, j) => j === i ? { ...x, done: !x.done } : x);
      saveGoals(next);
      if (next.every(x => x.done)) { catSay("All weekly goals done!"); triggerCatCelebrate(); }
    });
    row.querySelector(".week-goal-text").addEventListener("click", () => {
      const nt = prompt("Edit goal", g.text);
      if (nt && nt.trim()) saveGoals(goals.map((x, j) => j === i ? { ...x, text: nt.trim().slice(0, 100) } : x));
    });
    row.querySelector(".sub-del").addEventListener("click", () => saveGoals(goals.filter((_, j) => j !== i)));
    list.appendChild(row);
  });
}
function addWeekGoal() {
  const input = document.getElementById("week-goal-new");
  const text = input.value.trim();
  if (!text) return;
  saveGoals([...currentGoals(), { id: uid(), text, done: false }]);
  input.value = "";
  input.focus();
}
document.getElementById("week-goal-add-btn").addEventListener("click", addWeekGoal);
document.getElementById("week-goal-new").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addWeekGoal(); } });
["week-prev", "week-next", "week-today"].forEach(id => document.getElementById(id).addEventListener("click", renderWeekGoals));

/* ---------- spread steps across days ---------- */
document.getElementById("spread-steps-btn").addEventListener("click", () => {
  const due = document.getElementById("task-due-date").value;
  if (!due) { showSimpleToast("Set a due date first", "Steps are spread between the start date and the due date."); return; }
  const today = todayStr();
  const start = document.getElementById("task-start-date").value || (today <= due ? today : due);
  const skipWk = document.getElementById("spread-skip-weekends").checked;
  let days = [];
  for (let d = start, n = 0; d <= due && n < 60; d = dateShift(d, 1), n++) days.push(d);
  if (skipWk) {
    const wk = days.filter(d => { const g = new Date(d + "T12:00:00").getDay(); return g !== 0 && g !== 6; });
    if (wk.length) days = wk;
  }
  const pending = modalSubtasks.filter(x => !x.done && !x.day && String(x.text || "").trim());
  if (!pending.length) { showSimpleToast("No steps to spread", "Add some steps first. Steps that already have a day are left alone."); return; }
  pending.forEach((x, i) => { x.day = days[Math.min(days.length - 1, Math.floor(i * days.length / pending.length))]; });
  renderSubtaskEditor();
  syncDayPlanFromSteps();
  showSimpleToast("Steps spread out", `${pending.length} step${pending.length === 1 ? "" : "s"} placed across ${days.length} day${days.length === 1 ? "" : "s"}. Adjust any of them below.`);
});

/* ---------- calendar export ---------- */
function icsEscape(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function icsLocal(dateStr, timeStr, addMin) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "00:00").split(":").map(Number);
  const dt = new Date(y, m - 1, d, hh, mm + (addMin || 0));
  const p = n => String(n).padStart(2, "0");
  return `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}T${p(dt.getHours())}${p(dt.getMinutes())}00`;
}
function icsDay(dateStr, plus) {
  return dateShift(dateStr, plus || 0).replace(/-/g, "");
}
function buildIcs(list) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Molly's Panel//EN", "CALSCALE:GREGORIAN"];
  const ev = (uid, summary, desc, startLine, endLine) => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@molly-panel`, `DTSTAMP:${stamp}`, startLine, endLine,
      `SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(desc)}`, "END:VEVENT");
  };
  list.forEach(t => {
    if (!t.dueDate) return;
    const desc = [t.category, t.notes, t.link].filter(Boolean).join("\n");
    if (t.dueTime) {
      ev(t.id, t.title, desc, `DTSTART:${icsLocal(t.dueDate, t.dueTime)}`, `DTEND:${icsLocal(t.dueDate, t.dueTime, Number(t.estimate) || 30)}`);
    } else {
      ev(t.id, t.title, desc, `DTSTART;VALUE=DATE:${icsDay(t.dueDate)}`, `DTEND;VALUE=DATE:${icsDay(t.dueDate, 1)}`);
    }
    (t.subtasks || []).forEach(x => {
      if (x.day && !x.done) ev(x.id || uid(), `${x.text} (${t.title})`, `Step of “${t.title}”`, `DTSTART;VALUE=DATE:${icsDay(x.day)}`, `DTEND;VALUE=DATE:${icsDay(x.day, 1)}`);
    });
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
async function downloadFile(filename, text, mime) {
  if (window.claude && typeof window.claude.use === "function") {
    const dl = await window.claude.use("downloads");
    if (!dl) throw new Error("no downloads");
    await dl.save({ filename, data: text });
    return;
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function exportIcs(list, name) {
  const items = list.filter(t => t.dueDate && !t.completed && !t.archived);
  const stepCount = items.reduce((n, t) => n + (t.subtasks || []).filter(x => x.day && !x.done).length, 0);
  if (!items.length) { showSimpleToast("Nothing to export", "No open tasks with a due date in that range."); return; }
  try {
    await downloadFile(name, buildIcs(items), "text/calendar");
    showSimpleToast("Calendar file saved", `${items.length} task${items.length === 1 ? "" : "s"}${stepCount ? ` and ${stepCount} step${stepCount === 1 ? "" : "s"}` : ""}. Open it to add them to Google Calendar, Apple Calendar or Outlook.`);
  } catch (err) {
    if (err && err.code === "declined") return;
    showSimpleToast("Couldn't download", "Your browser blocked the download here. Try the GitHub Pages version of the site.");
  }
}
document.getElementById("week-export").addEventListener("click", () => {
  const start = formatDate(getWeekRange(weekOffset).start);
  const end = dateShift(start, 6);
  exportIcs(tasks.filter(t => t.dueDate >= start && t.dueDate <= end || (t.subtasks || []).some(x => x.day >= start && x.day <= end)), `molly-panel-week-${start}.ics`);
});
document.getElementById("export-ics-btn").addEventListener("click", () => exportIcs(tasks, `molly-panel-tasks-${todayStr()}.ics`));

document.getElementById("gcal-link").addEventListener("click", (e) => {
  const title = document.getElementById("task-title").value.trim();
  const due = document.getElementById("task-due-date").value;
  if (!title || !due) { e.preventDefault(); showSimpleToast("Add a title and due date", "Then you can send the task to Google Calendar."); return; }
  const time = document.getElementById("task-due-time").value;
  const mins = Number(document.getElementById("task-estimate").value) || 30;
  const dates = time ? `${icsLocal(due, time)}/${icsLocal(due, time, mins)}` : `${icsDay(due)}/${icsDay(due, 1)}`;
  const details = [document.getElementById("task-notes").value.trim(), document.getElementById("task-link").value.trim()].filter(Boolean).join("\n");
  e.currentTarget.href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&details=${encodeURIComponent(details)}`;
});
// keep the Google Calendar link visible in the task form
document.getElementById("gcal-link").style.display = "inline-block";

/* ---------- Pomodoro ---------- */
let pomoSegStart = null;
let pomoBreakInterval = null;
let pomoBreakEndsAt = 0;
let pomoBreakOver = false;
const POMO_COUNT_KEY = "molly-panel-pomo-count-v1";

function pomoCountToday() {
  const s = loadJSON(POMO_COUNT_KEY, {});
  return s.date === todayStr() ? (s.n || 0) : 0;
}
function pomoBumpCount() {
  localStorage.setItem(POMO_COUNT_KEY, JSON.stringify({ date: todayStr(), n: pomoCountToday() + 1 }));
}
function updatePomoHint() {
  const on = !!prefs.pomo;
  document.getElementById("pomo-enabled").checked = on;
  const n = pomoCountToday();
  document.getElementById("pomo-hint").textContent = on
    ? `${prefs.pomoWork} min work · ${prefs.pomoBreak} min break${n ? ` · ${n} round${n === 1 ? "" : "s"} today` : ""}`
    : "";
}
document.getElementById("pomo-enabled").addEventListener("change", (e) => {
  prefs.pomo = e.target.checked;
  savePrefs();
  pomoSegStart = timerRunning ? timerSeconds : null;
  endPomoBreak(false);
  updatePomoHint();
});
document.getElementById("timer-toggle").addEventListener("click", () => {
  if (pomoBreakInterval || pomoBreakOver) endPomoBreak(false);
  pomoSegStart = timerRunning ? timerSeconds : null;
});
document.getElementById("timer-reset").addEventListener("click", () => { pomoSegStart = null; endPomoBreak(false); });

function pomodoroCheck() {
  if (!prefs.pomo || !timerRunning) return;
  if (pomoSegStart === null) { pomoSegStart = timerSeconds; return; }
  if (timerSeconds - pomoSegStart >= prefs.pomoWork * 60) startPomoBreak();
}
function startPomoBreak() {
  pomoSegStart = null;
  document.getElementById("timer-toggle").click();   // pauses and banks the time
  pomoSegStart = null;
  pomoBumpCount();
  updatePomoHint();
  pomoBreakOver = false;
  pomoBreakEndsAt = Date.now() + prefs.pomoBreak * 60 * 1000;
  const box = document.getElementById("pomo-break");
  box.style.display = "flex";
  box.classList.remove("done");
  document.getElementById("pomo-break-title").textContent = "Break time";
  document.getElementById("pomo-skip").textContent = "Skip break";
  playBeep();
  notifyUser("Break time", `Nice focus. Stretch for ${prefs.pomoBreak} minutes.`);
  catSay("Break time! Stretch.");
  clearInterval(pomoBreakInterval);
  tickPomoBreak();
  pomoBreakInterval = setInterval(tickPomoBreak, 500);
}
function tickPomoBreak() {
  const left = Math.max(0, Math.ceil((pomoBreakEndsAt - Date.now()) / 1000));
  document.getElementById("pomo-break-time").textContent = formatTimer(left);
  if (left <= 0) {
    clearInterval(pomoBreakInterval);
    pomoBreakInterval = null;
    pomoBreakOver = true;
    document.getElementById("pomo-break").classList.add("done");
    document.getElementById("pomo-break-title").textContent = "Break's over";
    document.getElementById("pomo-skip").textContent = "Resume work";
    playBeep();
    notifyUser("Break's over", "Ready for the next round?");
  }
}
function endPomoBreak() {
  clearInterval(pomoBreakInterval);
  pomoBreakInterval = null;
  pomoBreakOver = false;
  document.getElementById("pomo-break").style.display = "none";
}
document.getElementById("pomo-skip").addEventListener("click", () => {
  endPomoBreak();
  if (!timerRunning && timerTaskId) document.getElementById("timer-toggle").click();
});

/* ---------- reminders + notifications ---------- */
const NOTIFIED_KEY = "molly-panel-notified-v1";
function notifyUser(title, body) {
  showSimpleToast(title, body);
  try {
    if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
      new Notification(title, { body });
    }
  } catch (_) { /* notifications unavailable */ }
}
function checkReminders() {
  if (!prefs.remind && !prefs.morning) return;
  const now = new Date();
  const today = todayStr();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let sent = loadJSON(NOTIFIED_KEY, {});
  if (sent.date !== today) sent = { date: today, ids: [], morning: false };
  let changed = false;
  if (prefs.remind) {
    tasks.forEach(t => {
      if (t.completed || t.archived || t.dueDate !== today || !t.dueTime || sent.ids.includes(t.id)) return;
      const [h, m] = t.dueTime.split(":").map(Number);
      const dm = h * 60 + m;
      if (nowMin >= dm - prefs.remindLead && nowMin <= dm + 30) {
        sent.ids.push(t.id); changed = true;
        const diff = dm - nowMin;
        notifyUser(diff > 0 ? `Due in ${diff} min` : "Due now", t.title);
      }
    });
  }
  if (prefs.morning && !sent.morning) {
    const [h, m] = (prefs.morningTime || "08:00").split(":").map(Number);
    if (nowMin >= h * 60 + m && nowMin <= h * 60 + m + 180) {
      sent.morning = true; changed = true;
      const open = tasks.filter(t => isWorkableToday(t, today));
      const mins = open.reduce((s, t) => s + (Number(t.estimate) || 0), 0);
      const first = priorityQueueOrder.map(id => open.find(t => t.id === id)).filter(Boolean)[0];
      notifyUser("Good morning, Molly", open.length
        ? `${open.length} task${open.length === 1 ? "" : "s"} today${mins ? " (" + formatMinutesLabel(mins) + ")" : ""}. First up: ${first ? first.title : open[0].title}.`
        : "Nothing planned today. Enjoy the space.");
    }
  }
  if (changed) localStorage.setItem(NOTIFIED_KEY, JSON.stringify(sent));
}
setInterval(checkReminders, 30 * 1000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkReminders(); });

function renderPrefsUi() {
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) { if (el.type === "checkbox") el.checked = !!v; else el.value = v; } };
  set("pref-pomo-work", prefs.pomoWork); set("pref-pomo-break", prefs.pomoBreak);
  set("pref-remind", prefs.remind); set("pref-remind-lead", prefs.remindLead);
  set("pref-morning", prefs.morning); set("pref-morning-time", prefs.morningTime);
  updatePomoHint();
  const note = document.getElementById("remind-note");
  if (note) {
    const perm = ("Notification" in window) ? Notification.permission : "unsupported";
    note.textContent = "Reminders always show as a pop-up in the app while it's open." +
      (perm === "granted" ? " Browser notifications are on too." : perm === "denied" ? " Browser notifications are blocked for this site." : perm === "unsupported" ? "" : " Turn a reminder on to also allow browser notifications.");
  }
}
function bindPref(id, key, parse) {
  document.getElementById(id).addEventListener("change", (e) => {
    const el = e.target;
    let v = el.type === "checkbox" ? el.checked : parse(el.value);
    if (v === null || v === undefined || (typeof v === "number" && !(v > 0))) { renderPrefsUi(); return; }
    prefs[key] = v;
    savePrefs();
    if ((key === "remind" || key === "morning") && v && "Notification" in window && Notification.permission === "default") {
      try { Notification.requestPermission().then(renderPrefsUi); } catch (_) {}
    }
    renderPrefsUi();
    checkReminders();
  });
}
bindPref("pref-pomo-work", "pomoWork", v => Math.min(90, Math.max(5, parseInt(v, 10))));
bindPref("pref-pomo-break", "pomoBreak", v => Math.min(30, Math.max(1, parseInt(v, 10))));
bindPref("pref-remind", "remind", v => v);
bindPref("pref-remind-lead", "remindLead", v => Math.min(120, Math.max(1, parseInt(v, 10))));
bindPref("pref-morning", "morning", v => v);
bindPref("pref-morning-time", "morningTime", v => v || null);

/* ---------- archive ---------- */
function archiveCandidates() {
  const cutoff = dateShift(todayStr(), -30);
  return tasks.filter(t => t.completed && !t.archived && t.completedOn && t.completedOn < cutoff);
}
function refreshArchiveUi() {
  const note = document.getElementById("archive-note");
  if (!note) return;
  const n = tasks.filter(t => t.archived).length;
  const c = archiveCandidates().length;
  note.textContent = `Archiving hides completed tasks older than 30 days from the lists. They still count in your stats and can be found with search. ${c} ready to archive now${n ? `, ${n} already archived` : ""}.`;
  document.getElementById("unarchive-btn").style.display = n ? "inline-block" : "none";
}
document.getElementById("archive-btn").addEventListener("click", () => {
  const list = archiveCandidates();
  if (!list.length) { showSimpleToast("Nothing to archive", "No completed tasks older than 30 days."); return; }
  const snap = snapshotState();
  list.forEach(t => { t.archived = true; });
  saveTasks(); renderAll(); closeSettings();
  showUndoToast(`Archived ${list.length} old completed task${list.length === 1 ? "" : "s"}`, snap);
});
document.getElementById("unarchive-btn").addEventListener("click", () => {
  const snap = snapshotState();
  const n = tasks.filter(t => t.archived).length;
  tasks.forEach(t => { delete t.archived; });
  saveTasks(); renderAll(); closeSettings();
  showUndoToast(`Restored ${n} archived task${n === 1 ? "" : "s"}`, snap);
});

/* ---------- heatmap ---------- */
function renderHeatmap() {
  const grid = document.getElementById("heatmap");
  if (!grid) return;
  const today = todayStr();
  const weeks = 26;
  const thisMonday = formatDate(getWeekRange(0).start);
  const first = dateShift(thisMonday, -(weeks - 1) * 7);
  const doneBy = {}, minBy = {};
  tasks.forEach(t => { if (t.completed && t.completedOn) doneBy[t.completedOn] = (doneBy[t.completedOn] || 0) + 1; });
  sessions.forEach(s => { minBy[s.date] = (minBy[s.date] || 0) + (Number(s.minutes) || 0); });
  let html = "", active = 0, bestDay = 0;
  for (let i = 0; i < weeks * 7; i++) {
    const d = dateShift(first, i);
    if (d > today) { html += `<i class="hm-cell hm-future"></i>`; continue; }
    const n = doneBy[d] || 0, m = minBy[d] || 0;
    const score = n + Math.floor(m / 30);
    const lvl = score === 0 ? 0 : score === 1 ? 1 : score <= 3 ? 2 : score <= 5 ? 3 : 4;
    if (score > 0) active++;
    bestDay = Math.max(bestDay, score);
    const label = new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    html += `<i class="hm-cell hm${lvl}" title="${label}: ${n} task${n === 1 ? "" : "s"} done${m ? ", " + formatMinutesLabel(m) + " tracked" : ""}"></i>`;
  }
  grid.innerHTML = html;
  const streak = typeof computeDayStreak === "function" ? computeDayStreak() : 0;
  document.getElementById("heatmap-note").textContent = `${active} active day${active === 1 ? "" : "s"} in the last 6 months${streak ? ` · ${streak}-day streak` : ""}`;
}

/* ---------- estimates vs reality ---------- */
function renderEstimates() {
  const body = document.getElementById("estimates-body");
  if (!body) return;
  const actualOf = id => sessions.filter(s => s.taskId === id).reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
  const rows = tasks.filter(t => t.completed && Number(t.estimate) > 0).map(t => ({ t, est: Number(t.estimate), act: actualOf(t.id) })).filter(r => r.act > 0);
  if (rows.length < 3) {
    body.innerHTML = `<p class="insight-empty">Finish a few tasks that have an estimate and tracked time (timer or manual log). Your estimate accuracy will show up here. ${rows.length}/3 so far.</p>`;
    document.getElementById("estimates-note").textContent = "";
    return;
  }
  const byCat = {};
  rows.forEach(r => {
    const c = byCat[r.t.category || "Other"] = byCat[r.t.category || "Other"] || { est: 0, act: 0, n: 0 };
    c.est += r.est; c.act += r.act; c.n++;
  });
  const totEst = rows.reduce((s, r) => s + r.est, 0), totAct = rows.reduce((s, r) => s + r.act, 0);
  const pctOff = Math.round((totAct - totEst) / totEst * 100);
  document.getElementById("estimates-note").textContent = Math.abs(pctOff) < 8
    ? `${rows.length} tasks · your estimates are right on`
    : `${rows.length} tasks · you ${pctOff > 0 ? "underestimate" : "overestimate"} by about ${Math.abs(pctOff)}%`;
  const max = Math.max(...Object.values(byCat).map(c => Math.max(c.est, c.act)));
  const catRows = Object.entries(byCat).sort((a, b) => b[1].act - a[1].act).map(([name, c]) => {
    const diff = Math.round((c.act - c.est) / c.est * 100);
    const color = getCategoryColor(name);
    return `<div class="est-row">
      <div class="est-name"><span class="week-cat-dot" style="background:${color}"></span>${escapeHtml(name)} <small>${c.n} task${c.n === 1 ? "" : "s"}</small></div>
      <div class="est-bars">
        <div class="est-bar est"><i style="width:${c.est / max * 100}%"></i><span>planned ${formatMinutesLabel(c.est)}</span></div>
        <div class="est-bar act ${diff > 10 ? "over" : ""}"><i style="width:${c.act / max * 100}%;background:${color}"></i><span>actual ${formatMinutesLabel(c.act)} (${diff > 0 ? "+" : ""}${diff}%)</span></div>
      </div>
    </div>`;
  }).join("");
  const worst = rows.filter(r => r.est >= 10).map(r => ({ ...r, diff: (r.act - r.est) / r.est })).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 3);
  const worstHtml = worst.length ? `<div class="est-worst"><strong>Biggest surprises</strong>${worst.map(r => `<span>${escapeHtml(r.t.title)}: planned ${formatMinutesLabel(r.est)}, took ${formatMinutesLabel(r.act)}</span>`).join("")}</div>` : "";
  body.innerHTML = catRows + worstHtml;
}

/* ---------- search everything (Ctrl/Cmd + K) ---------- */
let paletteIndex = 0;
let paletteItems = [];
function openPalette() {
  document.getElementById("palette-overlay").classList.add("open");
  const input = document.getElementById("palette-input");
  input.value = "";
  renderPalette();
  setTimeout(() => input.focus(), 30);
}
function closePalette() { document.getElementById("palette-overlay").classList.remove("open"); }
function renderPalette() {
  const q = document.getElementById("palette-input").value.trim().toLowerCase();
  const out = [];
  const fmtD = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const today = todayStr();
  if (!q) {
    tasks.filter(t => !t.completed && !t.archived && t.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8)
      .forEach(t => out.push({ t, sub: `${t.category} · ${fmtD(t.dueDate)}`, kind: "task" }));
  } else {
    tasks.forEach(t => {
      const hay = `${t.title} ${t.notes || ""} ${t.category || ""}`.toLowerCase();
      const matchTask = hay.includes(q);
      if (matchTask) out.push({ t, kind: "task", sub: `${t.category}${t.dueDate ? " · " + fmtD(t.dueDate) : ""}${t.completed ? " · done" : ""}${t.archived ? " · archived" : ""}`, score: (t.title.toLowerCase().includes(q) ? 0 : 2) + (t.completed ? 1 : 0) });
      (t.subtasks || []).forEach(x => {
        if (String(x.text).toLowerCase().includes(q)) out.push({ t, kind: "step", label: x.text, sub: `Step of ${t.title}${x.day ? " · " + fmtD(x.day) : ""}`, score: 1.5 });
      });
    });
    out.sort((a, b) => (a.score || 0) - (b.score || 0));
  }
  paletteItems = out.slice(0, 40);
  paletteIndex = 0;
  const box = document.getElementById("palette-results");
  if (!paletteItems.length) { box.innerHTML = `<div class="palette-empty">${q ? "No matches" : "Nothing coming up"}</div>`; return; }
  box.innerHTML = paletteItems.map((it, i) => `
    <div class="palette-item${i === 0 ? " active" : ""}" data-i="${i}">
      <span class="palette-kind">${it.kind}</span>
      <span class="palette-main"><b>${escapeHtml(it.label || it.t.title)}</b><small>${escapeHtml(it.sub)}</small></span>
      <i class="week-cat-dot" style="background:${getCategoryColor(it.t.category)}"></i>
    </div>`).join("");
  box.querySelectorAll(".palette-item").forEach(el => {
    el.addEventListener("click", () => pickPalette(parseInt(el.dataset.i, 10)));
    el.addEventListener("mousemove", () => setPaletteIndex(parseInt(el.dataset.i, 10)));
  });
}
function setPaletteIndex(i) {
  paletteIndex = Math.max(0, Math.min(paletteItems.length - 1, i));
  document.querySelectorAll(".palette-item").forEach((el, j) => el.classList.toggle("active", j === paletteIndex));
  const act = document.querySelector(".palette-item.active");
  if (act) act.scrollIntoView({ block: "nearest" });
}
function pickPalette(i) {
  const it = paletteItems[i];
  if (!it) return;
  closePalette();
  openModal(it.t.id);
}
document.getElementById("palette-input").addEventListener("input", renderPalette);
document.getElementById("palette-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); setPaletteIndex(paletteIndex + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setPaletteIndex(paletteIndex - 1); }
  else if (e.key === "Enter") { e.preventDefault(); pickPalette(paletteIndex); }
});
document.getElementById("palette-overlay").addEventListener("click", (e) => { if (e.target.id === "palette-overlay") closePalette(); });
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (document.getElementById("palette-overlay").classList.contains("open")) closePalette(); else openPalette();
  }
});

/* ---------- focus mode ---------- */
let focusInterval = null;
function focusTask() {
  const today = todayStr();
  if (timerTaskId) { const t = tasks.find(x => x.id === timerTaskId && !x.completed); if (t) return t; }
  const open = tasks.filter(t => isWorkableToday(t, today));
  const byId = new Map(open.map(t => [t.id, t]));
  return priorityQueueOrder.map(id => byId.get(id)).find(Boolean) || open[0] || null;
}
function openFocus() {
  document.getElementById("focus-overlay").classList.add("open");
  renderFocus();
  clearInterval(focusInterval);
  focusInterval = setInterval(() => {
    const el = document.getElementById("focus-time");
    if (el) el.textContent = focusTimeText();
  }, 1000);
}
function closeFocus() {
  document.getElementById("focus-overlay").classList.remove("open");
  clearInterval(focusInterval);
}
function focusTimeText() {
  const t = focusTask();
  if (!t) return "00:00";
  if (timerTaskId === t.id) return formatTimer(timerSeconds);
  return formatTimer(timerBankedSeconds[t.id] || 0);
}
function renderFocus() {
  const inner = document.getElementById("focus-inner");
  if (!document.getElementById("focus-overlay").classList.contains("open")) return;
  const t = focusTask();
  const today = todayStr();
  if (!t) {
    const doneToday = tasks.filter(x => x.completed && x.completedOn === today).length;
    inner.innerHTML = `<p class="focus-eyebrow">All clear</p><h1 class="focus-title">Nothing left for today</h1><p class="focus-sub">${doneToday ? `You finished ${doneToday} task${doneToday === 1 ? "" : "s"} today.` : "Add a task or enjoy the free time."}</p>`;
    return;
  }
  const left = tasks.filter(x => isWorkableToday(x, today)).length;
  const subs = t.subtasks || [];
  const running = timerRunning && timerTaskId === t.id;
  const cc = getCategoryColor(t.category);
  inner.innerHTML = `
    <p class="focus-eyebrow">${running ? "In progress" : "Up next"} &middot; ${left} to go today</p>
    <h1 class="focus-title">${escapeHtml(t.title)}</h1>
    <div class="focus-meta">
      <span class="focus-chip" style="background:${cc}55;border-color:${cc}">${escapeHtml(t.category || "")}</span>
      ${t.estimate ? `<span class="focus-chip">${formatMinutesLabel(Number(t.estimate))} planned</span>` : ""}
      ${t.dayMinutes && t.dayMinutes[today] > 0 ? `<span class="focus-chip">${formatMinutesLabel(t.dayMinutes[today])} planned for today</span>` : ""}
      ${t.dueDate ? `<span class="focus-chip">${dueLabelInfo(t).text}</span>` : ""}
    </div>
    <div class="focus-time" id="focus-time">${focusTimeText()}</div>
    <div class="focus-actions">
      <button type="button" class="btn-primary" id="focus-toggle">${running ? "Pause" : "Start timer"}</button>
      <button type="button" class="btn-secondary" id="focus-done">Mark done</button>
      <button type="button" class="btn-ghost" id="focus-skip">Skip for now</button>
    </div>
    ${subs.length ? `<div class="focus-steps">${subs.map((x, i) => `<div class="focus-step${x.done ? " is-done" : ""}${x.day === today ? " is-today" : ""}" data-i="${i}"><span class="sub-box${x.done ? " done" : ""}">&#10003;</span><span>${escapeHtml(x.text)}${x.minutes ? ` <em class="focus-step-min">${formatMinutesLabel(x.minutes)}</em>` : ""}</span>${x.day ? `<small>${new Date(x.day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" })}</small>` : ""}</div>`).join("")}</div>` : ""}
    ${t.notes ? `<p class="focus-notes">${escapeHtml(t.notes)}</p>` : ""}`;
  document.getElementById("focus-toggle").addEventListener("click", () => {
    document.querySelector('.timer-mode-btn[data-timer-mode="task"]').click();
    const sel = document.getElementById("pomodoro-task-select");
    if (timerTaskId !== t.id) {
      if (!Array.from(sel.options).some(o => o.value === t.id)) return;
      sel.value = t.id; sel.dispatchEvent(new Event("change"));
    }
    document.getElementById("timer-toggle").click();
    renderFocus();
  });
  document.getElementById("focus-done").addEventListener("click", () => {
    let guard = 0;
    while (!t.completed && guard++ < 3) cycleTaskStatus(t.id);
  });
  document.getElementById("focus-skip").addEventListener("click", () => {
    priorityQueueOrder = priorityQueueOrder.filter(id => id !== t.id).concat(t.id);
    savePriorityQueue();
    if (timerTaskId === t.id && timerRunning) document.getElementById("timer-toggle").click();
    renderPriorityQueue(); populateTimerTaskSelect();
    renderFocus();
  });
  inner.querySelectorAll(".focus-step").forEach(el => el.addEventListener("click", () => {
    const step = t.subtasks[parseInt(el.dataset.i, 10)];
    if (!step) return;
    step.done = !step.done;
    saveTasks(); renderAll();
  }));
}
document.getElementById("open-focus").addEventListener("click", openFocus);
document.getElementById("focus-close").addEventListener("click", closeFocus);

/* ---------- cat moods ---------- */
let catBubbleTimer = null;
function catSay(text, ms = 2800) {
  const b = document.getElementById("cat-bubble");
  if (!b) return;
  b.textContent = text;
  b.classList.add("show");
  clearTimeout(catBubbleTimer);
  catBubbleTimer = setTimeout(() => b.classList.remove("show"), ms);
}
const CHEERS = ["Nice work!", "One down!", "Purr-fect!", "You did it!", "Meow-velous!", "Keep going!"];
function catCheer(t) {
  triggerCatCelebrate();
  triggerCatReaction();
  const today = todayStr();
  const dueToday = tasks.filter(x => x.dueDate === today);
  const allDone = dueToday.length > 0 && dueToday.every(x => x.completed);
  const streak = typeof computeDayStreak === "function" ? computeDayStreak() : 0;
  if (allDone && [3, 7, 14, 30, 60, 100].includes(streak)) catSay(`${streak}-day streak! Amazing!`, 4200);
  else if (allDone) catSay("All done for today!", 3600);
  else catSay(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
}
let lastActivity = Date.now();
let catAsleep = false;
function noteActivity() {
  lastActivity = Date.now();
  if (catAsleep) { catAsleep = false; updateCatMood(true); }
}
["pointerdown", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, noteActivity, { passive: true }));
let moveThrottle = 0;
document.addEventListener("mousemove", () => { const n = Date.now(); if (n - moveThrottle > 2000) { moveThrottle = n; noteActivity(); } }, { passive: true });
function updateCatMood(justWoke) {
  const cat = document.getElementById("pixel-cat");
  if (!cat) return;
  const idle = Date.now() - lastActivity;
  const night = computeTimeTheme() === "night";
  const working = timerRunning || (freeTimer && freeTimer.startedAt);
  const sleepy = !working && (idle > 8 * 60 * 1000 || (night && idle > 2 * 60 * 1000));
  catAsleep = sleepy;
  cat.classList.toggle("sleepy", sleepy);
  if (justWoke) catSay("mrrp?", 1800);
}
setInterval(updateCatMood, 15 * 1000);

function renderUpgrade3() {
  renderWeekGoals();
  renderHeatmap();
  renderEstimates();
  refreshArchiveUi();
  renderPrefsUi();
  renderFocus();
}

/* ---------- time per day for big tasks ---------- */
let modalDayMinutes = {};
let dayPlanManual = new Set();
let estimateManual = false;

function stepsTotal() {
  return modalSubtasks.reduce((n, x) => n + (Number(x.minutes) || 0), 0);
}
// big task total follows the step times until you type your own estimate
function syncEstimateFromSteps() {
  const sum = stepsTotal();
  if (sum > 0 && !estimateManual) document.getElementById("task-estimate").value = sum;
  else if (sum === 0 && !estimateManual && modalSubtasks.length) { /* keep whatever is there */ }
  updateEstimateTools();
  if (typeof updateDayPlanTotal === "function") updateDayPlanTotal();
}
function updateEstimateTools() {
  const box = document.getElementById("estimate-tools");
  if (!box) return;
  box.style.display = modalSubtasks.length ? "flex" : "none";
  const sum = stepsTotal();
  const est = Number(document.getElementById("task-estimate").value) || 0;
  const hint = document.getElementById("estimate-hint");
  if (!sum) hint.textContent = "Give steps a time and the total fills in for you.";
  else if (!estimateManual && est === sum) hint.textContent = `Auto: ${formatMinutesLabel(sum)} from your steps`;
  else hint.textContent = `Steps add up to ${formatMinutesLabel(sum)}`;
  document.getElementById("use-steps-total-btn").style.display = sum && est !== sum ? "inline-block" : "none";
}
document.getElementById("task-estimate").addEventListener("input", () => { estimateManual = true; updateEstimateTools(); });
document.getElementById("use-steps-total-btn").addEventListener("click", () => {
  estimateManual = false;
  syncEstimateFromSteps();
  syncDayPlanFromSteps();
});
document.getElementById("split-steps-btn").addEventListener("click", () => {
  const est = Number(document.getElementById("task-estimate").value) || 0;
  const targets = modalSubtasks.filter(x => !x.done && String(x.text || "").trim());
  if (!est) { showSimpleToast("Add an estimate first", "Enter the total estimated minutes, then split it across your steps."); return; }
  if (!targets.length) { showSimpleToast("No open steps", "Add some steps first."); return; }
  const base = Math.floor(est / targets.length / 5) * 5;
  let used = 0;
  targets.forEach((x, i) => {
    const m = i === targets.length - 1 ? est - used : base;
    if (m > 0) x.minutes = m; else delete x.minutes;
    used += base;
  });
  estimateManual = true;
  renderSubtaskEditor();
  syncDayPlanFromSteps();
  updateEstimateTools();
});

// days whose time comes from step minutes follow the steps until you type that day's time yourself
function syncDayPlanFromSteps() {
  const days = dayPlanDays();
  if (days.length) {
    days.forEach(d => {
      if (dayPlanManual.has(d)) return;
      const sum = modalSubtasks.reduce((n, x) => n + (x.day === d ? (Number(x.minutes) || 0) : 0), 0);
      if (sum > 0) modalDayMinutes[d] = sum; else delete modalDayMinutes[d];
    });
    renderDayPlan();
  }
}

// minutes a task asks for on a given day
function minutesOn(t, day) {
  const dm = t.dayMinutes;
  if (!dm) return Number(t.estimate) || 0;
  if (dm[day] != null) return Number(dm[day]) || 0;
  const outside = (t.dueDate && day > t.dueDate) || (t.startDate && day < t.startDate);
  return outside ? (Number(t.estimate) || 0) : 0;
}
// planned load on a calendar day across all open tasks
function loadOn(day) {
  return tasks.reduce((sum, t) => {
    if (t.completed || t.archived) return sum;
    if (t.dayMinutes) return sum + (Number(t.dayMinutes[day]) || 0);
    return t.dueDate === day ? sum + (Number(t.estimate) || 0) : sum;
  }, 0);
}
function cleanDayMinutes(start, due) {
  if (!start || !due || start >= due) return undefined;
  const out = {};
  Object.entries(modalDayMinutes).forEach(([d, m]) => {
    const n = Math.round(Number(m));
    if (n > 0 && d >= start && d <= due) out[d] = n;
  });
  return Object.keys(out).length ? out : undefined;
}
function dayPlanDays() {
  const start = document.getElementById("task-start-date").value;
  const due = document.getElementById("task-due-date").value;
  if (!start || !due || start >= due) return [];
  const days = [];
  for (let d = start, n = 0; d <= due && n < 45; d = dateShift(d, 1), n++) days.push(d);
  return days;
}
function renderDayPlan() {
  const field = document.getElementById("day-plan-field");
  if (!field) return;
  const days = dayPlanDays();
  field.style.display = days.length && editScope !== "series" ? "block" : "none";
  if (!days.length) return;
  const list = document.getElementById("day-plan-list");
  list.innerHTML = "";
  days.forEach(d => {
    const row = document.createElement("label");
    row.className = "day-plan-row";
    const label = new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    row.innerHTML = `<span>${label}</span><input type="number" min="0" max="960" step="15" placeholder="0" value="${modalDayMinutes[d] || ""}" /><em>min</em>`;
    row.querySelector("input").addEventListener("input", (e) => {
      const v = parseInt(e.target.value, 10);
      dayPlanManual.add(d);
      if (v > 0) modalDayMinutes[d] = v; else delete modalDayMinutes[d];
      updateDayPlanTotal();
    });
    list.appendChild(row);
  });
  updateDayPlanTotal();
}
function updateDayPlanTotal() {
  const days = dayPlanDays();
  const total = days.reduce((s, d) => s + (Number(modalDayMinutes[d]) || 0), 0);
  const est = Number(document.getElementById("task-estimate").value) || 0;
  const el = document.getElementById("day-plan-total");
  el.classList.remove("over", "short");
  if (!total) { el.textContent = est ? `Estimate: ${formatMinutesLabel(est)}` : "Enter minutes for each day"; return; }
  if (est && total !== est) {
    el.classList.add(total > est ? "over" : "short");
    el.textContent = `Planned ${formatMinutesLabel(total)} · ${total > est ? "over" : "under"} the ${formatMinutesLabel(est)} estimate by ${formatMinutesLabel(Math.abs(total - est))}`;
  } else {
    el.textContent = `Planned ${formatMinutesLabel(total)}${est ? " · matches your estimate" : ""}`;
  }
}
["task-start-date", "task-due-date", "task-estimate"].forEach(id => {
  document.getElementById(id).addEventListener("change", renderDayPlan);
});
document.getElementById("start-clear").addEventListener("click", renderDayPlan);
document.getElementById("day-plan-clear").addEventListener("click", () => { modalDayMinutes = {}; dayPlanManual = new Set(); syncDayPlanFromSteps(); renderDayPlan(); });
document.getElementById("day-plan-split").addEventListener("click", () => {
  let days = dayPlanDays();
  const est = Number(document.getElementById("task-estimate").value) || 0;
  if (!est) { showSimpleToast("Add an estimate first", "Set the estimated minutes for the whole task, then split it across the days."); return; }
  if (document.getElementById("spread-skip-weekends").checked) {
    const wk = days.filter(d => { const g = new Date(d + "T12:00:00").getDay(); return g !== 0 && g !== 6; });
    if (wk.length) days = wk;
  }
  modalDayMinutes = {};
  dayPlanManual = new Set(days);
  const base = Math.floor(est / days.length / 5) * 5;
  let used = 0;
  days.forEach((d, i) => {
    const m = i === days.length - 1 ? est - used : base;
    if (m > 0) modalDayMinutes[d] = m;
    used += base;
  });
  renderDayPlan();
});

/* ===================== Upgrade 4: big-task health + week views ===================== */
const WEEKVIEW_KEY = "molly-panel-weekview-v1";
let weekView = Object.assign({ mode: "week", compact: false, cat: "", hideDone: false, onlyBig: false }, loadJSON(WEEKVIEW_KEY, {}));
let monthOffset = 0;
let weekDragStep = null;
function saveWeekView() { try { localStorage.setItem(WEEKVIEW_KEY, JSON.stringify(weekView)); } catch (_) {} }

function weekVisible(t) {
  if (t.archived) return false;
  if (weekView.cat && t.category !== weekView.cat) return false;
  if (weekView.hideDone && t.completed) return false;
  if (weekView.onlyBig && !isBigTask(t)) return false;
  return true;
}

/* ---------- progress / on track ---------- */
function bigStatsFor(steps) {
  if (!steps || !steps.length) return null;
  const today = todayStr();
  const hasMin = steps.some(x => Number(x.minutes) > 0);
  const w = x => hasMin ? (Number(x.minutes) || 0) : 1;
  const total = steps.reduce((a, x) => a + w(x), 0);
  if (!total) return null;
  const done = steps.filter(x => x.done).reduce((a, x) => a + w(x), 0);
  const late = steps.filter(x => !x.done && x.day && x.day < today);
  const lateW = late.reduce((a, x) => a + w(x), 0);
  const ahead = steps.some(x => x.done && x.day && x.day > today);
  return { pct: Math.round(done / total * 100), state: late.length ? "behind" : ahead ? "ahead" : "on", lateMin: hasMin ? lateW : 0, lateCount: late.length };
}
function bigStateLabel(st) {
  if (st.state === "behind") return st.lateMin ? `behind by ${formatMinutesLabel(st.lateMin)}` : `${st.lateCount} step${st.lateCount === 1 ? "" : "s"} behind`;
  return st.state === "ahead" ? "ahead" : "on track";
}

/* ---------- catch-up ---------- */
function catchUpSteps(steps, endDate) {
  const today = todayStr();
  const late = steps.filter(x => !x.done && x.day && x.day < today);
  if (!late.length) return 0;
  const end = endDate && endDate >= today ? endDate : today;
  const days = [];
  for (let d = today, n = 0; d <= end && n < 60; d = dateShift(d, 1), n++) days.push(d);
  const load = {}; days.forEach(d => { load[d] = 0; });
  steps.forEach(x => { if (!x.done && x.day && load[x.day] != null) load[x.day] += Number(x.minutes) || 30; });
  late.forEach(x => {
    let best = days[0];
    days.forEach(d => { if (load[d] < load[best]) best = d; });
    x.day = best;
    load[best] += Number(x.minutes) || 30;
  });
  return late.length;
}
function rebuildDayMinutes(t) {
  if (!(t.subtasks || []).some(x => Number(x.minutes) > 0)) return;
  const dm = {};
  t.subtasks.forEach(x => { if (x.day && Number(x.minutes) > 0) dm[x.day] = (dm[x.day] || 0) + Number(x.minutes); });
  if (Object.keys(dm).length) t.dayMinutes = dm; else delete t.dayMinutes;
}
function catchUpTask(t) {
  const snap = snapshotState();
  const n = catchUpSteps(t.subtasks || [], t.dueDate);
  if (!n) return;
  rebuildDayMinutes(t);
  saveTasks();
  renderAll();
  showUndoToast(`Moved ${n} missed step${n === 1 ? "" : "s"} of “${t.title}” forward`, snap);
}
function moveStepToDay(tid, idx, d) {
  const t = tasks.find(x => x.id === tid);
  const x = t && (t.subtasks || [])[idx];
  if (!x || x.day === d) return;
  if ((t.dueDate && d > t.dueDate) || (t.startDate && d < t.startDate)) {
    showSimpleToast("Outside the window", `“${t.title}” runs ${t.startDate || "…"} to ${t.dueDate || "…"} — drop the step inside that range.`);
    return;
  }
  const snap = snapshotState();
  x.day = d;
  rebuildDayMinutes(t);
  saveTasks();
  renderAll();
  showUndoToast(`Moved step “${x.text}” to ${new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" })}`, snap);
}

/* modal: progress line + respread offer */
function updateBigProgress() {
  const box = document.getElementById("big-progress");
  if (!box) return;
  const st = modalSubtasks.length >= 2 ? bigStatsFor(modalSubtasks) : null;
  if (!st) { box.style.display = "none"; return; }
  box.style.display = "flex";
  box.innerHTML = `<div class="bp-bar"><i style="width:${st.pct}%"></i></div><span class="bp-label">${st.pct}% done · <b class="week-state ${st.state}">${bigStateLabel(st)}</b></span>${st.state === "behind" ? `<button type="button" class="btn-secondary bp-catchup">Catch up</button>` : ""}`;
  const b = box.querySelector(".bp-catchup");
  if (b) b.addEventListener("click", () => {
    catchUpSteps(modalSubtasks, document.getElementById("task-due-date").value);
    renderSubtaskEditor(); syncDayPlanFromSteps();
  });
}
function respreadDays() {
  const today = todayStr();
  const due = document.getElementById("task-due-date").value;
  if (!due) return [];
  const start = document.getElementById("task-start-date").value || today;
  let from = start > today ? start : today;
  if (from > due) from = start <= due ? start : due;
  const days = [];
  for (let d = from, n = 0; d <= due && n < 60; d = dateShift(d, 1), n++) days.push(d);
  return days;
}
function offerRespread() {
  const note = document.getElementById("respread-note");
  if (!note) return;
  const open = modalSubtasks.filter(x => !x.done);
  const days = respreadDays();
  if (!open.some(x => x.day) || !days.length) { note.style.display = "none"; return; }
  note.style.display = "flex";
  note.innerHTML = `<span>Dates changed. Respread ${open.length} unfinished step${open.length === 1 ? "" : "s"} across ${days.length} day${days.length === 1 ? "" : "s"}?</span><button type="button" class="btn-secondary" data-act="yes">Respread</button><button type="button" class="btn-secondary" data-act="no">Keep as is</button>`;
  note.querySelector('[data-act="no"]').addEventListener("click", () => { note.style.display = "none"; });
  note.querySelector('[data-act="yes"]').addEventListener("click", () => {
    open.forEach((x, i) => { x.day = days[Math.min(days.length - 1, Math.floor(i * days.length / open.length))]; });
    if (modalSubtasks.some(x => Number(x.minutes) > 0)) { dayPlanManual = new Set(); modalDayMinutes = {}; }
    note.style.display = "none";
    renderSubtaskEditor(); syncDayPlanFromSteps();
  });
}

/* ---------- week controls, summary, month ---------- */
function syncWeekControls() {
  const panel = document.getElementById("week");
  panel.classList.toggle("compact", !!weekView.compact);
  document.getElementById("week-compact").classList.toggle("is-on", !!weekView.compact);
  document.querySelectorAll(".week-seg-btn").forEach(b => b.classList.toggle("is-on", b.dataset.wmode === weekView.mode));
  const month = weekView.mode === "month";
  ["week-goals-card", "week-bars-card", "week-days", "week-summary"].forEach(id => { document.getElementById(id).style.display = month ? "none" : ""; });
  document.getElementById("month-view").style.display = month ? "block" : "none";
  const sel = document.getElementById("wf-cat");
  if (document.activeElement !== sel) {
    sel.innerHTML = `<option value="">All</option>` + categories.map(c => `<option value="${escapeAttr(c.name)}"${c.name === weekView.cat ? " selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
  }
  document.getElementById("wf-hide-done").checked = !!weekView.hideDone;
  document.getElementById("wf-only-big").checked = !!weekView.onlyBig;
  document.getElementById("wf-reset").style.display = (weekView.cat || weekView.hideDone || weekView.onlyBig) ? "inline-block" : "none";
}
document.querySelectorAll(".week-seg-btn").forEach(b => b.addEventListener("click", () => { weekView.mode = b.dataset.wmode; saveWeekView(); renderWeek(); }));
document.getElementById("week-compact").addEventListener("click", () => { weekView.compact = !weekView.compact; saveWeekView(); renderWeek(); });
document.getElementById("wf-cat").addEventListener("change", (e) => { weekView.cat = e.target.value; saveWeekView(); renderWeek(); });
document.getElementById("wf-hide-done").addEventListener("change", (e) => { weekView.hideDone = e.target.checked; saveWeekView(); renderWeek(); });
document.getElementById("wf-only-big").addEventListener("change", (e) => { weekView.onlyBig = e.target.checked; saveWeekView(); renderWeek(); });
document.getElementById("wf-reset").addEventListener("click", () => { weekView.cat = ""; weekView.hideDone = false; weekView.onlyBig = false; saveWeekView(); renderWeek(); });

function renderWeekSummary(days, today) {
  const el = document.getElementById("week-summary");
  const vis = tasks.filter(weekVisible);
  const capMin = Math.round(weekCapacityHours() * 60);
  const loadV = d => vis.reduce((sum, t) => {
    if (t.completed) return sum;
    if (t.dayMinutes) return sum + (Number(t.dayMinutes[d]) || 0);
    return t.dueDate === d ? sum + (Number(t.estimate) || 0) : sum;
  }, 0);
  const loads = days.map(loadV);
  const planned = loads.reduce((a, b) => a + b, 0);
  const busyI = loads.indexOf(Math.max(...loads));
  const dueWeek = vis.filter(t => days.includes(t.dueDate));
  const doneT = dueWeek.filter(t => t.completed).length;
  let sTot = 0, sDone = 0;
  vis.forEach(t => (t.subtasks || []).forEach(x => { if (x.day && days.includes(x.day)) { sTot++; if (x.done) sDone++; } }));
  const tracked = sessions.filter(s => days.includes(s.date) && (!weekView.cat || s.category === weekView.cat)).reduce((a, s) => a + (Number(s.minutes) || 0), 0);
  const total = capMin * 7;
  const pct = total ? Math.min(100, Math.round(planned / total * 100)) : 0;
  const busy = loads[busyI] > 0 ? `${new Date(days[busyI] + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" })} · ${formatMinutesLabel(loads[busyI])}` : "—";
  const tile = (k, v) => `<div class="ws-tile"><span>${k}</span><strong>${v}</strong></div>`;
  el.innerHTML = `
    <div class="ws-tiles">
      ${tile("Planned", `${formatMinutesLabel(planned) || "0m"} <small>of ${formatMinutesLabel(total)}</small>`)}
      ${tile("Tasks done", `${doneT}/${dueWeek.length}`)}
      ${tile("Steps done", `${sDone}/${sTot}`)}
      ${tile("Tracked", formatMinutesLabel(tracked) || "0m")}
      ${tile("Busiest day", busy)}
    </div>
    <div class="ws-bar" title="${pct}% of this week's capacity planned"><i style="width:${pct}%"></i></div>`;
}

function renderMonth() {
  const box = document.getElementById("month-view");
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1, 12);
  const month = first.getMonth();
  const lead = (first.getDay() + 6) % 7;
  const dim = new Date(first.getFullYear(), month + 1, 0).getDate();
  const rows = Math.ceil((lead + dim) / 7);
  const gridStart = new Date(first); gridStart.setDate(1 - lead);
  const today = todayStr();
  const thisMon = getWeekRange(0).start;
  document.getElementById("week-range-label").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" }) + (monthOffset === 0 ? " · this month" : "");
  let html = `<div class="month-head">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(n => `<span>${n}</span>`).join("")}</div><div class="month-grid">`;
  for (let i = 0; i < rows * 7; i++) {
    const dt = new Date(gridStart); dt.setDate(gridStart.getDate() + i);
    const d = formatDate(dt);
    const due = tasks.filter(t => weekVisible(t) && t.dueDate === d);
    const win = tasks.filter(t => weekVisible(t) && !t.completed && t.startDate && t.dueDate && t.startDate <= d && d < t.dueDate);
    const mins = loadOn(d);
    const items = [
      ...due.map(t => ({ t, cls: t.completed ? " is-done" : "", txt: t.title })),
      ...win.map(t => ({ t, cls: " win", txt: "▶ " + t.title })),
    ];
    const shown = items.slice(0, 3);
    html += `<div class="month-cell${dt.getMonth() !== month ? " other" : ""}${d === today ? " is-today" : ""}" data-date="${d}">
      <div class="month-num"><b>${dt.getDate()}</b>${mins ? `<span>${formatMinutesLabel(mins)}</span>` : ""}</div>
      ${shown.map(it => { const c = getCategoryColor(it.t.category); return `<div class="month-item${it.cls}" data-id="${it.t.id}" style="background:${c}33;border-color:${c}" title="${escapeAttr(it.t.title)}">${escapeHtml(it.txt)}</div>`; }).join("")}
      ${items.length > 3 ? `<div class="month-more">+${items.length - 3} more</div>` : ""}
    </div>`;
  }
  box.innerHTML = html + "</div>";
  box.querySelectorAll(".month-item").forEach(el => el.addEventListener("click", (e) => { e.stopPropagation(); openModal(el.dataset.id); }));
  box.querySelectorAll(".month-cell").forEach(el => el.addEventListener("click", () => {
    const dt = new Date(el.dataset.date + "T12:00:00");
    const mon = new Date(dt); mon.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); mon.setHours(0, 0, 0, 0);
    weekOffset = Math.round((mon - thisMon) / (7 * 86400000));
    weekView.mode = "week"; saveWeekView();
    renderWeek();
  }));
}

function renderAll() {
  renderGreeting();
  renderCalendar();
  renderStats();
  populateCategorySelects();
  renderTasks();
  renderPriorityQueue();
  renderWeek();
  populateTemplateSelects();
  renderReviewNudge();
  renderMoveBanner();
  populateTimerTaskSelect();
  renderSessionList();
  renderAchievements();
  renderSummary();
  renderNextAchievement();
  renderUpgrade3();
}

migrateFreeSessions();
renderAll();
applyTaskTimerState();
if (freeTimer.startedAt && !timerRunning) {
  document.querySelector('.timer-mode-btn[data-timer-mode="free"]').click();
}
checkAchievements();
initCatDrag();
updateCatAccessories();
renderSceneStars();
applyTimeTheme();
setInterval(applyTimeTheme, 5 * 60 * 1000);
initCloudSync();

let lastKnownDate = todayStr();
function checkDateRollover() {
  const current = todayStr();
  if (current !== lastKnownDate) {
    lastKnownDate = current;
    renderAll();
    checkAchievements();
  }
}
setInterval(checkDateRollover, 60 * 1000);

/* ===================== Time-of-day theme ===================== */
function computeTimeTheme() {
  const hour = new Date().getHours();
  if (hour >= 21 || hour < 5) return "night";
  if (hour >= 16) return "afternoon";
  return "morning";
}

function applyTimeTheme() {
  document.documentElement.setAttribute("data-time-theme", computeTimeTheme());
}

function renderSceneStars() {
  const container = document.getElementById("scene-stars");
  if (!container) return;
  container.innerHTML = "";
  for (let i = 0; i < 14; i++) {
    const star = document.createElement("div");
    star.className = "scene-star";
    const size = 2 + Math.random() * 2;
    star.style.width = size + "px";
    star.style.height = size + "px";
    star.style.top = Math.random() * 55 + "%";
    star.style.left = Math.random() * 100 + "%";
    star.style.animationDelay = (Math.random() * 3) + "s";
    container.appendChild(star);
  }
}

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
