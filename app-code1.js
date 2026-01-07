import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/** ===========================
 *  SUPABASE CONFIG (YOUR VALUES)
 *  =========================== */
const SUPABASE_URL = "https://zbiutjrfcpzfndvwosfe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8xY3RQcA_JXtBH36iLQpUQ_Yr2ROeey";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** ===========================
 *  PAY RATE
 *  =========================== */
const HOURLY_RATE = 25.26;
const RATE_PER_SECOND = HOURLY_RATE / 3600;

/** ===========================
 *  STATE
 *  =========================== */
let intervalId = null;
let currentUser = null;

let state = {
  running: false,
  useManual: false,
  startTimeMs: null,   // timestamp (ms)
  manualNowMs: null,   // timestamp (ms)
};

// save to cloud every N seconds while running (avoid spam)
let cloudSaveCounter = 0;
const CLOUD_SAVE_EVERY_SECONDS = 30;

/** ===========================
 *  DOM HELPERS
 *  =========================== */
const $ = (id) => document.getElementById(id);

function setMoney(val) {
  $("money").innerText = "$" + val.toFixed(2);
}
function setStatus(msg) {
  $("status").innerText = msg;
}
function setAuthStatus(msg) {
  $("authStatus").innerText = msg;
}
function showAuthGate() {
  $("authGate").style.display = "block";
  $("trackerApp").style.display = "none";
}
function showTracker() {
  $("authGate").style.display = "none";
  $("trackerApp").style.display = "block";
}

/** ===========================
 *  TIME HELPERS
 *  =========================== */
// input value from <input type="time"> is always "HH:MM" or "HH:MM:SS" (24-hour)
function timeStrToMs(str) {
  const parts = (str || "00:00:00").split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;

  const d = new Date();
  d.setHours(h, m, s, 0);
  return d.getTime();
}

function msToTimeStr(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// YYYY-MM-DD (local)
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWorkEndMs() {
  const d = new Date();
  d.setHours(14, 20, 0, 0); // 2:20 PM
  return d.getTime();
}

function nowMs() {
  if (!state.useManual) return Date.now();
  if (state.manualNowMs == null) {
    state.manualNowMs = timeStrToMs($("manualNow").value);
  }
  return state.manualNowMs;
}

function computeEarned(now) {
  if (!state.startTimeMs) return 0;
  const end = getWorkEndMs();
  const effectiveNow = Math.min(now, end);
  const elapsedSeconds = (effectiveNow - state.startTimeMs) / 1000;
  return Math.max(0, elapsedSeconds) * RATE_PER_SECOND;
}

/** ===========================
 *  SUPABASE STORAGE: tracker_state
 *  =========================== */
async function loadCloudState() {
  if (!currentUser) return false;

  const { data, error } = await supabase
    .from("tracker_state")
    .select("state")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.warn("loadCloudState:", error.message);
    return false;
  }

  if (data?.state) {
    state = { ...state, ...data.state };
    return true;
  }
  return false;
}

async function saveCloudState() {
  if (!currentUser) return;

  const { error } = await supabase
    .from("tracker_state")
    .upsert({
      user_id: currentUser.id,
      state,
      updated_at: new Date().toISOString(),
    });

  if (error) console.warn("saveCloudState:", error.message);
}

/** ===========================
 *  SUPABASE STORAGE: earnings_log (daily totals)
 *  =========================== */
async function upsertDailyTotal(totalEarned) {
  if (!currentUser) return;

  const work_date = todayKey();
  const rounded = Number(totalEarned.toFixed(2));

  const { error } = await supabase
    .from("earnings_log")
    .upsert({
      user_id: currentUser.id,
      work_date,
      total_earned: rounded,
      updated_at: new Date().toISOString(),
    });

  if (error) console.warn("upsertDailyTotal:", error.message);
}

/** ===========================
 *  HISTORY DRAWER UI + QUERIES
 *  =========================== */
window.toggleHistory = function toggleHistory() {
  const drawer = $("historyDrawer");
  const open = drawer.classList.toggle("open");
  drawer.setAttribute("aria-hidden", String(!open));

  // load history when opened
  if (open) refreshHistory();
};

window.refreshHistory = async function refreshHistory() {
  if (!currentUser) return;

  const list = $("historyList");
  list.innerHTML = `<div class="muted">Loading…</div>`;

  const { data, error } = await supabase
    .from("earnings_log")
    .select("work_date,total_earned")
    .eq("user_id", currentUser.id)
    .order("work_date", { ascending: false });

  if (error) {
    list.innerHTML = `<div class="muted">Error loading history: ${error.message}</div>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = `<div class="muted">No data yet.</div>`;
    $("historyTotalValue").innerText = "$0.00";
    return;
  }

  let totalAll = 0;
  list.innerHTML = "";

  for (const row of data) {
    const dateStr = row.work_date; // YYYY-MM-DD
    const amt = Number(row.total_earned || 0);
    totalAll += amt;

    const div = document.createElement("div");
    div.className = "histRow";
    div.innerHTML = `<span>${dateStr}</span><span>$${amt.toFixed(2)}</span>`;
    list.appendChild(div);
  }

  $("historyTotalValue").innerText = "$" + totalAll.toFixed(2);
};

window.resetHistory = async function resetHistory() {
  if (!currentUser) return;

  const ok = confirm("Reset ALL saved history for your account? This cannot be undone.");
  if (!ok) return;

  const { error } = await supabase
    .from("earnings_log")
    .delete()
    .eq("user_id", currentUser.id);

  if (error) {
    alert("Could not reset history: " + error.message);
    return;
  }

  await refreshHistory();
};

/** ===========================
 *  RESTORE + RENDER
 *  =========================== */
function syncUIFromState() {
  $("useManual").checked = !!state.useManual;

  if (state.useManual) {
    if (state.manualNowMs != null) $("manualNow").value = msToTimeStr(state.manualNowMs);
  }
}

async function restoreAndRender() {
  syncUIFromState();

  const end = getWorkEndMs();
  const current = nowMs();

  // If already past end: freeze and stop
  if (state.startTimeMs && current >= end) {
    state.running = false;
    if (state.useManual) state.manualNowMs = end;

    const finalEarned = computeEarned(end);
    setMoney(finalEarned);
    setStatus("Workday ended at 2:20 PM — final saved.");

    stopInterval();
    await saveCloudState();
    await upsertDailyTotal(finalEarned);   // ✅ save daily total
    return;
  }

  // Normal render
  setMoney(computeEarned(current));
  setStatus(state.running ? "RUNNING" : "Ready.");

  if (state.running) startInterval();
  else stopInterval();
}

/** ===========================
 *  INTERVAL / TICK
 *  =========================== */
function startInterval() {
  if (intervalId) return;
  intervalId = setInterval(tick, 1000);
}

function stopInterval() {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
}

async function finalizeAtEnd(end) {
  state.running = false;
  if (state.useManual) state.manualNowMs = end;

  const finalEarned = computeEarned(end);
  setMoney(finalEarned);
  setStatus("Workday ended at 2:20 PM — final saved.");
  stopInterval();

  await saveCloudState();
  await upsertDailyTotal(finalEarned); // ✅ save daily total
}

function tick() {
  if (!currentUser || !state.running) return;

  const end = getWorkEndMs();

  // Advance manual clock by 1 sec if in manual mode
  if (state.useManual) {
    state.manualNowMs = nowMs() + 1000;
    $("manualNow").value = msToTimeStr(state.manualNowMs);
  }

  const current = nowMs();

  // Hard stop at 2:20 PM
  if (current >= end) {
    finalizeAtEnd(end);
    return;
  }

  setMoney(computeEarned(current));
  setStatus("RUNNING");

  cloudSaveCounter++;
  if (cloudSaveCounter >= CLOUD_SAVE_EVERY_SECONDS) {
    cloudSaveCounter = 0;
    saveCloudState();
  }
}

/** ===========================
 *  TRACKER CONTROLS (AUTH REQUIRED)
 *  =========================== */
window.start = async function start() {
  if (!currentUser) return;

  state.useManual = $("useManual").checked;

  if (state.useManual) {
    state.manualNowMs = timeStrToMs($("manualNow").value || "08:00:00");
  } else {
    state.manualNowMs = null;
  }

  const current = nowMs();
  const end = getWorkEndMs();

  if (current >= end) {
    await finalizeAtEnd(end);
    return;
  }

  state.running = true;
  state.startTimeMs = current;

  cloudSaveCounter = 0;
  await saveCloudState();

  await restoreAndRender();
};

window.stop = async function stop() {
  if (!currentUser) return;

  state.running = false;
  stopInterval();

  const total = computeEarned(nowMs());
  setStatus("Stopped.");
  await saveCloudState();
  await upsertDailyTotal(total); // ✅ save daily total on stop
};

window.resetAll = async function resetAll() {
  if (!currentUser) return;

  stopInterval();
  cloudSaveCounter = 0;

  // also save today's total as 0 (optional)
  await upsertDailyTotal(0);

  state = {
    running: false,
    useManual: false,
    startTimeMs: null,
    manualNowMs: null,
  };

  $("useManual").checked = false;
  $("manualNow").value = "08:00:00";

  setMoney(0);
  setStatus("Reset.");
  await saveCloudState();

  // update drawer if open
  const drawerOpen = $("historyDrawer").classList.contains("open");
  if (drawerOpen) refreshHistory();
};

window.applyManualNow = async function applyManualNow() {
  if (!currentUser) return;

  if (!$("useManual").checked) {
    setStatus("Enable manual time first.");
    return;
  }

  state.useManual = true;
  state.manualNowMs = timeStrToMs($("manualNow").value || "08:00:00");

  const end = getWorkEndMs();
  if (state.manualNowMs >= end) {
    state.manualNowMs = end;
    $("manualNow").value = msToTimeStr(end);

    if (state.running) {
      await finalizeAtEnd(end);
      return;
    }
  }

  setMoney(computeEarned(nowMs()));
  setStatus("Manual time applied.");
  await saveCloudState();
};

/** ===========================
 *  AUTH
 *  =========================== */
window.signUp = async function signUp() {
  const email = ($("email").value || "").trim();
  const password = $("password").value || "";

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    setAuthStatus("Sign up error: " + error.message);
    return;
  }

  setAuthStatus("Signed up! Now sign in.");
};

window.signIn = async function signIn() {
  const email = ($("email").value || "").trim();
  const password = $("password").value || "";

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setAuthStatus("Sign in error: " + error.message);
    return;
  }

  currentUser = data.user;
  setAuthStatus("Signed in as: " + currentUser.email);

  showTracker();

  await loadCloudState();
  await restoreAndRender();

  // preload history
  refreshHistory();
};

window.signOut = async function signOut() {
  await supabase.auth.signOut();

  currentUser = null;
  stopInterval();

  // close drawer on sign out
  $("historyDrawer").classList.remove("open");

  showAuthGate();
  setAuthStatus("Not signed in.");
};

/** ===========================
 *  INIT
 *  =========================== */
document.addEventListener("DOMContentLoaded", async () => {
  // existing session?
  const { data } = await supabase.auth.getUser();

  if (data?.user) {
    currentUser = data.user;
    setAuthStatus("Signed in as: " + currentUser.email);
    showTracker();

    await loadCloudState();
    await restoreAndRender();
  } else {
    currentUser = null;
    showAuthGate();
    setAuthStatus("Not signed in.");
  }

  // auth changes
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = session.user;
      setAuthStatus("Signed in as: " + currentUser.email);
      showTracker();

      await loadCloudState();
      await restoreAndRender();
      refreshHistory();
    } else {
      currentUser = null;
      stopInterval();
      $("historyDrawer").classList.remove("open");
      showAuthGate();
      setAuthStatus("Not signed in.");
    }
  });
});
