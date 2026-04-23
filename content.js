// ============================================================
// IndiaMART Scraper — Content Script v3.0
// Fixed flow:
// 1) collect supplier base URLs from modal link #t0901_addr0L
// 2) fetch profile + facts first
// 3) fetch enquiry page last and extract phone from #footerPNS / data-pnsno
// 4) keep a floating bottom-right dock that can be collapsed
// ============================================================

(function () {
  "use strict";

  if (window.__imScraperListening) return;
  window.__imScraperListening = true;

  /* ─────────────────────────────────────────────────────────
   * State
   * ───────────────────────────────────────────────────────── */
  let isRunning = false;
  let currentPhase = "idle";

  /* ─────────────────────────────────────────────────────────
   * Small helpers
   * ───────────────────────────────────────────────────────── */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function parseHTML(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

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

  function sendMsg(type, payload) {
    try {
      chrome.runtime.sendMessage({ type, payload });
    } catch (_) {}
  }

  function log(msg) {
    sendMsg("log", { msg });
    dockLog(msg);
  }

  function prog(cur, tot) {
    sendMsg("progress", { cur, tot });
    updateDockProgress(cur, tot);
  }

  function sendResult(data) {
    sendMsg("result", data);
  }

  function done(msg) {
    sendMsg("done", { msg });
    setDockStatus("done", msg);
  }

  function err(msg) {
    sendMsg("error", { msg });
    setDockStatus("error", msg);
  }

  async function fetchPage(url) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-IN,en;q=0.9,hi;q=0.7",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        credentials: "include",
      });
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      console.warn("[IM-Scraper] fetch error:", url, e.message);
      return null;
    }
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

  function baseUrlFromAnyHref(href) {
    const slug = slugFromHref(href);
    if (!slug) return "";
    return `https://www.indiamart.com/${slug}/`;
  }

  function companyNameFromModalLink(linkEl, fallbackSlug = "") {
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

  /* ─────────────────────────────────────────────────────────
   * Floating bottom-right dock
   * ───────────────────────────────────────────────────────── */
  const DOCK_ID = "__im_scraper_dock__";

  const dock = {
    root: null,
    statusTxt: null,
    phaseTxt: null,
    countTxt: null,
    progTxt: null,
    progBar: null,
    logWrap: null,
    collapsed: false,
  };

  function injectDock() {
    if (document.getElementById(DOCK_ID)) return;

    const style = document.createElement("style");
    style.textContent = `
      #${DOCK_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: 340px;
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
      #${DOCK_ID} * { box-sizing: border-box; }
      #${DOCK_ID} .im-hd {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        background: #101823;
        border-bottom: 1px solid #1e2c3b;
      }
      #${DOCK_ID} .im-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      #${DOCK_ID} .im-title strong {
        font-size: 12px;
        letter-spacing: .02em;
        color: #f1f5f9;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${DOCK_ID} .im-title span,
      #${DOCK_ID} .im-meta,
      #${DOCK_ID} .im-log-ts {
        font-size: 10px;
        color: #93a4b5;
      }
      #${DOCK_ID} .im-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      #${DOCK_ID} .im-btn {
        border: 1px solid #243344;
        background: #151f2b;
        color: #dbe6f0;
        border-radius: 10px;
        padding: 6px 8px;
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
        user-select: none;
      }
      #${DOCK_ID} .im-btn:hover { background: #1b2735; }
      #${DOCK_ID} .im-body {
        padding: 10px 12px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #${DOCK_ID} .im-kpis {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      #${DOCK_ID} .im-kpi {
        background: #0f1721;
        border: 1px solid #223041;
        border-radius: 10px;
        padding: 8px;
      }
      #${DOCK_ID} .im-kpi .lbl {
        display: block;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: .08em;
        color: #7f90a3;
        margin-bottom: 4px;
      }
      #${DOCK_ID} .im-kpi .val {
        font-size: 12px;
        font-weight: 700;
        color: #ecf2f7;
      }
      #${DOCK_ID} .im-progress {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      #${DOCK_ID} .im-progress .row {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        font-size: 10px;
        color: #97a7b8;
      }
      #${DOCK_ID} .im-track {
        height: 6px;
        background: #162231;
        border-radius: 999px;
        overflow: hidden;
      }
      #${DOCK_ID} .im-bar {
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, #00c87d, #00e5a0);
        border-radius: inherit;
        transition: width .25s ease;
      }
      #${DOCK_ID} .im-log {
        max-height: 150px;
        overflow: auto;
        background: #0d141d;
        border: 1px solid #223041;
        border-radius: 10px;
        padding: 8px;
      }
      #${DOCK_ID} .im-line {
        display: flex;
        gap: 8px;
        margin-bottom: 6px;
        font-size: 10px;
        line-height: 1.45;
      }
      #${DOCK_ID} .im-line:last-child { margin-bottom: 0; }
      #${DOCK_ID} .im-log-ts { flex-shrink: 0; white-space: nowrap; }
      #${DOCK_ID} .im-log-msg { color: #d8e2eb; word-break: break-word; }
      #${DOCK_ID}.collapsed {
        width: 280px;
      }
      #${DOCK_ID}.collapsed .im-body {
        display: none;
      }
    `;
    document.documentElement.appendChild(style);

    const root = document.createElement("div");
    root.id = DOCK_ID;
    root.innerHTML = `
      <div class="im-hd">
        <div class="im-title">
          <strong>IndiaMART Scraper Pro</strong>
          <span id="imDockPhase">Idle</span>
        </div>
        <div class="im-actions">
          <button class="im-btn" id="imDockCollapse" type="button">Collapse</button>
        </div>
      </div>
      <div class="im-body">
        <div class="im-kpis">
          <div class="im-kpi">
            <span class="lbl">Status</span>
            <div class="val" id="imDockStatus">IDLE</div>
          </div>
          <div class="im-kpi">
            <span class="lbl">Suppliers</span>
            <div class="val" id="imDockCount">0</div>
          </div>
          <div class="im-kpi">
            <span class="lbl">Progress</span>
            <div class="val" id="imDockPct">0%</div>
          </div>
        </div>
        <div class="im-progress">
          <div class="row">
            <span id="imDockLabel">Waiting…</span>
            <span id="imDockText">0 / 0</span>
          </div>
          <div class="im-track"><div class="im-bar" id="imDockBar"></div></div>
        </div>
        <div class="im-log" id="imDockLog"></div>
      </div>
    `;
    document.documentElement.appendChild(root);

    dock.root = root;
    dock.statusTxt = root.querySelector("#imDockStatus");
    dock.phaseTxt = root.querySelector("#imDockPhase");
    dock.countTxt = root.querySelector("#imDockCount");
    dock.progTxt = root.querySelector("#imDockText");
    dock.progBar = root.querySelector("#imDockBar");
    dock.logWrap = root.querySelector("#imDockLog");
    dock.labelTxt = root.querySelector("#imDockLabel");
    dock.pctTxt = root.querySelector("#imDockPct");

    root.querySelector("#imDockCollapse").addEventListener("click", () => {
      dock.collapsed = !dock.collapsed;
      root.classList.toggle("collapsed", dock.collapsed);
      root.querySelector("#imDockCollapse").textContent = dock.collapsed ? "Expand" : "Collapse";
    });
  }

  function setDockStatus(state, phaseText = "") {
    injectDock();
    const map = {
      idle: "IDLE",
      running: "RUNNING",
      done: "DONE",
      error: "ERROR",
    };
    dock.statusTxt.textContent = map[state] || "IDLE";
    dock.phaseTxt.textContent = phaseText || currentPhase || "Idle";
  }

  function setDockCount(count) {
    injectDock();
    dock.countTxt.textContent = String(count ?? 0);
  }

  function updateDockProgress(cur, tot) {
    injectDock();
    const pct = tot > 0 ? Math.round((cur / tot) * 100) : 0;
    dock.progTxt.textContent = `${cur} / ${tot}`;
    dock.pctTxt.textContent = `${pct}%`;
    dock.progBar.style.width = `${pct}%`;
  }

  function dockLog(msg) {
    injectDock();
    if (!dock.logWrap) return;
    const line = document.createElement("div");
    line.className = "im-line";
    const ts = new Date().toLocaleTimeString("en-IN", { hour12: false });
    line.innerHTML = `<span class="im-log-ts">${escText(ts)}</span><span class="im-log-msg">${escText(msg)}</span>`;
    dock.logWrap.appendChild(line);
    dock.logWrap.scrollTop = dock.logWrap.scrollHeight;
  }

  /* ─────────────────────────────────────────────────────────
   * Extraction helpers
   * ───────────────────────────────────────────────────────── */
  function extractPhone(root) {
    if (!root) return "";

    // 1) tel: links
    for (const a of root.querySelectorAll('a[href^="tel:"]')) {
      const raw = a.getAttribute("href") || "";
      const digits = onlyDigits(raw);
      if (digits.length >= 10) return digits;
    }

    // 2) specific "footerPNS" / pns spans on enquiry page
    const pnsCandidates = [
      root.querySelector("#footerPNS"),
      root.querySelector("[data-pnsno]"),
      root.querySelector("[id*='footerPNS']"),
      root.querySelector("span[data-pnsno]"),
      root.querySelector("div[data-pnsno]"),
    ].filter(Boolean);

    for (const el of pnsCandidates) {
      const visible = normalizeText(el.textContent || "");
      const visibleDigits = onlyDigits(visible);
      if (visibleDigits.length === 10 || visibleDigits.length === 11) {
        return visibleDigits;
      }

      const attr =
        el.getAttribute("data-pnsno") ||
        el.querySelector("[data-pnsno]")?.getAttribute("data-pnsno") ||
        "";
      const attrDigits = onlyDigits(attr);
      if (attrDigits.length >= 10) {
        return attrDigits;
      }
    }

    // 3) known classes / ids
    const phoneSels = [
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
    for (const sel of phoneSels) {
      try {
        const el = root.querySelector(sel);
        if (el) {
          const digits = onlyDigits(el.textContent || "");
          if (digits.length >= 10) return digits.slice(0, 11);
        }
      } catch (_) {}
    }

    // 4) regex on visible text
    const text = normalizeText(root.textContent || "");
    const patterns = [
      /(?:Call|Phone|Mob(?:ile)?|Contact|Ph(?:one)?\.?\s*(?:No|Number)?\.?\s*:?\s*)(0?[6-9]\d{9})/i,
      /\b(0?[6-9]\d{9})\b/,
      /\b([0-9]{5}[\s\-]?[0-9]{5})\b/,
      /\b(0[0-9]{2,3}[\s\-]?[0-9]{6,8})\b/,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        const found = onlyDigits(m[1] || m[0]);
        if (found.length >= 10) return found;
      }
    }

    return "";
  }

  function extractEmail(root) {
    if (!root) return "";

    for (const a of root.querySelectorAll('a[href^="mailto:"]')) {
      const e = String(a.getAttribute("href") || "")
        .replace("mailto:", "")
        .split("?")[0]
        .trim();
      if (e.includes("@")) return e;
    }

    const text = normalizeText(root.textContent || "");
    const m = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (m) return m[0];
    return "";
  }

  function extractFirstValueByPatterns(doc, patterns) {
    const sels = [
      "table tr",
      "[class*='factsheet'] tr",
      "dl dt",
      "[class*='label']",
      "[class*='lbl']",
      "[class*='key']",
    ];

    for (const sel of sels) {
      for (const row of doc.querySelectorAll(sel)) {
        const cells = row.querySelectorAll("td, th");
        if (cells.length >= 2) {
          const key = normalizeText(cells[0].textContent || "");
          if (patterns.some((re) => re.test(key))) {
            return normalizeText(cells[1].textContent || "");
          }
        }

        if (row.tagName === "DT") {
          const key = normalizeText(row.textContent || "");
          if (patterns.some((re) => re.test(key))) {
            const dd = row.nextElementSibling;
            if (dd) return normalizeText(dd.textContent || "");
          }
        } else {
          const key = normalizeText(row.textContent || "");
          if (patterns.some((re) => re.test(key))) {
            const parent = row.parentElement;
            const val =
              row.nextElementSibling ||
              parent?.querySelector("[class*='val']") ||
              parent?.querySelector("[class*='value']");
            if (val) return normalizeText(val.textContent || "");
          }
        }
      }
    }
    return "";
  }

  function cleanCompanyNameFromDoc(doc) {
    const nameEl =
      doc.querySelector("h1") ||
      doc.querySelector('[class*="compname"]') ||
      doc.querySelector('[class*="company_name"]') ||
      doc.querySelector('[itemprop="name"]') ||
      doc.querySelector("title");

    if (!nameEl) return "";
    return normalizeText(nameEl.textContent || "").replace(/\s*[-–|].*$/, "").trim();
  }

  /* ─────────────────────────────────────────────────────────
   * Page scrapers
   * ───────────────────────────────────────────────────────── */
  async function scrapeEnquiryPage(baseUrl) {
    const url = baseUrl.replace(/\/$/, "") + "/enquiry.html";
    const html = await fetchPage(url);
    if (!html) return {};

    const doc = parseHTML(html);
    const data = {};

    data.phone = extractPhone(doc.body || doc);

    // Email
    data.email = extractEmail(doc.body || doc);

    // Address
    const addressSelectors = [
      ".fcp_m2.FM_fl.FM_w13",
      "[class*='fcp_m2']",
      "[id*='reach']",
      "[class*='reach']",
      "[class*='address']",
      "[class*='addr']",
      ".supp-addr",
      "[class*='supp_addr']",
    ];

    for (const sel of addressSelectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]').forEach((n) => n.remove());
        const txt = normalizeText(clone.textContent || "")
          .replace(/Reach\s*Us/gi, "")
          .trim();
        if (txt.length > 5) {
          data.address = txt.slice(0, 200);
          break;
        }
      }
    }

    if (!data.address) {
      const bodyText = normalizeText(doc.body?.textContent || "");
      const addrMatch = bodyText.match(/([A-Z][a-z][\w\s,\-\/]+(?:Road|Rd|Street|St|Lane|Ln|Area|Sector|Phase|Nagar|Industrial Area|Industrial Estate)[\w\s,\-\/]*\d{6})/i);
      if (addrMatch) data.address = normalizeText(addrMatch[1]).slice(0, 200);
    }

    return data;
  }

  async function scrapeProfilePage(baseUrl) {
    const url = baseUrl.replace(/\/$/, "") + "/profile.html";
    const html = await fetchPage(url);
    if (!html) return {};

    const doc = parseHTML(html);
    const data = {};

    data.name = cleanCompanyNameFromDoc(doc);

    // Fallback contact values from profile page
    data.phone = extractPhone(doc.body || doc);
    data.email = extractEmail(doc.body || doc);

    data.ceo = extractFirstValueByPatterns(doc, [
      /ceo/i,
      /owner/i,
      /proprietor/i,
      /chairman/i,
      /contact\s*person/i,
      /\bmd\b/i,
    ]);

    data.address = extractFirstValueByPatterns(doc, [
      /registered\s*address/i,
      /\baddress\b/i,
    ]);

    data.employees = extractFirstValueByPatterns(doc, [
      /employee/i,
      /staff/i,
      /manpower/i,
    ]);

    data.turnover = extractFirstValueByPatterns(doc, [
      /turnover/i,
      /annual/i,
    ]);

    data.businessType = extractFirstValueByPatterns(doc, [
      /nature.*business/i,
      /business.*type/i,
      /additional.*business/i,
      /line of business/i,
    ]);

    data.gst = extractFirstValueByPatterns(doc, [
      /gst/i,
      /gstin/i,
    ]);

    data.legalStatus = extractFirstValueByPatterns(doc, [
      /legal\s*status/i,
      /firm/i,
    ]);

    data.yearEst = extractFirstValueByPatterns(doc, [
      /establish/i,
      /founded/i,
      /year/i,
    ]);

    return data;
  }

  async function scrapeTestimonialsPage(baseUrl) {
    const url = baseUrl.replace(/\/$/, "") + "/testimonials.html";
    const html = await fetchPage(url);
    if (!html) return {};

    const doc = parseHTML(html);
    const data = {};

    const reviews = doc.querySelectorAll(
      "[class*='review'], [class*='testimonial'], [class*='rating_card'], [itemprop='review']"
    );
    data.reviewCount = reviews.length ? String(reviews.length) : "—";

    const ratingEl = doc.querySelector(
      "[class*='avg_rating'], [class*='average_rating'], [itemprop='ratingValue'], [class*='ratVal']"
    );
    if (ratingEl) data.rating = normalizeText(ratingEl.textContent || "");
    else data.rating = "—";

    return data;
  }

  /* ─────────────────────────────────────────────────────────
   * Supplier card collection
   * ───────────────────────────────────────────────────────── */
  function getSupplierCards() {
    let cards = [
      ...document.querySelectorAll(".card.brs5"),
      ...document.querySelectorAll("[id^='LST']"),
    ];

    cards = [...new Set(cards)];

    if (cards.length === 0) {
      cards = [...new Set([...document.querySelectorAll("[class*='brs5']")])];
    }

    return cards;
  }

  function findContactButton(card) {
    const BTN_SELS = [
      '[class*="contactsupplier"]',
      '[class*="contact_supplier"]',
      '[class*="gNbtn"]',
      ".gNbtn",
      '[data-label="Contact Supplier"]',
      '[class*="sen_c"]',
      '[class*="NP-2"]',
      "button",
      "a",
    ];

    for (const sel of BTN_SELS) {
      const el = card.querySelector(sel);
      if (el && /contact.*supplier|get.*contact/i.test(el.textContent || "")) return el;
    }

    for (const el of card.querySelectorAll("button, a, div, span")) {
      if (/contact.*supplier|get.*contact/i.test(el.textContent || "")) return el;
    }

    return null;
  }

  async function closeModal() {
    const CLOSE_SELS = [
      ".cls-btn",
      ".prodet_close",
      "[aria-label='Close']",
      ".modal-close",
      "[data-dismiss='modal']",
      "button[class*='close']",
      ".close",
      "[class*='close']",
    ];

    let closed = false;
    for (const sel of CLOSE_SELS) {
      const cb = document.querySelector(sel);
      if (cb) {
        cb.click();
        closed = true;
        break;
      }
    }

    if (!closed) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true })
      );
    }

    await sleep(rand(350, 650));
  }

  async function collectFromCards() {
    injectDock();
    setDockStatus("running", "Collecting supplier links");
    setDockCount(0);
    updateDockProgress(0, 0);

    const entries = [];
    const cards = getSupplierCards();

    log(`Found ${cards.length} supplier card(s) on the page.`);
    if (cards.length === 0) return entries;

    const seenSlugs = new Set();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      prog(i + 1, cards.length);
      currentPhase = "collecting links";
      setDockStatus("running", `Collecting supplier links (${i + 1}/${cards.length})`);

      const btn = findContactButton(card);
      if (!btn) {
        log(`Card ${i + 1}: no Contact Supplier button found.`);
        continue;
      }

      try {
        btn.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(350);
        btn.click();

        let modalLink = null;
        for (let tick = 0; tick < 30; tick++) {
          await sleep(180);
          const el = document.getElementById("t0901_addr0L");
          if (el && el.href && el.href.includes("indiamart.com")) {
            modalLink = el;
            break;
          }
        }

        if (!modalLink) {
          log(`Card ${i + 1}: modal link #t0901_addr0L not found.`);
          await closeModal();
          continue;
        }

        const baseUrl = baseUrlFromAnyHref(modalLink.href);
        const slug = slugFromHref(modalLink.href);

        if (!baseUrl || !slug) {
          log(`Card ${i + 1}: could not resolve supplier URL.`);
          await closeModal();
          continue;
        }

        if (seenSlugs.has(slug)) {
          log(`Card ${i + 1}: duplicate supplier skipped (${slug}).`);
          await closeModal();
          continue;
        }

        seenSlugs.add(slug);

        const name = companyNameFromModalLink(modalLink, slug);
        entries.push({
          index: entries.length + 1,
          slug,
          baseUrl,
          name,
          modalHref: modalLink.href,
        });

        log(`Collected: ${name} → ${baseUrl}`);
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

  /* ─────────────────────────────────────────────────────────
   * Main flow
   * ───────────────────────────────────────────────────────── */
  async function runScraper(searchKeyword, searchLocation) {
    if (isRunning) return;
    isRunning = true;

    try {
      injectDock();
      currentPhase = "starting";
      setDockStatus("running", "Launching scraper…");

      log(`IndiaMART scraper started.`);
      if (!location.hostname.includes("indiamart.com")) {
        err("Please open an IndiaMART search results page first.");
        return;
      }

      if (searchKeyword || searchLocation) {
        log(
          `Search config: ${searchKeyword || "—"}${searchLocation ? ` | ${searchLocation}` : ""}`
        );
      }

      const suppliers = await collectFromCards();

      if (suppliers.length === 0) {
        err("No suppliers found. Load the results page fully and scroll down once.");
        return;
      }

      sendMsg("total", { count: suppliers.length });
      setDockCount(suppliers.length);
      log(`Found ${suppliers.length} suppliers. Fetching details now…`);

      let successCount = 0;

      for (let i = 0; i < suppliers.length; i++) {
        const supplier = suppliers[i];
        prog(i + 1, suppliers.length);

        try {
          currentPhase = `profile ${i + 1}/${suppliers.length}`;
          setDockStatus("running", `Fetching details (${i + 1}/${suppliers.length})`);
          log(`Detail pass: ${supplier.name}`);

          // First: profile + facts + testimonials
          const [profile, testimonials] = await Promise.all([
            scrapeProfilePage(supplier.baseUrl),
            scrapeTestimonialsPage(supplier.baseUrl),
          ]);

          // Then: enquiry page phone number
          currentPhase = `phone ${i + 1}/${suppliers.length}`;
          setDockStatus("running", `Resolving phone number (${i + 1}/${suppliers.length})`);
          const enquiry = await scrapeEnquiryPage(supplier.baseUrl);

          const row = {
            index: i + 1,
            url: supplier.baseUrl,
            name: profile.name || supplier.name || "—",
            phone: enquiry.phone || profile.phone || "—",
            email: enquiry.email || profile.email || "—",
            address: enquiry.address || profile.address || "—",
            ceo: profile.ceo || "—",
            businessType: profile.businessType || "—",
            employees: profile.employees || "—",
            turnover: profile.turnover || "—",
            legalStatus: profile.legalStatus || "—",
            gst: profile.gst || "—",
            yearEst: profile.yearEst || "—",
            rating: testimonials.rating || "—",
            reviewCount: testimonials.reviewCount || "—",
          };

          sendResult(row);
          successCount++;

          log(`Saved: ${row.name} | ${row.phone} | ${row.email}`);

          // Polite delay
          if (i < suppliers.length - 1) {
            const wait = rand(2500, 5000);
            log(`Waiting ${(wait / 1000).toFixed(1)}s before next supplier…`);
            await sleep(wait);
          }
        } catch (e) {
          log(`Supplier ${i + 1}: ${e.message}`);
        }
      }

      done(`Scraping complete. ${successCount} of ${suppliers.length} suppliers saved.`);
    } catch (e) {
      err(e.message || "Unexpected scraper error.");
    } finally {
      isRunning = false;
    }
  }

  /* ─────────────────────────────────────────────────────────
   * Message bridge
   * ───────────────────────────────────────────────────────── */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message.action === "startScraping") {
        runScraper(message.keyword, message.location);
        sendResponse({ ok: true });
        return true;
      }

      if (message.action === "ping") {
        sendResponse({ ok: true });
        return true;
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
    return false;
  });
})();