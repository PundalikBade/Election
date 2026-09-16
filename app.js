const COLLEGE_NAME = "College of Engineering";
const DEFAULT_DEPARTMENTS = ["AI & ML", "Computer Engineering", "Civil Engineering", "Electronics & Telecommunication"];

const isLocalHost = ["localhost", "127.0.0.1"].includes(location.hostname);
const API_BASE = (location.protocol === "file:" || (isLocalHost && location.port && location.port !== "8000")) ? "http://localhost:8000" : "";

async function api(path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
  const res = await fetch(API_BASE + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get("content-type") || "";
  if (opts.raw && !ct.includes("application/json")) {
    const t = await res.text();
    if (!res.ok) throw new Error("Export failed (" + res.status + ")");
    return t;
  }
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

const STATE = {
  token: null,
  adminToken: null,
  voter: null,
  role: null,
  activeElectionId: null,
  activeElection: null,
  votes: {},
  currentPositionIndex: 0,
  submitting: false,
  resultsReturn: "login",
  lastResultsElection: null,
  myElections: { available: [], others: [] },
  adminElections: [],
  candidatesTarget: null,
};

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function initials(name) {
  return (name || "").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso || ""; }
}

function toast(msg, type) {
  const el = document.createElement("div");
  el.className = "toast " + (type || "");
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 0.3s"; setTimeout(() => el.remove(), 300); }, 2800);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
}

function openModal(html) {
  document.getElementById("modal-box").innerHTML = html;
  document.getElementById("modal-backdrop").style.display = "flex";
}

function closeModal() {
  document.getElementById("modal-backdrop").style.display = "none";
}

document.getElementById("modal-backdrop").addEventListener("click", function (e) {
  if (e.target === this) closeModal();
});

function renderAvatar(img, name, sizeClass) {
  const cls = sizeClass || "candidate-avatar";
  if (img) return `<div class="${cls}"><img src="${img}" alt=""></div>`;
  return `<div class="${cls}">${escapeHtml(initials(name))}</div>`;
}

function doLogout() {
  STATE.token = null;
  STATE.voter = null;
  STATE.role = null;
  STATE.activeElection = null;
  STATE.activeElectionId = null;
  STATE.votes = {};
  document.getElementById("login-form").reset();
  showScreen("login-screen");
}

/* ============ STUDENT LOGIN ============ */

document.getElementById("login-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  const id = document.getElementById("student-id").value.trim();
  const pin = document.getElementById("student-pin").value.trim();
  try {
    const res = await api("/api/login", { method: "POST", body: { student_id: id, pin } });
    STATE.token = res.token;
    STATE.role = "student";
    STATE.voter = res.student;
    document.getElementById("login-form").reset();
    await showElectionCenter();
  } catch (err) {
    toast(err.message, "error");
  }
});

/* ============ ADMIN LOGIN ============ */

document.getElementById("admin-login-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  const u = document.getElementById("admin-username").value.trim();
  const p = document.getElementById("admin-password").value;
  try {
    const res = await api("/api/admin/login", { method: "POST", body: { username: u, password: p } });
    STATE.adminToken = res.token;
    STATE.role = "admin";
    document.getElementById("admin-login-form").reset();
    showScreen("admin-screen");
    await initAdmin();
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("go-admin-login").addEventListener("click", function () {
  showScreen("admin-login-screen");
});

document.getElementById("go-back-login").addEventListener("click", function () {
  showScreen("login-screen");
});

document.getElementById("center-logout").addEventListener("click", doLogout);
document.getElementById("logout-final-btn").addEventListener("click", doLogout);
document.getElementById("admin-logout").addEventListener("click", function () {
  STATE.adminToken = null;
  STATE.role = null;
  showScreen("login-screen");
});

/* ============ ELECTION CENTER ============ */

async function showElectionCenter() {
  if (!STATE.voter || !STATE.token) { doLogout(); return; }
  try {
    const res = await api("/api/my/elections", { token: STATE.token });
    STATE.myElections = res;
  } catch (err) {
    toast(err.message, "error");
    doLogout();
    return;
  }
  const s = STATE.voter;
  document.getElementById("center-voter-info").textContent = `${s.name} • ${s.id} • ${s.department}`;
  renderElectionCenter();
  showScreen("election-center-screen");
}

function renderElectionCenter() {
  const list = document.getElementById("election-list");
  let html = "";
  const available = STATE.myElections.available || [];
  const others = STATE.myElections.others || [];

  if (available.length === 0) {
    html += '<div class="card empty-state">No elections are currently open and available for you.</div>';
  }
  available.forEach(e => {
    html += `
      <div class="election-card">
        <div>
          <h3>${escapeHtml(e.title)}</h3>
          <p>${e.type === "college-wide" ? "College-wide election" : "Department election"} • ${e.positions.length} positions • ${e.eligible_count} eligible voters • ${e.ballots} cast</p>
        </div>
        <button class="btn btn-primary btn-small vote-btn" data-id="${e.id}">Vote Now</button>
      </div>`;
  });

  others.forEach(e => {
    const st = e.status;
    const pillLabel = e.voted ? "Voted ✓" : (st === "draft" ? "Not published" : st);
    html += `
      <div class="election-card" style="opacity:0.55">
        <div>
          <h3>${escapeHtml(e.title)}</h3>
          <p>${e.type === "college-wide" ? "College-wide election" : "Department election"}${e.eligible !== undefined && !e.eligible ? " (you are not eligible)" : ""}</p>
        </div>
        <span class="pill ${e.voted ? "voted" : st}">${pillLabel}</span>
      </div>`;
  });

  list.innerHTML = html || '<div class="card empty-state">No elections found.</div>';

  list.querySelectorAll(".vote-btn").forEach(btn => {
    btn.addEventListener("click", function () {
      startVoting(this.dataset.id);
    });
  });
}

/* ============ VOTING ============ */

function startVoting(electionId) {
  const election = (STATE.myElections.available || []).find(e => e.id === electionId);
  if (!election) { toast("Election not available.", "error"); return; }
  if (election.status !== "open") { toast("This election is not open.", "error"); return; }
  if (election.voted) { toast("You have already voted in this election.", "error"); return; }

  STATE.activeElection = election;
  STATE.activeElectionId = election.id;
  STATE.votes = {};
  STATE.currentPositionIndex = 0;
  STATE.submitting = false;

  document.getElementById("voting-election-title").textContent = election.title;
  document.getElementById("voter-info").textContent = `${STATE.voter.name} • ${STATE.voter.department}`;

  buildVotingUI();
  showScreen("voting-screen");
}

document.getElementById("vote-back-center").addEventListener("click", function () {
  showElectionCenter();
});

function buildVotingUI() {
  const election = STATE.activeElection;
  const tabs = document.getElementById("position-tabs");
  const container = document.getElementById("voting-positions");

  tabs.innerHTML = election.positions.map((p, i) =>
    `<div class="position-tab ${i === 0 ? "active" : ""}" data-index="${i}">${escapeHtml(p.title)}</div>`
  ).join("");

  container.innerHTML = election.positions.map((p, i) => `
    <div class="position-section" style="display:${i === 0 ? "block" : "none"}">
      <h2>${escapeHtml(p.title)}</h2>
      <p class="position-desc">${escapeHtml(p.description || "")}</p>
      ${p.candidates.map(c => `
        <div class="candidate-card" data-position="${p.id}" data-candidate="${c.id}">
          ${renderAvatar(c.photo, c.name)}
          <div class="candidate-info">
            <h3>${escapeHtml(c.name)} ${c.symbol ? `<span title="Election symbol">${escapeHtml(c.symbol)}</span>` : ""}</h3>
            <p>${escapeHtml(c.department)} • ${escapeHtml(c.year || "N/A")}</p>
            <div class="platform">${escapeHtml(c.platform || "")}</div>
          </div>
          <div class="radio-dot"></div>
        </div>
      `).join("")}
      <div class="candidate-card" data-position="${p.id}" data-candidate="NOTA">
        <div class="candidate-avatar" style="background:var(--amber-light);color:var(--amber)">—</div>
        <div class="candidate-info">
          <h3>None of the Above (NOTA)</h3>
          <p>Choose this to vote against all candidates</p>
        </div>
        <div class="radio-dot"></div>
      </div>
    </div>
  `).join("");

  tabs.querySelectorAll(".position-tab").forEach(tab => {
    tab.addEventListener("click", function () { goToPosition(parseInt(this.dataset.index)); });
  });

  container.querySelectorAll(".candidate-card").forEach(card => {
    card.addEventListener("click", function () {
      const pos = this.dataset.position;
      const cand = this.dataset.candidate;
      container.querySelectorAll(`.candidate-card[data-position="${pos}"]`).forEach(c => c.classList.remove("selected"));
      this.classList.add("selected");
      STATE.votes[pos] = cand;
      updateTabs();
      updateNavButtons();
    });
  });

  updateNavButtons();
  updateTabs();
}

function goToPosition(index) {
  const sections = document.querySelectorAll(".position-section");
  const labels = document.querySelectorAll(".position-tab");
  if (!STATE.activeElection) return;
  STATE.currentPositionIndex = Math.max(0, Math.min(index, STATE.activeElection.positions.length - 1));
  sections.forEach((s, i) => s.style.display = i === STATE.currentPositionIndex ? "block" : "none");
  labels.forEach((t, i) => t.classList.toggle("active", i === STATE.currentPositionIndex));
  updateNavButtons();
  window.scrollTo(0, 0);
}

function updateTabs() {
  if (!STATE.activeElection) return;
  document.querySelectorAll(".position-tab").forEach((tab, i) => {
    const pos = STATE.activeElection.positions[i];
    tab.classList.toggle("done", !!STATE.votes[pos.id]);
  });
}

function updateNavButtons() {
  if (!STATE.activeElection) return;
  const prev = document.getElementById("prev-btn");
  const next = document.getElementById("next-btn");
  prev.style.display = STATE.currentPositionIndex === 0 ? "none" : "inline-flex";
  const isLast = STATE.currentPositionIndex === STATE.activeElection.positions.length - 1;
  const allVoted = STATE.activeElection.positions.every(p => !!STATE.votes[p.id]);

  if (isLast && allVoted) {
    next.textContent = "Review Votes ✓";
    next.className = "btn btn-success";
  } else {
    next.textContent = "Next Position →";
    next.className = "btn btn-primary";
  }
}

document.getElementById("prev-btn").addEventListener("click", function () {
  goToPosition(STATE.currentPositionIndex - 1);
});

document.getElementById("next-btn").addEventListener("click", function () {
  if (!STATE.activeElection) return;
  if (STATE.currentPositionIndex < STATE.activeElection.positions.length - 1) {
    goToPosition(STATE.currentPositionIndex + 1);
  } else {
    const missing = STATE.activeElection.positions.find(p => !STATE.votes[p.id]);
    if (missing) { toast("Please select a candidate for every position before reviewing."); return; }
    showReview();
  }
});

function showReview() {
  const election = STATE.activeElection;
  const list = document.getElementById("review-list");
  list.innerHTML = election.positions.map(p => {
    const candId = STATE.votes[p.id];
    const isNota = candId === "NOTA";
    const cand = p.candidates.find(c => c.id === candId);
    return `
      <div class="review-item">
        <span class="review-position">${escapeHtml(p.title)}</span>
        <span class="review-candidate ${isNota ? "nota" : ""}">${isNota ? "NOTA" : escapeHtml(cand.name)}</span>
      </div>`;
  }).join("");
  showScreen("review-screen");
}

document.getElementById("review-edit").addEventListener("click", function () {
  showScreen("voting-screen");
});

document.getElementById("submit-votes-btn").addEventListener("click", async function () {
  if (STATE.submitting) return;
  const election = STATE.activeElection;
  if (!election || !STATE.voter || !STATE.token) return;
  if (election.status !== "open") { toast("Voting is closed.", "error"); return; }
  if (election.positions.some(p => !STATE.votes[p.id])) { toast("Please vote for all positions."); return; }

  const confirmed = confirm("Are you sure you want to submit your ballot? This cannot be undone.");
  if (!confirmed) return;

  STATE.submitting = true;
  const btn = document.getElementById("submit-votes-btn");
  btn.disabled = true;
  btn.textContent = "Submitting...";

  try {
    const res = await api("/api/vote", {
      method: "POST",
      token: STATE.token,
      body: { election_id: election.id, selections: STATE.votes },
    });
    const recap = document.getElementById("receipt-box");
    recap.innerHTML = `
      <div>Receipt number (does not reveal your selections)</div>
      <div class="rec-no">${escapeHtml(res.receipt)}</div>
      <div style="margin-top:8px">Election: ${escapeHtml(election.title)}</div>
      <div>Voter: ${escapeHtml(STATE.voter.name)} (${escapeHtml(STATE.voter.id)})</div>
      <div>Votes locked permanently for this election (server-side).</div>`;
    STATE.lastResultsElection = election.id;
    STATE.activeElection = null;
    STATE.activeElectionId = null;
    STATE.votes = {};
    showScreen("success-screen");
    showElectionCenter();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    STATE.submitting = false;
    btn.disabled = false;
    btn.textContent = "Confirm and Submit Vote";
  }
});

document.getElementById("view-results-btn").addEventListener("click", async function () {
  const eid = STATE.lastResultsElection;
  if (!eid) { toast("No election to display."); return; }
  STATE.resultsReturn = "voter";
  try {
    await renderResults(eid, false);
    showScreen("results-screen");
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("results-back").addEventListener("click", function () {
  if (STATE.resultsReturn === "voter") showElectionCenter();
  else if (STATE.resultsReturn === "admin") showScreen("admin-screen");
  else showScreen("login-screen");
});

/* ============ RESULTS ============ */

async function renderResults(electionId, inadmin) {
  const res = await api("/api/results/" + electionId);
  const election = res.election;

  document.getElementById("dashboard-meta").innerHTML = `
    <h3 style="margin:0">${escapeHtml(COLLEGE_NAME)} — Student Association</h3>
    <p class="muted" style="margin:4px 0 0">${escapeHtml(election.title)}</p>`;

  const st = election.status;
  const statusText = st === "open" ? "Voting Open" : (st === "closed" || st === "published") ? "Voting Closed" : "Voting " + st.charAt(0).toUpperCase() + st.slice(1);

  document.getElementById("dashboard-stats").innerHTML = `
    <div class="stat-box"><div class="stat-num">${res.stats.votes}</div><div class="stat-label">Total Votes</div></div>
    <div class="stat-box"><div class="stat-num">${res.stats.eligible}</div><div class="stat-label">Eligible Voters</div></div>
    <div class="stat-box"><div class="stat-num">${res.stats.turnout}%</div><div class="stat-label">Turnout</div></div>
    <div class="stat-box"><div class="stat-num">${res.positions.length}</div><div class="stat-label">Positions</div></div>`;

  document.getElementById("dashboard-status").innerHTML = `
    <div class="status-banner ${st}">${statusText} ${st === "open" ? "— ballots are recorded anonymously" : ""}</div>`;

  let html = "";
  res.positions.forEach(p => {
    let rows = "";
    const total = p.total;
    p.rows.forEach(c => {
      const isNota = c.id === "NOTA";
      const pct = total > 0 ? c.pct : 0;
      rows += `
        <div class="result-row">
          <div class="result-name">
            <div class="cand">
              <div class="mini-avatar">${isNota ? "—" : c.photo ? `<img src="${c.photo}">` : escapeHtml(initials(c.name))}</div>
              <span>${escapeHtml(c.name)} ${c.winner ? `<span class="winner-badge">★ Leading</span>` : ""}</span>
            </div>
            <span class="votes">${c.votes} vote${c.votes !== 1 ? "s" : ""} (${pct}%)</span>
          </div>
          <div class="result-bar"><div class="result-bar-fill ${c.winner ? "winner" : "normal"}" style="width:${Math.min(pct, 100)}%"></div></div>
        </div>`;
    });
    html += `
      <div class="result-position">
        <h3>${escapeHtml(p.title)}</h3>
        <div class="result-bar-container">${rows || '<div class="empty-state">No votes yet.</div>'}</div>
      </div>`;
  });

  if (res.stats.votes === 0) {
    html = '<div class="card empty-state">No votes have been cast yet.</div>' + html;
  }
  document.getElementById("results-list").innerHTML = html;
  STATE.lastResultsElection = electionId;
}

setInterval(async function () {
  if (document.getElementById("results-screen").classList.contains("active") && STATE.lastResultsElection) {
    try {
      await renderResults(STATE.lastResultsElection, false);
    } catch (e) {}
  }
}, 4000);

/* ============ ADMIN ============ */

async function initAdmin() {
  document.querySelectorAll(".admin-nav-item").forEach(n => n.classList.remove("active"));
  document.querySelector(".admin-nav-item[data-tab='elections']").classList.add("active");
  document.querySelectorAll(".admin-panel").forEach(p => p.style.display = "none");
  document.getElementById("panel-elections").style.display = "block";
  STATE.adminTab = "elections";
  try {
    await renderAdminElections();
    await renderCandidateElectionSelect();
  } catch (err) {
    toast(err.message, "error");
  }
}

document.querySelectorAll(".admin-nav-item").forEach(item => {
  item.addEventListener("click", async function () {
    const tab = this.dataset.tab;
    STATE.adminTab = tab;
    document.querySelectorAll(".admin-nav-item").forEach(n => n.classList.remove("active"));
    this.classList.add("active");
    document.querySelectorAll(".admin-panel").forEach(p => p.style.display = "none");
    const panel = document.getElementById("panel-" + tab);
    if (panel) panel.style.display = "block";
    try {
      if (tab === "elections") await renderAdminElections();
      if (tab === "candidates") await loadCandidatesTarget();
      if (tab === "students") await renderStudents();
      if (tab === "voting") await renderVotingControls();
      if (tab === "results") await renderAdminResults();
      if (tab === "audit") await renderAuditLog();
    } catch (err) {
      toast(err.message, "error");
    }
  });
});

document.getElementById("create-election-btn").addEventListener("click", function () {
  openElectionModal(null);
});

function electionHtml(e) {
  const st = e.status;
  return `
    <div class="row-card">
      <div class="row-main">
        <h4>${escapeHtml(e.title)} <span class="pill ${st}">${st}</span></h4>
        <p>${e.type === "college-wide" ? "College-wide" : "Department"} • ${e.positions_count} positions</p>
        <p class="small muted">Eligible: ${e.eligible_count} • Ballots cast: ${e.ballots} • Created: ${fmtTime(e.created_at)}</p>
      </div>
      <div class="row-actions">
        <button class="btn btn-outline btn-small edit-e" data-id="${e.id}">Edit</button>
        <button class="btn btn-outline btn-small preview-e" data-id="${e.id}">Preview</button>
        ${st === "draft" ? `<button class="btn btn-success btn-small open-e" data-id="${e.id}">Open Voting</button>` : ""}
        <button class="btn btn-danger btn-small del-e" data-id="${e.id}">Delete</button>
      </div>
    </div>`;
}

async function renderAdminElections() {
  const res = await api("/api/admin/elections", { token: STATE.adminToken });
  STATE.adminElections = res.elections;
  const list = document.getElementById("election-manage-list");
  if (STATE.adminElections.length === 0) {
    list.innerHTML = '<div class="card empty-state">No elections yet. Create your first election.</div>';
    return;
  }
  list.innerHTML = STATE.adminElections.map(electionHtml).join("");

  list.querySelectorAll(".edit-e").forEach(b => b.addEventListener("click", () => openElectionModal(b.dataset.id)));
  list.querySelectorAll(".preview-e").forEach(b => b.addEventListener("click", async () => {
    STATE.resultsReturn = "admin";
    try {
      await renderResults(b.dataset.id, true);
      showScreen("results-screen");
    } catch (err) { toast(err.message, "error"); }
  }));
  list.querySelectorAll(".open-e").forEach(b => b.addEventListener("click", async () => {
    try {
      await api("/api/admin/elections/" + b.dataset.id + "/status", { method: "POST", token: STATE.adminToken, body: { status: "open" } });
      toast("Voting opened.");
      await renderAdminElections();
      await renderVotingControls();
    } catch (err) { toast(err.message, "error"); }
  }));
  list.querySelectorAll(".del-e").forEach(b => b.addEventListener("click", async () => {
    const e = STATE.adminElections.find(x => x.id === b.dataset.id);
    if (!confirm(`Delete election "${e.title}" and all its ballots?`)) return;
    try {
      await api("/api/admin/elections/" + b.dataset.id, { method: "DELETE", token: STATE.adminToken });
      toast("Election deleted.");
      await renderAdminElections();
      await renderCandidateElectionSelect();
    } catch (err) { toast(err.message, "error"); }
  }));
}

async function openElectionModal(eid) {
  let e = null;
  if (eid) {
    try {
      e = await api("/api/admin/elections/" + eid, { token: STATE.adminToken });
    } catch (err) {
      toast(err.message, "error");
      return;
    }
  }
  const isNew = !e;
  const positionsHtml = e ? e.positions.map((p, i) => `
    <div class="row-card" style="box-shadow:none;border:1px solid var(--gray-100)">
      <div class="row-main"><h4>${escapeHtml(p.title)}</h4><p>${p.candidates.length} candidates</p></div>
      <div class="row-actions">
        <button class="btn btn-outline btn-small pp-edit" data-i="${i}">Edit</button>
        <button class="btn btn-danger btn-small pp-del" data-i="${i}">Remove</button>
      </div>
    </div>`).join("") : "";

  openModal(`
    <h3>${isNew ? "Create Election" : "Edit Election"}</h3>
    <div class="form-group"><label>Election Title</label>
      <input type="text" id="me-title" value="${e ? escapeHtml(e.title) : ""}" placeholder="e.g. General Secretary Election 2026"></div>
    <div class="form-group"><label>Election Type</label>
      <select id="me-type">
        <option value="college-wide" ${e && e.type === "college-wide" ? "selected" : ""}>College-wide election</option>
        <option value="department" ${e && e.type === "department" ? "selected" : ""}>Department election</option>
      </select></div>
    <div class="form-group"><label>Participating Departments</label>
      <select id="me-depts" multiple size="4" style="height:auto">
        ${DEFAULT_DEPARTMENTS.map(d => `<option value="${d}" ${e ? e.departments.includes(d) ? "selected" : "" : ""}>${d}</option>`).join("")}
      </select>
      <span class="field-note">Hold Ctrl/Cmd to select multiple departments.${e && e.ballots > 0 ? " Structure is locked once ballots exist." : ""}</span></div>

    <hr style="border:none;border-top:1px solid var(--gray-100);margin:14px 0">
    <h4 style="margin-bottom:10px">Positions</h4>
    <div id="me-positions">${positionsHtml || '<div class="empty-state small">No positions yet.</div>'}</div>
    <button id="me-add-position" class="btn btn-outline btn-small btn-full" style="margin-top:8px">+ Add Position</button>

    <div class="modal-actions">
      <button class="btn btn-outline" id="me-cancel">Cancel</button>
      <button class="btn btn-primary btn-full" id="me-save">${isNew ? "Create Election" : "Save Changes"}</button>
    </div>`);

  let draftPositions = e ? JSON.parse(JSON.stringify(e.positions)) : [];

  const renderPositions = () => {
    const box = document.getElementById("me-positions");
    if (draftPositions.length === 0) { box.innerHTML = '<div class="empty-state small">No positions yet.</div>'; return; }
    box.innerHTML = draftPositions.map((p, i) => `
      <div class="row-card" style="box-shadow:none;border:1px solid var(--gray-100)">
        <div class="row-main">
          <h4>${escapeHtml(p.title)}</h4>
          <p>${escapeHtml(p.description || "")}</p>
          <p class="small muted">${p.candidates.length} candidate(s)</p>
        </div>
        <div class="row-actions">
          <button class="btn btn-outline btn-small pp-edit" data-i="${i}">Edit</button>
          <button class="btn btn-danger btn-small pp-del" data-i="${i}">Remove</button>
        </div>
      </div>`);
    box.querySelectorAll(".pp-edit").forEach(b => b.addEventListener("click", () => openPositionModal(draftPositions, parseInt(b.dataset.i), renderPositions)));
    box.querySelectorAll(".pp-del").forEach(b => b.addEventListener("click", () => {
      draftPositions.splice(parseInt(b.dataset.i), 1);
      renderPositions();
    }));
  };
  renderPositions();

  document.getElementById("me-add-position").addEventListener("click", () => openPositionModal(draftPositions, null, renderPositions));
  document.getElementById("me-cancel").addEventListener("click", closeModal);
  document.getElementById("me-save").addEventListener("click", async () => {
    const title = document.getElementById("me-title").value.trim();
    const type = document.getElementById("me-type").value;
    const depts = [...document.getElementById("me-depts").selectedOptions].map(o => o.value);
    if (!title) { toast("Election title required.", "error"); return; }
    if (depts.length === 0) { toast("Select at least one department.", "error"); return; }
    if (draftPositions.length === 0) { toast("Add at least one position.", "error"); return; }

    const payload = { title, type, departments: depts, positions: draftPositions };
    try {
      if (isNew) {
        await api("/api/admin/elections", { method: "POST", token: STATE.adminToken, body: payload });
        toast("Election created (draft).");
      } else {
        await api("/api/admin/elections/" + e.id, { method: "PUT", token: STATE.adminToken, body: payload });
        toast("Election updated.");
      }
      closeModal();
      await renderAdminElections();
      await renderCandidateElectionSelect();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

function openPositionModal(positionList, index, refresh) {
  const isNew = index === null;
  const p = isNew ? null : positionList[index];
  const candidatesHtml = p ? p.candidates.map((c, i) => `
    <div class="row-card" style="box-shadow:none;border:1px solid var(--gray-100);padding:10px">
      <div class="row-main"><h4>${escapeHtml(c.name)}</h4><p>${escapeHtml(c.department)} • ${escapeHtml(c.platform || "")}</p></div>
      <div class="row-actions">
        <button class="btn btn-danger btn-small ce-del" data-i="${i}">Remove</button>
      </div>
    </div>`).join("") : "";

  openModal(`
    <h3>${isNew ? "Add Position" : "Edit Position"}</h3>
    <div class="form-group"><label>Position Title</label><input type="text" id="pp-title" value="${p ? escapeHtml(p.title) : ""}" placeholder="e.g. General Secretary"></div>
    <div class="form-group"><label>Description</label><input type="text" id="pp-desc" value="${p ? escapeHtml(p.description || "") : ""}" placeholder="Short description of responsibilities"></div>
    <hr style="border:none;border-top:1px solid var(--gray-100);margin:14px 0">
    <h4 style="margin-bottom:10px">Candidates</h4>
    <div id="pp-candidates">${candidatesHtml || '<div class="empty-state small">No candidates yet.</div>'}</div>
    <button id="pp-add-cand" class="btn btn-outline btn-small btn-full" style="margin-top:8px">+ Add Candidate</button>
    <div class="modal-actions">
      <button class="btn btn-outline" id="pp-cancel">Cancel</button>
      <button class="btn btn-primary btn-full" id="pp-save">${isNew ? "Add Position" : "Save Position"}</button>
    </div>`);

  let draftCandidates = p ? JSON.parse(JSON.stringify(p.candidates)) : [];

  const renderCands = () => {
    const box = document.getElementById("pp-candidates");
    if (draftCandidates.length === 0) { box.innerHTML = '<div class="empty-state small">No candidates yet.</div>'; return; }
    box.innerHTML = draftCandidates.map((c, i) => `
      <div class="row-card" style="box-shadow:none;border:1px solid var(--gray-100);padding:10px">
        <div class="row-main"><h4>${escapeHtml(c.name)} ${c.photo ? "📷" : ""}</h4><p>${escapeHtml(c.department)} • ${escapeHtml(c.year || "")}</p><p class="small muted">${escapeHtml(c.platform || "")}</p></div>
        <div class="row-actions">
          <button class="btn btn-outline btn-small ce-edit" data-i="${i}">Edit</button>
          <button class="btn btn-danger btn-small ce-del" data-i="${i}">Remove</button>
        </div>
      </div>`);
    box.querySelectorAll(".ce-edit").forEach(b => b.addEventListener("click", () => openCandidateModal(draftCandidates, parseInt(b.dataset.i), renderCands)));
    box.querySelectorAll(".ce-del").forEach(b => b.addEventListener("click", () => {
      draftCandidates.splice(parseInt(b.dataset.i), 1);
      renderCands();
    }));
  };
  renderCands();

  document.getElementById("pp-add-cand").addEventListener("click", () => openCandidateModal(draftCandidates, null, renderCands));
  document.getElementById("pp-cancel").addEventListener("click", closeModal);
  document.getElementById("pp-save").addEventListener("click", () => {
    const title = document.getElementById("pp-title").value.trim();
    const desc = document.getElementById("pp-desc").value.trim();
    if (!title) { toast("Position title required.", "error"); return; }
    if (isNew) {
      positionList.push({ id: makeLocalId("p_"), title, description: desc, candidates: draftCandidates });
    } else {
      p.title = title; p.description = desc; p.candidates = draftCandidates;
    }
    closeModal();
    refresh();
  });
}

function makeLocalId(prefix) {
  return (prefix || "") + Math.random().toString(36).slice(2, 8);
}

function openCandidateModal(candidateList, index, refresh) {
  const isNew = index === null;
  const c = isNew ? null : candidateList[index];
  openModal(`
    <h3>${isNew ? "Add Candidate" : "Edit Candidate"}</h3>
    <div class="form-group"><label>Full Name</label><input type="text" id="ce-name" value="${c ? escapeHtml(c.name) : ""}" placeholder="e.g. Suraj Jadhav"></div>
    <div style="display:flex;gap:10px">
      <div class="form-group" style="flex:1"><label>Department</label>
        <select id="ce-dept">${DEFAULT_DEPARTMENTS.map(d => `<option ${c && c.department === d ? "selected" : ""}>${d}</option>`).join("")}</select></div>
      <div class="form-group" style="flex:1"><label>Year</label><input type="text" id="ce-year" value="${c ? escapeHtml(c.year || "") : ""}" placeholder="SE"></div>
    </div>
    <div class="form-group"><label>Platform / Key Points</label><input type="text" id="ce-platform" value="${c ? escapeHtml(c.platform || "") : ""}" placeholder="One-line agenda"></div>
    <div class="form-group"><label>Election Symbol</label><input type="text" id="ce-symbol" value="${c ? escapeHtml(c.symbol || "") : ""}" placeholder="e.g. ⚙️ (optional)"></div>
    <div class="form-group"><label>Photograph</label>
      <input type="file" id="ce-photo" accept="image/*">
      <span class="field-note">Optional. Upload a candidate photograph (max 400 KB).</span></div>
    ${c && c.photo ? `<img src="${c.photo}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover">` : ""}
    <div class="modal-actions">
      <button class="btn btn-outline" id="ce-cancel">Cancel</button>
      <button class="btn btn-primary btn-full" id="ce-save">${isNew ? "Add Candidate" : "Save Candidate"}</button>
    </div>`);

  document.getElementById("ce-photo").addEventListener("change", function () {
    const file = this.files[0];
    if (!file) return;
    if (file.size > 400 * 1024) { toast("Image too large (max 400 KB).", "error"); this.value = ""; return; }
    const reader = new FileReader();
    reader.onload = ev => { this.dataset.photo = ev.target.result; };
    reader.readAsDataURL(file);
  });

  document.getElementById("ce-cancel").addEventListener("click", closeModal);
  document.getElementById("ce-save").addEventListener("click", () => {
    const name = document.getElementById("ce-name").value.trim();
    const dept = document.getElementById("ce-dept").value;
    const year = document.getElementById("ce-year").value.trim();
    const platform = document.getElementById("ce-platform").value.trim();
    const symbol = document.getElementById("ce-symbol").value.trim();
    const photoEl = document.getElementById("ce-photo");
    if (!name) { toast("Candidate name required.", "error"); return; }

    const photo = photoEl && photoEl.dataset.photo ? photoEl.dataset.photo : (c ? c.photo : null);
    const obj = { id: c ? c.id : makeLocalId("c_"), name, department: dept, year, platform, symbol, photo };

    if (isNew) candidateList.push(obj);
    else Object.assign(candidateList[index], obj);

    closeModal();
    refresh();
  });
}

async function renderCandidateElectionSelect() {
  const sel = document.getElementById("cand-election-select");
  sel.innerHTML = STATE.adminElections.map(e => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join("");
  STATE.candidatesTarget = null;
  if (STATE.adminTab === "candidates") {
    await loadCandidatesTarget();
  }
}

document.getElementById("cand-election-select").addEventListener("change", async function () {
  await loadCandidatesTarget();
});

async function loadCandidatesTarget() {
  const eid = document.getElementById("cand-election-select").value;
  const list = document.getElementById("candidate-manage-list");
  if (!eid) {
    list.innerHTML = '<div class="card empty-state">Create an election first.</div>';
    return;
  }
  try {
    STATE.candidatesTarget = await api("/api/admin/elections/" + eid, { token: STATE.adminToken });
    renderCandidatesManage();
  } catch (err) {
    toast(err.message, "error");
    list.innerHTML = '<div class="card empty-state">Could not load election.</div>';
  }
}

function renderCandidatesManage() {
  const e = STATE.candidatesTarget;
  const list = document.getElementById("candidate-manage-list");
  if (!e) { list.innerHTML = '<div class="card empty-state">Create an election first.</div>'; return; }
  list.innerHTML = e.positions.map(p => `
    <div class="card">
      <h4>${escapeHtml(p.title)}</h4>
      <p class="small muted" style="margin-bottom:10px">${escapeHtml(p.description || "")}</p>
      ${p.candidates.map(c => `
        <div class="row-card" style="box-shadow:none;border:1px solid var(--gray-100)">
          <div style="display:flex;align-items:center;gap:10px">
            ${renderAvatar(c.photo, c.name, "")}
            <div class="row-main" style="min-width:160px">
              <h4>${escapeHtml(c.name)} ${c.symbol ? "(" + escapeHtml(c.symbol) + ")" : ""}</h4>
              <p class="small muted">${escapeHtml(c.department)} • ${escapeHtml(c.year || "N/A")}</p>
            </div>
          </div>
          <div class="row-actions">
            <button class="btn btn-outline btn-small cand-edit" data-p="${p.id}" data-c="${c.id}">Edit</button>
            <button class="btn btn-danger btn-small cand-del" data-p="${p.id}" data-c="${c.id}">Remove</button>
          </div>
        </div>`).join("") || '<div class="empty-state small">No candidates yet.</div>'}
    </div>`).join("");

  list.querySelectorAll(".cand-edit").forEach(b => b.addEventListener("click", () => {
    const p = e.positions.find(x => x.id === b.dataset.p);
    const idx = p.candidates.findIndex(x => x.id === b.dataset.c);
    openCandidateModal(p.candidates, idx, saveCandidatesTarget);
  }));
  list.querySelectorAll(".cand-del").forEach(b => b.addEventListener("click", () => {
    const p = e.positions.find(x => x.id === b.dataset.p);
    p.candidates = p.candidates.filter(x => x.id !== b.dataset.c);
    saveCandidatesTarget();
  }));
}

async function saveCandidatesTarget() {
  const e = STATE.candidatesTarget;
  if (!e) return;
  try {
    const payload = { title: e.title, type: e.type, departments: e.departments, positions: e.positions };
    await api("/api/admin/elections/" + e.id, { method: "PUT", token: STATE.adminToken, body: payload });
    toast("Candidates saved.");
    await loadCandidatesTarget();
    await renderAdminElections();
  } catch (err) {
    toast(err.message, "error");
  }
}

document.getElementById("add-candidate-btn").addEventListener("click", () => {
  const e = STATE.candidatesTarget;
  if (!e) { toast("Create an election first.", "error"); return; }
  if (e.positions.length === 0) { toast("Add a position first.", "error"); return; }
  const posHtml = e.positions.map((p, i) => `<option value="${i}">${escapeHtml(p.title)}</option>`).join("");
  openModal(`
    <h3>Add Candidate</h3>
    <div class="form-group"><label>Position</label><select id="pick-pos">${posHtml}</select></div>
    <div class="form-group"><label>Full Name</label><input type="text" id="ac-name" placeholder="Candidate name"></div>
    <div class="form-group"><label>Department</label><select id="ac-dept">${DEFAULT_DEPARTMENTS.map(d => `<option>${d}</option>`).join("")}</select></div>
    <div class="form-group"><label>Year</label><input type="text" id="ac-year" placeholder="SE"></div>
    <div class="form-group"><label>Platform</label><input type="text" id="ac-platform" placeholder="One-line agenda"></div>
    <div class="form-group"><label>Symbol</label><input type="text" id="ac-symbol" placeholder="e.g. ⚙️"></div>
    <div class="form-group"><label>Photo</label><input type="file" id="ac-photo" accept="image/*"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="ac-cancel">Cancel</button>
      <button class="btn btn-primary btn-full" id="ac-save">Add Candidate</button>
    </div>`);
  document.getElementById("ac-photo").addEventListener("change", function () {
    const f = this.files[0];
    if (!f) return;
    if (f.size > 400 * 1024) { toast("Image too large (max 400 KB).", "error"); this.value = ""; return; }
    const r = new FileReader();
    r.onload = ev => { this.dataset.photo = ev.target.result; };
    r.readAsDataURL(f);
  });
  document.getElementById("ac-cancel").addEventListener("click", closeModal);
  document.getElementById("ac-save").addEventListener("click", async () => {
    const pi = parseInt(document.getElementById("pick-pos").value);
    const name = document.getElementById("ac-name").value.trim();
    if (!name) { toast("Name required.", "error"); return; }
    const photoEl = document.getElementById("ac-photo");
    STATE.candidatesTarget.positions[pi].candidates.push({
      id: makeLocalId("c_"), name,
      department: document.getElementById("ac-dept").value,
      year: document.getElementById("ac-year").value.trim(),
      platform: document.getElementById("ac-platform").value.trim(),
      symbol: document.getElementById("ac-symbol").value.trim(),
      photo: photoEl.dataset.photo || null,
    });
    closeModal();
    await saveCandidatesTarget();
  });
});

/* ============ STUDENTS (admin) ============ */

async function renderStudents() {
  const res = await api("/api/admin/students", { token: STATE.adminToken });
  const students = res.students;
  const list = document.getElementById("student-manage-list");
  if (students.length === 0) {
    list.innerHTML = '<div class="card empty-state">No students imported yet. Use the import button above.</div>';
    return;
  }
  list.innerHTML = `
    <div class="card" style="padding:16px 20px">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span class="pill eligible">${students.length} students on record</span>
        <span class="pill">Voter status and ballots stored in MongoDB</span>
      </div>
    </div>
    <div class="card" style="overflow-x:auto">
      <table class="data-table">
        <tr><th>Student ID</th><th>Name</th><th>Department</th><th>Year</th><th>PIN</th><th></th></tr>
        ${students.map(s => `
          <tr>
            <td><strong>${escapeHtml(s.id)}</strong></td>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.department)}</td>
            <td>${escapeHtml(s.year)}</td>
            <td><span class="pin-cell">${escapeHtml(s.pin)}</span></td>
            <td><button class="btn btn-outline btn-small st-del" data-id="${escapeHtml(s.id)}">Remove</button></td>
          </tr>`).join("")}
      </table>
    </div>`;
  list.querySelectorAll(".st-del").forEach(b => b.addEventListener("click", async () => {
    const sid = b.dataset.id;
    if (!confirm(`Remove student ${sid}?`)) return;
    try {
      await api("/api/admin/students/" + sid, { method: "DELETE", token: STATE.adminToken });
      toast("Student removed.");
      await renderStudents();
    } catch (err) { toast(err.message, "error"); }
  }));
}

document.getElementById("import-students-btn").addEventListener("click", () => document.getElementById("csv-input").click());

document.getElementById("csv-input").addEventListener("change", function () {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const text = ev.target.result;
      const parsed = parseCSV(text);
      if (parsed.length === 0) { toast("File is empty or unreadable.", "error"); return; }

      const header = parsed[0].map(h => h.trim().toLowerCase());
      const colId = header.indexOf("studentid");
      const colName = header.indexOf("studentname");
      const colDept = header.indexOf("department");
      const colYear = header.indexOf("year");
      const formatDetected = colId >= 0 && colName >= 0 && colDept >= 0;

      let rows = formatDetected ? parsed.slice(1).filter(r => r.length >= 3) : parsed.filter(r => r.length >= 3);
      const idxId = formatDetected ? colId : 0;
      const idxName = formatDetected ? colName : 1;
      const idxDept = formatDetected ? colDept : 2;
      const idxYear = formatDetected && colYear >= 0 ? colYear : 3;

      const records = rows.map(r => ({ id: String(r[idxId] || "").trim(), name: String(r[idxName] || "").trim(), department: String(r[idxDept] || "").trim(), year: String(r[idxYear] || "").trim() || "SE" }));

      const res = await api("/api/admin/students/import", { method: "POST", token: STATE.adminToken, body: { confirm: false, records } });

      const hint = formatDetected ? "" : "No header row found — treated first line as data.";
      openModal(`
        <h3>Import Preview</h3>
        <div class="card" style="padding:14px;background:var(--gray-50)">
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
            <span class="pill open">${res.valid.length} valid</span>
            <span class="pill paused">${res.duplicates.length} duplicates</span>
            <span class="pill closed">${res.invalid.length} invalid</span>
          </div>
          ${hint ? `<p class="field-note">${hint}</p>` : ""}
          ${res.duplicates.length > 0 ? `<p class="small muted">Duplicate IDs skipped: ${escapeHtml(res.duplicates.join(", "))}</p>` : ""}
          ${res.invalid.length > 0 ? `<p class="small muted">Invalid records skipped: ${res.invalid.length}</p>` : ""}
        </div>
        <div class="card" style="overflow-x:auto;max-height:220px;overflow-y:auto">
          <table class="data-table">
            <tr><th>ID</th><th>Name</th><th>Dept</th><th>PIN (generated)</th></tr>
            ${res.valid.slice(0, 20).map(v => `<tr><td>${escapeHtml(v.id)}</td><td>${escapeHtml(v.name)}</td><td>${escapeHtml(v.department)}</td><td><span class="pin-cell">${escapeHtml(v.pin)}</span></td></tr>`).join("")}
            ${res.valid.length > 20 ? `<tr><td colspan="4" class="muted small">…and ${res.valid.length - 20} more</td></tr>` : ""}
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" id="imp-cancel">Cancel</button>
          <button class="btn btn-success btn-full" id="imp-confirm" ${res.valid.length === 0 ? "disabled" : ""}>Confirm &amp; Save ${res.valid.length} Students</button>
        </div>`);

      document.getElementById("imp-cancel").addEventListener("click", closeModal);
      document.getElementById("imp-confirm").addEventListener("click", async () => {
        try {
          const done = await api("/api/admin/students/import", { method: "POST", token: STATE.adminToken, body: { confirm: true, upload_token: res.upload_token } });
          closeModal();
          await renderStudents();
          toast(`${done.inserted} students imported with one-time PINs.`);
        } catch (err) {
          toast(err.message, "error");
        }
      });
    } catch (err) {
      toast(err.message, "error");
    }
  };
  reader.readAsText(file);
  this.value = "";
});

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

/* ============ VOTING CONTROLS (admin) ============ */

async function renderVotingControls() {
  const res = await api("/api/admin/elections", { token: STATE.adminToken });
  STATE.adminElections = res.elections;
  const list = document.getElementById("voting-control-list");
  if (STATE.adminElections.length === 0) {
    list.innerHTML = '<div class="card empty-state">No elections yet.</div>';
    document.getElementById("voting-status-pill").textContent = "—";
    return;
  }
  document.getElementById("voting-status-pill").textContent = "";
  list.innerHTML = STATE.adminElections.map(e => {
    const st = e.status;
    const turnout = e.eligible_count > 0 ? Math.round((e.ballots / e.eligible_count) * 100) : 0;
    return `
      <div class="card" style="border-left:4px solid ${st === "open" ? "var(--success)" : st === "paused" ? "var(--amber)" : st === "closed" ? "var(--gray-400)" : "var(--primary)"}">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:center">
          <div>
            <h4 style="margin-bottom:3px">${escapeHtml(e.title)} <span class="pill ${st}">${st}</span></h4>
            <p class="small muted">Eligible: ${e.eligible_count} • Ballots: ${e.ballots} • Turnout: ${turnout}%</p>
            <div class="result-bar" style="margin-top:8px;height:8px"><div class="result-bar-fill normal" style="width:${Math.min(turnout, 100)}%"></div></div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${st === "draft" ? `<button class="btn btn-success btn-small vc-open" data-id="${e.id}">▶ Open</button>` : ""}
            ${st === "open" ? `<button class="btn btn-outline btn-small vc-pause" data-id="${e.id}">⏸ Pause</button>` : ""}
            ${st === "paused" ? `<button class="btn btn-success btn-small vc-resume" data-id="${e.id}">▶ Resume</button>` : ""}
            ${(st === "open" || st === "paused") ? `<button class="btn btn-danger btn-small vc-close" data-id="${e.id}">■ Close</button>` : ""}
            ${st === "closed" ? `<button class="btn btn-primary btn-small vc-publish" data-id="${e.id}">📢 Publish Results</button>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");

  const apply = async (id, status, label) => {
    try {
      await api("/api/admin/elections/" + id + "/status", { method: "POST", token: STATE.adminToken, body: { status } });
      toast(label + ".");
      await renderVotingControls();
    } catch (err) { toast(err.message, "error"); }
  };

  list.querySelectorAll(".vc-open").forEach(b => b.addEventListener("click", () => apply(b.dataset.id, "open", "Opened voting")));
  list.querySelectorAll(".vc-pause").forEach(b => b.addEventListener("click", () => apply(b.dataset.id, "paused", "Paused voting")));
  list.querySelectorAll(".vc-resume").forEach(b => b.addEventListener("click", () => apply(b.dataset.id, "open", "Resumed voting")));
  list.querySelectorAll(".vc-close").forEach(b => b.addEventListener("click", () => {
    if (!confirm("Close voting? Ballots collected so far will be kept.")) return;
    apply(b.dataset.id, "closed", "Closed voting");
  }));
  list.querySelectorAll(".vc-publish").forEach(b => b.addEventListener("click", () => apply(b.dataset.id, "published", "Results published to public dashboard")));
}

/* ============ RESULTS (admin) ============ */

async function renderAdminResults() {
  const res = await api("/api/admin/elections", { token: STATE.adminToken });
  STATE.adminElections = res.elections;
  const list = document.getElementById("admin-results-list");
  if (STATE.adminElections.length === 0) {
    list.innerHTML = '<div class="card empty-state">No elections yet.</div>';
    return;
  }
  list.innerHTML = STATE.adminElections.map(e => {
    const published = e.status === "published" || e.status === "closed";
    return `
      <div class="row-card">
        <div class="row-main">
          <h4>${escapeHtml(e.title)} <span class="pill ${e.status}">${e.status}</span></h4>
          <p class="small muted">${published ? "Results may be viewed and exported." : "Voting must be closed before results are final."} Ballots: ${e.ballots}</p>
        </div>
        <div class="row-actions">
          <button class="btn btn-outline btn-small ar-view" data-id="${e.id}">View</button>
          ${published ? `<button class="btn btn-outline btn-small ar-export" data-id="${e.id}">Export CSV</button>` : ""}
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".ar-view").forEach(b => b.addEventListener("click", async () => {
    STATE.resultsReturn = "admin";
    try {
      await renderResults(b.dataset.id, true);
      showScreen("results-screen");
    } catch (err) { toast(err.message, "error"); }
  }));
  list.querySelectorAll(".ar-export").forEach(b => b.addEventListener("click", () => exportResultsCSV(b.dataset.id)));
}

document.getElementById("export-results-btn").addEventListener("click", async function () {
  const e = STATE.adminElections.find(x => x.status === "published" || x.status === "closed");
  if (!e) { toast("Close and publish an election first.", "error"); return; }
  await exportResultsCSV(e.id);
});

async function exportResultsCSV(eid) {
  try {
    const csv = await api("/api/admin/export/" + eid, { token: STATE.adminToken, raw: true });
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "election_results.csv";
    a.click();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ============ AUDIT LOG (admin) ============ */

async function renderAuditLog() {
  const res = await api("/api/admin/audit", { token: STATE.adminToken });
  const list = document.getElementById("audit-log-list");
  if (!res.log || res.log.length === 0) {
    list.innerHTML = '<div class="card empty-state">No administrative actions recorded.</div>';
    return;
  }
  list.innerHTML = '<div class="card">' + res.log.map(l => `
    <div class="audit-item">
      <span class="audit-time">${fmtTime(l.at)}</span>
      <span class="audit-action">${escapeHtml(l.action)}</span>
    </div>`).join("") + '</div>';
}

document.getElementById("clear-audit-btn").addEventListener("click", async function () {
  if (!confirm("Clear the entire audit log?")) return;
  try {
    await api("/api/admin/audit", { method: "DELETE", token: STATE.adminToken });
    await renderAuditLog();
    toast("Audit log cleared.");
  } catch (err) {
    toast(err.message, "error");
  }
});