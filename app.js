const STORAGE_KEY = "assembly-room-scheduler-v1";
const DEMO_PREVIEW = window.location.hostname.endsWith(".vercel.app");
const DEFAULT_DATE = "2026-08-25";

const iconMap = {
  calendar: "▣",
  rooms: "▦",
  bookings: "▤",
  approvals: "✓",
  reports: "▥",
  check: "✓",
  clock: "◷",
  people: "♧",
  edit: "✎",
  trash: "⌫"
};

const seedData = () => ({
  settings: {
    preparedBy: "Marisol Santos",
    reportAudience: "Everyone",
    includeEmptyRooms: true,
    emailNotifications: true,
    approvalReminders: true
  },
  rooms: [
    { id: "room-m6a-training", name: "M6A Training Room", type: "Training Room", location: "M6A", capacity: 30, equipment: "Projector, TV, Whiteboard", status: "Available", requiresApproval: true },
    { id: "room-m6b-lounge", name: "M6B Client Lounge", type: "Lounge", location: "M6B", capacity: 18, equipment: "Coffee station, Display", status: "Available", requiresApproval: false },
    { id: "room-m6b-meeting", name: "M6B Meeting Room", type: "Meeting Room", location: "M6B", capacity: 12, equipment: "Display, Whiteboard", status: "Available", requiresApproval: false },
    { id: "room-m5b-conference", name: "M5B Conference Room", type: "Conference Room", location: "M5B", capacity: 16, equipment: "Projector, Conference phone", status: "Available", requiresApproval: false },
    { id: "room-m4a-workshop", name: "M4A Workshop Room", type: "Workshop Room", location: "M4A", capacity: 24, equipment: "Projector, Tables, Whiteboard", status: "Available", requiresApproval: true }
  ],
  reservations: [
    { id: "res-001", roomId: "room-m6a-training", date: DEFAULT_DATE, startTime: "07:00", endTime: "16:00", timeType: "range", reservedFor: "L&D", eventName: "Training", requestedBy: "Marisol Santos", department: "Learning & Development", attendees: 25, equipment: "Projector", remarks: "Quarterly onboarding session", status: "Approved", createdAt: "2026-08-20T08:00:00" },
    { id: "res-002", roomId: "room-m6a-training", date: DEFAULT_DATE, startTime: "16:00", endTime: "23:59", timeType: "onwards", reservedFor: "HRD", eventName: "E-Sports", requestedBy: "Daniel Cruz", department: "HRD", attendees: 20, equipment: "TV", remarks: "", status: "Approved", createdAt: "2026-08-21T08:00:00" },
    { id: "res-003", roomId: "room-m6b-lounge", date: DEFAULT_DATE, startTime: "00:00", endTime: "23:59", timeType: "whole-day", reservedFor: "CNG VIPs", eventName: "Client visit", requestedBy: "Angela Lim", department: "CNG", attendees: 10, equipment: "Coffee station", remarks: "Whole-day guest access", status: "Approved", createdAt: "2026-08-20T08:00:00" },
    { id: "res-004", roomId: "room-m6b-meeting", date: DEFAULT_DATE, startTime: "16:00", endTime: "23:59", timeType: "onwards", reservedFor: "HRD", eventName: "E-Sports", requestedBy: "Daniel Cruz", department: "HRD", attendees: 10, equipment: "Display", remarks: "", status: "Approved", createdAt: "2026-08-21T08:00:00" },
    { id: "res-005", roomId: "room-m5b-conference", date: DEFAULT_DATE, startTime: "08:00", endTime: "10:00", timeType: "range", reservedFor: "Ms. Pat", eventName: "Leadership sync", requestedBy: "Patricia Tan", department: "Operations", attendees: 8, equipment: "Conference phone", remarks: "", status: "Approved", createdAt: "2026-08-20T08:00:00" },
    { id: "res-006", roomId: "room-m5b-conference", date: DEFAULT_DATE, startTime: "16:00", endTime: "23:59", timeType: "onwards", reservedFor: "HRD", eventName: "E-Sports", requestedBy: "Daniel Cruz", department: "HRD", attendees: 14, equipment: "Projector", remarks: "", status: "Approved", createdAt: "2026-08-21T08:00:00" },
    { id: "res-007", roomId: "room-m4a-workshop", date: DEFAULT_DATE, startTime: "11:00", endTime: "12:30", timeType: "range", reservedFor: "Facilities", eventName: "Safety briefing", requestedBy: "Nina Dela Cruz", department: "Facilities", attendees: 18, equipment: "Whiteboard", remarks: "Awaiting facilities confirmation", status: "Pending", createdAt: "2026-08-24T08:00:00" }
  ]
});

let state = normalizeState(seedData());
let currentUser = null;
let users = [];
let databaseSnapshot = null;
let serverRevision = 0;
let liveSyncTimer = null;
let liveSyncInFlight = false;
let localSaveInProgress = false;
let saveQueue = Promise.resolve();
let calendarCursor = new Date(2026, 7, 1);
let isAuthenticated = false;
let currentView = "dashboard";
let selectedReportDate = DEFAULT_DATE;
let reportRoomFilter = "all";
let roomSearch = "";
let reservationSearch = "";
let requestLookupDate = DEFAULT_DATE;
let requestLookupRoom = "";
let currentModal = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const page = $("#page-content");
const modalBackdrop = $("#modal-backdrop");
const modal = $("#modal");

function ensurePreviewAccounts() {
  if (!localStorage.getItem("assembly-demo-users")) {
    localStorage.setItem("assembly-demo-users", JSON.stringify([{ id: 1, name: "Preview Super Admin", email: "preview.superadmin@assembly.local", department: "Administration", role: "Super Admin", status: "Active", password: "PreviewOnly2026!" }]));
  }
}

function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || seedData());
  } catch (_) {
    return normalizeState(seedData());
  }
}

function normalizeState(raw) {
  const defaults = seedData();
  return {
    ...defaults,
    ...raw,
    settings: { ...defaults.settings, ...(raw.settings || {}) },
    rooms: raw.rooms ?? defaults.rooms,
    reservations: (raw.reservations ?? defaults.reservations).map(reservation => ({
      ...reservation,
      date: reservation.date || reservation.startDate || DEFAULT_DATE,
      startDate: reservation.startDate || reservation.date || DEFAULT_DATE,
      endDate: reservation.endDate || reservation.date || reservation.startDate || DEFAULT_DATE,
      assignmentStatus: reservation.assignmentStatus || "Assigned"
    }))
  };
}

function saveState() {
  if (DEMO_PREVIEW) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return Promise.resolve({ ok: true, preview: true });
  }
  const performSave = async () => {
    localSaveInProgress = true;
    try {
      const response = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rooms: state.rooms, reservations: state.reservations, settings: state.settings, revision: serverRevision })
      });
      const result = await response.json();
      if (response.status === 409) {
        await refreshLiveState(true);
        showToast("Schedule changed on another device", "The latest schedule was loaded. Please reapply your change.", "error");
        return null;
      }
      if (!response.ok) throw new Error(result.error || "SQLite save failed");
      serverRevision = Number(result.revision ?? serverRevision);
      return result;
    } catch (error) {
      showToast("Database sync failed", error.message || "The server could not save this change to SQLite.", "error");
      return null;
    } finally {
      localSaveInProgress = false;
    }
  };
  saveQueue = saveQueue.then(performSave, performSave);
  return saveQueue;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function slug(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function dateObject(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLongDate(dateString) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(dateObject(dateString));
}

function formatShortDate(dateString) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(dateObject(dateString));
}

function formatReservationDates(reservation) {
  const start = reservationStartDate(reservation);
  const end = reservationEndDate(reservation);
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

function formatTime(time) {
  if (!time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")}${suffix}`;
}

function formatTimeRange(reservation) {
  if (reservation.timeType === "whole-day") return "Whole day";
  if (reservation.timeType === "onwards") return `${formatTime(reservation.startTime)} onwards`;
  if (reservation.timeType === "blocked") return `${formatTime(reservation.startTime)} - ${formatTime(reservation.endTime)} · blocked`;
  return `${formatTime(reservation.startTime)} - ${formatTime(reservation.endTime)}`;
}

function roomById(id) { return state.rooms.find(room => room.id === id); }
function reservationById(id) { return state.reservations.find(reservation => reservation.id === id); }
function reservationStartDate(reservation) { return reservation.startDate || reservation.date; }
function reservationEndDate(reservation) { return reservation.endDate || reservation.date || reservationStartDate(reservation); }
function reservationCoversDate(reservation, date) { return reservationStartDate(reservation) <= date && reservationEndDate(reservation) >= date; }
function activeReservations(date = selectedReportDate) { return state.reservations.filter(reservation => reservationCoversDate(reservation, date) && !["Cancelled", "Rejected"].includes(reservation.status) && reservation.assignmentStatus !== "Unassigned"); }

function reservationIsExpired(reservation, now = Date.now()) {
  return new Date(`${reservationEndDate(reservation)}T${reservation.endTime || "23:59"}:00`).getTime() < now;
}

function syncExpiredReservations() {
  let changed = false;
  state.reservations.forEach(reservation => {
    if (reservation.status === "Approved" && reservation.assignmentStatus !== "Unassigned" && reservationIsExpired(reservation)) {
      reservation.assignmentStatus = "Unassigned";
      reservation.autoUnassignedAt = new Date().toISOString();
      changed = true;
    }
  });
  if (changed) saveState();
}

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "NA";
}

function statusBadge(status) {
  return `<span class="status-badge ${slug(status)}">${escapeHtml(status)}</span>`;
}

function assignmentBadge(status) {
  return `<span class="assignment-badge ${slug(status)}">${status === "Unassigned" ? "Unassigned" : "Assigned"}</span>`;
}

function roomDot(room) {
  const color = room.status === "Under Maintenance" ? "orange" : room.status === "Disabled" ? "red" : room.status === "Occupied" ? "purple" : "green";
  return `<span class="room-dot ${color}"></span>`;
}

function emptyState(title, copy) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(copy)}</div>`;
}

function pageHeading(eyebrow, title, description, action = "") {
  const resolvedTitle = title === "Good morning, Marisol" ? `Good morning, ${currentUser?.role || "Admin"}` : title;
  return `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(resolvedTitle)}</h1><p>${escapeHtml(description)}</p></div>${action ? `<div class="heading-actions">${action}</div>` : ""}</div>`;
}

function render() {
  if (!isAuthenticated) return;
  syncExpiredReservations();
  const views = { dashboard: renderDashboard, rooms: renderRooms, reservations: renderReservations, approvals: renderApprovals, requests: renderRequests, reports: renderReports, settings: renderSettings, calendar: renderCalendar, users: renderUsers, database: renderDatabase, todo: renderTodo, help: renderHelp };
  page.innerHTML = views[currentView]();
  if (DEMO_PREVIEW) page.insertAdjacentHTML("afterbegin", '<div class="preview-notice"><strong>Vercel preview</strong><span>Demo mode · changes are saved in this browser only.</span></div>');
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === currentView));
  const titleMap = { requests: "Request a room", reports: "Daily report", calendar: "Calendar", users: "Accounts", database: "Database", todo: "To-do list", help: "Help centre" };
  const title = titleMap[currentView] || currentView.charAt(0).toUpperCase() + currentView.slice(1);
  $("#breadcrumb-title").textContent = title === "Reports" ? "Daily report" : title;
  $("#room-count").textContent = state.rooms.length;
  $("#approval-count").textContent = state.reservations.filter(reservation => reservation.status === "Pending").length;
  $("#topbar-date").textContent = formatLongDate(DEFAULT_DATE);
  applyCurrentUser();
  bindViewEvents();
}

function applyCurrentUser() {
  const admin = ["Admin", "Super Admin"].includes(currentUser?.role);
  const superAdmin = currentUser?.role === "Super Admin";
  $(".admin-only").forEach(element => { element.style.display = admin ? "" : "none"; });
  $(".superadmin-only").forEach(element => { element.style.display = superAdmin ? "" : "none"; });
  const avatarText = initials(currentUser?.name || "MS");
  const topAvatar = $("#topbar-avatar");
  if (topAvatar) topAvatar.textContent = avatarText;
  const userAvatar = $(".user-card .avatar");
  if (userAvatar) userAvatar.textContent = avatarText;
  const userName = $(".user-card .user-copy strong");
  const userRole = $(".user-card .user-copy span");
  if (userName) userName.textContent = currentUser?.name || "Marisol Santos";
  if (userRole) userRole.textContent = currentUser?.role || "Administrator";
}

function liveStateSignature(value) {
  const sortById = rows => [...(rows || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const ordered = { rooms: sortById(value.rooms), reservations: sortById(value.reservations), settings: value.settings || {} };
  return JSON.stringify(ordered, (key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.keys(item).sort().reduce((sorted, name) => { sorted[name] = item[name]; return sorted; }, {});
    }
    return item;
  });
}

async function refreshLiveState(force = false) {
  if (liveSyncInFlight || !isAuthenticated || (!force && (localSaveInProgress || currentModal))) return;
  if (document.hidden && !force) return;
  liveSyncInFlight = true;
  try {
    if (DEMO_PREVIEW) {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (stored) {
        const incoming = normalizeState(stored);
        if (liveStateSignature(incoming) !== liveStateSignature(state)) {
          state = incoming;
          render();
          showToast("Schedule updated", "Changes from another preview tab are now visible.", "info");
        }
      }
      return;
    }
    const response = await fetch("/api/bootstrap", { headers: { "Accept": "application/json" } });
    if (!response.ok) {
      if (response.status === 401) showLogin("Your session expired. Sign in again.");
      return;
    }
    const payload = await response.json();
    serverRevision = Number(payload.revision ?? serverRevision);
    const incoming = normalizeState(payload);
    if (liveStateSignature(incoming) !== liveStateSignature(state)) {
      state = incoming;
      render();
      showToast("Schedule updated", "Changes from another user are now visible.", "info");
    }
  } catch (_) {
    // Keep the current schedule visible and retry on the next poll.
  } finally {
    liveSyncInFlight = false;
  }
}

function startLiveSync() {
  if (liveSyncTimer) clearInterval(liveSyncTimer);
  liveSyncTimer = setInterval(() => refreshLiveState(), 3000);
}

function stopLiveSync() {
  if (liveSyncTimer) clearInterval(liveSyncTimer);
  liveSyncTimer = null;
}

async function loadAppFromSQLite(user) {
  const response = await fetch("/api/bootstrap");
  if (!response.ok) throw new Error("Could not load the SQLite workspace");
  const payload = await response.json();
  currentUser = user || payload.currentUser;
  state = normalizeState(payload);
  serverRevision = Number(payload.revision || 0);
  isAuthenticated = true;
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("app-hidden");
  render();
  startLiveSync();
}

function showLogin(message = "") {
  stopLiveSync();
  isAuthenticated = false;
  currentUser = null;
  $("#login-screen").classList.remove("hidden");
  $("#app-shell").classList.add("app-hidden");
  const error = $("#login-error");
  if (error) {
    error.textContent = message;
    error.classList.toggle("hidden", !message);
  }
}

async function boot() {
  if (DEMO_PREVIEW) {
    ensurePreviewAccounts();
    state = loadState();
    const hint = $(".login-hint");
    if (hint) hint.innerHTML = "<strong>Vercel preview account</strong><span>preview.superadmin@assembly.local · PreviewOnly2026!</span>";
    $("#login-email").value = "preview.superadmin@assembly.local";
    showLogin();
    return;
  }
  try {
    const response = await fetch("/api/session");
    if (response.ok) {
      const payload = await response.json();
      await loadAppFromSQLite(payload.user);
    } else {
      showLogin();
    }
  } catch (_) {
    showLogin("Start the SQLite server, then refresh this page.");
  }
}

function renderDashboard() {
  const todayReservations = activeReservations(DEFAULT_DATE);
  const approvedToday = todayReservations.filter(reservation => reservation.status === "Approved");
  const pending = state.reservations.filter(reservation => reservation.status === "Pending");
  const occupied = approvedToday.filter(reservation => isCurrentlyActive(reservation)).length;
  const available = Math.max(0, state.rooms.length - occupied);
  const occupancyRate = state.rooms.length ? Math.round((occupied / state.rooms.length) * 100) : 0;
  const nextBookings = todayReservations.filter(reservation => reservation.status === "Approved").sort((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, 5);

  return `${pageHeading("Tuesday, 25 August 2026", "Good morning, Marisol", "Here’s what’s happening across your rooms today.", `<button class="button secondary" data-action="copy-today-schedule">▣ &nbsp; Copy today’s schedule</button><button class="button" data-action="new-reservation"><span class="plus">+</span> New reservation</button>`)}
    <div class="metrics-grid">
      ${metricCard("Total reservations today", approvedToday.length, "calendar", "purple", `<span class="trend-up">+3</span> vs. last Tuesday`)}
      ${metricCard("Pending approvals", pending.length, "approvals", "orange", pending.length ? "Needs your attention" : "All requests are clear")}
      ${metricCard("Available rooms now", available, "rooms", "green", `${state.rooms.length} rooms in workspace`)}
      ${metricCard("Occupied rooms", occupied, "bookings", "red", `${occupancyRate}% current occupancy`)}
    </div>
    <div class="quick-actions"><button class="quick-action-card" data-action="new-reservation"><span class="quick-action-icon purple">＋</span><span><strong>Add schedule</strong><small>Create a reservation with a required date and time</small></span><b>→</b></button><button class="quick-action-card" data-action="new-room"><span class="quick-action-icon green">▦</span><span><strong>Add meeting room</strong><small>Add capacity, equipment, and approval rules</small></span><b>→</b></button><button class="quick-action-card" data-view="requests"><span class="quick-action-icon orange">⌕</span><span><strong>Check availability</strong><small>Find an open slot before you submit a request</small></span><b>→</b></button></div>
    <div class="content-grid">
      <section class="panel view-panel">
        <div class="panel-header"><div><h2 class="panel-title">Today’s reservations</h2><p class="panel-subtitle">Approved room bookings for ${formatShortDate(DEFAULT_DATE)}</p></div><button class="panel-link" data-view="reservations">View all →</button></div>
        ${nextBookings.length ? `<div class="table-wrap"><table><thead><tr><th>Room</th><th>Time</th><th>Reserved for</th><th>Status</th></tr></thead><tbody>${nextBookings.map(reservationRow).join("")}</tbody></table></div>` : emptyState("No approved bookings today", "Your rooms are ready for new reservations.")}
      </section>
      <section class="panel occupancy-panel">
        <div class="panel-header"><div><h2 class="panel-title">Room occupancy</h2><p class="panel-subtitle">Live overview for today</p></div><button class="panel-link" data-view="rooms">Manage rooms</button></div>
        <div class="occupancy-body"><div class="occupancy-score"><strong>${occupancyRate}%</strong><span>${occupied} of ${state.rooms.length} rooms in use</span></div><div class="progress"><span style="width:${Math.max(4, occupancyRate)}%"></span></div><div class="occupancy-note">Peak usage expected between 4:00 PM – 6:00 PM</div><div class="room-status-list">${state.rooms.slice(0, 4).map(roomStatusRow).join("")}</div></div>
      </section>
    </div>`;
}

function metricCard(label, value, icon, color, note) {
  return `<article class="metric-card"><div class="metric-top"><span class="metric-label">${label}</span><span class="metric-icon ${color}">${iconMap[icon] || "•"}</span></div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`;
}

function reservationRow(reservation) {
  const room = roomById(reservation.roomId);
  return `<tr><td><div class="room-cell">${roomDot(room)}<strong>${escapeHtml(room?.name || "Unknown room")}</strong></div></td><td>${escapeHtml(formatTimeRange(reservation))}</td><td><strong>${escapeHtml(reservation.reservedFor)}</strong><span class="room-type">${escapeHtml(reservation.eventName || "Internal booking")}</span></td><td>${statusBadge(reservation.status)}</td></tr>`;
}

function roomStatusRow(room) {
  const roomBookings = activeReservations(DEFAULT_DATE).filter(reservation => reservation.roomId === room.id && reservation.status === "Approved");
  const current = roomBookings.find(isCurrentlyActive);
  const label = current ? "Occupied" : room.status;
  return `<div class="room-status-row">${roomDot({ ...room, status: label })}<div class="room-status-info"><strong>${escapeHtml(room.name)}</strong><span>${current ? escapeHtml(formatTimeRange(current)) : "Available for booking"}</span></div><span>${current ? "In use" : "Open"}</span></div>`;
}

function isCurrentlyActive(reservation) {
  // The demo uses the report date as its operating day so the seeded schedule remains predictable.
  const simulatedTime = "13:00";
  return reservation.date === DEFAULT_DATE && reservation.status === "Approved" && reservation.startTime <= simulatedTime && reservation.endTime > simulatedTime;
}

function renderRooms() {
  const filtered = state.rooms.filter(room => `${room.name} ${room.type} ${room.location}`.toLowerCase().includes(roomSearch.toLowerCase()));
  return `${pageHeading("Workspace", "Rooms", "Manage your spaces, equipment, and approval rules.", `<button class="button" data-action="new-room"><span class="plus">+</span> Add room</button>`)}
    <div class="toolbar"><div class="search-box"><span>⌕</span><input id="room-search" type="search" value="${escapeHtml(roomSearch)}" placeholder="Search rooms..." /></div><div class="toolbar-actions"><select class="select-control" id="room-status-filter"><option value="all">All statuses</option><option>Available</option><option>Under Maintenance</option><option>Disabled</option></select><button class="button secondary" data-action="room-view-toggle">☷ &nbsp; Table view</button></div></div>
    <div class="card-grid">${filtered.map(roomCard).join("") || emptyState("No rooms found", "Try a different search term or add a new room.")}</div>`;
}

function roomCard(room) {
  const status = room.status === "Available" ? "Available" : room.status;
  return `<article class="room-card"><div class="room-card-top"><div><h3>${escapeHtml(room.name)}</h3><span class="room-type">${escapeHtml(room.type)}</span></div>${statusBadge(status)}</div><div class="room-card-location">⌖ &nbsp; ${escapeHtml(room.location)}</div><div class="room-card-meta"><span>♧ &nbsp; Capacity ${room.capacity}</span>${room.requiresApproval ? `<span>· Approval required</span>` : ""}</div><div class="room-card-equipment">${escapeHtml(room.equipment || "No equipment listed")}</div><div class="room-card-actions"><button class="button secondary small" data-action="edit-room" data-id="${room.id}">Edit room</button><button class="button ghost small" data-action="new-reservation" data-room-id="${room.id}">Book room</button></div></article>`;
}

function renderReservations() {
  const filtered = state.reservations.filter(reservation => {
    const room = roomById(reservation.roomId);
    const haystack = `${room?.name || ""} ${reservation.reservedFor} ${reservation.eventName} ${reservation.requestedBy} ${reservation.department}`.toLowerCase();
    return haystack.includes(reservationSearch.toLowerCase());
  }).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  return `${pageHeading("Workspace", "Reservations", "Create, review, and keep track of every room booking.", `<button class="button" data-action="new-reservation"><span class="plus">+</span> New reservation</button>`)}
    <div class="subnav"><button class="active" data-res-tab="all">All reservations</button><button data-res-tab="today">Today</button><button data-res-tab="pending">Pending approval</button><button data-res-tab="mine">My requests</button></div>
    <div class="toolbar"><div class="search-box"><span>⌕</span><input id="reservation-search" type="search" value="${escapeHtml(reservationSearch)}" placeholder="Search reservations..." /></div><div class="toolbar-actions"><button class="button secondary" data-action="export-reservations">↓ &nbsp; Export list</button></div></div>
    <section class="panel view-panel"><div class="panel-header"><div><h2 class="panel-title">All reservations</h2><p class="panel-subtitle">${filtered.length} booking${filtered.length === 1 ? "" : "s"} across ${state.rooms.length} rooms</p></div></div>${filtered.length ? `<div class="table-wrap"><table><thead><tr><th>Room & date</th><th>Time</th><th>Reserved for</th><th>Requested by</th><th>Status</th><th></th></tr></thead><tbody>${filtered.map(fullReservationRow).join("")}</tbody></table></div>` : emptyState("No reservations found", "Create a reservation to start building your schedule.")}</section>`;
}

function fullReservationRow(reservation) {
  const room = roomById(reservation.roomId);
  return `<tr><td><div class="room-cell">${roomDot(room)}<div><strong>${escapeHtml(room?.name || "Unknown room")}</strong><span class="room-type">${formatReservationDates(reservation)}</span></div></div></td><td>${escapeHtml(formatTimeRange(reservation))}</td><td><strong>${escapeHtml(reservation.reservedFor)}</strong><span class="room-type">${escapeHtml(reservation.eventName || "Internal booking")}</span></td><td>${escapeHtml(reservation.requestedBy)}</td><td>${statusBadge(reservation.status)}${reservation.assignmentStatus === "Unassigned" ? `<div style="margin-top:5px">${assignmentBadge(reservation.assignmentStatus)}</div>` : ""}</td><td><div class="action-group"><button class="table-action" data-action="view-reservation" data-id="${reservation.id}">View</button><button class="table-action danger" data-action="cancel-reservation" data-id="${reservation.id}">Cancel</button></div></td></tr>`;
}

function renderApprovals() {
  const pending = state.reservations.filter(reservation => reservation.status === "Pending");
  const approved = state.reservations.filter(reservation => reservation.status === "Approved").length;
  const rejected = state.reservations.filter(reservation => reservation.status === "Rejected").length;
  return `${pageHeading("Workflow", "Approvals", "Review requests that need a room owner’s sign-off.", pending.length ? `<button class="button secondary" data-action="approve-all">✓ Approve all</button>` : "")}
    <div class="approval-summary"><div class="mini-stat warning"><span>Waiting for review</span><strong>${pending.length}</strong></div><div class="mini-stat success"><span>Approved requests</span><strong>${approved}</strong></div><div class="mini-stat muted"><span>Rejected requests</span><strong>${rejected}</strong></div></div>
    <section class="panel view-panel"><div class="panel-header"><div><h2 class="panel-title">Requests waiting for review</h2><p class="panel-subtitle">Approve or reject requests before they appear in the daily report.</p></div></div>${pending.length ? `<div class="table-wrap"><table><thead><tr><th>Request</th><th>Room & time</th><th>Attendees</th><th>Requested</th><th></th></tr></thead><tbody>${pending.map(approvalRow).join("")}</tbody></table></div>` : emptyState("You’re all caught up", "There are no reservation requests waiting for approval.")}</section>`;
}

function approvalRow(reservation) {
  const room = roomById(reservation.roomId);
  return `<tr id="approval-row-${reservation.id}"><td><div class="approval-cell"><span class="requester-avatar">${initials(reservation.requestedBy)}</span><div class="approval-request"><strong>${escapeHtml(reservation.eventName || "Room reservation")}</strong><span>${escapeHtml(reservation.requestedBy)} · ${escapeHtml(reservation.department)}</span></div></div></td><td><strong>${escapeHtml(room?.name || "Unknown room")}</strong><span class="room-type">${formatReservationDates(reservation)} · ${escapeHtml(formatTimeRange(reservation))}</span></td><td>${reservation.attendees || "—"} people</td><td>${statusBadge("Pending")}</td><td><div class="action-group"><button class="button success small" data-action="approve" data-id="${reservation.id}">Approve</button><button class="button danger small" data-action="reject" data-id="${reservation.id}">Reject</button></div></td></tr>`;
}

function renderRequests() {
  const rooms = state.rooms.filter(room => room.status !== "Disabled" && room.status !== "Under Maintenance");
  const selectedRoomId = requestLookupRoom || rooms[0]?.id || "";
  const selectedRoom = roomById(selectedRoomId);
  const windows = selectedRoom ? availableWindows(selectedRoom, requestLookupDate) : [];
  const busy = selectedRoom ? activeReservations(requestLookupDate).filter(reservation => reservation.roomId === selectedRoom.id).sort((a, b) => a.startTime.localeCompare(b.startTime)) : [];
  return `${pageHeading("Self-service", "Request a room", "Plan ahead, check open times, and submit a request to the room approver.", `<button class="button" data-action="new-reservation" data-room-id="${selectedRoomId}"><span class="plus">+</span> Request a room</button>`)}
    <div class="request-layout"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">Find an available time</h2><p class="panel-subtitle">Available slots are calculated from approved and assigned reservations.</p></div></div><div class="request-filters"><label class="form-field"><span class="form-label">Date</span><input class="form-control" id="request-date" type="date" value="${requestLookupDate}" /></label><label class="form-field"><span class="form-label">Room</span><select class="form-control" id="request-room">${rooms.map(room => `<option value="${room.id}" ${room.id === selectedRoomId ? "selected" : ""}>${escapeHtml(room.name)}</option>`).join("")}</select></label></div><div class="availability-section"><div class="availability-header"><div><h3>${escapeHtml(selectedRoom?.name || "Select a room")}</h3><p>${selectedRoom ? `${selectedRoom.capacity} seats · ${escapeHtml(selectedRoom.equipment)}` : "Choose a room to see its schedule."}</p></div>${selectedRoom ? `<span class="status-badge available">${windows.length} open slot${windows.length === 1 ? "" : "s"}</span>` : ""}</div>${selectedRoom ? `<div class="availability-grid">${windows.length ? windows.map(window => `<button class="slot-card" data-action="request-slot" data-room-id="${selectedRoom.id}" data-start="${window.start}" data-end="${window.end}"><span>${formatTime(window.start)} – ${formatTime(window.end)}</span><small>Request this time →</small></button>`).join("") : emptyState("No open slots found", "Try another date or room.")}</div>` : emptyState("Choose a room", "Available times will appear here.")}</div></section><section class="panel"><div class="panel-header"><div><h2 class="panel-title">Already booked</h2><p class="panel-subtitle">${formatShortDate(requestLookupDate)}</p></div></div>${busy.length ? `<div class="booking-list">${busy.map(reservation => `<div class="booking-list-row"><span class="booking-time">${escapeHtml(formatTimeRange(reservation))}</span><div><strong>${escapeHtml(reservation.eventName || "Room booking")}</strong><small>Reserved for ${escapeHtml(reservation.reservedFor)}</small></div>${statusBadge(reservation.status)}</div>`).join("")}</div>` : emptyState("Nothing booked yet", "This room is open for the selected date.")}</section></div>`;
}

function availableWindows(room, date) {
  const dayStart = "07:00";
  const dayEnd = "20:00";
  const bookings = activeReservations(date).filter(reservation => reservation.roomId === room.id).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const windows = [];
  let cursor = dayStart;
  bookings.forEach(booking => {
    const start = booking.startTime < dayStart ? dayStart : booking.startTime;
    const end = booking.endTime > dayEnd ? dayEnd : booking.endTime;
    if (start > cursor) windows.push({ start: cursor, end: start });
    if (end > cursor) cursor = end;
  });
  if (cursor < dayEnd) windows.push({ start: cursor, end: dayEnd });
  return windows.filter(window => window.start < window.end);
}

function renderTodo() {
  const todoItems = [
    ["done", "Room reservation MVP", "Create rooms, reservations, conflict checking, approvals, and daily report."],
    ["done", "Copy today’s schedule", "Copy the report text directly from the dashboard or daily report."],
    ["done", "Weekly, monthly, yearly CSV exports", "Download filtered CSV files from the daily report page."],
    ["done", "User advance request page", "Users can select a room/date and view available times before requesting."],
    ["done", "Admin assign / unassign controls", "Admin can mark a reserved slot unassigned, assign it again, or delete the meeting."],
    ["done", "Automatic end-date unassignment", "Assigned slots are automatically released after their end date and time."],
    ["next", "Confirm final meeting room names", "Replace the sample room list after the official names are provided."],
    ["next", "Connect real user login and roles", "Replace the demo administrator with employee, approver, admin, and read-only roles."],
    ["next", "Connect PostgreSQL and Drizzle", "Move local browser storage into the production database."],
    ["next", "Connect email delivery", "Send approval updates and the daily schedule through SMTP or Microsoft Graph."],
    ["next", "Add PDF and Excel report exports", "Add printable PDF and workbook exports after the report format is approved."]
  ];
  const done = todoItems.filter(item => item[0] === "done").length;
  return `${pageHeading("Project tracking", "To-do list", "The requested workflow is captured here so we can build it in a clear order.", `<button class="button secondary" data-action="copy-todo">Copy list</button>`)}<section class="todo-summary"><div><strong>${done}</strong><span>completed in this MVP</span></div><div class="todo-progress"><span style="width:${Math.round((done / todoItems.length) * 100)}%"></span></div><span>${todoItems.length - done} next steps remain</span></section><section class="panel todo-panel"><div class="panel-header"><div><h2 class="panel-title">Requested features</h2><p class="panel-subtitle">Completed items are ready to review; next items are queued for the production build.</p></div></div><div class="todo-list">${todoItems.map(([status, title, description]) => `<div class="todo-row"><span class="todo-check ${status}">${status === "done" ? "✓" : "→"}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></div><span class="todo-status ${status}">${status === "done" ? "In MVP" : "Next"}</span></div>`).join("")}</div></section>`;
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const monthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(calendarCursor);
  const first = new Date(year, month, 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - ((first.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const iso = toDateInputValue(date);
    const inMonth = date.getMonth() === month;
    const events = activeReservations(iso).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const eventMarkup = events.slice(0, 3).map(reservation => '<div class="calendar-event ' + (reservation.status === "Pending" ? "teal" : "") + '">' + escapeHtml(formatTimeRange(reservation)) + ' · ' + escapeHtml(reservation.eventName || reservation.reservedFor) + '</div>').join("");
    const more = events.length > 3 ? '<div class="calendar-more">+' + (events.length - 3) + ' more</div>' : "";
    return '<div class="calendar-day ' + (inMonth ? "" : "muted") + ' ' + (iso === DEFAULT_DATE ? "today" : "") + '" data-action="calendar-add" data-id="' + iso + '" title="Add a schedule on ' + formatShortDate(iso) + '"><div class="calendar-day-number"><span>' + date.getDate() + '</span><span class="calendar-add">＋</span></div><div class="calendar-events">' + eventMarkup + more + '</div></div>';
  }).join("");
  const controls = '<div class="calendar-toolbar"><button class="button secondary small" data-action="calendar-prev">←</button><span class="calendar-title">' + escapeHtml(monthTitle) + '</span><button class="button secondary small" data-action="calendar-next">→</button><button class="button small" data-action="calendar-today">Today</button></div>';
  const addButton = '<button class="button" data-action="calendar-add" data-id="' + DEFAULT_DATE + '"><span class="plus">+</span> Add schedule</button>';
  return pageHeading("Planning", "Calendar", "See the month at a glance and add a schedule directly to any date.", controls + addButton) +
    '<div class="calendar-shell"><div class="calendar-weekdays"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="calendar-grid">' + cells + '</div></div><p class="calendar-help"><strong>Tip:</strong> Select any day to open a pre-filled schedule form. Approved and pending bookings are shown with different colors.</p>';
}

function renderUsers() {
  if (!["Admin", "Super Admin"].includes(currentUser?.role)) return pageHeading("Administration", "Accounts", "You do not have permission to manage accounts.") + emptyState("Admin access required", "Ask an administrator to create or manage accounts.");
  return pageHeading("Administration", "Accounts", "Create Admin accounts with full system access, except database editing.", '<button class="button" data-action="new-user"><span class="plus">+</span> Add account</button>') +
    '<section class="panel view-panel"><div class="panel-header"><div><h2 class="panel-title">Workspace accounts</h2><p class="panel-subtitle">' + users.length + ' account' + (users.length === 1 ? "" : "s") + ' can sign in to this SQLite workspace.</p></div><span class="role-pill admin">Admin access</span></div><div class="account-list">' + (users.length ? users.map(accountRow).join("") : emptyState("Loading accounts", "Fetching the account list from SQLite.")) + '</div></section>';
}

function accountRow(user) {
  const isSelf = user.id === currentUser?.id;
  const protectedAccount = user.role === "Super Admin";
  const disabled = isSelf || protectedAccount;
  const actionLabel = isSelf ? "Current account" : protectedAccount ? "Protected" : "Delete";
  return '<div class="account-row"><div class="avatar avatar-purple">' + initials(user.name) + '</div><div class="account-copy"><strong>' + escapeHtml(user.name) + '</strong><small>' + escapeHtml(user.email) + ' · ' + escapeHtml(user.department || "Operations") + '</small></div><span class="role-pill ' + (user.role === "Admin" || user.role === "Super Admin" ? "admin" : "") + '">' + escapeHtml(user.role) + '</span><button class="account-delete" data-action="delete-user" data-id="' + user.id + '" ' + (disabled ? "disabled" : "") + '>' + actionLabel + '</button></div>';
}

function renderReportsLegacy() {
  const rooms = reportRoomFilter === "all" ? state.rooms : state.rooms.filter(room => room.id === reportRoomFilter);
  const approved = activeReservations(selectedReportDate).filter(reservation => reservation.status === "Approved");
  const reportRooms = rooms.map(room => ({ room, reservations: approved.filter(reservation => reservation.roomId === room.id).sort((a, b) => a.startTime.localeCompare(b.startTime)) })).filter(entry => state.settings.includeEmptyRooms || entry.reservations.length);
  return `${pageHeading("Communication", "Daily room report", "Turn approved reservations into the schedule your team can rely on.", `<button class="button" data-action="send-report">✈ &nbsp; Send report</button>`)}
    <div class="report-layout"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">Report settings</h2><p class="panel-subtitle">Choose a date and rooms to include.</p></div></div><div class="report-config"><div class="form-grid"><label class="form-field"><span class="form-label">Report date</span><input class="form-control" type="date" id="report-date" value="${selectedReportDate}" /></label><label class="form-field"><span class="form-label">Prepared by</span><input class="form-control" type="text" id="report-prepared-by" value="${escapeHtml(state.settings.preparedBy)}" /></label><label class="form-field full"><span class="form-label">Room filter</span><select class="form-control" id="report-room-filter"><option value="all">All rooms</option>${state.rooms.map(room => `<option value="${room.id}" ${reportRoomFilter === room.id ? "selected" : ""}>${escapeHtml(room.name)}</option>`).join("")}</select></label></div><label class="checkbox-field"><input type="checkbox" id="include-empty-rooms" ${state.settings.includeEmptyRooms ? "checked" : ""} /> Include rooms with no approved reservations</label><div class="report-actions"><button class="button" data-action="generate-report">↻ &nbsp; Generate report</button><button class="button secondary" data-action="preview-email">Preview email</button><button class="button secondary" data-action="export-report">↓ &nbsp; Export .txt</button></div></div></section><section class="report-paper" id="report-paper"><p class="report-greeting">${escapeHtml(state.settings.reportAudience)}</p><h2>${escapeHtml(state.settings.preparedBy)} - Assembly Room Schedule</h2><p class="report-date">${formatLongDate(selectedReportDate)}</p>${reportRooms.length ? reportRooms.map(reportRoomBlock).join("") : `<div class="report-empty">No rooms match the selected filter.</div>`}<div class="report-paper-footer">Generated from approved reservations · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div></section></div>`;
}

function renderReportsWithTable() {
  const rooms = reportRoomFilter === "all" ? state.rooms : state.rooms.filter(room => room.id === reportRoomFilter);
  const approved = activeReservations(selectedReportDate).filter(reservation => reservation.status === "Approved");
  const reportRooms = rooms.map(room => ({ room, reservations: approved.filter(reservation => reservation.roomId === room.id).sort((a, b) => a.startTime.localeCompare(b.startTime)) })).filter(entry => state.settings.includeEmptyRooms || entry.reservations.length);
  return `${pageHeading("Communication", "Daily room report", "Turn approved reservations into the schedule your team can rely on.", `<button class="button secondary" data-action="copy-today-schedule">▣ &nbsp; Copy schedule</button><button class="button" data-action="send-report">✈ &nbsp; Send report</button>`)}
    <div class="report-layout"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">Report settings</h2><p class="panel-subtitle">Choose a date and rooms to include.</p></div></div><div class="report-config"><div class="form-grid"><label class="form-field"><span class="form-label">Report date</span><input class="form-control" type="date" id="report-date" value="${selectedReportDate}" /></label><label class="form-field"><span class="form-label">Prepared by</span><input class="form-control" type="text" id="report-prepared-by" value="${escapeHtml(state.settings.preparedBy)}" /></label><label class="form-field full"><span class="form-label">Room filter</span><select class="form-control" id="report-room-filter"><option value="all">All rooms</option>${state.rooms.map(room => `<option value="${room.id}" ${reportRoomFilter === room.id ? "selected" : ""}>${escapeHtml(room.name)}</option>`).join("")}</select></label></div><label class="checkbox-field"><input type="checkbox" id="include-empty-rooms" ${state.settings.includeEmptyRooms ? "checked" : ""} /> Include rooms with no approved reservations</label><div class="report-actions"><button class="button" data-action="generate-report">↻ &nbsp; Generate report</button><button class="button secondary" data-action="preview-email">Preview email</button><button class="button secondary" data-action="export-report">↓ &nbsp; Export .txt</button></div><div class="csv-export-block"><span>Export approved reservations</span><div><button class="button secondary small" data-action="export-csv-period" data-period="week">Weekly CSV</button><button class="button secondary small" data-action="export-csv-period" data-period="month">Monthly CSV</button><button class="button secondary small" data-action="export-csv-period" data-period="year">Yearly CSV</button></div></div></div></section><section class="report-paper" id="report-paper"><p class="report-greeting">${escapeHtml(state.settings.reportAudience)}</p><h2>${escapeHtml(state.settings.preparedBy)} - Assembly Room Schedule</h2><p class="report-date">${formatLongDate(selectedReportDate)}</p>${reportRooms.length ? reportRooms.map(reportRoomBlock).join("") : `<div class="report-empty">No rooms match the selected filter.</div>`}<div class="report-paper-footer">Generated from approved reservations · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div></section></div>
    <section class="panel schedule-table-panel"><div class="panel-header"><div><h2 class="panel-title">${selectedReportDate === DEFAULT_DATE ? "Today’s schedule" : `Schedule for ${formatShortDate(selectedReportDate)}`}</h2><p class="panel-subtitle">Table view for quick copying, review, and handover.</p></div><button class="panel-link" data-action="copy-today-schedule">Copy table →</button></div>${approved.length ? `<div class="table-wrap"><table><thead><tr><th>Room</th><th>Date</th><th>Time</th><th>Reserved for</th><th>Requested by</th><th>Status</th></tr></thead><tbody>${approved.sort((a, b) => `${a.startTime}${a.roomId}`.localeCompare(`${b.startTime}${b.roomId}`)).map(scheduleTableRow).join("")}</tbody></table></div>` : emptyState("No approved reservations", "Generate a schedule after an approver confirms a request.")}</section>`;
}

function renderReports() {
  return renderReportsWithTable().replace(/<section class="panel schedule-table-panel">[\s\S]*?<\/section>$/, "");
}

function scheduleTableRow(reservation) {
  const room = roomById(reservation.roomId);
  return `<tr><td><div class="room-cell">${roomDot(room)}<strong>${escapeHtml(room?.name || "Unknown room")}</strong></div></td><td>${escapeHtml(formatReservationDates(reservation))}</td><td>${escapeHtml(formatTimeRange(reservation))}</td><td><strong>${escapeHtml(reservation.reservedFor)}</strong><span class="room-type">${escapeHtml(reservation.eventName || "Internal booking")}</span></td><td>${escapeHtml(reservation.requestedBy)}</td><td>${statusBadge("Approved")} ${assignmentBadge(reservation.assignmentStatus || "Assigned")}</td></tr>`;
}

function reportRoomBlock(entry) {
  const { room, reservations } = entry;
  return `<div class="report-room-block"><h3>${escapeHtml(room.name)}</h3>${reservations.length ? reservations.map(reportLine).join("") : `<p class="report-line">No reservations scheduled</p>`}</div>`;
}

function reportLine(reservation) {
  let line = "";
  if (reservation.timeType === "whole-day") line = `Reserved for ${reservation.reservedFor} (Whole Day)`;
  else if (reservation.timeType === "onwards") line = `${formatTime(reservation.startTime)} onwards - Reserved for ${reservation.reservedFor}${reservation.eventName ? ` (${reservation.eventName})` : ""}`;
  else line = `${formatTime(reservation.startTime)} - ${formatTime(reservation.endTime)} - Reserved for ${reservation.reservedFor}${reservation.eventName ? ` (${reservation.eventName})` : ""}`;
  return `<p class="report-line">${escapeHtml(line)}</p>`;
}

function renderDatabase() {
  const tables = databaseSnapshot?.tables || {};
  const canEdit = currentUser?.role === "Super Admin";
  const notice = canEdit
    ? "Super Admin can edit database records. Password hashes are never displayed."
    : "Read-only access. Only the Super Admin can edit database records.";
  return pageHeading("Administration", "Database", "Review the application records stored in SQLite.", "") +
    '<div class="preview-notice"><strong>' + (canEdit ? "Editable" : "View only") + '</strong><span>' + notice + '</span></div>' +
    Object.entries(tables).map(([name, rows]) => databaseTable(name, rows, canEdit)).join("") +
    (!Object.keys(tables).length ? emptyState("Loading database", "Fetching records from the SQLite database.") : "");
}

function databaseTable(name, rows, canEdit) {
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  if (!rows?.length) return '<section class="panel view-panel database-panel"><h2>' + escapeHtml(title) + '</h2>' + emptyState("No records", "This table is empty.") + '</section>';
  const columns = Object.keys(rows[0]);
  const editable = canEdit;
  const header = columns.map(column => '<th>' + escapeHtml(column.replaceAll("_", " ")) + '</th>').join("") + (editable ? "<th>Actions</th>" : "");
  const body = rows.map(row => {
    const rowId = row.id ?? row.setting_key;
    return '<tr>' + columns.map(column => '<td>' + escapeHtml(row[column] ?? "") + '</td>').join("") +
      (editable ? '<td><button class="table-action" data-action="edit-db-row" data-table="' + name + '" data-id="' + escapeHtml(rowId) + '">Edit</button></td>' : "") + '</tr>';
  }).join("");
  return '<section class="panel view-panel database-panel"><div class="panel-header"><div><h2>' + escapeHtml(title) + '</h2><p class="panel-subtitle">' + rows.length + ' records</p></div></div><div class="table-wrap"><table><thead><tr>' + header + '</tr></thead><tbody>' + body + '</tbody></table></div></section>';
}

async function fetchDatabase() {
  if (DEMO_PREVIEW) {
    const accounts = JSON.parse(localStorage.getItem("assembly-demo-users") || "[]").map(({password, ...user}) => user);
    databaseSnapshot = { tables: {
      users: accounts,
      rooms: state.rooms.map(room => ({id:room.id,name:room.name,type:room.type,location:room.location,capacity:room.capacity,equipment:room.equipment,status:room.status,requires_approval:room.requiresApproval})),
      reservations: state.reservations.map(item => ({id:item.id,room_id:item.roomId,reserved_for:item.reservedFor,event_name:item.eventName,requested_by:item.requestedBy,department:item.department,date:item.date,start_date:item.startDate,end_date:item.endDate,start_time:item.startTime,end_time:item.endTime,time_type:item.timeType,attendees:item.attendees,equipment:item.equipment,remarks:item.remarks,status:item.status,assignment_status:item.assignmentStatus})),
      settings: Object.entries(state.settings).map(([setting_key,setting_value])=>({setting_key,setting_value:JSON.stringify(setting_value)}))
    }};
    render();
    return;
  }
  try {
    const response = await fetch("/api/database");
    if (!response.ok) throw new Error("Database access unavailable");
    databaseSnapshot = await response.json();
    render();
  } catch (_) {
    showToast("Could not load database", "Check the SQLite server connection and your account permissions.", "error");
  }
}

function openDatabaseRow(table, id) {
  if (currentUser?.role !== "Super Admin") return showToast("Read-only access", "Only the Super Admin can edit database records.", "error");
  const rows = databaseSnapshot?.tables?.[table] || [];
  const record = rows.find(row => String(row.id ?? row.setting_key) === String(id));
  if (!record) return;
  const excluded = ["id","setting_key","created_at","updated_at","auto_unassigned_at"];
  const fields = Object.entries(record).filter(([key]) => !excluded.includes(key));
  const formFields = fields.map(([key,value]) => '<label class="form-field"><span class="form-label">' + escapeHtml(key.replaceAll("_", " ")) + '</span><input class="form-control" name="' + escapeHtml(key) + '" value="' + escapeHtml(value ?? "") + '" /></label>').join("");
  openModal('<div class="modal-header"><div><h2 id="modal-title">Edit database record</h2><p>' + escapeHtml(table) + ' · ' + escapeHtml(id) + '</p></div><button class="modal-close" data-action="close-modal">×</button></div><form id="database-row-form"><div class="modal-body"><div class="form-grid">' + formFields + '</div></div><div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button">Save record</button></div></form>');
  $("#database-row-form").addEventListener("submit", async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target).entries());
    if (DEMO_PREVIEW) {
      Object.assign(record, values);
      if (table === "rooms") state.rooms = databaseSnapshot.tables.rooms.map(row=>({id:row.id,name:row.name,type:row.type,location:row.location,capacity:Number(row.capacity),equipment:row.equipment,status:row.status,requiresApproval:["1","true","yes","on"].includes(String(row.requires_approval).toLowerCase())}));
      if (table === "reservations") state.reservations = databaseSnapshot.tables.reservations.map(row=>({...row,roomId:row.room_id,reservedFor:row.reserved_for,eventName:row.event_name,requestedBy:row.requested_by,date:row.date,startDate:row.start_date,endDate:row.end_date,startTime:row.start_time,endTime:row.end_time,timeType:row.time_type,assignmentStatus:row.assignment_status,attendees:Number(row.attendees)}));
      if (table === "settings") { try { state.settings[record.setting_key] = JSON.parse(values.setting_value); } catch (_) { state.settings[record.setting_key] = values.setting_value; } }
      if (table === "users") {
        const accounts=JSON.parse(localStorage.getItem("assembly-demo-users")||"[]");
        const account=accounts.find(item=>String(item.id)===String(id));
        if(account) Object.assign(account,values);
        localStorage.setItem("assembly-demo-users",JSON.stringify(accounts));
      }
      saveState();
      closeModal();
      fetchDatabase();
      showToast("Preview record saved", "This change is stored in this browser only.", "success");
      return;
    }
    try {
      const response = await fetch("/api/database/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table, recordId: id, values }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save record");
      closeModal(); fetchDatabase(); showToast("Database record updated", "The SQLite record was saved.", "success");
    } catch (error) { showToast("Could not save record", error.message, "error"); }
  });
}

function openPasswordModal() {
  openModal('<div class="modal-header"><div><h2 id="modal-title">Change password</h2><p>Choose a new password with at least 10 characters.</p></div><button class="modal-close" data-action="close-modal">×</button></div><form id="password-form"><div class="modal-body"><div id="password-error" class="login-error hidden"></div><label class="form-field"><span class="form-label">Current password</span><input class="form-control" type="password" name="currentPassword" required autocomplete="current-password" /></label><label class="form-field"><span class="form-label">New password</span><input class="form-control" type="password" name="newPassword" minlength="10" required autocomplete="new-password" /></label><label class="form-field"><span class="form-label">Confirm new password</span><input class="form-control" type="password" name="confirmPassword" minlength="10" required autocomplete="new-password" /></label></div><div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button">Update password</button></div></form>');
  $("#password-form").addEventListener("submit", submitPasswordChange);
}

async function submitPasswordChange(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries());
  if (payload.newPassword !== payload.confirmPassword) {
    const error=$("#password-error"); error.textContent="The new passwords do not match."; error.classList.remove("hidden"); return;
  }
  if (DEMO_PREVIEW) {
    const accounts=JSON.parse(localStorage.getItem("assembly-demo-users")||"[]");
    const account=accounts.find(user=>String(user.id)===String(currentUser.id));
    if(account){account.password=payload.newPassword;localStorage.setItem("assembly-demo-users",JSON.stringify(accounts));}
    closeModal();showToast("Preview password changed","This password is stored in this browser only.","success");return;
  }
  try {
    const response=await fetch("/api/password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword:payload.currentPassword,newPassword:payload.newPassword})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not change password");
    closeModal();showToast("Password updated","Use your new password the next time you sign in.","success");
  } catch(error){const notice=$("#password-error");notice.textContent=error.message;notice.classList.remove("hidden");}
}

function renderSettings() {
  return `${pageHeading("Workspace", "Settings", "Keep your report defaults and notifications in sync with the team.", `<button class="button" data-action="save-settings">Save changes</button>`)}
    <div class="settings-layout"><nav class="settings-nav"><button class="active">General</button><button>Notifications</button><button>Permissions</button></nav><div><section class="panel settings-card"><h2>Report defaults</h2><p>These details are used when the daily schedule is generated.</p><div class="form-grid"><label class="form-field"><span class="form-label">Prepared by</span><input class="form-control" id="settings-prepared-by" value="${escapeHtml(state.settings.preparedBy)}" /></label><label class="form-field"><span class="form-label">Report audience</span><input class="form-control" id="settings-audience" value="${escapeHtml(state.settings.reportAudience)}" /></label></div><div class="settings-save"><button class="button" data-action="save-settings">Save changes</button></div></section><section class="panel settings-card"><h2>Notifications</h2><p>Choose what the reservation team should receive automatically.</p>${toggleRow("email-notifications", "Reservation notifications", "Email the requester when a booking is submitted or approved.", state.settings.emailNotifications)}${toggleRow("approval-reminders", "Approval reminders", "Remind approvers about requests that have been waiting for more than one day.", state.settings.approvalReminders)}</section><section class="panel settings-card"><h2>Account security</h2><p>Change your sign-in password whenever you need to.</p><button class="button secondary" data-action="change-password">Change password</button></section></div></div>`;
}

function toggleRow(id, title, copy, isOn) {
  return `<div class="toggle-row"><div class="toggle-copy"><strong>${title}</strong><span>${copy}</span></div><button class="toggle ${isOn ? "on" : ""}" data-action="toggle-setting" data-setting="${id}" aria-label="Toggle ${title}"></button></div>`;
}

function renderHelp() {
  return `${pageHeading("Support", "Help centre", "A quick guide to running a calm, reliable room schedule.")}
    <div class="help-panel"><div><h2>Keep every room in sync.</h2><p>Assembly replaces scattered messages with one shared schedule. Create the booking, let the system catch conflicts, then approve the requests that need a closer look.</p><div class="help-steps"><div class="help-step"><div class="help-step-number">01</div><strong>Create a reservation</strong><span>Choose a room, time, and who the booking is for.</span></div><div class="help-step"><div class="help-step-number">02</div><strong>Review approvals</strong><span>Training rooms and whole-day bookings wait for sign-off.</span></div><div class="help-step"><div class="help-step-number">03</div><strong>Send the report</strong><span>Only approved reservations appear in the daily schedule.</span></div></div></div><div class="help-art"><div class="help-art-icon">✦</div></div></div>`;
}

function bindViewEvents() {
  $$("[data-view]").forEach(element => element.addEventListener("click", () => navigate(element.dataset.view)));
  $("[data-action]").forEach(element => element.addEventListener("click", () => handleAction(element.dataset.action, element.dataset.id, element.dataset.roomId, element.dataset.period || element.dataset.setting, element.dataset.start, element.dataset.end, element.dataset.table)));
  const roomInput = $("#room-search");
  if (roomInput) roomInput.addEventListener("input", event => { roomSearch = event.target.value; render(); requestAnimationFrame(() => { const input = $("#room-search"); input?.focus(); input?.setSelectionRange(roomSearch.length, roomSearch.length); }); });
  const reservationInput = $("#reservation-search");
  if (reservationInput) reservationInput.addEventListener("input", event => { reservationSearch = event.target.value; render(); requestAnimationFrame(() => { const input = $("#reservation-search"); input?.focus(); input?.setSelectionRange(reservationSearch.length, reservationSearch.length); }); });
  const dateInput = $("#report-date");
  if (dateInput) dateInput.addEventListener("change", event => { selectedReportDate = event.target.value || DEFAULT_DATE; render(); });
  const reportFilter = $("#report-room-filter");
  if (reportFilter) reportFilter.addEventListener("change", event => { reportRoomFilter = event.target.value; render(); });
  const includeEmpty = $("#include-empty-rooms");
  if (includeEmpty) includeEmpty.addEventListener("change", event => { state.settings.includeEmptyRooms = event.target.checked; saveState(); render(); });
  const roomStatusFilter = $("#room-status-filter");
  if (roomStatusFilter) roomStatusFilter.addEventListener("change", event => { const value = event.target.value; $$(".room-card").forEach(card => { card.style.display = value === "all" || card.querySelector(".status-badge")?.textContent === value ? "" : "none"; }); });
  const requestDate = $("#request-date");
  if (requestDate) requestDate.addEventListener("change", event => { requestLookupDate = event.target.value || DEFAULT_DATE; render(); });
  const requestRoom = $("#request-room");
  if (requestRoom) requestRoom.addEventListener("change", event => { requestLookupRoom = event.target.value; render(); });
}

function navigate(view) {
  currentView = view;
  $("#sidebar").classList.remove("open");
  render();
  if (view === "users") fetchUsers();
  if (view === "database") fetchDatabase();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function handleAction(action, id, roomId, setting, startTime, endTime, table) {
  if (action === "calendar-prev") { calendarCursor.setMonth(calendarCursor.getMonth() - 1); render(); }
  if (action === "calendar-next") { calendarCursor.setMonth(calendarCursor.getMonth() + 1); render(); }
  if (action === "calendar-today") { calendarCursor = dateObject(DEFAULT_DATE); render(); }
  if (action === "calendar-add") openReservationModal("", { date: id || DEFAULT_DATE });
  if (action === "new-reservation") openReservationModal(roomId, { date: currentView === "requests" ? requestLookupDate : selectedReportDate });
  if (action === "request-slot") openReservationModal(roomId, { date: requestLookupDate, startTime, endTime });
  if (action === "new-room") openRoomModal();
  if (action === "edit-room") openRoomModal(roomById(id));
  if (action === "view-reservation") openReservationDetails(id);
  if (action === "cancel-reservation") openCancelModal(id);
  if (action === "approve") updateReservationStatus(id, "Approved");
  if (action === "reject") openRejectModal(id);
  if (action === "approve-all") { state.reservations.filter(reservation => reservation.status === "Pending").forEach(reservation => { reservation.status = "Approved"; }); saveState(); render(); showToast("Requests approved", "All pending reservations are now on the schedule.", "success"); }
  if (action === "send-report") sendReport();
  if (action === "generate-report") { showToast("Report refreshed", "The preview now reflects the latest approved reservations.", "success"); }
  if (action === "preview-email") openEmailPreview();
  if (action === "export-report") exportReport();
  if (action === "export-reservations") exportReservations();
  if (action === "export-csv-period") exportPeriodReport(setting);
  if (action === "copy-today-schedule") copySchedule(selectedReportDate);
  if (action === "copy-todo") copyTodoList();
  if (action === "toggle-assignment") toggleAssignment(id);
  if (action === "delete-reservation") openDeleteReservationModal(id);
  if (action === "new-user") openUserModal();
  if (action === "change-password") openPasswordModal();
  if (action === "edit-db-row") openDatabaseRow(table, id);
  if (action === "delete-user") openDeleteUserModal(id);
  if (action === "logout") logout();
  if (action === "save-settings") saveSettingsFromForm();
  if (action === "toggle-setting") toggleSetting(setting);
  if (action === "close-modal") closeModal();
  if (action === "room-view-toggle") showToast("Table view coming next", "The card view is active for this MVP.", "info");
}

async function fetchUsers() {
  if (!["Admin", "Super Admin"].includes(currentUser?.role)) return;
  if (DEMO_PREVIEW) {
    users = JSON.parse(localStorage.getItem("assembly-demo-users") || "[]").map(({password, ...user}) => user);
    render();
    return;
  }
  try {
    const response = await fetch("/api/users");
    if (!response.ok) throw new Error("Account list unavailable");
    users = (await response.json()).users || [];
    if (currentView === "users") render();
  } catch (_) {
    showToast("Could not load accounts", "Check the SQLite server connection and try again.", "error");
  }
}

function openUserModal() {
  openModal('<div class="modal-header"><div><h2 id="modal-title">Add account</h2><p>Create a sign-in with full admin access by default.</p></div><button class="modal-close" data-action="close-modal">×</button></div><form id="user-form"><div class="modal-body"><div class="form-grid"><label class="form-field full"><span class="form-label">Full name <b class="required">*</b></span><input class="form-control" name="name" placeholder="e.g. Alex Santos" required /></label><label class="form-field"><span class="form-label">Email <b class="required">*</b></span><input class="form-control" name="email" type="email" placeholder="alex@company.com" required /></label><label class="form-field"><span class="form-label">Department</span><input class="form-control" name="department" value="Operations" /></label><label class="form-field"><span class="form-label">Access</span><input class="form-control" value="Admin · Full access except database editing" disabled /></label><label class="form-field"><span class="form-label">Temporary password <b class="required">*</b></span><input class="form-control" name="password" type="password" minlength="10" placeholder="At least 10 characters" required /></label></div><div class="modal-notice">✦ &nbsp; Admin accounts can add and delete accounts, manage rooms, and control schedules.</div></div><div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button">Create account</button></div></form>');
  $("#user-form").addEventListener("submit", submitUser);
}

async function submitUser(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.target).entries());
  if (payload.password.length < 10) return showToast("Account not created", "Use a temporary password with at least 10 characters.", "error");
  if (DEMO_PREVIEW) {
    const accounts = JSON.parse(localStorage.getItem("assembly-demo-users") || "[]");
    if (accounts.some(user => user.email.toLowerCase() === payload.email.toLowerCase())) return showToast("Account not created", "An account with that email already exists.", "error");
    accounts.push({ id: Date.now(), name: payload.name, email: payload.email, department: payload.department || "Operations", role: "Admin", status: "Active", password: payload.password });
    localStorage.setItem("assembly-demo-users", JSON.stringify(accounts));
    users = accounts.map(({password, ...user}) => user);
    closeModal(); render(); showToast("Admin account created", "The account can sign in to this preview in this browser.", "success"); return;
  }
  try {
    const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not create account");
    users = [...users, result.user].sort((a, b) => a.name.localeCompare(b.name));
    closeModal();
    render();
    showToast("Account created", result.user.name + " can now sign in.", "success");
  } catch (error) {
    const notice = $("#user-form #modal-error");
    if (notice) notice.textContent = error.message;
    else showToast("Account not created", error.message, "error");
  }
}

function openDeleteUserModal(id) {
  const user = users.find(item => item.id === Number(id));
  if (!user) return;
  openModal('<div class="modal-header"><div><h2 id="modal-title">Delete account?</h2><p>This removes the user’s ability to sign in.</p></div><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body"><div class="confirm-copy">You are deleting <strong>' + escapeHtml(user.name) + '</strong> (<strong>' + escapeHtml(user.email) + '</strong>). Their past reservations will remain in the schedule history.</div></div><div class="modal-footer"><button class="button secondary" data-action="close-modal">Keep account</button><button class="button danger" data-action="confirm-delete-user" data-id="' + user.id + '">Delete account</button></div>');
  $("[data-action='confirm-delete-user']", modal).addEventListener("click", () => deleteUser(user.id));
}

async function deleteUser(id) {
  if (DEMO_PREVIEW) {
    const accounts = JSON.parse(localStorage.getItem("assembly-demo-users") || "[]").filter(user => String(user.id) !== String(id));
    localStorage.setItem("assembly-demo-users", JSON.stringify(accounts));
    users = accounts.map(({password, ...user}) => user);
    closeModal(); render(); showToast("Account deleted", "The preview account was removed.", "success"); return;
  }
  try {
    const response = await fetch("/api/users/" + id, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not delete account");
    users = users.filter(user => user.id !== Number(id));
    closeModal();
    render();
    showToast("Account deleted", "The account can no longer sign in.", "success");
  } catch (error) {
    showToast("Account not deleted", error.message, "error");
  }
}

async function submitLogin(event) {
  event.preventDefault();
  if (DEMO_PREVIEW) {
    const accounts = JSON.parse(localStorage.getItem("assembly-demo-users") || "[]");
    const account = accounts.find(user => user.email.toLowerCase() === $("#login-email").value.trim().toLowerCase() && user.password === $("#login-password").value);
    if (!account) {
      const error = $("#login-error");
      error.textContent = "Email or password is incorrect. Use the preview credentials shown below.";
      error.classList.remove("hidden");
      return;
    }
    currentUser = { id: account.id, name: account.name, email: account.email, role: account.role, department: account.department };
    isAuthenticated = true;
    $("#login-screen").classList.add("hidden");
    $("#app-shell").classList.remove("app-hidden");
    render();
    startLiveSync();
    return;
  }
  const error = $("#login-error");
  const button = $(".login-submit");
  if (button) button.disabled = true;
  if (error) error.classList.add("hidden");
  try {
    const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("#login-email").value.trim(), password: $("#login-password").value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Invalid email or password");
    await loadAppFromSQLite(result.user);
  } catch (loginError) {
    const message = loginError?.message === "Failed to fetch"
      ? "The SQLite server is not running. Start server.py, then open http://127.0.0.1:4173/."
      : loginError.message;
    if (error) { error.textContent = message; error.classList.remove("hidden"); }
  } finally {
    if (button) button.disabled = false;
  }
}

async function logout() {
  if (!DEMO_PREVIEW) await fetch("/api/logout", { method: "POST" }).catch(() => {});
  showLogin();
}

function openModal(content) {
  modal.innerHTML = content;
  modalBackdrop.classList.remove("hidden");
  currentModal = true;
  document.body.style.overflow = "hidden";
  $('[data-action]', modal).forEach(button => button.addEventListener("click", () => handleAction(button.dataset.action, button.dataset.id, button.dataset.roomId, button.dataset.period || button.dataset.setting, button.dataset.start, button.dataset.end, button.dataset.table)));
  const firstInput = $("input, select, textarea", modal);
  firstInput?.focus();
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  modal.innerHTML = "";
  currentModal = null;
  document.body.style.overflow = "";
}

function openReservationModalLegacy(prefilledRoomId = "") {
  const roomOptions = state.rooms.filter(room => room.status !== "Disabled" && room.status !== "Under Maintenance").map(room => `<option value="${room.id}" ${prefilledRoomId === room.id ? "selected" : ""}>${escapeHtml(room.name)} · ${room.capacity} seats</option>`).join("");
  openModal(`<div class="modal-header"><div><h2 id="modal-title">New reservation</h2><p>Reserve a room for your team or guests.</p></div><button class="modal-close" data-action="close-modal">×</button></div><form id="reservation-form"><div class="modal-body"><div id="reservation-conflict"></div><div class="form-grid"><label class="form-field full"><span class="form-label">Room <b class="required">*</b></span><select class="form-control" name="roomId" required>${roomOptions}</select></label><label class="form-field"><span class="form-label">Reservation date <b class="required">*</b></span><input class="form-control" name="date" type="date" value="${selectedReportDate}" required /></label><label class="form-field"><span class="form-label">Time type <b class="required">*</b></span><select class="form-control" name="timeType"><option value="range">Time range</option><option value="whole-day">Whole day</option><option value="onwards">Onwards</option><option value="blocked">Blocked</option></select></label><label class="form-field"><span class="form-label">Start time <b class="required">*</b></span><input class="form-control" name="startTime" type="time" value="09:00" required /></label><label class="form-field"><span class="form-label">End time <b class="required">*</b></span><input class="form-control" name="endTime" type="time" value="10:00" required /></label><label class="form-field"><span class="form-label">Reserved for <b class="required">*</b></span><input class="form-control" name="reservedFor" placeholder="Team, client, or person" required /></label><label class="form-field"><span class="form-label">Event name</span><input class="form-control" name="eventName" placeholder="What is this for?" /></label><label class="form-field"><span class="form-label">Requested by <b class="required">*</b></span><input class="form-control" name="requestedBy" value="Marisol Santos" required /></label><label class="form-field"><span class="form-label">Department</span><input class="form-control" name="department" value="Operations" /></label><label class="form-field"><span class="form-label">Attendees</span><input class="form-control" name="attendees" type="number" min="1" placeholder="0" /></label><label class="form-field"><span class="form-label">Equipment needed</span><input class="form-control" name="equipment" placeholder="Projector, whiteboard..." /></label><label class="form-field full"><span class="form-label">Remarks</span><textarea class="form-control" name="remarks" placeholder="Add context for the approver"></textarea></label></div><div class="modal-notice">✦ &nbsp; Training rooms, whole-day bookings, and after-hours requests will be sent for approval automatically.</div></div><div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button">Create reservation</button></div></form>`);
  $("#reservation-form").addEventListener("submit", submitReservation);
  $$('select[name="timeType"]', modal)[0].addEventListener("change", updateTimeTypeFields);
}

function openReservationModal(prefilledRoomId = "", prefill = {}) {
  const startDate = prefill.startDate || prefill.date || selectedReportDate;
  const endDate = prefill.endDate || prefill.date || startDate;
  const startTime = prefill.startTime || "09:00";
  const endTime = prefill.endTime || "10:00";
  const roomOptions = state.rooms.filter(room => room.status !== "Disabled" && room.status !== "Under Maintenance").map(room => '<option value="' + room.id + '" ' + (prefilledRoomId === room.id ? "selected" : "") + ">" + escapeHtml(room.name) + " · " + room.capacity + " seats</option>").join("");
  const html = '<div class="modal-header"><div><h2 id="modal-title">New reservation</h2><p>Reserve a room for your team or guests.</p></div><button class="modal-close" data-action="close-modal">×</button></div>' +
    '<form id="reservation-form"><div class="modal-body"><div id="reservation-conflict"></div><div class="form-grid">' +
    '<label class="form-field full"><span class="form-label">Room <b class="required">*</b></span><select class="form-control" name="roomId" required>' + roomOptions + '</select></label>' +
    '<label class="form-field"><span class="form-label">Start date <b class="required">*</b></span><input class="form-control" name="startDate" type="date" value="' + startDate + '" required /></label>' +
    '<label class="form-field"><span class="form-label">End date <b class="required">*</b></span><input class="form-control" name="endDate" type="date" value="' + endDate + '" required /></label>' +
    '<label class="form-field"><span class="form-label">Time type <b class="required">*</b></span><select class="form-control" name="timeType"><option value="range">Time range</option><option value="whole-day">Whole day</option><option value="onwards">Onwards</option><option value="blocked">Blocked</option></select></label>' +
    '<label class="form-field"><span class="form-label">Start time <b class="required">*</b></span><input class="form-control" name="startTime" type="time" value="' + startTime + '" required /></label>' +
    '<label class="form-field"><span class="form-label">End time <b class="required">*</b></span><input class="form-control" name="endTime" type="time" value="' + endTime + '" required /></label>' +
    '<label class="form-field"><span class="form-label">Reserved for <b class="required">*</b></span><input class="form-control" name="reservedFor" placeholder="Team, client, or person" required /></label>' +
    '<label class="form-field"><span class="form-label">Event name</span><input class="form-control" name="eventName" placeholder="What is this for?" /></label>' +
    '<label class="form-field"><span class="form-label">Requested by <b class="required">*</b></span><input class="form-control" name="requestedBy" value="Marisol Santos" required /></label>' +
    '<label class="form-field"><span class="form-label">Department</span><input class="form-control" name="department" value="Operations" /></label>' +
    '<label class="form-field"><span class="form-label">Attendees</span><input class="form-control" name="attendees" type="number" min="1" placeholder="0" /></label>' +
    '<label class="form-field"><span class="form-label">Equipment needed</span><input class="form-control" name="equipment" placeholder="Projector, whiteboard..." /></label>' +
    '<label class="form-field full"><span class="form-label">Remarks</span><textarea class="form-control" name="remarks" placeholder="Add context for the approver"></textarea></label>' +
    '</div><div class="modal-notice">✦ &nbsp; Date and time are required. Training rooms, whole-day bookings, and after-hours requests will be sent for approval automatically.</div></div>' +
    '<div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button">Create reservation</button></div></form>';
  openModal(html);
  $("#reservation-form").addEventListener("submit", submitReservation);
  $$('select[name="timeType"]', modal)[0].addEventListener("change", updateTimeTypeFields);
}

function updateTimeTypeFields(event) {
  const form = event.target.form;
  const start = form.querySelector('[name="startTime"]');
  const end = form.querySelector('[name="endTime"]');
  const isWholeDay = event.target.value === "whole-day";
  const isOnwards = event.target.value === "onwards";
  start.disabled = isWholeDay;
  end.disabled = isWholeDay || isOnwards;
  if (isWholeDay) { start.value = "00:00"; end.value = "23:59"; }
  if (isOnwards) { end.value = "23:59"; }
}

function submitReservationLegacy(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const data = Object.fromEntries(form.entries());
  const timeType = data.timeType;
  if (timeType === "whole-day") { data.startTime = "00:00"; data.endTime = "23:59"; }
  if (timeType === "onwards") data.endTime = "23:59";
  if (data.startTime >= data.endTime) return showConflict("Please choose an end time after the start time.");
  const room = roomById(data.roomId);
  if (Number(data.attendees || 0) > room.capacity) return showConflict(`${room.name} seats ${room.capacity} people. Please reduce the attendee count or choose a larger room.`);
  const conflict = findConflict(data);
  if (conflict) return showConflict(`Conflict detected: ${room.name} is already reserved from ${formatTime(conflict.startTime)} to ${formatTime(conflict.endTime)} for ${conflict.reservedFor}.`);
  const requiresApproval = room.requiresApproval || ["whole-day", "onwards", "blocked"].includes(timeType) || data.startTime < "08:00" || data.endTime > "18:00";
  state.reservations.push({ id: `res-${Date.now()}`, ...data, attendees: Number(data.attendees || 0), status: requiresApproval ? "Pending" : "Approved", createdAt: new Date().toISOString() });
  saveState();
  closeModal();
  render();
  showToast(requiresApproval ? "Reservation submitted" : "Reservation approved", requiresApproval ? "The request is waiting for an approver’s review." : "Your booking has been added to the daily schedule.", "success");
}

function submitReservation(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());
  const timeType = data.timeType;
  data.date = data.startDate;
  if (!data.startDate || !data.endDate) return showConflict("Start date and end date are required.");
  if (data.startDate > data.endDate) return showConflict("End date must be on or after the start date.");
  if (timeType === "whole-day") { data.startTime = "00:00"; data.endTime = "23:59"; }
  if (timeType === "onwards") data.endTime = "23:59";
  if (data.startDate === data.endDate && data.startTime >= data.endTime) return showConflict("Please choose an end time after the start time.");
  const room = roomById(data.roomId);
  if (!room) return showConflict("Choose a valid room.");
  if (Number(data.attendees || 0) > room.capacity) return showConflict(room.name + " seats " + room.capacity + " people. Please reduce the attendee count or choose a larger room.");
  const conflict = findConflict(data);
  if (conflict) return showConflict("Conflict detected: " + room.name + " is already reserved from " + formatTime(conflict.startTime) + " to " + formatTime(conflict.endTime) + " for " + conflict.reservedFor + ".");
  const requiresApproval = room.requiresApproval || ["whole-day", "onwards", "blocked"].includes(timeType) || data.startTime < "08:00" || data.endTime > "18:00";
  state.reservations.push({ id: "res-" + Date.now(), ...data, attendees: Number(data.attendees || 0), status: requiresApproval ? "Pending" : "Approved", assignmentStatus: "Assigned", createdAt: new Date().toISOString() });
  saveState();
  closeModal();
  render();
  showToast(requiresApproval ? "Reservation submitted" : "Reservation approved", requiresApproval ? "The request is waiting for an approver review." : "Your booking has been added to the daily schedule.", "success");
}

function findConflictLegacy(candidate) {
  return state.reservations.find(existing => existing.roomId === candidate.roomId && existing.date === candidate.date && !["Cancelled", "Rejected"].includes(existing.status) && candidate.startTime < existing.endTime && candidate.endTime > existing.startTime);
}

function dateRangesOverlap(first, second) {
  return reservationStartDate(first) <= reservationEndDate(second) && reservationEndDate(first) >= reservationStartDate(second);
}

function findConflict(candidate) {
  return state.reservations.find(existing => {
    const sameRoom = existing.roomId === candidate.roomId;
    const active = !["Cancelled", "Rejected"].includes(existing.status) && existing.assignmentStatus !== "Unassigned";
    if (!sameRoom || !active || !dateRangesOverlap(candidate, existing)) return false;
    const spansMultipleDays = reservationStartDate(candidate) !== reservationEndDate(candidate) || reservationStartDate(existing) !== reservationEndDate(existing);
    return spansMultipleDays || (candidate.startTime < existing.endTime && candidate.endTime > existing.startTime);
  });
}

function showConflict(message) {
  const target = $("#reservation-conflict");
  if (target) target.innerHTML = `<div class="conflict-alert"><span>!</span><div><strong>Can’t create this reservation</strong>${escapeHtml(message)}</div></div>`;
}

function openRoomModal(room = null) {
  const isEdit = Boolean(room);
  openModal(`<div class="modal-header"><div><h2 id="modal-title">${isEdit ? "Edit room" : "Add a room"}</h2><p>${isEdit ? "Update this room’s details and approval rules." : "Add a space to your reservation workspace."}</p></div><button class="modal-close" data-action="close-modal">×</button></div><form id="room-form"><div class="modal-body"><div class="form-grid"><label class="form-field full"><span class="form-label">Room name <b class="required">*</b></span><input class="form-control" name="name" value="${escapeHtml(room?.name || "")}" placeholder="e.g. M6A Training Room" required /></label><label class="form-field"><span class="form-label">Room type <b class="required">*</b></span><select class="form-control" name="type"><option ${room?.type === "Meeting Room" ? "selected" : ""}>Meeting Room</option><option ${room?.type === "Training Room" ? "selected" : ""}>Training Room</option><option ${room?.type === "Conference Room" ? "selected" : ""}>Conference Room</option><option ${room?.type === "Lounge" ? "selected" : ""}>Lounge</option><option ${room?.type === "Workshop Room" ? "selected" : ""}>Workshop Room</option></select></label><label class="form-field"><span class="form-label">Location</span><input class="form-control" name="location" value="${escapeHtml(room?.location || "")}" placeholder="e.g. M6A" /></label><label class="form-field"><span class="form-label">Capacity <b class="required">*</b></span><input class="form-control" name="capacity" type="number" min="1" value="${room?.capacity || 10}" required /></label><label class="form-field"><span class="form-label">Status</span><select class="form-control" name="status"><option ${room?.status === "Available" || !room ? "selected" : ""}>Available</option><option ${room?.status === "Under Maintenance" ? "selected" : ""}>Under Maintenance</option><option ${room?.status === "Disabled" ? "selected" : ""}>Disabled</option></select></label><label class="form-field full"><span class="form-label">Equipment</span><input class="form-control" name="equipment" value="${escapeHtml(room?.equipment || "")}" placeholder="Projector, TV, Whiteboard" /></label></div><label class="checkbox-field"><input type="checkbox" name="requiresApproval" ${room?.requiresApproval ? "checked" : ""} /> Require approval for reservations in this room</label></div><div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button type="submit" class="button">${isEdit ? "Save room" : "Add room"}</button></div></form>`);
  $("#room-form").addEventListener("submit", event => submitRoom(event, room?.id));
}

function submitRoom(event, roomId) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  data.capacity = Number(data.capacity);
  data.requiresApproval = Boolean(data.requiresApproval);
  if (roomId) Object.assign(roomById(roomId), data);
  else state.rooms.push({ id: `room-${Date.now()}`, ...data });
  saveState();
  closeModal();
  render();
  showToast(roomId ? "Room updated" : "Room added", `${data.name} is ready to use.`, "success");
}

function openReservationDetailsLegacy(id) {
  const reservation = reservationById(id);
  const room = roomById(reservation.roomId);
  openModal(`<div class="modal-header"><div><h2 id="modal-title">Reservation details</h2><p>${escapeHtml(room.name)} · ${formatShortDate(reservation.date)}</p></div><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body"><div class="approval-summary"><div class="mini-stat"><span>Time</span><strong>${escapeHtml(formatTimeRange(reservation))}</strong></div><div class="mini-stat"><span>Reserved for</span><strong>${escapeHtml(reservation.reservedFor)}</strong></div><div class="mini-stat"><span>Status</span><div style="margin-top:9px">${statusBadge(reservation.status)}</div></div></div><div class="confirm-copy"><strong>${escapeHtml(reservation.eventName || "Internal booking")}</strong><br />Requested by ${escapeHtml(reservation.requestedBy)} from ${escapeHtml(reservation.department || "the team")} · ${reservation.attendees || "—"} attendees.<br /><br />${escapeHtml(reservation.remarks || "No additional remarks were provided.")}</div></div><div class="modal-footer"><button class="button secondary" data-action="close-modal">Close</button></div>`);
}

function openReservationDetails(id) {
  const reservation = reservationById(id);
  if (!reservation) return;
  const room = roomById(reservation.roomId);
  const assignmentStatus = reservation.assignmentStatus || "Assigned";
  const assignmentAction = assignmentStatus === "Unassigned" ? "Assign slot" : "Mark unassigned";
  const html = '<div class="modal-header"><div><h2 id="modal-title">Reservation details</h2><p>' + escapeHtml(room?.name || "Unknown room") + ' · ' + escapeHtml(formatReservationDates(reservation)) + '</p></div><button class="modal-close" data-action="close-modal">×</button></div>' +
    '<div class="modal-body"><div class="approval-summary"><div class="mini-stat"><span>Time</span><strong>' + escapeHtml(formatTimeRange(reservation)) + '</strong></div><div class="mini-stat"><span>Reserved for</span><strong>' + escapeHtml(reservation.reservedFor) + '</strong></div><div class="mini-stat"><span>Status</span><div style="margin-top:9px">' + statusBadge(reservation.status) + '</div></div></div>' +
    '<div class="confirm-copy"><strong>' + escapeHtml(reservation.eventName || "Internal booking") + '</strong><br />Requested by ' + escapeHtml(reservation.requestedBy) + ' from ' + escapeHtml(reservation.department || "the team") + ' · ' + (reservation.attendees || "—") + ' attendees.<br /><br />' + escapeHtml(reservation.remarks || "No additional remarks were provided.") + '</div>' +
    '<div class="assignment-panel"><span>Admin assignment</span><div>' + assignmentBadge(assignmentStatus) + (reservation.autoUnassignedAt ? '<small>Automatically released after the end date and time.</small>' : '') + '</div></div>' +
    '<div class="admin-actions"><button class="button ghost small" data-action="toggle-assignment" data-id="' + id + '">' + assignmentAction + '</button><button class="button danger small" data-action="delete-reservation" data-id="' + id + '">Delete schedule</button></div></div>' +
    '<div class="modal-footer"><button class="button secondary" data-action="close-modal">Close</button></div>';
  openModal(html);
}

function openCancelModal(id) {
  const reservation = reservationById(id);
  const room = roomById(reservation.roomId);
  openModal(`<div class="modal-header"><div><h2 id="modal-title">Cancel reservation?</h2><p>This will remove the booking from the daily schedule.</p></div><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body"><div class="confirm-copy">You’re cancelling <strong>${escapeHtml(room.name)}</strong> on <strong>${formatShortDate(reservation.date)}</strong> at <strong>${escapeHtml(formatTimeRange(reservation))}</strong>. This action can be reviewed in the reservation history.</div></div><div class="modal-footer"><button class="button secondary" data-action="close-modal">Keep reservation</button><button class="button danger" data-action="confirm-cancel" data-id="${id}">Cancel reservation</button></div>`);
  $("[data-action='confirm-cancel']", modal).addEventListener("click", () => { reservation.status = "Cancelled"; saveState(); closeModal(); render(); showToast("Reservation cancelled", "The room is available again for this time.", "success"); });
}

function openRejectModal(id) {
  const reservation = reservationById(id);
  openModal(`<div class="modal-header"><div><h2 id="modal-title">Reject request</h2><p>Share a reason so the requester knows what to change.</p></div><button class="modal-close" data-action="close-modal">×</button></div><form id="reject-form"><div class="modal-body"><label class="form-field"><span class="form-label">Reason</span><textarea class="form-control" name="reason" placeholder="Optional note for the requester"></textarea></label></div><div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">Keep pending</button><button type="submit" class="button danger">Reject request</button></div></form>`);
  $("#reject-form").addEventListener("submit", event => { event.preventDefault(); reservation.status = "Rejected"; reservation.rejectionReason = new FormData(event.target).get("reason"); saveState(); closeModal(); render(); showToast("Request rejected", "The requester can now review the decision.", "info"); });
}

function toggleAssignment(id) {
  const reservation = reservationById(id);
  if (!reservation) return;
  reservation.assignmentStatus = reservation.assignmentStatus === "Unassigned" ? "Assigned" : "Unassigned";
  if (reservation.assignmentStatus === "Assigned") delete reservation.autoUnassignedAt;
  else reservation.unassignedAt = new Date().toISOString();
  saveState();
  closeModal();
  render();
  showToast(reservation.assignmentStatus === "Assigned" ? "Slot assigned" : "Slot unassigned", reservation.assignmentStatus === "Assigned" ? "The room is back on the active schedule." : "The reserved slot is now available for reassignment.", "success");
}

function openDeleteReservationModal(id) {
  const reservation = reservationById(id);
  const room = roomById(reservation?.roomId);
  if (!reservation) return;
  const html = '<div class="modal-header"><div><h2 id="modal-title">Delete schedule meeting?</h2><p>This removes the schedule from the workspace completely.</p></div><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body"><div class="confirm-copy">You are deleting <strong>' + escapeHtml(reservation.eventName || "this meeting") + '</strong> in <strong>' + escapeHtml(room?.name || "the room") + '</strong> on <strong>' + escapeHtml(formatReservationDates(reservation)) + '</strong> at <strong>' + escapeHtml(formatTimeRange(reservation)) + '</strong>.</div></div><div class="modal-footer"><button class="button secondary" data-action="close-modal">Keep schedule</button><button class="button danger" data-action="confirm-delete" data-id="' + id + '">Delete schedule</button></div>';
  openModal(html);
  $("[data-action='confirm-delete']", modal).addEventListener("click", () => {
    state.reservations = state.reservations.filter(item => item.id !== id);
    saveState();
    closeModal();
    render();
    showToast("Schedule deleted", "The meeting slot is available again.", "success");
  });
}

function updateReservationStatus(id, status) {
  const reservation = reservationById(id);
  if (!reservation) return;
  reservation.status = status;
  saveState();
  render();
  showToast(status === "Approved" ? "Request approved" : "Request updated", status === "Approved" ? "It will now appear in the daily room report." : "The reservation was updated.", "success");
}

function openEmailPreview() {
  const paper = $("#report-paper");
  openModal(`<div class="modal-header"><div><h2 id="modal-title">Email preview</h2><p>Ready to send to ${escapeHtml(state.settings.reportAudience)}.</p></div><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body"><div style="padding:13px;border:1px solid var(--line);border-radius:8px;background:#fbfbfd;font-size:10px;line-height:1.55;color:var(--ink-soft)"><strong style="display:block;margin-bottom:8px;color:var(--ink)">Subject: Assembly Room Schedule · ${formatShortDate(selectedReportDate)}</strong>${paper?.innerText.replace(/\n{3,}/g, "\n\n").replace(/\n/g, "<br />") || "Generate a report first."}</div></div><div class="modal-footer"><button class="button secondary" data-action="close-modal">Close preview</button><button class="button" data-action="send-report">Send to ${escapeHtml(state.settings.reportAudience)}</button></div>`);
}

function sendReport() {
  closeModal();
  showToast("Report ready to send", `Email delivery is a placeholder in this MVP. Recipient: ${state.settings.reportAudience}.`, "info");
}

function exportReport() {
  const text = buildReportText();
  downloadFile(`assembly-room-schedule-${selectedReportDate}.txt`, text, "text/plain");
  showToast("Report exported", "A text copy of the daily schedule was downloaded.", "success");
}

function copyScheduleLegacy(date) {
  const text = buildReportTextForDate(date);
  const fallbackCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallbackCopy);
  else fallbackCopy();
  showToast("Schedule copied", "Today’s schedule is ready to paste into email or chat.", "success");
}

function copySchedule(date) {
  const rows = buildScheduleRows(date);
  const text = rows.length ? [["Room", "Date", "Time", "Reserved for", "Event", "Requested by", "Status"], ...rows.map(row => [row.room, row.date, row.time, row.reservedFor, row.event, row.requestedBy, row.status])].map(row => row.join("\t")).join("\n") : "No approved reservations scheduled.";
  const html = rows.length ? '<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Room</th><th>Date</th><th>Time</th><th>Reserved for</th><th>Event</th><th>Requested by</th><th>Status</th></tr></thead><tbody>' + rows.map(row => '<tr><td>' + escapeHtml(row.room) + '</td><td>' + escapeHtml(row.date) + '</td><td>' + escapeHtml(row.time) + '</td><td>' + escapeHtml(row.reservedFor) + '</td><td>' + escapeHtml(row.event) + '</td><td>' + escapeHtml(row.requestedBy) + '</td><td>' + escapeHtml(row.status) + '</td></tr>').join("") + '</tbody></table>' : '<p>No approved reservations scheduled.</p>';
  const fallbackCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  };
  const copyPromise = navigator.clipboard?.write && window.ClipboardItem
    ? navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })])
    : navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error("Clipboard unavailable"));
  copyPromise.then(() => showToast("Schedule table copied", "Paste it into Excel, Outlook, Teams, or chat.", "success")).catch(() => {
    fallbackCopy();
    showToast("Schedule table copied", "The tab-separated table is ready to paste.", "success");
  });
}

function buildScheduleRows(date) {
  return activeReservations(date).filter(reservation => reservation.status === "Approved").sort((a, b) => (a.startTime + a.roomId).localeCompare(b.startTime + b.roomId)).map(reservation => {
    const room = roomById(reservation.roomId);
    return { room: room?.name || "Unknown room", date: formatReservationDates(reservation), time: formatTimeRange(reservation), reservedFor: reservation.reservedFor, event: reservation.eventName || "Internal booking", requestedBy: reservation.requestedBy, status: "Approved" };
  });
}

function copyTodoList() {
  const text = "Assembly Room Scheduler to-do list\n\nCompleted in MVP: copy today’s schedule, weekly/monthly/yearly CSV exports, advance room requests, availability lookup, admin assign/unassign, schedule deletion, automatic end-date unassignment.\n\nNext: confirm final room names, connect real login and roles, PostgreSQL/Drizzle, email delivery, PDF and Excel exports.";
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text);
  showToast("To-do list copied", "The current build checklist is ready to share.", "success");
}

function buildReportTextForDate(date) {
  const approved = activeReservations(date).filter(reservation => reservation.status === "Approved");
  const entries = state.rooms.map(room => ({ room, reservations: approved.filter(reservation => reservation.roomId === room.id).sort((a, b) => a.startTime.localeCompare(b.startTime)) })).filter(entry => state.settings.includeEmptyRooms || entry.reservations.length);
  return [state.settings.reportAudience, "", state.settings.preparedBy + " - Assembly Room Schedule", formatLongDate(date), "", ...entries.flatMap(({ room, reservations }) => [room.name, ...(reservations.length ? reservations.map(reportLineText) : ["No reservations scheduled"]), ""])].join("\n");
}

function periodBounds(period, anchorDate = selectedReportDate) {
  const anchor = dateObject(anchorDate);
  if (period === "year") return { start: new Date(anchor.getFullYear(), 0, 1), end: new Date(anchor.getFullYear(), 11, 31) };
  if (period === "month") return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0) };
  const mondayOffset = (anchor.getDay() + 6) % 7;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function toDateInputValue(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function exportPeriodReport(period) {
  const bounds = periodBounds(period);
  const start = toDateInputValue(bounds.start);
  const end = toDateInputValue(bounds.end);
  const reservations = state.reservations.filter(reservation => reservation.status === "Approved" && reservation.assignmentStatus !== "Unassigned" && reservationStartDate(reservation) <= end && reservationEndDate(reservation) >= start).sort((a, b) => (reservationStartDate(a) + a.startTime).localeCompare(reservationStartDate(b) + b.startTime));
  const header = "Room,Start date,End date,Time,Reserved for,Event,Requested by,Department,Attendees,Status";
  const rows = reservations.map(reservation => { const room = roomById(reservation.roomId); return [room?.name, reservationStartDate(reservation), reservationEndDate(reservation), formatTimeRange(reservation), reservation.reservedFor, reservation.eventName, reservation.requestedBy, reservation.department, reservation.attendees, reservation.status].map(value => '"' + String(value || "").replaceAll('"', '""') + '"').join(","); });
  downloadFile("assembly-room-" + period + "-report-" + selectedReportDate + ".csv", [header, ...rows].join("\n"), "text/csv");
  const periodLabel = period === "week" ? "Weekly" : period === "month" ? "Monthly" : "Yearly";
  showToast(periodLabel + " CSV exported", reservations.length + " approved reservation" + (reservations.length === 1 ? "" : "s") + " included.", "success");
}

function buildReportText() {
  const approved = activeReservations(selectedReportDate).filter(reservation => reservation.status === "Approved");
  const entries = state.rooms.map(room => ({ room, reservations: approved.filter(reservation => reservation.roomId === room.id).sort((a, b) => a.startTime.localeCompare(b.startTime)) })).filter(entry => state.settings.includeEmptyRooms || entry.reservations.length);
  return [state.settings.reportAudience, "", `${state.settings.preparedBy} - Assembly Room Schedule`, formatLongDate(selectedReportDate), "", ...entries.flatMap(({ room, reservations }) => [room.name, ...(reservations.length ? reservations.map(reportLineText) : ["No reservations scheduled"]), ""])].join("\n");
}

function reportLineText(reservation) {
  if (reservation.timeType === "whole-day") return `Reserved for ${reservation.reservedFor} (Whole Day)`;
  if (reservation.timeType === "onwards") return `${formatTime(reservation.startTime)} onwards - Reserved for ${reservation.reservedFor}${reservation.eventName ? ` (${reservation.eventName})` : ""}`;
  return `${formatTime(reservation.startTime)} - ${formatTime(reservation.endTime)} - Reserved for ${reservation.reservedFor}${reservation.eventName ? ` (${reservation.eventName})` : ""}`;
}

function exportReservations() {
  const header = "Room,Date,Time,Reserved for,Event,Requested by,Department,Status";
  const rows = state.reservations.map(reservation => { const room = roomById(reservation.roomId); return [room?.name, reservation.date, formatTimeRange(reservation), reservation.reservedFor, reservation.eventName, reservation.requestedBy, reservation.department, reservation.status].map(value => `"${String(value || "").replaceAll('"', '""')}"`).join(","); });
  downloadFile("assembly-reservations.csv", [header, ...rows].join("\n"), "text/csv");
  showToast("Reservation list exported", "Your CSV file is ready.", "success");
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function saveSettingsFromForm() {
  const preparedBy = $("#settings-prepared-by")?.value || $("#report-prepared-by")?.value;
  const audience = $("#settings-audience")?.value;
  if (preparedBy) state.settings.preparedBy = preparedBy;
  if (audience) state.settings.reportAudience = audience;
  saveState();
  render();
  showToast("Settings saved", "Your report defaults have been updated.", "success");
}

function toggleSetting(setting) {
  const map = { "email-notifications": "emailNotifications", "approval-reminders": "approvalReminders" };
  if (!map[setting]) return;
  state.settings[map[setting]] = !state.settings[map[setting]];
  saveState();
  render();
}

function showToast(title, copy, type = "info") {
  const stack = $("#toast-stack");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${type === "success" ? "✓" : type === "error" ? "!" : "✦"}</span><div class="toast-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

$("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
modalBackdrop.addEventListener("click", event => { if (event.target === modalBackdrop) closeModal(); });
$("#notifications-button").addEventListener("click", () => showToast("You’re up to date", "No new room notifications.", "info"));
$("#login-form")?.addEventListener("submit", submitLogin);
boot();
