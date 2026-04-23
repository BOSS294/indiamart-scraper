#!/usr/bin/env python3
"""
IndiaMART Supplier Scraper (Python)

What it does:
- Opens IndiaMART search pages state-by-state
- Collects supplier base URLs from modal link #t0901_addr0L
- Visits ONLY /enquiry.html for each supplier
- Extracts phone from #footerPNS / data-pnsno / visible text
- Retries each supplier up to 3 times, then skips
- Exports to Excel (.xlsx)

Install:
    pip install playwright openpyxl
    playwright install chromium

Run:
    python indiamart_scraper_py.py --keyword "home furniture manufacturer" --states "Delhi,Maharashtra,Gujarat"

Optional:
    --headful   to watch the browser
    --output    custom Excel file path
    --delay-min / --delay-max   polite delay between suppliers
"""

from __future__ import annotations

import argparse
import os
import random
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright, Page, Locator


SEARCH_URL = "https://dir.indiamart.com/search.mp?ss={keyword}&v=4{loc_part}"

INDIAN_STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
    "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Delhi", "Jammu and Kashmir",
]


@dataclass
class SupplierRow:
    index: int
    state: str
    name: str
    phone: str
    email: str
    address: str
    url: str


def clean_text(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def only_digits(value: Optional[str]) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def slug_from_href(href: str) -> str:
    try:
        from urllib.parse import urlparse
        path = urlparse(href).path
        seg = [p for p in path.split("/") if p]
        if seg:
            candidate = seg[0]
            if candidate and len(candidate) > 2 and "." not in candidate:
                return candidate
    except Exception:
        pass
    m = re.search(r"indiamart\.com/([a-z0-9\-_]+)", href or "", re.I)
    return m.group(1) if m else ""


def base_url_from_href(href: str) -> str:
    slug = slug_from_href(href)
    return f"https://www.indiamart.com/{slug}/" if slug else ""


def build_search_url(keyword: str, state: str = "") -> str:
    kw = keyword.strip() or "home furniture manufacturer"
    loc_part = f"&cq={state.strip()}" if state.strip() else ""
    return SEARCH_URL.format(keyword=kw.replace(" ", "+"), loc_part=loc_part)


def pick_states(raw: str) -> List[str]:
    if not raw.strip():
        return []
    tokens = [t.strip() for t in raw.split(",")]
    # Keep only reasonable non-empty values; preserve order and remove duplicates.
    out: List[str] = []
    seen = set()
    for token in tokens:
        if not token:
            continue
        norm = token.lower()
        if norm not in seen:
            out.append(token)
            seen.add(norm)
    return out


def delay_range(min_s: float, max_s: float) -> None:
    time.sleep(random.uniform(min_s, max_s))


def scroll_until_stable(page: Page, selector: str, rounds: int = 20, stable_rounds: int = 3) -> None:
    """
    Scrolls a page until the number of matching elements stops increasing.
    """
    last_count = -1
    stable = 0
    for _ in range(rounds):
        try:
            page.wait_for_timeout(900)
            count = page.locator(selector).count()
            if count == last_count:
                stable += 1
            else:
                stable = 0
                last_count = count

            # Scroll near bottom to trigger lazy-loading.
            page.mouse.wheel(0, 2600)
            page.wait_for_timeout(300)

            if stable >= stable_rounds:
                break
        except Exception:
            break


def get_card_locators(page: Page) -> Locator:
    # User-confirmed supplier card IDs are LST1, LST2, LST3...
    # Keep broader selectors as backup.
    return page.locator('[id^="LST"], .card.brs5, [class*="brs5"]')


def find_contact_button(card: Locator) -> Optional[Locator]:
    candidates = [
        '[class*="contactsupplier"]',
        '[class*="contact_supplier"]',
        '[class*="gNbtn"]',
        '.gNbtn',
        '[data-label="Contact Supplier"]',
        '[class*="sen_c"]',
        '[class*="NP-2"]',
        'button',
        'a',
        'span',
        'div',
    ]

    for sel in candidates:
        loc = card.locator(sel).filter(has_text=re.compile(r'contact\s*supplier|get\s*contact', re.I))
        if loc.count() > 0:
            return loc.first
    return None


def close_modal(page: Page) -> None:
    close_selectors = [
        ".cls-btn",
        ".prodet_close",
        "[aria-label='Close']",
        ".modal-close",
        "[data-dismiss='modal']",
        "button[class*='close']",
        ".close",
        "[class*='close']",
    ]
    for sel in close_selectors:
        try:
            loc = page.locator(sel)
            if loc.count() > 0:
                loc.first.click(timeout=1000)
                page.wait_for_timeout(300)
                return
        except Exception:
            pass
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    except Exception:
        pass


def collect_supplier_links_for_state(page: Page, keyword: str, state: str, log) -> List[Tuple[str, str]]:
    """
    Returns list of (supplier_name, base_url)
    """
    url = build_search_url(keyword, state)
    log(f"Opening search page: {state or 'All'}")
    page.goto(url, wait_until="domcontentloaded", timeout=45000)
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass

    scroll_until_stable(page, '[id^="LST"], .card.brs5, [class*="brs5"]')

    cards = get_card_locators(page)
    total = cards.count()
    log(f"Found {total} cards on {state or 'All'} page.")

    seen_slugs = set()
    suppliers: List[Tuple[str, str]] = []

    # Iterate over all currently loaded cards; scroll again if needed.
    processed_ids = set()
    stagnant_rounds = 0

    for _ in range(6):
        current_count = cards.count()
        new_found = 0

        for i in range(current_count):
            try:
                card = cards.nth(i)
                card_id = ""
                try:
                    card_id = clean_text(card.get_attribute("id"))
                except Exception:
                    card_id = f"idx-{i}"

                if not card_id:
                    card_id = f"idx-{i}"

                if card_id in processed_ids:
                    continue
                processed_ids.add(card_id)

                btn = find_contact_button(card)
                if btn is None:
                    continue

                btn.scroll_into_view_if_needed(timeout=5000)
                page.wait_for_timeout(250)
                btn.click(timeout=5000)

                modal_link = page.locator("#t0901_addr0L")
                try:
                    modal_link.wait_for(state="visible", timeout=6000)
                except PlaywrightTimeoutError:
                    # Sometimes the modal is still rendered but not marked visible quickly.
                    pass

                href = ""
                name = ""
                try:
                    if modal_link.count() > 0:
                        href = clean_text(modal_link.first.get_attribute("href"))
                        name = clean_text(modal_link.first.inner_text())
                except Exception:
                    pass

                if not href:
                    # Fallback: inspect any compurl link inside modal area.
                    alt = page.locator("a.compurlredir.compurlr, a[href*='indiamart.com/']")
                    if alt.count() > 0:
                        try:
                            href = clean_text(alt.first.get_attribute("href"))
                            name = clean_text(alt.first.inner_text())
                        except Exception:
                            pass

                base_url = base_url_from_href(href)
                slug = slug_from_href(href)

                if base_url and slug and slug not in seen_slugs:
                    seen_slugs.add(slug)
                    supplier_name = name or slug.replace("-", " ").title()
                    suppliers.append((supplier_name, base_url))
                    new_found += 1
                    log(f"Collected: {supplier_name} -> {base_url}")

                close_modal(page)

            except Exception as e:
                log(f"Card {i + 1}: {e}")
                close_modal(page)

        if new_found == 0:
            stagnant_rounds += 1
        else:
            stagnant_rounds = 0

        if stagnant_rounds >= 2:
            break

        page.mouse.wheel(0, 2800)
        page.wait_for_timeout(900)

    log(f"Collected {len(suppliers)} unique supplier URL(s) for {state or 'All'}.")
    return suppliers


def extract_phone_from_page(page: Page) -> str:
    # 1) exact selector requested by you
    selectors = [
        "#footerPNS",
        "[data-pnsno]",
        "span[data-pnsno]",
        "div[data-pnsno]",
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel)
            if loc.count() > 0:
                first = loc.first
                for attr in ("data-pnsno", "href"):
                    try:
                        val = clean_text(first.get_attribute(attr))
                        d = only_digits(val)
                        if len(d) >= 10:
                            return d[:11]
                    except Exception:
                        pass
                try:
                    txt = clean_text(first.inner_text())
                    d = only_digits(txt)
                    if len(d) >= 10:
                        return d[:11]
                except Exception:
                    pass
        except Exception:
            pass

    # 2) tel links
    try:
        tel_links = page.locator('a[href^="tel:"]')
        if tel_links.count() > 0:
            href = clean_text(tel_links.first.get_attribute("href"))
            d = only_digits(href)
            if len(d) >= 10:
                return d[:11]
    except Exception:
        pass

    # 3) text regex
    try:
        body_text = clean_text(page.locator("body").inner_text(timeout=3000))
    except Exception:
        try:
            body_text = clean_text(page.content())
        except Exception:
            body_text = ""

    patterns = [
        r'(?:Call|Phone|Mob(?:ile)?|Contact|Ph(?:one)?\.?\s*(?:No|Number)?\.?\s*:?\s*)(0?[6-9]\d{9})',
        r'\b(0?[6-9]\d{9})\b',
        r'\b([0-9]{5}[\s\-]?[0-9]{5})\b',
        r'\b(0[0-9]{2,3}[\s\-]?[0-9]{6,8})\b',
    ]
    for pat in patterns:
        m = re.search(pat, body_text, re.I)
        if m:
            d = only_digits(m.group(1) or m.group(0))
            if len(d) >= 10:
                return d[:11]
    return ""


def extract_email_from_page(page: Page) -> str:
    try:
        mail = page.locator('a[href^="mailto:"]')
        if mail.count() > 0:
            href = clean_text(mail.first.get_attribute("href")).replace("mailto:", "").split("?")[0].strip()
            if "@" in href:
                return href
    except Exception:
        pass

    try:
        body_text = clean_text(page.locator("body").inner_text(timeout=3000))
    except Exception:
        body_text = ""
    m = re.search(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', body_text)
    return m.group(0) if m else ""


def extract_address_from_page(page: Page) -> str:
    selectors = [
        ".fcp_m2.FM_fl.FM_w13",
        "[class*='fcp_m2']",
        "[id*='reach']",
        "[class*='reach']",
        "[class*='address']",
        "[class*='addr']",
        ".supp-addr",
        "[class*='supp_addr']",
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel)
            if loc.count() > 0:
                txt = clean_text(loc.first.inner_text(timeout=3000))
                txt = re.sub(r"Reach\s*Us", "", txt, flags=re.I).strip()
                if len(txt) > 5:
                    return txt[:220]
        except Exception:
            pass
    return ""


def extract_name_from_page(page: Page) -> str:
    candidates = ["h1", '[class*="compname"]', '[class*="company_name"]', '[itemprop="name"]', "title"]
    for sel in candidates:
        try:
            loc = page.locator(sel)
            if loc.count() > 0:
                txt = clean_text(loc.first.inner_text(timeout=3000))
                txt = re.sub(r"\s*[-–|].*$", "", txt).strip()
                if txt:
                    return txt
        except Exception:
            pass
    return ""


def scrape_enquiry_page(page: Page, base_url: str, log, attempts: int = 3) -> dict:
    url = base_url.rstrip("/") + "/enquiry.html"

    for attempt in range(1, attempts + 1):
        try:
            log(f"Opening enquiry page ({attempt}/{attempts})")
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass

            # Give IndiaMART a moment to render the phone block.
            page.wait_for_timeout(1200)

            name = extract_name_from_page(page)
            phone = extract_phone_from_page(page) or "—"
            email = extract_email_from_page(page) or "—"
            address = extract_address_from_page(page) or "—"

            if phone != "—" or email != "—" or address != "—":
                return {
                    "name": name or "—",
                    "phone": phone,
                    "email": email,
                    "address": address,
                }

            # Sometimes data arrives a little late.
            page.wait_for_timeout(1500)
            phone = extract_phone_from_page(page) or "—"
            email = extract_email_from_page(page) or "—"
            address = extract_address_from_page(page) or "—"
            return {
                "name": name or "—",
                "phone": phone,
                "email": email,
                "address": address,
            }

        except Exception as e:
            log(f"Fetch failed ({attempt}/{attempts}) for {url} -> {e}")
            if attempt < attempts:
                time.sleep(0.8 * attempt)
            else:
                return {"name": "—", "phone": "—", "email": "—", "address": "—"}

    return {"name": "—", "phone": "—", "email": "—", "address": "—"}


def retry_scrape_supplier(
    detail_page: Page,
    supplier_name: str,
    base_url: str,
    log,
    attempts: int = 3,
) -> dict:
    last = None
    for attempt in range(1, attempts + 1):
        try:
            return scrape_enquiry_page(detail_page, base_url, log, attempts=1)
        except Exception as e:
            last = e
            log(f"Supplier retry {attempt}/{attempts} failed: {supplier_name} -> {e}")
            if attempt < attempts:
                time.sleep(0.8 * attempt)
    log(f"Skipping after {attempts} failed attempts: {supplier_name}")
    return {"name": supplier_name or "—", "phone": "—", "email": "—", "address": "—"}


def export_excel(rows: Sequence[SupplierRow], output_path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Suppliers"

    headers = ["#", "State", "Company Name", "Phone", "Email", "Address", "Profile URL"]
    ws.append(headers)

    header_fill = PatternFill("solid", fgColor="1F2937")
    header_font = Font(bold=True, color="FFFFFF")
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for row in rows:
        ws.append([
            row.index,
            row.state,
            row.name,
            row.phone,
            row.email,
            row.address,
            row.url,
        ])

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions

    # Auto width
    widths = [6, 18, 34, 18, 28, 42, 48]
    for col_idx, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    # Hyperlink styling for URL column
    for cell in ws["G"][1:]:
        if cell.value and str(cell.value).startswith("http"):
            cell.hyperlink = cell.value
            cell.style = "Hyperlink"

    wb.save(output_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="IndiaMART supplier scraper (Python).")
    parser.add_argument("--keyword", default="home furniture manufacturer", help="Search keyword.")
    parser.add_argument("--states", default="", help="Comma-separated states/locations.")
    parser.add_argument("--headful", action="store_true", help="Show browser window.")
    parser.add_argument("--output", default="", help="Output Excel filename.")
    parser.add_argument("--delay-min", type=float, default=2.5, help="Minimum delay between suppliers.")
    parser.add_argument("--delay-max", type=float, default=5.0, help="Maximum delay between suppliers.")
    parser.add_argument("--user-data-dir", default="im_playwright_profile", help="Persistent browser profile folder.")
    args = parser.parse_args()

    keyword = args.keyword.strip() or "home furniture manufacturer"
    states = pick_states(args.states)

    if not args.output.strip():
        stamp = datetime.now().strftime("%Y-%m-%d")
        args.output = f"indiamart_suppliers_{stamp}.xlsx"

    all_rows: List[SupplierRow] = []
    seen_global = set()
    log_lines = []

    def log(msg: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        line = f"[{stamp}] {msg}"
        print(line, flush=True)
        log_lines.append(line)

    # Ensure output folder exists.
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=not args.headful,
            slow_mo=0 if not args.headful else 25,
            args=[
                "--disable-blink-features=AutomationControlled",
            ],
        )

        context = browser.new_context(
            viewport={"width": 1440, "height": 1100},
            ignore_https_errors=True,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
            ),
            locale="en-IN",
        )
        context.set_default_timeout(15000)

        search_page = context.new_page()
        detail_page = context.new_page()

        try:
            target_states = states or [""]
            for state in target_states:
                log(f"Search phase: {state or 'All India'}")
                suppliers = collect_supplier_links_for_state(search_page, keyword, state, log)

                if not suppliers:
                    log(f"No suppliers found for {state or 'All India'}")
                    continue

                log(f"Detail phase started for {state or 'All India'}: {len(suppliers)} suppliers")

                for idx, (supplier_name, base_url) in enumerate(suppliers, start=1):
                    slug = slug_from_href(base_url)
                    dedupe_key = slug or base_url
                    if dedupe_key in seen_global:
                        continue
                    seen_global.add(dedupe_key)

                    log(f"Processing {idx}/{len(suppliers)}: {supplier_name}")
                    data = None

                    for attempt in range(1, 4):
                        try:
                            data = scrape_enquiry_page(detail_page, base_url, log, attempts=1)
                            phone = data.get("phone", "—")
                            email = data.get("email", "—")
                            address = data.get("address", "—")
                            name = data.get("name", supplier_name) or supplier_name

                            if any(v != "—" for v in [phone, email, address, name]):
                                break

                            raise RuntimeError("Empty enquiry result")
                        except Exception as e:
                            log(f"Fetch failed ({attempt}/3) for {base_url.rstrip('/')}/enquiry.html")
                            if attempt < 3:
                                time.sleep(0.8 * attempt)
                            else:
                                log(f"Skipping after 3 failed attempts: {supplier_name}")
                                data = {"name": supplier_name, "phone": "—", "email": "—", "address": "—"}

                    assert data is not None
                    row = SupplierRow(
                        index=len(all_rows) + 1,
                        state=state or "All India",
                        name=data.get("name") or supplier_name or "—",
                        phone=data.get("phone") or "—",
                        email=data.get("email") or "—",
                        address=data.get("address") or "—",
                        url=base_url,
                    )
                    all_rows.append(row)
                    log(f"Saved: {row.name} | {row.phone} | {row.email}")

                    if idx < len(suppliers):
                        delay_range(args.delay_min, args.delay_max)

        finally:
            context.close()
            browser.close()

    export_excel(all_rows, output_path)
    log(f"Excel exported: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
