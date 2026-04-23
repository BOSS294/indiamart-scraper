// ============================================================
// IndiaMART Scraper — Content Script v2.0 (Enterprise)
// ============================================================

(function () {
  "use strict";

  // Guard: only register listeners once per page load
  if (window.__imScraperListening) return;
  window.__imScraperListening = true;

  /* ── Utilities ────────────────────────────────────────── */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand  = (lo, hi) => lo + Math.random() * (hi - lo);

  function sendMsg(type, payload) {
    try { chrome.runtime.sendMessage({ type, payload }); } catch (_) {}
  }
  const log    = (msg)      => sendMsg("log",      { msg });
  const prog   = (cur, tot) => sendMsg("progress", { cur, tot });
  const result = (data)     => sendMsg("result",   data);
  const done   = (msg)      => sendMsg("done",     { msg });
  const err    = (msg)      => sendMsg("error",    { msg });

  function parseHTML(html) {
    return new DOMParser().parseFromString(html, "text/html");
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

  /* ── Phone extraction helpers ─────────────────────────── */
  function extractPhone(root) {
    if (!root) return "";

    // Priority 1: tel: links
    const telLinks = root.querySelectorAll('a[href^="tel:"]');
    for (const a of telLinks) {
      const p = a.href.replace("tel:", "").replace(/[\s\-()]/g, "");
      if (p.length >= 10) return p;
    }

    // Priority 2: known IndiaMART phone classes/ids
    const phoneSels = [
      '.cust_ph_no', '.mobtxt', '[class*="callnumber"]', '[class*="call_number"]',
      '[class*="phone_no"]', '[class*="phoneno"]', '[class*="mobno"]',
      '[id*="mobno"]', '[id*="phone"]', '[id*="call"]',
      '[class*="phno"]', '[class*="phn"]', '.phn', '.phone',
      '.supplierPhone', '.supplier_phone', '[data-phone]',
      'span[class*="cust"]', '.cust-phone', '.supp-phone',
    ];
    for (const sel of phoneSels) {
      try {
        const el = root.querySelector(sel);
        if (el) {
          const digits = el.textContent.replace(/[^0-9]/g, "");
          if (digits.length >= 10) return digits.slice(0, 10);
        }
      } catch (_) {}
    }

    // Priority 3: regex on visible text
    const text = root.textContent || "";
    const patterns = [
      /(?:Call|Phone|Mob(?:ile)?|Contact|Ph(?:one)?\.?\s*(?:No|Number)?\.?\s*:?\s*)([6-9]\d{9})/i,
      /\b([6-9]\d{9})\b/,
      /\b([0-9]{5}[\s\-]?[0-9]{5})\b/,
      /\b(0[0-9]{2,3}[\s\-]?[0-9]{6,8})\b/,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        const digits = (m[1] || m[0]).replace(/[^0-9]/g, "");
        if (digits.length >= 10) return digits;
      }
    }
    return "";
  }

  function extractEmail(root) {
    if (!root) return "";

    // Priority 1: mailto: links
    for (const a of root.querySelectorAll('a[href^="mailto:"]')) {
      const e = a.href.replace("mailto:", "").split("?")[0].trim();
      if (e.includes("@")) return e;
    }

    // Priority 2: text regex
    const text = root.textContent || "";
    const m = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (m) return m[0];
    return "";
  }

  /* ── Slug extractor from any IndiaMART company URL ───── */
  function slugFromUrl(href) {
    // href may be full URL like https://www.indiamart.com/aonehomeinterior/?pos=1&kwd=...
    // or already clean. We just need the path segment after indiamart.com/
    try {
      const u = new URL(href);
      const seg = u.pathname.split("/").filter(Boolean)[0]; // first path segment = slug
      if (seg && seg.length > 2 && !seg.includes(".")) return seg;
    } catch (_) {}
    // Fallback regex
    const m = href.match(/indiamart\.com\/([a-z0-9\-_]+)/i);
    return m ? m[1] : "";
  }

  /* ── STEP 1: Click every "Contact Supplier" button,
       read #t0901_addr0L href from the modal,
       extract company slug → base URL.
       Phone will be fetched from /enquiry.html later.      */
  async function collectFromCards() {
    const entries = []; // { baseUrl, name }

    // ── Find all supplier cards ──────────────────────────
    let cards = [
      ...document.querySelectorAll(".card.brs5"),
      ...document.querySelectorAll("[id^='LST']"),
    ];
    // De-duplicate by reference
    cards = [...new Set(cards)];

    if (cards.length === 0) {
      const wider = [...document.querySelectorAll("[class*='brs5']")];
      cards = [...new Set(wider)];
    }

    log(`🔍 Found ${cards.length} supplier card(s) on this page.`);
    if (cards.length === 0) return entries;

    // ── Selectors for the "Contact Supplier" button ──────
    const BTN_SELS = [
      '[class*="contactsupplier"]',
      '[class*="contact_supplier"]',
      '[class*="gNbtn"]',
      '.gNbtn',
      '[data-label="Contact Supplier"]',
      '[class*="sen_c"]',
      '[class*="NP-2"]',
    ];

    const seenSlugs = new Set();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      prog(i + 1, cards.length); // show card-discovery progress

      // ── Find the button ──────────────────────────────
      let btn = null;
      for (const sel of BTN_SELS) {
        btn = card.querySelector(sel);
        if (btn) break;
      }
      // Text-content fallback
      if (!btn) {
        for (const el of card.querySelectorAll("button, a")) {
          if (/contact.*supplier|get.*contact/i.test(el.textContent)) { btn = el; break; }
        }
      }
      if (!btn) {
        log(`   ⚠️  [${i + 1}] No contact button found — skipping card.`);
        continue;
      }

      try {
        // ── Click the button ───────────────────────────
        btn.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(400);
        btn.click();

        // ── Wait for modal + AJAX to populate ─────────
        // IndiaMART loads modal data asynchronously; poll for #t0901_addr0L
        let modalLink = null;
        for (let tick = 0; tick < 20; tick++) {           // up to ~4 s
          await sleep(200);
          const el = document.getElementById("t0901_addr0L");
          if (el && el.href && el.href.includes("indiamart.com")) {
            modalLink = el;
            break;
          }
        }

        if (!modalLink) {
          log(`   ⚠️  [${i + 1}] Modal link (#t0901_addr0L) not found after waiting.`);
        } else {
          // ── Extract slug from href ───────────────────
          // e.g. https://www.indiamart.com/aonehomeinterior/?pos=1&kwd=...
          const slug = slugFromUrl(modalLink.href);
          if (slug && !seenSlugs.has(slug)) {
            seenSlugs.add(slug);
            const baseUrl    = `https://www.indiamart.com/${slug}/`;
            const supplierName = modalLink.textContent
              .replace(/[\r\n\t]+/g, " ").trim()   // strip the SVG text artefacts
              .replace(/\s{2,}/g, " ").trim();

            entries.push({ baseUrl, name: supplierName });
            log(`   ✔ [${i + 1}] ${supplierName} → ${baseUrl}`);
          }
        }

        // ── Close the modal ────────────────────────────
        const CLOSE_SELS = [
          ".cls-btn", ".prodet_close", "[aria-label='Close']",
          ".modal-close", "[data-dismiss='modal']",
          "button[class*='close']", ".close",
        ];
        let closed = false;
        for (const sel of CLOSE_SELS) {
          const cb = document.querySelector(sel);
          if (cb) { cb.click(); closed = true; break; }
        }
        if (!closed) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
        }
        await sleep(rand(400, 700));

      } catch (e) {
        log(`   ❌ [${i + 1}] Error: ${e.message}`);
      }
    }

    log(`📋 Collected ${entries.length} unique supplier URL(s).`);
    return entries;
  }

  /* ── STEP 2: Scrape enquiry page ──────────────────────── */
  async function scrapeEnquiryPage(baseUrl) {
    const url = baseUrl.replace(/\/$/, "") + "/enquiry.html";
    const html = await fetchPage(url);
    if (!html) return {};

    const doc  = parseHTML(html);
    const data = {};

    data.phone = extractPhone(doc.body);
    data.email = extractEmail(doc.body);

    // Address from reach-us block
    const reachSels = [
      ".fcp_m2.FM_fl.FM_w13", "[class*='fcp_m2']",
      "[id*='reach']", "[class*='reach']",
      "[class*='address']", "[class*='addr']",
      ".supp-addr", "[class*='supp_addr']",
    ];
    for (const sel of reachSels) {
      const el = doc.querySelector(sel);
      if (el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]').forEach((n) => n.remove());
        const txt = clone.textContent
          .replace(/Reach\s*Us/gi, "")
          .replace(/\s+/g, " ")
          .trim();
        if (txt.length > 5) { data.address = txt.slice(0, 200); break; }
      }
    }

    // Fallback address from body text
    if (!data.address) {
      const bodyText = doc.body?.textContent || "";
      const addrMatch = bodyText.match(/([A-Z][a-z][\w\s,\-]+[-\s]\d{6},?\s*[A-Z][a-z][\w\s]+)/);
      if (addrMatch) data.address = addrMatch[1].trim().slice(0, 200);
    }

    return data;
  }

  /* ── STEP 3: Scrape profile page ──────────────────────── */
  async function scrapeProfilePage(baseUrl) {
    const url = baseUrl.replace(/\/$/, "") + "/profile.html";
    const html = await fetchPage(url);
    if (!html) return {};

    const doc  = parseHTML(html);
    const data = {};

    // Company name
    const nameEl =
      doc.querySelector("h1") ||
      doc.querySelector('[class*="compname"]') ||
      doc.querySelector('[class*="company_name"]') ||
      doc.querySelector('[itemprop="name"]') ||
      doc.querySelector("title");
    if (nameEl) data.name = nameEl.textContent.replace(/\s*[-–|].*$/, "").trim();

    // Phone / email from profile
    data.phone = extractPhone(doc.body);
    data.email = extractEmail(doc.body);

    // Factsheet table rows
    const tryExtract = (keyRe) => {
      // Table row approach
      for (const row of doc.querySelectorAll("table tr, [class*='factsheet'] tr")) {
        const cells = row.querySelectorAll("td, th");
        if (cells.length >= 2) {
          const key = cells[0].textContent.trim();
          if (keyRe.test(key)) return cells[1].textContent.trim();
        }
      }
      // dt/dd approach
      for (const dt of doc.querySelectorAll("dt")) {
        if (keyRe.test(dt.textContent.trim())) {
          const dd = dt.nextElementSibling;
          if (dd) return dd.textContent.trim();
        }
      }
      // div pairs with label+value
      for (const el of doc.querySelectorAll("[class*='lbl'], [class*='label'], [class*='key']")) {
        if (keyRe.test(el.textContent.trim())) {
          const val = el.nextElementSibling || el.parentElement?.querySelector("[class*='val']");
          if (val) return val.textContent.trim();
        }
      }
      return "";
    };

    data.ceo          = tryExtract(/ceo|owner|proprietor|chairman|contact\s*person|md\b/i);
    data.address      = tryExtract(/registered\s*address|address/i);
    data.employees    = tryExtract(/employee|staff/i);
    data.turnover     = tryExtract(/turnover|annual/i);
    data.businessType = tryExtract(/nature.*business|business.*type|additional.*business/i);
    data.gst          = tryExtract(/gst|gstin/i);
    data.legalStatus  = tryExtract(/legal\s*status|firm/i);
    data.yearEst      = tryExtract(/establish|founded|year/i);

    return data;
  }

  /* ── STEP 4: Scrape testimonials (optional) ───────────── */
  async function scrapeTestimonialsPage(baseUrl) {
    const url = baseUrl.replace(/\/$/, "") + "/testimonials.html";
    const html = await fetchPage(url);
    if (!html) return {};

    const doc  = parseHTML(html);
    const data = {};

    // Count reviews
    const reviews = doc.querySelectorAll(
      "[class*='review'], [class*='testimonial'], [class*='rating_card'], [itemprop='review']"
    );
    data.reviewCount = reviews.length || "";

    // Average rating
    const ratingEl = doc.querySelector(
      "[class*='avg_rating'], [class*='average_rating'], [itemprop='ratingValue'], [class*='ratVal']"
    );
    if (ratingEl) data.rating = ratingEl.textContent.trim();

    return data;
  }

  /* ── MAIN orchestrator ───────────────────────────────── */
  async function runScraper(searchKeyword, searchLocation) {
    log("🚀 IndiaMART Enterprise Scraper v2.0 started…");

    // Verify URL
    if (!location.hostname.includes("indiamart.com")) {
      err("❌ Please navigate to an IndiaMART search results page first.");
      return;
    }

    log("📌 Step 1: Collecting supplier URLs from page…");
    const suppliers = await collectFromCards();

    if (suppliers.length === 0) {
      err("❌ No suppliers found. Make sure the page has loaded and cards are visible. Try scrolling down first.");
      return;
    }

    sendMsg("total", { count: suppliers.length });
    log(`📋 Found ${suppliers.length} unique suppliers. Fetching detailed profiles…`);

    let successCount = 0;

    for (let i = 0; i < suppliers.length; i++) {
      const { url: baseUrl, phone: modalPhone, name: modalName } = suppliers[i];
      prog(i + 1, suppliers.length);
      log(`⏳ [${i + 1}/${suppliers.length}] ${baseUrl}`);

      try {
        const [enquiry, profile, testimonials] = await Promise.all([
          scrapeEnquiryPage(baseUrl),
          scrapeProfilePage(baseUrl),
          scrapeTestimonialsPage(baseUrl),
        ]);

        // Slug-based fallback name
        const slug = baseUrl.replace(/\/$/, "").split("/").pop();
        const slugName = slug.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

        const row = {
          index        : i + 1,
          url          : baseUrl,
          name         : profile.name         || modalName          || slugName,
          phone        : modalPhone            || enquiry.phone      || profile.phone     || "—",
          email        : enquiry.email         || profile.email      || "—",
          address      : enquiry.address       || profile.address    || "—",
          ceo          : profile.ceo           || "—",
          businessType : profile.businessType  || "—",
          employees    : profile.employees     || "—",
          turnover     : profile.turnover      || "—",
          legalStatus  : profile.legalStatus   || "—",
          gst          : profile.gst           || "—",
          yearEst      : profile.yearEst       || "—",
          rating       : testimonials.rating   || "—",
          reviewCount  : testimonials.reviewCount || "—",
        };

        result(row);
        successCount++;
        log(`✅ [${i + 1}] ${row.name} | 📞 ${row.phone} | ✉️ ${row.email}`);
      } catch (e) {
        log(`⚠️ [${i + 1}] Error: ${e.message}`);
      }

      // Anti-bot: polite random delay
      if (i < suppliers.length - 1) {
        const wait = rand(2500, 5000);
        log(`Waiting ${(wait / 1000).toFixed(1)}s (rate limit protection)…`);
        await sleep(wait);
      }
    }

    done(`Scraping complete! ${successCount} of ${suppliers.length} suppliers scraped successfully.`);
  }

  /* ── Message listener ─────────────────────────────────── */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "startScraping") {
      runScraper(message.keyword, message.location);
      sendResponse({ ok: true });
    }
    if (message.action === "ping") {
      sendResponse({ ok: true });
    }
  });

})();