# IndiaMART Supplier Scraper Pro v2.0

Chrome Extension that scrapes supplier contact details from IndiaMART search results and exports them to a proper **Excel (.xlsx)** file.

---

## Installation

1. Download and unzip the extension folder.
2. Open **Chrome** → `chrome://extensions/`
3. Enable **Developer Mode** (top-right toggle).
4. Click **"Load unpacked"** → select the `indiamart-scraper` folder.
5. The green **IM** icon appears in your toolbar.

---

##  How to Use

### Option A — Auto Search
1. Click the **IM** toolbar icon.
2. Enter your keyword (e.g. `home furniture manufacturer`) and optionally a location.
3. Click **🔗 Open Search Page** — this opens IndiaMART in a new tab.
4. Once the page loads, click the extension icon again and press **▶ Start Scraping**.

### Option B — Manual Navigation
1. Navigate to any IndiaMART search results page.
2. Scroll down to make sure cards are visible.
3. Click the extension icon → **▶ Start Scraping**.

---

## What Gets Scraped

| Field          | Source                                |
|----------------|---------------------------------------|
| Company Name   | Profile page / Modal                  |
| **Phone**      | **Contact Supplier modal (primary)**  |
| Email          | Enquiry page                          |
| Address        | Enquiry page / Profile                |
| CEO / Owner    | Profile factsheet                     |
| Business Type  | Profile factsheet                     |
| Employees      | Profile factsheet                     |
| Annual Turnover| Profile factsheet                     |
| Legal Status   | Profile factsheet                     |
| GST Number     | Profile factsheet                     |
| Year Established | Profile factsheet                   |
| Ratings        | Testimonials page                     |

---

## How Phone Numbers Are Extracted (v2.0)

The key fix in v2.0: phone numbers are extracted from the **Contact Supplier modal**:

1. The scraper clicks each **"Contact Supplier"** button on every card.
2. Waits 1.8–2.8 seconds for the modal to open and data to load.
3. Searches the modal DOM for:
   - `tel:` links
   - Known IndiaMART phone CSS classes (`.cust_ph_no`, `.mobtxt`, etc.)
   - Text regex for 10-digit Indian mobile numbers
4. Extracts the company URL from `#t0901_addr0L` in the same modal.
5. Closes the modal (Escape key fallback).
6. Also tries enquiry.html and profile.html as backup sources.

---

## Anti-Ban Protection

- Random **2.5–5 second delays** between each supplier request.
- Random **1.8–2.8 second waits** after clicking each modal.
- Human-like `Accept-Language` and `Cache-Control` headers.
- Credentials included to respect session cookies.

---

##File Structure

```
indiamart-scraper/
├── manifest.json      # Extension config (MV3)
├── popup.html         # UI
├── popup.js           # Popup logic + Excel export
├── content.js         # Scraping engine (modal phone extraction)
├── background.js      # Service worker
├── xlsxgen.js         # Self-contained XLSX generator (no dependencies)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Notes

- Keep the browser tab **open and in the foreground** while scraping.
- Email addresses are not always public on IndiaMART — expect ~20–40% coverage.
- Data is persisted in `chrome.storage.local` across sessions.
- Use **✕ Clear** to start fresh.
- IndiaMART may block aggressive scrapers — the random delays mitigate this.
