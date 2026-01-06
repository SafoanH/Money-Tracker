const HOURLY_RATE = 25.26;
const RATE_PER_SECOND = HOURLY_RATE / 3600;

let startTime = null;     // Date object in the chosen clock (real or manual)
let interval = null;

let manualNowDate = null; // internal manual "now" Date, ticks forward when running

function setMoney(amount) {
  document.getElementById("money").innerText = "$" + amount.toFixed(2);
}

function getTodayAt(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function getWorkStart() {
  return getTodayAt(document.getElementById("workStart").value);
}

function getWorkEnd() {
  return getTodayAt(document.getElementById("workEnd").value);
}

function usingManual() {
  return document.getElementById("useManual").checked;
}

function getNow() {
  // If manual mode, return the ticking manual date; otherwise real current time
  if (!usingManual()) return new Date();

  // If manual date isn't initialized yet, init from the input
  if (!manualNowDate) {
    manualNowDate = getTodayAt(document.getElementById("manualNow").value);
  }
  return new Date(manualNowDate);
}

function isWithinWorkHours(now) {
  const start = getWorkStart();
  const end = getWorkEnd();
  return now >= start && now < end;
}

function start() {
  if (interval) return; // prevent double start

  // Initialize manualNowDate from input when manual mode is ON
  if (usingManual()) {
    manualNowDate = getTodayAt(document.getElementById("manualNow").value);
  }

  const now = getNow();

  if (!isWithinWorkHours(now)) {
    document.getElementById("status").innerText =
      "Outside work hours for the CURRENT clock (manual or real). Adjust your manual time/start/end.";
    alert("Outside work hours");
    return;
  }

  // startTime should be the "now" in the chosen clock
  startTime = now;

  interval = setInterval(() => {
    // Tick manual time forward by 1 second if manual mode is ON
    if (usingManual() && manualNowDate) {
      manualNowDate = new Date(manualNowDate.getTime() + 1000);

      // Keep the manual input field roughly in sync (minutes only)
      const hh = String(manualNowDate.getHours()).padStart(2, "0");
      const mm = String(manualNowDate.getMinutes()).padStart(2, "0");
      document.getElementById("manualNow").value = `${hh}:${mm}`;
    }

    const nowTick = getNow();
    const end = getWorkEnd();

    if (nowTick >= end) {
      stop();
      document.getElementById("status").innerText = "Reached end time — stopped.";
      return;
    }

    const elapsedSeconds = (nowTick - startTime) / 1000;
    const earned = elapsedSeconds * RATE_PER_SECOND;

    setMoney(earned);

    document.getElementById("status").innerText =
      usingManual()
        ? `Running in MANUAL mode (now = ${nowTick.toLocaleTimeString()})`
        : `Running in REAL TIME mode (now = ${nowTick.toLocaleTimeString()})`;
  }, 1000);
}

function stop() {
  if (interval) clearInterval(interval);
  interval = null;
}

function updateManualOnce() {
  // One-off calculation without running
  stop();

  if (!usingManual()) {
    document.getElementById("status").innerText =
      "Turn on 'Use manual time' first to test with manual values.";
    return;
  }

  manualNowDate = getTodayAt(document.getElementById("manualNow").value);

  const start = getWorkStart();
  const end = getWorkEnd();
  const now = getNow();

  const clampedNow = new Date(
    Math.min(Math.max(now.getTime(), start.getTime()), end.getTime())
  );

  const elapsedSeconds = Math.max(0, (clampedNow - start) / 1000);
  const earned = elapsedSeconds * RATE_PER_SECOND;

  setMoney(earned);

  document.getElementById("status").innerText =
    `Manual one-off: start=${start.toLocaleTimeString()} now=${now.toLocaleTimeString()} end=${end.toLocaleTimeString()}`;
}
