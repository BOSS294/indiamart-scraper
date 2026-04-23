"use strict";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[IndiaMART Scraper Pro] Installed v3.1.0");
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url, attempts = 3) {
  let lastErr = null;

  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-IN,en;q=0.9,hi;q=0.7",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });

      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        const text = await res.text();
        return { ok: true, text };
      }
    } catch (e) {
      lastErr = e;
    }

    await sleep(450 * i);
  }

  return { ok: false, error: lastErr ? lastErr.message : "Fetch failed" };
}

function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    let done = false;

    const cleanup = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearInterval(timer);
      clearTimeout(timer2);
    };

    const finish = () => {
      cleanup();
      resolve(true);
    };

    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };

    const timer = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab) {
          cleanup();
          reject(new Error("Tab disappeared"));
          return;
        }
        if (tab.status === "complete") finish();
      } catch (e) {
        cleanup();
        reject(e);
      }
    }, 500);

    const timer2 = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for tab load"));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function extractPageData(pageType) {
  const text = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();
  const digits = (s) => String(s ?? "").replace(/\D/g, "");

  const extractPhone = (root) => {
    if (!root) return "";

    const tel = root.querySelector('a[href^="tel:"]');
    if (tel) {
      const d = digits(tel.getAttribute("href") || "");
      if (d.length >= 10) return d;
    }

    const pnsNode = root.querySelector("#footerPNS, [data-pnsno], span[data-pnsno], div[data-pnsno]");
    if (pnsNode) {
      const attr = pnsNode.getAttribute("data-pnsno") || "";
      const attrDigits = digits(attr);
      if (attrDigits.length >= 10) return attrDigits;

      const visibleDigits = digits(text(pnsNode));
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
    ];

    for (const sel of sels) {
      const el = root.querySelector(sel);
      if (el) {
        const d = digits(text(el));
        if (d.length >= 10) return d.slice(0, 11);
      }
    }

    const bodyText = text(root);
    const patterns = [
      /(?:Call|Phone|Mob(?:ile)?|Contact|Ph(?:one)?\.?\s*(?:No|Number)?\.?\s*:?\s*)(0?[6-9]\d{9})/i,
      /\b(0?[6-9]\d{9})\b/,
      /\b([0-9]{5}[\s\-]?[0-9]{5})\b/,
      /\b(0[0-9]{2,3}[\s\-]?[0-9]{6,8})\b/,
    ];

    for (const pat of patterns) {
      const m = bodyText.match(pat);
      if (m) {
        const d = digits(m[1] || m[0]);
        if (d.length >= 10) return d;
      }
    }

    return "";
  };

  const extractEmail = (root) => {
    if (!root) return "";
    const mail = root.querySelector('a[href^="mailto:"]');
    if (mail) {
      const e = String(mail.getAttribute("href") || "").replace("mailto:", "").split("?")[0].trim();
      if (e.includes("@")) return e;
    }
    const m = text(root).match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    return m ? m[0] : "";
  };

  const extractAddress = (doc) => {
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
        const t = text(clone).replace(/Reach\s*Us/gi, "").trim();
        if (t.length > 5) return t.slice(0, 220);
      }
    }

    return "";
  };

  const extractName = (doc) => {
    const el =
      doc.querySelector("h1") ||
      doc.querySelector('[class*="compname"]') ||
      doc.querySelector('[class*="company_name"]') ||
      doc.querySelector('[itemprop="name"]') ||
      doc.querySelector("title");
    if (!el) return "";
    return text(el).replace(/\s*[-–|].*$/, "").trim();
  };

  const doc = document;
  const result = {};

  if (pageType === "enquiry" || pageType === "generic") {
    result.name = extractName(doc);
    result.phone = extractPhone(doc.body || doc.documentElement);
    result.email = extractEmail(doc.body || doc.documentElement);
    result.address = extractAddress(doc) || "";
  }

  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "imFetch") {
    (async () => {
      const res = await fetchHtml(message.url, message.attempts || 3);
      sendResponse(res);
    })();
    return true;
  }

  if (message.action === "imOpenAndRead") {
    (async () => {
      const url = String(message.url || "");
      const pageType = String(message.pageType || "generic");

      const tab = await chrome.tabs.create({ url, active: false });
      await waitForTabComplete(tab.id, message.timeoutMs || 25000);

      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageData,
        args: [pageType],
      });

      const data = injected?.[0]?.result || {};
      await chrome.tabs.remove(tab.id).catch(() => {});
      sendResponse({ ok: true, data });
    })().catch(async (e) => {
      sendResponse({ ok: false, error: e.message || "Tab read failed" });
    });
    return true;
  }

  return false;
});