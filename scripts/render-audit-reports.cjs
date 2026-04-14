const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const auditDir = path.join(root, 'docs', 'audit');
const htmlDir = path.join(auditDir, 'html');
const pdfDir = path.join(auditDir, 'pdf');

const reports = fs.readdirSync(auditDir)
  .filter((name) => name.endsWith('.md'))
  .sort((a, b) => a.localeCompare(b, 'tr'));

fs.mkdirSync(htmlDir, { recursive: true });
fs.mkdirSync(pdfDir, { recursive: true });

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdown(value) {
  let out = escapeHtml(value);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return out;
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  let inCode = false;
  let codeLang = '';
  let codeBuffer = [];

  function flushCode() {
    html.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
    inCode = false;
    codeLang = '';
    codeBuffer = [];
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeBuffer = [];
      }
      i += 1;
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      html.push('<div class="table-wrap"><table>');
      html.push(`<thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead>`);
      html.push('<tbody>');
      for (const row of rows) {
        html.push(`<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`);
      }
      html.push('</tbody></table></div>');
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      html.push('<ul>');
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        html.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
        i += 1;
      }
      html.push('</ul>');
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      html.push('<ol>');
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        html.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i += 1;
      }
      html.push('</ol>');
      continue;
    }

    const paragraph = [line.trim()];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].startsWith('```') &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  }

  if (inCode) flushCode();
  return html.join('\n');
}

function titleFromMarkdown(markdown, fallback) {
  const titleLine = markdown.split(/\r?\n/).find((line) => line.startsWith('# '));
  return titleLine ? titleLine.replace(/^#\s+/, '').trim() : fallback.replace(/\.md$/, '');
}

function layout(title, body, options = {}) {
  const generatedAt = new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Istanbul',
  }).format(new Date());

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: A4;
      margin: 16mm 14mm 18mm;
    }

    :root {
      color-scheme: light;
      --ink: #16202a;
      --muted: #607080;
      --line: #d9e0e7;
      --soft: #f5f7fa;
      --accent: #0b6b6e;
      --accent-2: #b13f2b;
      --warn: #b7791f;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #ffffff;
      color: var(--ink);
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 10.4pt;
      line-height: 1.54;
    }

    .cover {
      border-bottom: 4px solid var(--accent);
      margin-bottom: 22px;
      padding: 10px 0 18px;
    }

    .eyebrow {
      color: var(--accent);
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .cover h1 {
      border: 0;
      color: #0e252b;
      font-size: 25pt;
      line-height: 1.12;
      margin: 0 0 10px;
      padding: 0;
    }

    .meta {
      color: var(--muted);
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 9.5pt;
    }

    .content {
      max-width: 100%;
    }

    h1, h2, h3, h4 {
      color: #102a32;
      break-after: avoid;
      page-break-after: avoid;
    }

    h1 {
      border-bottom: 2px solid var(--line);
      font-size: 20pt;
      margin: 24px 0 12px;
      padding-bottom: 8px;
    }

    h2 {
      border-left: 5px solid var(--accent);
      font-size: 15.5pt;
      margin: 22px 0 10px;
      padding-left: 10px;
    }

    h3 {
      color: var(--accent-2);
      font-size: 12.5pt;
      margin: 16px 0 8px;
    }

    h4 {
      font-size: 11pt;
      margin: 12px 0 6px;
    }

    p {
      margin: 7px 0;
    }

    ul, ol {
      margin: 7px 0 10px 21px;
      padding: 0;
    }

    li {
      margin: 3px 0;
      padding-left: 2px;
    }

    code {
      background: #eef3f6;
      border: 1px solid #d7e1e8;
      border-radius: 4px;
      color: #143947;
      font-family: Consolas, "Courier New", monospace;
      font-size: 9.2pt;
      padding: 1px 4px;
    }

    pre {
      background: #101820;
      border-radius: 6px;
      color: #f3f7fb;
      font-size: 8.7pt;
      line-height: 1.45;
      margin: 10px 0 14px;
      overflow: hidden;
      padding: 11px 12px;
      white-space: pre-wrap;
    }

    pre code {
      background: transparent;
      border: 0;
      color: inherit;
      padding: 0;
    }

    .table-wrap {
      margin: 11px 0 15px;
      overflow: visible;
      page-break-inside: avoid;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 8.2pt;
      table-layout: fixed;
    }

    th {
      background: #16323a;
      color: #ffffff;
      font-weight: 700;
      text-align: left;
    }

    th, td {
      border: 1px solid var(--line);
      padding: 6px 7px;
      vertical-align: top;
      word-break: break-word;
    }

    tbody tr:nth-child(even) td {
      background: var(--soft);
    }

    strong {
      color: #0d2830;
    }

    .page-break {
      break-before: page;
      page-break-before: always;
    }

    .package h1:first-child {
      margin-top: 0;
    }

    @media print {
      a {
        color: inherit;
        text-decoration: none;
      }
    }
  </style>
</head>
<body>
  <section class="cover">
    <div class="eyebrow">Restoran POS V3 Audit Raporu</div>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <span>Olusturulma: ${escapeHtml(generatedAt)}</span>
      <span>Kaynak: docs/audit</span>
      <span>Format: ${options.package ? 'Birlesik PDF paketi' : 'Tekil rapor'}</span>
    </div>
  </section>
  <main class="content ${options.package ? 'package' : ''}">
    ${body}
  </main>
</body>
</html>`;
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, '/')}`;
}

function printPdf(browser, htmlPath, pdfPath) {
  const result = spawnSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    fileUrl(htmlPath),
  ], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`PDF render failed for ${htmlPath}\n${result.stderr || result.stdout}`);
  }
}

const browser = findBrowser();
if (!browser) {
  throw new Error('Chrome or Edge executable was not found. Set CHROME_PATH and run this script again.');
}

const renderedSections = [];

for (const report of reports) {
  const sourcePath = path.join(auditDir, report);
  const markdown = fs.readFileSync(sourcePath, 'utf8');
  const title = titleFromMarkdown(markdown, report);
  const body = markdownToHtml(markdown);
  const baseName = report.replace(/\.md$/, '');
  const htmlPath = path.join(htmlDir, `${baseName}.html`);
  const pdfPath = path.join(pdfDir, `${baseName}.pdf`);

  fs.writeFileSync(htmlPath, layout(title, body), 'utf8');
  printPdf(browser, htmlPath, pdfPath);
  renderedSections.push(`<section class="page-break">${body}</section>`);
  console.log(`Rendered ${path.relative(root, pdfPath)}`);
}

if (renderedSections.length > 1) {
  const packageHtmlPath = path.join(htmlDir, 'audit-report-package.html');
  const packagePdfPath = path.join(pdfDir, 'audit-report-package.pdf');
  fs.writeFileSync(
    packageHtmlPath,
    layout('Restoran POS V3 Audit Rapor Paketi', renderedSections.join('\n'), { package: true }),
    'utf8'
  );
  printPdf(browser, packageHtmlPath, packagePdfPath);
  console.log(`Rendered ${path.relative(root, packagePdfPath)}`);
}
