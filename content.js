// ============================================================
// IndiaMART Scraper — Content Script v3.1
// Enquiry-page only flow:
// 1) collect supplier URLs from cards / modal link
// 2) fetch ONLY /enquiry.html
// 3) extract phone from #footerPNS or data-pnsno
// 4) retry 3 times, then skip
// 5) center repair box + bottom-right dock
// ============================================================

(function () {
  "use strict";

  if (window.__imScraperListening) return;
  window.__imScraperListening = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  const state = {
    isRunning: false,
    pauseRequested: false,
    stats: {
      collected: 0,
      processed: 0,
      failed: 0,
    },
  };

  function escText(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeText(s) {
    return String(s ?? "").replace(/\s+/g, " ").trim();
  }

  function onlyDigits(s) {
    return String(s ?? "").replace(/\D/g, "");
  }

  function runtimeSend(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(resp || { ok: false, error: "Empty response" });
      });
    });
  }

  function sendMsg(type, payload) {
    try {
      chrome.runtime.sendMessage({ type, payload });
    } catch (_) {}
  }

  const UI = {
    dockReady: false,
    repairReady: false,
    dock: {},
    repair: {},
  };

  function injectStyles() {
    if (document.getElementById("__im_scraper_styles__")) return;

    const style = document.createElement("style");
    style.id = "__im_scraper_styles__";
    style.textContent = `
      #__im_scraper_dock__ {
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: 360px;
        max-width: calc(100vw - 24px);
        z-index: 2147483647;
        font-family: Arial, sans-serif;
        color: #e8edf3;
        background: linear-gradient(180deg, #0f1620 0%, #0b1118 100%);
        border: 1px solid #223041;
        border-radius: 14px;
        box-shadow: 0 18px 60px rgba(0,0,0,.35);
        overflow: hidden;
      }
      #__im_scraper_dock__ * { box-sizing: border-box; }
      #__im_scraper_dock__.collapsed .im-body { display: none; }
      #__im_scraper_dock__ .im-hd {
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        padding:10px 12px; background:#101823; border-bottom:1px solid #1e2c3b;
      }
      #__im_scraper_dock__ .im-title { display:flex; flex-direction:column; gap:2px; min-width:0; }
      #__im_scraper_dock__ .im-title strong { font-size:12px; color:#f1f5f9; }
      #__im_scraper_dock__ .im-title span { font-size:10px; color:#93a4b5; }
      #__im_scraper_dock__ .im-actions { display:flex; gap:6px; }
      #__im_scraper_dock__ .im-btn {
        border:1px solid #243344; background:#151f2b; color:#dbe6f0;
        border-radius:10px; padding:6px 8px; font-size:11px; cursor:pointer;
      }
      #__im_scraper_dock__ .im-btn:hover { background:#1b2735; }
      #__im_scraper_dock__ .im-body { padding:10px 12px 12px; display:flex; flex-direction:column; gap:10px; }
      #__im_scraper_dock__ .im-kpis { display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; }
      #__im_scraper_dock__ .im-kpi {
        background:#0f1721; border:1px solid #223041; border-radius:10px; padding:8px;
      }
      #__im_scraper_dock__ .im-kpi .lbl {
        display:block; font-size:9px; text-transform:uppercase; letter-spacing:.08em; color:#7f90a3; margin-bottom:4px;
      }
      #__im_scraper_dock__ .im-kpi .val { font-size:12px; font-weight:700; color:#ecf2f7; }
      #__im_scraper_dock__ .im-progress { display:flex; flex-direction:column; gap:6px; }
      #__im_scraper_dock__ .row { display:flex; justify-content:space-between; gap:10px; font-size:10px; color:#97a7b8; }
      #__im_scraper_dock__ .im-track { height:6px; background:#162231; border-radius:999px; overflow:hidden; }
      #__im_scraper_dock__ .im-bar { width:0%; height:100%; background:linear-gradient(90deg,#00c87d,#00e5a0); transition:width .25s ease; }
      #__im_scraper_dock__ .im-mini { display:flex; gap:6px; flex-wrap:wrap; }
      #__im_scraper_dock__ .im-log {
        max-height:160px; overflow:auto; background:#0d141d; border:1px solid #223041; border-radius:10px; padding:8px;
      }
      #__im_scraper_dock__ .im-line { display:flex; gap:8px; margin-bottom:6px; font-size:10px; line-height:1.45; }
      #__im_scraper_dock__ .im-line:last-child { margin-bottom:0; }
      #__im_scraper_dock__ .im-log-ts { color:#93a4b5; flex-shrink:0; white-space:nowrap; }
      #__im_scraper_dock__ .im-log-msg { color:#d8e2eb; word-break:break-word; }

      #__im_scraper_repair__ {
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: min(520px, calc(100vw - 24px));
        z-index: 2147483647;
        background: rgba(10,16,23,.96);
        border: 1px solid #2a3a4d;
        border-radius: 16px;
        box-shadow: 0 24px 80px rgba(0,0,0,.45);
        color: #eef4fa;
        overflow: hidden;
        display: none;
      }
      #__im_scraper_repair__ * { box-sizing:border-box; }
      #__im_scraper_repair__ .hd {
        padding: 12px 14px;
        border-bottom: 1px solid #223041;
        display:flex;
        justify-content:space-between;
        gap:12px;
        align-items:flex-start;
      }
      #__im_scraper_repair__ .hd strong { display:block; font-size:14px; }
      #__im_scraper_repair__ .hd span { display:block; color:#9fb0c3; font-size:11px; margin-top:4px; line-height:1.4; }
      #__im_scraper_repair__ .body { padding: 14px; display:flex; flex-direction:column; gap:12px; }
      #__im_scraper_repair__ .err {
        background:#0f1721;
        border:1px solid #29394b;
        border-radius:12px;
        padding:12px;
        font-family: monospace;
        font-size:12px;
        color:#ffd7a8;
        white-space:pre-wrap;
        word-break:break-word;
        max-height:180px;
        overflow:auto;
      }
      #__im_scraper_repair__ .actions { display:flex; gap:8px; flex-wrap:wrap; }
      #__im_scraper_repair__ .act {
        border:1px solid #2c3e52;
        background:#15202d;
        color:#eef4fa;
        border-radius:10px;
        padding:8px 10px;
        font-size:12px;
        cursor:pointer;
      }
      #__im_scraper_repair__ .act:hover { background:#1b2735; }
      #__im_scraper_repair__ .act.primary { background:#00c87d; color:#03180e; border-color:#00c87d; font-weight:700; }
      #__im_scraper_repair__ .act.warn { background:#25150a; border-color:#53331a; color:#ffcf9c; }
      #__im_scraper_repair__ .foot { padding: 0 14px 14px; color:#9fb0c3; font-size:11px; line-height:1.5; }
    `;
    document.documentElement.appendChild(style);
  }

  function injectDock() {
    if (document.getElementById("__im_scraper_dock__")) return;
    injectStyles();

    const root = document.createElement("div");
    root.id = "__im_scraper_dock__";
    root.innerHTML = `
      <div class="im-hd">
        <div class="im-title">
          <strong>IndiaMART Scraper Pro</strong>
          <span id="imDockPhase">Idle</span>
        </div>
        <div class="im-actions">
          <button class="im-btn" id="imPauseBtn" type="button">Pause</button>
          <button class="im-btn" id="imCollapseBtn" type="button">Collapse</button>
        </div>
      </div>
      <div class="im-body">
        <div class="im-kpis">
          <div class="im-kpi"><span class="lbl">Status</span><div class="val" id="imDockStatus">IDLE</div></div>
          <div class="im-kpi"><span class="lbl">Suppliers</span><div class="val" id="imDockCount">0</div></div>
          <div class="im-kpi"><span class="lbl">Progress</span><div class="val" id="imDockPct">0%</div></div>
        </div>

        <div class="im-progress">
          <div class="row"><span id="imDockLabel">Waiting…</span><span id="imDockText">0 / 0</span></div>
          <div class="im-track"><div class="im-bar" id="imDockBar"></div></div>
        </div>

        <div class="im-mini">
          <button class="im-btn" id="imRetryCurrentBtn" type="button">Retry Current</button>
          <button class="im-btn" id="imSkipCurrentBtn" type="button">Skip Current</button>
          <button class="im-btn" id="imHideRepairBtn" type="button">Hide Error Box</button>
        </div>

        <div class="im-log" id="imDockLog"></div>
      </div>
    `;
    document.documentElement.appendChild(root);

    UI.dockReady = true;
    UI.dock.root = root;
    UI.dock.status = root.querySelector("#imDockStatus");
    UI.dock.phase = root.querySelector("#imDockPhase");
    UI.dock.count = root.querySelector("#imDockCount");
    UI.dock.pct = root.querySelector("#imDockPct");
    UI.dock.label = root.querySelector("#imDockLabel");
    UI.dock.text = root.querySelector("#imDockText");
    UI.dock.bar = root.querySelector("#imDockBar");
    UI.dock.log = root.querySelector("#imDockLog");
    UI.dock.pause = root.querySelector("#imPauseBtn");
    UI.dock.collapse = root.querySelector("#imCollapseBtn");
    UI.dock.retry = root.querySelector("#imRetryCurrentBtn");
    UI.dock.skip = root.querySelector("#imSkipCurrentBtn");
    UI.dock.hideRepair = root.querySelector("#imHideRepairBtn");

    UI.dock.collapse.addEventListener("click", () => {
      root.classList.toggle("collapsed");
      UI.dock.collapse.textContent = root.classList.contains("collapsed") ? "Expand" : "Collapse";
    });

    UI.dock.pause.addEventListener("click", () => {
      state.pauseRequested = !state.pauseRequested;
      UI.dock.pause.textContent = state.pauseRequested ? "Resume" : "Pause";
      dockLog(state.pauseRequested ? "Paused." : "Resumed.");
    });

    UI.dock.retry.addEventListener("click", () => {
      window.__imRetryCurrent = true;
      showRepair("Manual retry requested.", "");
    });

    UI.dock.skip.addEventListener("click", () => {
      window.__imSkipCurrent = true;
      showRepair("Current supplier marked to skip.", "");
    });

    UI.dock.hideRepair.addEventListener("click", hideRepair);
  }

  function injectRepair() {
    if (document.getElementById("__im_scraper_repair__")) return;
    injectStyles();

    const box = document.createElement("div");
    box.id = "__im_scraper_repair__";
    box.innerHTML = `
      <div class="hd">
        <div>
          <strong id="imRepairTitle">Connection recovery</strong>
          <span id="imRepairSubtitle">The scraper will retry automatically and then move on if needed.</span>
        </div>
        <button class="act" id="imRepairClose" type="button">Close</button>
      </div>
      <div class="body">
        <div class="err" id="imRepairError">No error.</div>
        <div class="actions">
          <button class="act primary" id="imRepairRetry" type="button">Retry now</button>
          <button class="act warn" id="imRepairSkip" type="button">Skip this supplier</button>
          <button class="act" id="imRepairOpenTab" type="button">Open enquiry tab</button>
        </div>
      </div>
      <div class="foot">Use the dock buttons to pause, retry, or skip while the extension keeps running.</div>
    `;
    document.documentElement.appendChild(box);

    UI.repairReady = true;
    UI.repair.root = box;
    UI.repair.title = box.querySelector("#imRepairTitle");
    UI.repair.subtitle = box.querySelector("#imRepairSubtitle");
    UI.repair.error = box.querySelector("#imRepairError");
    UI.repair.retry = box.querySelector("#imRepairRetry");
    UI.repair.skip = box.querySelector("#imRepairSkip");
    UI.repair.openTab = box.querySelector("#imRepairOpenTab");
    UI.repair.close = box.querySelector("#imRepairClose");

    UI.repair.retry.addEventListener("click", () => {
      window.__imRetryCurrent = true;
      hideRepair();
    });

    UI.repair.skip.addEventListener("click", () => {
      window.__imSkipCurrent = true;
      hideRepair();
    });

    UI.repair.openTab.addEventListener("click", () => {
      if (window.__imCurrentTempUrl) {
        chrome.runtime.sendMessage({
          action: "imOpenAndRead",
          url: window.__imCurrentTempUrl,
          pageType: "enquiry",
        });
      }
    });

    UI.repair.close.addEventListener("click", hideRepair);
  }

  function showRepair(title, errText, subtitle) {
    injectRepair();
    UI.repair.root.style.display = "block";
    UI.repair.title.textContent = title || "Connection recovery";
    UI.repair.subtitle.textContent =
      subtitle || "The scraper is retrying automatically and can skip this card safely.";
    UI.repair.error.textContent = errText || "No details.";
  }

  function hideRepair() {
    if (UI.repair.root) UI.repair.root.style.display = "none";
  }

  function setDockStatus(stateName, phaseText = "") {
    injectDock();
    const map = { idle: "IDLE", running: "RUNNING", done: "DONE", error: "ERROR" };
    UI.dock.status.textContent = map[stateName] || "IDLE";
    UI.dock.phase.textContent = phaseText || "Idle";
  }

  function setDockCount(count) {
    injectDock();
    UI.dock.count.textContent = String(count ?? 0);
  }

  function setDockProgress(cur, tot) {
    injectDock();
    const pct = tot > 0 ? Math.round((cur / tot) * 100) : 0;
    UI.dock.text.textContent = `${cur} / ${tot}`;
    UI.dock.pct.textContent = `${pct}%`;
    UI.dock.bar.style.width = `${pct}%`;
  }

  function dockLog(msg) {
    injectDock();
    const line = document.createElement("div");
    line.className = "im-line";
    const ts = new Date().toLocaleTimeString("en-IN", { hour12: false });
    line.innerHTML = `<span class="im-log-ts">${escText(ts)}</span><span class="im-log-msg">${escText(msg)}</span>`;
    UI.dock.log.appendChild(line);
    UI.dock.log.scrollTop = UI.dock.log.scrollHeight;
  }

  function log(msg) {
    sendMsg("log", { msg });
    dockLog(msg);
  }

  function parseHTML(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  function slugFromHref(href) {
    try {
      const u = new URL(href);
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg && seg.length > 2 && !seg.includes(".")) return seg;
    } catch (_) {}
    const m = String(href || "").match(/indiamart\.com\/([a-z0-9\-_]+)/i);
    return m ? m[1] : "";
  }

  function baseUrlFromHref(href) {
    const slug = slugFromHref(href);
    return slug ? `https://www.indiamart.com/${slug}/` : "";
  }

  function companyNameFromLink(linkEl, fallbackSlug = "") {
    const raw = normalizeText(linkEl?.textContent || "");
    if (raw) return raw.replace(/\s*[-–|].*$/, "").trim();
    if (fallbackSlug) {
      return fallbackSlug
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
    return "—";
  }

  async function fetchPage(url, attempts = 3) {
    for (let i = 1; i <= attempts; i++) {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "imFetch", url, attempts: 1 },
          (resp) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(resp || { ok: false, error: "Empty response" });
          }
        );
      });

      if (res?.ok && typeof res.text === "string") return res.text;

      log(`Fetch failed (${i}/${attempts}) for ${url}`);
      await sleep(450 * i);
    }
    return null;
  }

  async function readViaTempTab(url) {
    const res = await runtimeSend({
      action: "imOpenAndRead",
      url,
      pageType: "enquiry",
      timeoutMs: 30000,
    });
    if (res?.ok) return res.data || {};
    return {};
  }

  function extractPhone(root) {
    if (!root) return "";

    for (const a of root.querySelectorAll('a[href^="tel:"]')) {
      const d = onlyDigits(a.getAttribute("href") || "");
      if (d.length >= 10) return d;
    }

    const pnsNode = root.querySelector("#footerPNS, [data-pnsno], span[data-pnsno], div[data-pnsno]");
    if (pnsNode) {
      const attr = pnsNode.getAttribute("data-pnsno") || "";
      const attrDigits = onlyDigits(attr);
      if (attrDigits.length >= 10) return attrDigits;

      const visibleDigits = onlyDigits(normalizeText(pnsNode.textContent || ""));
      if (visibleDigits.length >= 10) return visibleDigits;
    }

    const sels = [
      ".cust_ph_no",
      ".mobtxt",
      "[class*='callnumber']",
      "[class*='call_number']",
      "[class*='phone_no']",
      "[class*='phoneno']",
      "[class*='mobno']",
      "[id*='mobno']",
      "[id*='phone']",
      "[id*='call']",
      "[class*='phno']",
      "[class*='phn']",
      ".phn",
      ".phone",
      ".supplierPhone",
      ".supplier_phone",
      "[data-phone]",
      "span[class*='cust']",
      ".cust-phone",
      ".supp-phone",
    ];

    for (const sel of sels) {
      try {
        const el = root.querySelector(sel);
        if (el) {
          const d = onlyDigits(el.textContent || "");
          if (d.length >= 10) return d.slice(0, 11);
        }
      } catch (_) {}
    }

    const text = normalizeText(root.textContent || "");
    const pats = [
      /(?:Call|Phone|Mob(?:ile)?|Contact|Ph(?:one)?\.?\s*(?:No|Number)?\.?\s*:?\s*)(0?[6-9]\d{9})/i,
      /\b(0?[6-9]\d{9})\b/,
      /\b([0-9]{5}[\s\-]?[0-9]{5})\b/,
      /\b(0[0-9]{2,3}[\s\-]?[0-9]{6,8})\b/,
    ];

    for (const pat of pats) {
      const m = text.match(pat);
      if (m) {
        const d = onlyDigits(m[1] || m[0]);
        if (d.length >= 10) return d;
      }
    }

    return "";
  }

  function extractEmail(root) {
    if (!root) return "";
    for (const a of root.querySelectorAll('a[href^="mailto:"]')) {
      const e = String(a.getAttribute("href") || "").replace("mailto:", "").split("?")[0].trim();
      if (e.includes("@")) return e;
    }
    const m = normalizeText(root.textContent || "").match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    return m ? m[0] : "";
  }

  function extractAddress(doc) {
    const sels = [
      ".fcp_m2.FM_fl.FM_w13",
      "[class*='fcp_m2']",
      "[id*='reach']",
      "[class*='reach']",
      "[class*='address']",
      "[class*='addr']",
      ".supp-addr",
      "[class*='supp_addr']",
    ];

    for (const sel of sels) {
      const el = doc.querySelector(sel);
      if (el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]').forEach((n) => n.remove());
        const t = normalizeText(clone.textContent || "").replace(/Reach\s*Us/gi, "").trim();
        if (t.length > 5) return t.slice(0, 220);
      }
    }
    return "";
  }

  function extractCompanyName(doc) {
    const el =
      doc.querySelector("h1") ||
      doc.querySelector('[class*="compname"]') ||
      doc.querySelector('[class*="company_name"]') ||
      doc.querySelector('[itemprop="name"]') ||
      doc.querySelector("title");
    if (!el) return "";
    return normalizeText(el.textContent || "").replace(/\s*[-–|].*$/, "").trim();
  }

  async function scrapeEnquiryOnly(baseUrl) {
    const url = baseUrl.replace(/\/$/, "") + "/enquiry.html";

    const html = await fetchPage(url, 3);
    if (html) {
      const doc = parseHTML(html);
      return {
        name: extractCompanyName(doc),
        phone: extractPhone(doc.body || doc.documentElement) || "—",
        email: extractEmail(doc.body || doc.documentElement) || "—",
        address: extractAddress(doc) || "—",
      };
    }

    log(`Background fetch failed. Opening temp enquiry tab for ${url}`);
    const temp = await readViaTempTab(url);

    return {
      name: temp.name || "—",
      phone: temp.phone || "—",
      email: temp.email || "—",
      address: temp.address || "—",
    };
  }

  function getSupplierCards() {
    let cards = [
      ...document.querySelectorAll('[id^="LST"]'),
      ...document.querySelectorAll("div[id^='LST']"),
      ...document.querySelectorAll("article[id^='LST']"),
      ...document.querySelectorAll("li[id^='LST']"),
      ...document.querySelectorAll(".card.brs5"),
      ...document.querySelectorAll("[class*='brs5']"),
    ];

    cards = [...new Set(cards)].filter((el) => el && el.isConnected);

    if (cards.length === 0) {
      const all = [...document.querySelectorAll("div, article, li, section")];
      cards = all.filter((el) => /contact\s*supplier|get\s*contact/i.test(el.innerText || ""));
    }

    return [...new Set(cards)];
  }

  function findContactButton(card) {
    const selectors = [
      '[class*="contactsupplier"]',
      '[class*="contact_supplier"]',
      '[class*="gNbtn"]',
      ".gNbtn",
      '[data-label="Contact Supplier"]',
      '[class*="sen_c"]',
      '[class*="NP-2"]',
      "button",
      "a",
      "span",
      "div",
    ];

    for (const sel of selectors) {
      const el = card.querySelector(sel);
      if (el && /contact.*supplier|get.*contact/i.test(el.textContent || "")) return el;
    }

    for (const el of card.querySelectorAll("button, a, span, div")) {
      if (/contact.*supplier|get.*contact/i.test(el.textContent || "")) return el;
    }

    return null;
  }

  async function closeModal() {
    const selectors = [
      ".cls-btn",
      ".prodet_close",
      "[aria-label='Close']",
      ".modal-close",
      "[data-dismiss='modal']",
      "button[class*='close']",
      ".close",
      "[class*='close']",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.click();
        await sleep(rand(250, 500));
        return;
      }
    }

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true })
    );
    await sleep(rand(250, 500));
  }

  async function collectFromCards() {
    injectDock();
    setDockStatus("running", "Collecting supplier links");
    setDockCount(0);
    setDockProgress(0, 0);

    const entries = [];
    const cards = getSupplierCards();
    log(`Found ${cards.length} supplier card(s).`);

    if (cards.length === 0) return entries;

    const seen = new Set();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      setDockProgress(i + 1, cards.length);

      if (state.pauseRequested) {
        i--;
        await sleep(400);
        continue;
      }

      const btn = findContactButton(card);
      if (!btn) {
        log(`Card ${i + 1}: Contact Supplier button not found.`);
        continue;
      }

      try {
        btn.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(250);
        btn.click();

        let modalLink = null;
        for (let tick = 0; tick < 35; tick++) {
          await sleep(160);
          const el = document.getElementById("t0901_addr0L");
          if (el && el.href && el.href.includes("indiamart.com")) {
            modalLink = el;
            break;
          }
        }

        if (!modalLink) {
          log(`Card ${i + 1}: modal link not found.`);
          await closeModal();
          continue;
        }

        const baseUrl = baseUrlFromHref(modalLink.href);
        const slug = slugFromHref(modalLink.href);

        if (!baseUrl || !slug) {
          log(`Card ${i + 1}: could not resolve supplier base URL.`);
          await closeModal();
          continue;
        }

        if (seen.has(slug)) {
          log(`Card ${i + 1}: duplicate supplier skipped.`);
          await closeModal();
          continue;
        }

        seen.add(slug);
        entries.push({
          index: entries.length + 1,
          slug,
          baseUrl,
          name: companyNameFromLink(modalLink, slug),
          modalHref: modalLink.href,
        });

        log(`Collected: ${entries[entries.length - 1].name} → ${baseUrl}`);
        await closeModal();
      } catch (e) {
        log(`Card ${i + 1}: ${e.message}`);
        await closeModal();
      }
    }

    setDockCount(entries.length);
    log(`Collected ${entries.length} unique supplier URL(s).`);
    return entries;
  }

  function normalizeRow(row) {
    return {
      index: row.index ?? 0,
      url: row.url || "—",
      name: row.name || "—",
      phone: row.phone || "—",
      email: row.email || "—",
      address: row.address || "—",
    };
  }

  async function processSupplier(supplier, idx, total) {
    const attemptLimit = 3;
    let lastErr = "";

    for (let attempt = 1; attempt <= attemptLimit; attempt++) {
      try {
        setDockStatus("running", `Fetching enquiry (${idx + 1}/${total})`);
        setDockProgress(idx + 1, total);

        window.__imCurrentTempUrl = supplier.baseUrl.replace(/\/$/, "") + "/enquiry.html";
        window.__imRetryCurrent = false;
        window.__imSkipCurrent = false;

        log(`Enquiry pass: ${supplier.name} (attempt ${attempt}/${attemptLimit})`);

        const enquiry = await scrapeEnquiryOnly(supplier.baseUrl);

        const row = normalizeRow({
          index: idx + 1,
          url: supplier.baseUrl,
          name: enquiry.name || supplier.name || "—",
          phone: enquiry.phone || "—",
          email: enquiry.email || "—",
          address: enquiry.address || "—",
        });

        sendMsg("result", row);
        log(`Saved: ${row.name} | ${row.phone} | ${row.email}`);
        return { ok: true, row };
      } catch (e) {
        lastErr = e.message || "Unknown error";
        showRepair(
          "Scraper recovery",
          `Supplier: ${supplier.name}\nAttempt: ${attempt}/${attemptLimit}\nError: ${lastErr}`,
          "The tool retries automatically and can skip this supplier safely."
        );
        log(`Supplier ${idx + 1} failed: ${lastErr}`);

        if (attempt < attemptLimit) {
          await sleep(900 * attempt);
        }
      }
    }

    return { ok: false, error: lastErr };
  }

  async function runScraper(searchKeyword, searchLocation) {
    if (state.isRunning) return;
    state.isRunning = true;

    injectDock();
    injectRepair();
    setDockStatus("running", "Launching scraper…");
    hideRepair();

    try {
      log("IndiaMART scraper started.");

      if (!location.hostname.includes("indiamart.com")) {
        showRepair(
          "Open IndiaMART first",
          "Please navigate to an IndiaMART search results page and try again."
        );
        sendMsg("error", { msg: "Please navigate to an IndiaMART search results page first." });
        return;
      }

      if (searchKeyword || searchLocation) {
        log(`Search config: ${searchKeyword || "—"}${searchLocation ? ` | ${searchLocation}` : ""}`);
      }

      const suppliers = await collectFromCards();

      if (suppliers.length === 0) {
        showRepair(
          "No suppliers found",
          "The page did not expose any supplier cards. Scroll the result page a little further and retry."
        );
        sendMsg("error", { msg: "No suppliers found. Make sure the page is fully loaded and visible." });
        return;
      }

      sendMsg("total", { count: suppliers.length });
      setDockCount(suppliers.length);
      log(`Found ${suppliers.length} suppliers. Fetching enquiry pages only…`);

      let successCount = 0;

      for (let i = 0; i < suppliers.length; i++) {
        setDockProgress(i + 1, suppliers.length);

        while (state.pauseRequested) {
          setDockStatus("idle", "Paused");
          await sleep(350);
        }

        if (window.__imSkipCurrent) {
          window.__imSkipCurrent = false;
          log(`Supplier ${i + 1} skipped by user.`);
          continue;
        }

        const res = await processSupplier(suppliers[i], i, suppliers.length);
        if (res.ok) successCount++;

        if (i < suppliers.length - 1) {
          const wait = rand(2500, 5000);
          log(`Waiting ${(wait / 1000).toFixed(1)}s before next supplier…`);
          await sleep(wait);
        }
      }

      setDockStatus("done", "Scraping complete");
      sendMsg("done", {
        msg: `Scraping complete! ${successCount} of ${suppliers.length} suppliers scraped successfully.`,
      });
      hideRepair();
    } catch (e) {
      setDockStatus("error", "Unexpected error");
      showRepair("Unexpected error", e.message || "Unknown scraper error.");
      sendMsg("error", { msg: e.message || "Unexpected scraper error." });
    } finally {
      state.isRunning = false;
      state.pauseRequested = false;
      UI.dock.pause.textContent = "Pause";
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "startScraping") {
      runScraper(message.keyword, message.location);
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "ping") {
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();