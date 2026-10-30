const fs = require('node:fs');
const source = 'docs/WhyCode-working-guide-Hinglish.md';
const target = 'docs/WhyCode-working-guide-Hinglish.html';
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const flows = [
  { title: 'System ka overall data flow', steps: ['Browser / React', 'Express API', 'GitHub data + public disk snapshots + Neo4j', 'Gemini answer/review; optional auth, translation aur search'], note: 'Public answer history browser localStorage mein alag save hoti hai. Har request har service ko call nahi karti.' },
  { title: 'Repository connect karne ka flow', steps: ['URL type → Explore click', 'URL validate aur normalize', 'Valid → indexing job; invalid → error', 'Job ID browser ko; GitHub collection server par', 'Snapshot / graph save → Complete, Partial ya Failed', 'Browser polling se status dikhata hai'], note: 'Indexing bounded hai. Server ka background job aur browser ki polling alag activities hain.' },
  { title: 'Question se reviewed answer tak', steps: ['Question submit + input/access checks', 'Repository evidence retrieve', 'Evidence nahi → answer withhold', 'Evidence hai → Gemini candidate claims', 'Citations / quotes validate → separate model review', 'Unsupported → withhold; supported → reviewed answer', 'Optional public translation / web context → result screen'], note: 'Review pass ke baad bhi important decisions ke liye original sources inspect karne chahiye.' },
  { title: 'Private repository ka flow', steps: ['Verified account sign-in', 'GitHub App authorization + repository selection', 'Server permission re-check', 'Session memory mein private index', 'Model consent nahi → question blocked', 'Consent hai → selected excerpts + question to Gemini', 'Temporary browser answer; localStorage history mein save nahi'], note: 'Private flow mein Sarvam translation aur external web search disabled hain.' },
];
let flowIndex = 0;
function diagram() {
  const flow = flows[flowIndex++];
  return `<figure class="flow"><figcaption>${escape(flow.title)}</figcaption><ol>${flow.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol><p>${escape(flow.note)}</p></figure>`;
}
const lines = fs.readFileSync(source, 'utf8').split(/\r?\n/);
const output = [];
for (let i = 0; i < lines.length;) {
  const line = lines[i];
  if (!line.trim()) { i++; continue; }
  if (line.startsWith('```mermaid')) {
    while (++i < lines.length && !lines[i].startsWith('```')) {}
    i++; output.push(diagram()); continue;
  }
  const heading = /^(#{1,6}) (.+)$/.exec(line);
  if (heading) { const level = heading[1].length; output.push(`<h${level}>${inline(heading[2])}</h${level}>`); i++; continue; }
  if (line.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) {
      const cells = lines[i++].split('|').slice(1, -1).map(cell => cell.trim());
      if (cells.every(cell => /^:?-+:?$/.test(cell))) continue;
      rows.push(cells);
    }
    output.push('<div class="table-wrap"><table><thead><tr>' + rows[0].map(cell => `<th>${inline(cell)}</th>`).join('') + '</tr></thead><tbody>' + rows.slice(1).map(row => '<tr>' + row.map(cell => `<td>${inline(cell)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
    continue;
  }
  if (/^(?:\d+\.|-) /.test(line)) {
    const ordered = /^\d/.test(line), tag = ordered ? 'ol' : 'ul';
    const items = [];
    while (i < lines.length && (ordered ? /^\d+\. / : /^- /).test(lines[i])) items.push(lines[i++].replace(/^(?:\d+\.|-) /, ''));
    output.push(`<${tag}>` + items.map(item => `<li>${inline(item)}</li>`).join('') + `</${tag}>`); continue;
  }
  const paragraph = [line]; i++;
  while (i < lines.length && lines[i].trim() && !/^(?:#|\||```|\d+\. |- )/.test(lines[i])) paragraph.push(lines[i++]);
  output.push(`<p>${inline(paragraph.join(' '))}</p>`);
}
if (flowIndex !== flows.length) throw new Error('Diagram count changed: update the printable flowcharts.');
fs.writeFileSync(target, `<!doctype html>
<html lang="hi-Latn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhyCode — Simple Hinglish Working Guide</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f5f2eb;color:#203b32;font:17px/1.75 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1060px;margin:40px auto;padding:50px 60px;background:#fffefb;border:1px solid #dddcd2;border-radius:16px}h1{font-size:42px;line-height:1.2;letter-spacing:-1px}h2{font-size:27px;line-height:1.35;margin:55px 0 22px;padding-top:24px;border-top:2px solid #dce5d8;break-after:avoid}h3{font-size:21px;margin-top:30px;break-after:avoid}p{margin:16px 0}li{margin:8px 0}strong{font-weight:700}code{background:#eef0e6;padding:2px 5px;border-radius:4px;font-size:.85em;overflow-wrap:anywhere}.table-wrap{overflow-x:auto;margin:24px 0}table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.6}th{background:#203d32;color:#fff;text-align:left}td,th{padding:12px 14px;border:1px solid #d9dfd3;vertical-align:top}tbody tr:nth-child(even){background:#f5f7ee}.flow{margin:30px 0;padding:26px;background:#edf2e7;border:1px solid #cddac7;border-radius:12px;break-inside:avoid}.flow figcaption{font-weight:750;font-size:20px;margin-bottom:20px}.flow ol{list-style:none;padding:0;margin:0;display:grid;gap:24px}.flow li{position:relative;margin:0;padding:12px 18px;background:#fffefb;border:1px solid #b9cdb7;border-left:4px solid #246553;border-radius:7px;font-weight:600}.flow li:not(:last-child):after{content:'↓';position:absolute;left:50%;bottom:-27px;color:#a55b3c;font-size:23px}.flow p{font-size:14px;margin:20px 0 0}.reading-note{font-size:14px;color:#526457;border-bottom:1px solid #dddcd2;padding-bottom:18px}
@media(max-width:700px){main{margin:0;padding:25px 20px;border:0;border-radius:0}body{font-size:16px}h1{font-size:33px}h2{font-size:24px}.flow{margin:25px 0;padding:18px}}
@media print{@page{size:A4;margin:17mm}body{background:white;font-size:10.5pt}main{max-width:none;margin:0;padding:0;border:0}h1{font-size:28pt}h2{font-size:18pt;margin-top:25px}h3{font-size:14pt}table{font-size:9pt}.table-wrap{overflow:visible}tr{break-inside:avoid}thead{display:table-header-group}.flow{break-inside:avoid;background:#f7f9f3}code{font-size:9pt}}
</style></head><body><main><p class="reading-note">Current code par based guide · 29 October 2026 · Print/PDF ke liye browser mein Ctrl + P use karein</p>${output.join('\n')}</main></body></html>`);
console.log(`Created ${target}: ${flowIndex} self-contained flowcharts.`);
