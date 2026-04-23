// ============================================================
// IndiaMART Scraper Pro — Popup Script v2.0
// ============================================================
"use strict";

let results    = [];
let isRunning  = false;
let totalCount = 0;
let logLineCount = 0;

const $ = (id) => document.getElementById(id);
const startBtn  = $("startBtn");
const exportBtn = $("exportBtn");
const clearBtn  = $("clearBtn");
const openBtn   = $("openBtn");
const statusPill = $("statusPill");
const statusTxt  = $("statusTxt");
const pageUrl   = $("pageUrl");
const logWrap   = $("logWrap");
const logCount  = $("logCount");
const progWrap  = $("progWrap");
const progBar   = $("progBar");
const progText  = $("progText");
const progLabel = $("progLabel");
const cTotal    = $("cTotal");
const cPhone    = $("cPhone");
const cEmail    = $("cEmail");
const cAddr     = $("cAddr");
const cComp     = $("cComp");
const rowCount  = $("rowCount");
const tbody     = $("tbody");
const emptyState = $("emptyState");
const tableWrap  = $("tableWrap");
const toast      = $("toast");
const urlWarn    = $("urlWarn");
const kwInput    = $("kwInput");
const locInput   = $("locInput");

/* ── Init: detect current tab ───────────────────────────── */
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) return;
  const url = tab.url || "";
  const short = url.length > 72 ? url.slice(0, 69) + "…" : url;
  pageUrl.textContent = short;

  const onIM = url.includes("indiamart.com");
  const onSearch = url.includes("dir.indiamart.com") || url.includes("/search");

  if (!onIM) {
    urlWarn.style.display = "flex";
    startBtn.disabled = true;
  }
});

chrome.storage.local.get(["imResults", "imKeyword", "imLocation"], (stored) => {
  if (stored.imKeyword) kwInput.value  = stored.imKeyword;
  if (stored.imLocation) locInput.value = stored.imLocation;

  if (stored.imResults?.length) {
    results = stored.imResults;
    results.forEach(addRow);
    updateStats();
    showTable();
  }
});

openBtn.addEventListener("click", () => {
  const kw = kwInput.value.trim() || "home furniture manufacturer";
  const locRaw = locInput.value.trim();

  // Allow: "Delhi, Maharashtra, Gujarat"
  const states = locRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const url = `https://dir.indiamart.com/search.mp?ss=${encodeURIComponent(kw)}&v=4${
    states.length ? `&cq=${encodeURIComponent(states[0])}` : ""
  }`;

  chrome.tabs.create({ url });
  showToast("Opening IndiaMART search…");
});

startBtn.addEventListener("click", async () => {
  if (isRunning) return;

  const [tab] = await new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, r));
  if (!tab) return;

  const kw  = kwInput.value.trim()  || "home furniture manufacturer";
  const loc = locInput.value.trim() || "";

  // Save search params
  chrome.storage.local.set({ imKeyword: kw, imLocation: loc });

  isRunning = true;
  startBtn.innerHTML = "⏳ Scraping…";
  startBtn.disabled  = true;
  setStatus("running");
  progWrap.style.display = "flex";
  progLabel.textContent  = "Collecting supplier cards…";
  logMsg("🚀 Scraper launched. Please keep this tab active.", "info");

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    }).catch(() => {});

    // Send start signal
    chrome.tabs.sendMessage(tab.id, { action: "startScraping", keyword: kw, location: loc }, (res) => {
      if (chrome.runtime.lastError) {
        logMsg("Cannot connect to page. Refresh IndiaMART tab and try again.", "error");
        resetBtn(); setStatus("error");
      }
    });
  } catch (e) {
    logMsg("" + e.message, "error");
    resetBtn(); setStatus("error");
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  const { type, payload } = msg;

  switch (type) {
    case "log":
      logMsg(payload.msg, "info");
      break;
    case "total":
      totalCount = payload.count;
      progLabel.textContent = `Processing ${totalCount} suppliers…`;
      break;
    case "progress":
      updateProgress(payload.cur, payload.tot || totalCount);
      break;
    case "result":
      results.push(payload);
      addRow(payload);
      updateStats();
      showTable();
      chrome.storage.local.set({ imResults: results });
      exportBtn.disabled = false;
      clearBtn.disabled  = false;
      break;
    case "error":
      logMsg(payload.msg, "error");
      resetBtn(); setStatus("error");
      break;
    case "done":
      logMsg(payload.msg, "success");
      resetBtn(); setStatus("done");
      progLabel.textContent = "Scraping complete!";
      progBar.style.width   = "100%";
      showToast(`${results.length} suppliers scraped`);
      break;
  }
});

exportBtn.addEventListener("click", () => {
  if (!results.length || typeof XLSXGEN === "undefined") {
    showToast("⚠ No data or Excel engine not loaded."); return;
  }

  const headers = [
    "#", "Company Name", "Phone", "Email", "Address",
    "CEO / Owner", "Business Type", "Employees", "Annual Turnover",
    "Legal Status", "GST No.", "Year Established", "Rating",
    "Review Count", "Profile URL"
  ];

  const rows = results.map((r) => [
    r.index, r.name, r.phone, r.email, r.address,
    r.ceo, r.businessType, r.employees, r.turnover,
    r.legalStatus, r.gst, r.yearEst, r.rating,
    r.reviewCount, r.url
  ]);

  const xlsxBytes = XLSXGEN.generate([headers, ...rows]);
  const blob = new Blob([xlsxBytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `indiamart_suppliers_${date}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast("Excel file downloaded!");
  logMsg(`Exported ${results.length} records to Excel.`, "success");
});

clearBtn.addEventListener("click", () => {
  if (!confirm("Clear all scraped data? This cannot be undone.")) return;
  results = []; totalCount = 0; logLineCount = 0;
  tbody.innerHTML = "";
  logWrap.innerHTML = "";
  logCount.textContent = "0 lines";
  emptyState.style.display = "flex";
  tableWrap.style.display  = "none";
  exportBtn.disabled = true;
  clearBtn.disabled  = true;
  progWrap.style.display = "none";
  progBar.style.width = "0%";
  updateStats();
  setStatus("idle");
  chrome.storage.local.remove("imResults");
  showToast("🗑 Cleared.");
});

function logMsg(msg, level = "info") {
  const el  = document.createElement("div");
  el.className = `log-entry log-${level}`;
  const ts  = new Date().toLocaleTimeString("en-IN", { hour12: false });
  el.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg">${esc(msg)}</span>`;
  logWrap.appendChild(el);
  logWrap.scrollTop = logWrap.scrollHeight;
  logLineCount++;
  logCount.textContent = logLineCount + " line" + (logLineCount !== 1 ? "s" : "");
}

function addRow(r) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="td-idx">${r.index}</td>
    <td class="td-name" style="max-width:130px">
      <a href="${esc(r.url)}" target="_blank" title="${esc(r.name)}">${esc(r.name)}</a>
    </td>
    <td>
      ${r.phone !== "—"
        ? `<span class="chip chip-phone">📞 ${esc(r.phone)}</span>`
        : `<span class="chip-none">—</span>`}
    </td>
    <td>
      ${r.email !== "—"
        ? `<span class="chip chip-email" title="${esc(r.email)}">✉ ${esc(r.email.split("@")[0])}@…</span>`
        : `<span class="chip-none">—</span>`}
    </td>
    <td title="${esc(r.address)}" style="color:var(--ink1);font-size:9.5px">
      ${esc(r.address === "—" ? "—" : r.address.slice(0, 24) + (r.address.length > 24 ? "…" : ""))}
    </td>
    <td style="color:var(--ink1);font-size:9.5px" title="${esc(r.ceo)}">${esc((r.ceo||"—").slice(0,18))}</td>
    <td style="color:var(--ink2);font-size:9px">${esc(r.employees||"—")}</td>
  `;
  tbody.appendChild(tr);
  rowCount.textContent = results.length + " row" + (results.length !== 1 ? "s" : "");
}

function updateProgress(cur, tot) {
  const pct = tot > 0 ? Math.round((cur / tot) * 100) : 0;
  progBar.style.width = pct + "%";
  progText.textContent = `${cur} / ${tot} (${pct}%)`;
}

function updateStats() {
  cTotal.textContent = results.length;
  cPhone.textContent = results.filter(r => r.phone !== "—").length;
  cEmail.textContent = results.filter(r => r.email !== "—").length;
  cAddr.textContent  = results.filter(r => r.address !== "—").length;
  cComp.textContent  = results.filter(r => r.phone !== "—" && r.name !== "—").length;
}

function showTable() {
  emptyState.style.display = "none";
  tableWrap.style.display  = "block";
}

function setStatus(state) {
  statusPill.dataset.s = state;
  const labels = { idle: "IDLE", running: "RUNNING", done: "DONE", error: "ERROR" };
  statusTxt.textContent = labels[state] || "IDLE";
}

function resetBtn() {
  isRunning = false;
  startBtn.innerHTML = "▶ Start Scraping";
  startBtn.disabled  = false;
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
