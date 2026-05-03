# 🏭 IndiaMART Supplier Scraper Pro

<div align="center">

[![Version](https://img.shields.io/badge/version-v2.0-brightgreen?style=flat-square)](https://github.com/BOSS294/indiamart-scraper/releases)
[![Manifest](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/)
[![Platform](https://img.shields.io/badge/platform-Chrome-yellow?style=flat-square&logo=googlechrome)](https://www.google.com/chrome/)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue?style=flat-square&logo=python)](PY/)
[![License](https://img.shields.io/badge/license-MIT-purple?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/BOSS294/indiamart-scraper?style=flat-square)](https://github.com/BOSS294/indiamart-scraper/stargazers)
[![Issues](https://img.shields.io/github/issues/BOSS294/indiamart-scraper?style=flat-square)](https://github.com/BOSS294/indiamart-scraper/issues)

**Extract verified supplier contact details from IndiaMART search results and export to Excel — in minutes.**

*A Manifest V3 Chrome Extension + Python CLI for B2B lead generation, supplier research, and market intelligence.*

[🚀 Quick Start](#-installation) · [✨ Features](#-features) · [📊 What Gets Scraped](#-what-gets-scraped) · [🐍 Python Version](#-python-version) · [🛡️ Anti-Ban](#-anti-ban-protection) · [📁 File Structure](#-file-structure) · [🔧 Troubleshooting](#-troubleshooting)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [What Gets Scraped](#-what-gets-scraped)
- [Installation](#-installation)
- [How to Use](#-how-to-use)
- [How Phone Numbers Are Extracted](#-how-phone-numbers-are-extracted)
- [Python Version](#-python-version)
- [Anti-Ban Protection](#-anti-ban-protection)
- [File Structure](#-file-structure)
- [Requirements](#-requirements)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)

---

## 🌐 Overview

**IndiaMART Supplier Scraper Pro** is a dual-mode tool for extracting supplier contact information from [IndiaMART](https://www.indiamart.com/) — India's largest B2B marketplace with over 7 million registered suppliers.

Whether you are a sales professional building lead lists, a procurement team sourcing vendors, or a researcher mapping the Indian manufacturing ecosystem, this tool automates the tedious work of manually visiting hundreds of supplier profiles.

> **Available as both a Chrome Extension (no setup required) and a Python CLI script (headless, scriptable).**

---

## ✨ Features

| Feature | Chrome Extension | Python Script |
|---------|:---:|:---:|
| Auto-search by keyword + location | ✅ | ✅ |
| Scrape all 12 supplier data fields | ✅ | ✅ |
| Phone extraction from `/enquiry.html` | ✅ | ✅ |
| Multi-state search support | ✅ | ✅ |
| Export to Excel (.xlsx) | ✅ | ✅ |
| Real-time progress UI with live log | ✅ | — |
| Session persistence (resumes on reload) | ✅ | — |
| Headless / CI-friendly mode | — | ✅ |
| Custom delay configuration | — | ✅ |

### Extension Highlights
- 🎨 **Dark-theme popup** (720px wide) with live stats dashboard
- 📊 **Live data table** — company, phone, email, location, CEO, employees
- 💾 **Session persistence** — data survives popup close via `chrome.storage.local`
- 🔔 **Real-time activity log** with timestamps
- ⚡ **Zero external dependencies** — self-contained XLSX generator bundled in

### Python Script Highlights
- 🖥️ **Headless Playwright** — fully automated, no manual clicks needed
- 📍 **State-by-state scraping** — iterate across all Indian states
- 🔄 **Retry logic** — each supplier retried up to 3 times before skip
- 📁 **Date-stamped Excel output** — `indiamart_suppliers_YYYY-MM-DD.xlsx`
- 🎛️ **CLI flags** — `--keyword`, `--states`, `--headful`, `--output`, `--delay-min/max`

---

## 📊 What Gets Scraped

| # | Field | Source |
|---|-------|--------|
| 1 | Company Name | Search card / Profile `<h1>` |
| 2 | **Phone** | `/enquiry.html` → `#footerPNS` / `data-pnsno` (primary) |
| 3 | Email | `/enquiry.html` `mailto:` link |
| 4 | Address | `/enquiry.html` address section |
| 5 | CEO / Owner | Profile factsheet |
| 6 | Business Type | Profile factsheet |
| 7 | Employees | Profile factsheet |
| 8 | Annual Turnover | Profile factsheet |
| 9 | Legal Status | Profile factsheet |
| 10 | GST Number | Profile factsheet |
| 11 | Year Established | Profile factsheet |
| 12 | Ratings + Review Count | Testimonials section |

> **Phone coverage:** ~70–90% when `/enquiry.html` page is accessible.  
> **Email coverage:** ~20–40% (IndiaMART often hides emails behind login).

---

## 🚀 Installation

### Chrome Extension (Recommended)

1. **Download** this repository — click **Code → Download ZIP** and unzip it.
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer Mode** (toggle in the top-right corner).
4. Click **Load unpacked** → select the `indiamart-scraper` folder (the one containing `manifest.json`).
5. The green **IM** icon appears in your Chrome toolbar.

> **Note:** The extension works on any Chromium-based browser (Chrome, Edge, Brave).

---

## 🕹️ How to Use

### Option A — Auto Search (Recommended)

1. Click the **IM** toolbar icon to open the popup.
2. Enter your **keyword** (e.g. `home furniture manufacturer`) in the Search field.
3. Optionally enter a **Location** — type or pick Indian state(s), comma-separated.
4. Click **🔗 Open Search Page** — IndiaMART opens in a new tab.
5. Once the page loads, click the extension icon again.
6. Press **▶ Start Scraping**.
7. Watch the live log and stats update in real time.
8. When done, click **⬇ Export Excel** to download a dated `.xlsx` file.

### Option B — Manual Navigation

1. Navigate directly to any IndiaMART search results URL, e.g.:  
   `https://dir.indiamart.com/search.mp?ss=steel+pipes&v=4&cq=Maharashtra`
2. Scroll down to ensure supplier cards are visible.
3. Click the extension icon → **▶ Start Scraping**.

### UI Controls

| Button | Action |
|--------|--------|
| ▶ Start Scraping | Begin scraping the active IndiaMART search tab |
| 🔗 Open Search Page | Build and open a search URL from the keyword/location inputs |
| ⬇ Export Excel | Download all scraped data as a `.xlsx` file |
| ✕ Clear | Wipe all data from the table and storage |

---

## 📞 How Phone Numbers Are Extracted

The scraper uses a robust multi-strategy extraction pipeline:

1. **Primary:** Fetch `/enquiry.html` for each supplier URL.
2. Parse the HTML and look for `#footerPNS` or `data-pnsno` attributes — IndiaMART's known phone number containers.
3. Fallback to `a[href^="tel:"]` links in the page.
4. Fallback to known CSS class selectors: `.cust_ph_no`, `.mobtxt`, `[class*='callnumber']`, `[class*='phone_no']`, etc.
5. Last resort: regex scan for 10-digit Indian mobile patterns (`[6-9]\d{9}`).
6. **Retry:** Each supplier is retried up to **3 times** with exponential back-off before being skipped.

---

## 🐍 Python Version

A standalone Python script is included in the [`PY/`](PY/) folder for users who prefer a CLI workflow or need to run scraping in a scheduled / headless environment.

### Prerequisites

```bash
pip install playwright openpyxl
playwright install chromium
```

### Usage

```bash
# Scrape a keyword across specific states
python PY/indiamart_scraper_py.py \
  --keyword "home furniture manufacturer" \
  --states "Delhi,Maharashtra,Gujarat"

# Watch the browser (non-headless)
python PY/indiamart_scraper_py.py --keyword "steel pipes" --headful

# Custom output path and delays
python PY/indiamart_scraper_py.py \
  --keyword "textile machinery" \
  --output /tmp/textile_leads.xlsx \
  --delay-min 3 \
  --delay-max 7
```

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--keyword` | required | Search term (e.g. `"steel pipes"`) |
| `--states` | all states | Comma-separated Indian states to search |
| `--headful` | off | Show browser window while scraping |
| `--output` | auto-dated | Custom Excel output path |
| `--delay-min` | `2.5` | Minimum seconds between suppliers |
| `--delay-max` | `5.0` | Maximum seconds between suppliers |

---

## 🛡️ Anti-Ban Protection

Both the extension and Python script implement polite scraping practices:

- ⏱️ **Randomised delays** of 2.5–5 seconds between each supplier request.
- 🔄 **Retry with back-off** — failed requests are retried up to 3× before skipping.
- 🌐 **Human-like HTTP headers**: `Accept-Language: en-IN,en;q=0.9,hi;q=0.7` and `Cache-Control: no-cache`.
- 🍪 **Session cookies respected** — credentials are included so IndiaMART recognises a logged-in session.
- 📄 **Only `/enquiry.html` fetched** — the minimal required page, not the full profile.

> IndiaMART rate-limits aggressive bots. Stick to the default delays to avoid temporary IP blocks.

---

## 📁 File Structure

```
indiamart-scraper/
│
├── manifest.json          # Extension config (Manifest V3)
├── popup.html             # 720px dark-theme popup UI
├── popup.js               # Popup logic — stats, table, Excel export
├── content.js             # Scraping engine (enquiry.html phone extraction)
├── background.js          # MV3 service worker — fetch helper, tab management
├── xlsxgen.js             # Self-contained XLSX generator (no npm needed)
├── xlsx.mini.min.js       # Minimal XLSX polyfill
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── PY/
    ├── indiamart_scraper_py.py          # Python CLI (Playwright + openpyxl)
    └── indiamart_suppliers_2026-04-23.xlsx  # Sample output
```

---

## 🔧 Requirements

### Chrome Extension
- Google Chrome 88+ (or any Chromium-based browser supporting Manifest V3)
- An active IndiaMART session helps improve phone / email coverage

### Python Script
- Python 3.8+
- `playwright` (`pip install playwright`)
- `openpyxl` (`pip install openpyxl`)
- Chromium browser installed via `playwright install chromium`

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Cannot connect to page"** error | Refresh the IndiaMART tab and click ▶ Start Scraping again |
| Extension popup is blank / not loading | Go to `chrome://extensions/`, remove and reload the extension |
| Phone numbers showing `—` | IndiaMART's page structure may have changed — open an issue |
| Export button is greyed out | Start scraping first; the button enables after the first result |
| 0 suppliers found | Make sure you are on a `dir.indiamart.com` search results page |
| Python: `playwright._impl._errors.Error` | Run `playwright install chromium` to install the browser |
| Rate limited / CAPTCHA | Increase `--delay-min` and `--delay-max` values in the Python script |

> Keep the **browser tab open and in the foreground** while the extension is scraping — Chrome may throttle background tabs.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "feat: add my feature"`
4. Push the branch: `git push origin feature/my-feature`
5. Open a Pull Request.

Please open an [issue](https://github.com/BOSS294/indiamart-scraper/issues) first for major changes.

---

## ⭐ Support

If this tool saved you time, please **star the repo** — it helps others discover it!

[![GitHub stars](https://img.shields.io/github/stars/BOSS294/indiamart-scraper?style=social)](https://github.com/BOSS294/indiamart-scraper/stargazers)

---

<div align="center">

Made with ❤️ for the Indian B2B community &nbsp;·&nbsp; [Report a Bug](https://github.com/BOSS294/indiamart-scraper/issues) &nbsp;·&nbsp; [Request a Feature](https://github.com/BOSS294/indiamart-scraper/issues)

</div>
