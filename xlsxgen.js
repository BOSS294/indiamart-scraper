/**
 * xlsxgen.js — Minimal self-contained XLSX generator (no dependencies)
 * Produces valid .xlsx (Office Open XML) files from a 2D array of data.
 */
(function (global) {
  "use strict";

  /* ── CRC-32 ───────────────────────────────────────────── */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++)
      crc = (CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
    return (crc ^ 0xffffffff) >>> 0;
  }

  /* ── String → Uint8Array (UTF-8) ─────────────────────── */
  const enc = new TextEncoder();
  const str2u8 = (s) => enc.encode(s);

  /* ── Little-endian writers ────────────────────────────── */
  function u16(v) { return [(v & 0xff), (v >> 8) & 0xff]; }
  function u32(v) { return [(v & 0xff), (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]; }

  /* ── ZIP builder ──────────────────────────────────────── */
  function buildZip(files) {
    // files: { name: string, data: Uint8Array }[]
    const localHeaders = [];
    const centralDirs  = [];
    let offset = 0;

    for (const { name, data } of files) {
      const nameBuf = str2u8(name);
      const crc     = crc32(data);
      const sz      = data.length;

      // Local file header
      const lh = [
        0x50, 0x4b, 0x03, 0x04,  // signature
        0x14, 0x00,               // version needed: 20
        0x00, 0x00,               // flags
        0x00, 0x00,               // compression: stored
        0x00, 0x00, 0x00, 0x00,  // mod time/date (zeroed)
        ...u32(crc),
        ...u32(sz),
        ...u32(sz),
        ...u16(nameBuf.length),
        0x00, 0x00,               // extra field length
        ...nameBuf,
      ];

      // Central directory record
      const cd = [
        0x50, 0x4b, 0x01, 0x02,  // signature
        0x14, 0x00,               // version made by
        0x14, 0x00,               // version needed
        0x00, 0x00,               // flags
        0x00, 0x00,               // compression
        0x00, 0x00, 0x00, 0x00,  // mod time/date
        ...u32(crc),
        ...u32(sz),
        ...u32(sz),
        ...u16(nameBuf.length),
        0x00, 0x00,               // extra field length
        0x00, 0x00,               // comment length
        0x00, 0x00,               // disk start
        0x00, 0x00,               // internal attrs
        0x00, 0x00, 0x00, 0x00,  // external attrs
        ...u32(offset),
        ...nameBuf,
      ];

      localHeaders.push(new Uint8Array(lh), data);
      centralDirs.push(new Uint8Array(cd));
      offset += lh.length + sz;
    }

    const cdOffset = offset;
    const cdBufs   = centralDirs;
    const cdLen    = cdBufs.reduce((s, b) => s + b.length, 0);

    const eocd = [
      0x50, 0x4b, 0x05, 0x06,  // signature
      0x00, 0x00, 0x00, 0x00,  // disk numbers
      ...u16(files.length),
      ...u16(files.length),
      ...u32(cdLen),
      ...u32(cdOffset),
      0x00, 0x00,              // comment length
    ];

    // Concatenate all parts
    const all = [...localHeaders, ...cdBufs, new Uint8Array(eocd)];
    const total = all.reduce((s, b) => s + b.length, 0);
    const out   = new Uint8Array(total);
    let pos = 0;
    for (const b of all) { out.set(b, pos); pos += b.length; }
    return out;
  }

  /* ── XML helpers ──────────────────────────────────────── */
  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ── Build XLSX parts ─────────────────────────────────── */
  function contentTypes() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml"   ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml"       ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml"              ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  }

  function rootRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  }

  function workbook() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Suppliers" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
  }

  function workbookRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"     Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"        Target="styles.xml"/>
</Relationships>`;
  }

  function styles() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><sz val="11"/><b/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1a4a3a"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
</styleSheet>`;
  }

  /* ── Column letter helper ─────────────────────────────── */
  function colLetter(i) {
    let s = "";
    i += 1;
    while (i > 0) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - m) / 26);
    }
    return s;
  }

  /* ── Build shared strings + worksheet ────────────────── */
  function buildWorksheet(rows) {
    const strings = [];
    const strMap  = Object.create(null);

    function si(v) {
      const s = String(v ?? "");
      if (!(s in strMap)) { strMap[s] = strings.length; strings.push(s); }
      return strMap[s];
    }

    // Build cell data
    const cellRows = rows.map((row, ri) =>
      row.map((val, ci) => {
        const col = colLetter(ci);
        const ref = `${col}${ri + 1}`;
        const idx = si(val);
        const s   = ri === 0 ? ' s="1"' : "";       // style 1 = header
        return `<c r="${ref}" t="s"${s}><v>${idx}</v></c>`;
      })
    );

    // Compute column widths (heuristic)
    const colWidths = rows[0]?.map((_, ci) => {
      let max = 10;
      rows.forEach(r => { if (r[ci]) max = Math.max(max, String(r[ci]).length); });
      return Math.min(max + 2, 40);
    }) || [];

    const colsXml = colWidths.map((w, i) =>
      `<col min="${i+1}" max="${i+1}" width="${w}" bestFit="1" customWidth="1"/>`
    ).join("");

    const rowsXml = cellRows.map((cells, ri) =>
      `<row r="${ri+1}"${ri === 0 ? ' s="1" customFormat="1"' : ""}>${cells.join("")}</row>`
    ).join("");

    const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}
</sst>`;

    const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetView workbookViewId="0" showGridLines="1">
    <selection activeCell="A1" sqref="A1"/>
  </sheetView>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml}</sheetData>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;

    return { worksheetXml, sharedStringsXml };
  }

  /* ── Public API ───────────────────────────────────────── */
  function generateXLSX(rows) {
    // rows: string[][]  (first row = headers)
    const { worksheetXml, sharedStringsXml } = buildWorksheet(rows);

    const files = [
      { name: "[Content_Types].xml",          data: str2u8(contentTypes()) },
      { name: "_rels/.rels",                  data: str2u8(rootRels()) },
      { name: "xl/workbook.xml",              data: str2u8(workbook()) },
      { name: "xl/_rels/workbook.xml.rels",   data: str2u8(workbookRels()) },
      { name: "xl/worksheets/sheet1.xml",     data: str2u8(worksheetXml) },
      { name: "xl/sharedStrings.xml",         data: str2u8(sharedStringsXml) },
      { name: "xl/styles.xml",                data: str2u8(styles()) },
    ];

    return buildZip(files);
  }

  /* ── Attach to global ─────────────────────────────────── */
  global.XLSXGEN = { generate: generateXLSX };
})(typeof self !== "undefined" ? self : window);
