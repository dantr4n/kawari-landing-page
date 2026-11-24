// Prerender the page for crawlers and link previews.
//
// index.html is the source. Its text lives in the T dictionary inside the page
// script and is normally filled in by JS at load. This script fills the same
// text into the static HTML, writes the SEO <head>, and emits one copy per
// language so each has its own URL:
//
//   index.html     x-default: follows the browser language (prerendered in VI)
//   vi/index.html  pinned to Vietnamese
//   en/index.html  pinned to English
//   sitemap.xml
//   404.html       served by GitHub Pages for missing paths
//
// Usage:
//   node tools/build.mjs          rebuild everything
//   node tools/build.mjs --check  exit 1 if any output is stale (used in CI)
//
// Run it after every change to index.html. The JS still renders everything at
// runtime, so the prerendered text is only what crawlers and no-JS readers see.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SITE = "https://kawari-ai.app/";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const src = readFileSync(join(ROOT, "index.html"), "utf8");

// Pull T, STUDIES and the HTML builders out of the page script.
const a = src.indexOf("const T={");
const b = src.indexOf("/* shared:end */");
if (a < 0 || b < 0) throw new Error("index.html: cannot find 'const T={' ... '/* shared:end */'");
const { T, STUDIES, HTML, esc, rb } = vm.runInNewContext(
  src.slice(a, b) + "\n;({T,STUDIES,HTML,esc,rb})"
);

const VARIANTS = [
  { out: "index.html", lang: "vi", url: SITE, base: "", pin: false },
  { out: "vi/index.html", lang: "vi", url: SITE + "vi/", base: "../", pin: true },
  { out: "en/index.html", lang: "en", url: SITE + "en/", base: "../", pin: true },
];
const LOCALE = { vi: "vi_VN", en: "en_US" };

function replaceOnce(s, re, fn, what) {
  let n = 0;
  const r = s.replace(re, (...m) => (n++, fn(...m)));
  if (n !== 1) throw new Error(`expected exactly one ${what}, found ${n}`);
  return r;
}

function seo(v) {
  const D = T[v.lang];
  const other = v.lang === "vi" ? "en" : "vi";
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: D.title0,
    description: D.md,
    url: v.url,
    inLanguage: v.lang,
    isPartOf: { "@type": "WebSite", name: "Kawari", url: SITE },
    citation: STUDIES.map((s) => ({ "@type": "ScholarlyArticle", name: s.t, url: s.u })),
  };
  return [
    `<title>${esc(D.title0)}</title>`,
    `<meta name="description" content="${esc(D.md)}">`,
    `<link rel="canonical" href="${v.url}">`,
    `<link rel="alternate" hreflang="vi" href="${SITE}vi/">`,
    `<link rel="alternate" hreflang="en" href="${SITE}en/">`,
    `<link rel="alternate" hreflang="x-default" href="${SITE}">`,
    `<meta name="theme-color" content="#eef7fd">`,
    `<link rel="icon" href="${v.base}favicon.svg" type="image/svg+xml">`,
    `<link rel="icon" href="${v.base}favicon-48.png" sizes="48x48" type="image/png">`,
    `<link rel="apple-touch-icon" href="${v.base}apple-touch-icon.png">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Kawari">`,
    `<meta property="og:url" content="${v.url}">`,
    `<meta property="og:title" content="${esc(D.title0)}">`,
    `<meta property="og:description" content="${esc(D.md)}">`,
    `<meta property="og:image" content="${SITE}og.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(D.title0)}">`,
    `<meta property="og:locale" content="${LOCALE[v.lang]}">`,
    `<meta property="og:locale:alternate" content="${LOCALE[other]}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  ].join("\n");
}

function build(v) {
  const D = T[v.lang];
  let s = src;

  const attrs = v.pin ? ` lang="${v.lang}" data-lang="${v.lang}" data-base="${v.base}"` : ` lang="${v.lang}"`;
  s = replaceOnce(s, /<html[^>]*>/, () => `<html${attrs}>`, "<html>");
  s = replaceOnce(s, /<!--seo-->[\s\S]*?<!--\/seo-->/, () => `<!--seo-->\n${seo(v)}\n<!--/seo-->`, "seo block");

  // Elements with data-i hold plain text or ruby only, so the first closing tag of the same name ends them.
  s = s.replace(/(<(\w+)\b[^>]*\sdata-i="(\w+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, key, _, close) =>
    typeof D[key] === "string" ? open + rb(D[key]) + close : m
  );
  s = s.replace(/data-ph="(\w+)"(?:\s+placeholder="[^"]*")?/g, (m, key) => `data-ph="${key}" placeholder="${esc(D[key])}"`);

  const pre = {
    heroChat: HTML.hero(D),
    logList: HTML.log(D.log),
    vlines: HTML.vlines(D),
    studies: HTML.studies(D, v.lang),
    habits: HTML.habits(D),
  };
  for (const [id, html] of Object.entries(pre)) {
    s = replaceOnce(
      s,
      new RegExp(`(id="${id}"[^>]*>)<!--pre-->[\\s\\S]*?<!--/pre-->`),
      (m, open) => `${open}<!--pre-->${html}<!--/pre-->`,
      `#${id} prerender slot`
    );
  }
  return s;
}

function sitemap() {
  const alts = [
    ["vi", SITE + "vi/"],
    ["en", SITE + "en/"],
    ["x-default", SITE],
  ]
    .map(([l, u]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${u}"/>`)
    .join("\n");
  const urls = VARIANTS.map((v) => `  <url>\n    <loc>${v.url}</loc>\n${alts}\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

// GitHub Pages serves /404.html for any missing path. Prerendered in VI; a tiny script swaps to EN.
function notFound() {
  const vi = T.vi, en = T.en;
  const pick = (k) => JSON.stringify({ vi: vi[k], en: en[k] }).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(vi.nf_t)} — Kawari</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@500;800&family=Noto+Sans+JP:wght@800&display=swap" rel="stylesheet">
<style>
html,body{margin:0;min-height:100%}
body{min-height:100vh;display:grid;place-items:center;background:#eef7fd;color:#12233a;font:17px/1.6 "Be Vietnam Pro","Noto Sans JP",system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
i{font-style:normal;display:inline-grid;place-items:center;width:64px;height:64px;border-radius:20px;background:#2f9be0;color:#fff;font:800 36px "Noto Sans JP",sans-serif}
h1{font-size:clamp(28px,7vw,44px);letter-spacing:-.02em;margin:28px 0 8px}
p{color:#56697b;margin:0 0 6px}
code{font-size:14px;color:#8e86a8;word-break:break-all}
a{display:inline-block;margin-top:28px;padding:12px 22px;border-radius:999px;background:#2f9be0;color:#fff;text-decoration:none;font-weight:800}
</style>
</head>
<body>
<main>
  <i>代</i>
  <h1 data-k="nf_h">${esc(vi.nf_h)}</h1>
  <p data-k="nf_p">${esc(vi.nf_p)}</p>
  <code id="path"></code><br>
  <a href="/" data-k="nf_a">${esc(vi.nf_a)}</a>
</main>
<script>
{
const T={nf_t:${pick("nf_t")},nf_h:${pick("nf_h")},nf_p:${pick("nf_p")},nf_a:${pick("nf_a")}};
const L=(navigator.languages||[navigator.language||"vi"]).map(String).map(s=>s.toLowerCase());
const lang=L.find(s=>s.startsWith("vi"))?"vi":L.find(s=>s.startsWith("en"))?"en":"vi";
document.documentElement.lang=lang;document.title=T.nf_t[lang]+" — Kawari";
for(const el of document.querySelectorAll("[data-k]"))el.textContent=T[el.dataset.k][lang];
let p=location.pathname;try{p=decodeURIComponent(p)}catch(_){}document.getElementById("path").textContent=p;
}
</script>
</body>
</html>
`;
}

const outputs = [...VARIANTS.map((v) => [v.out, build(v)]), ["sitemap.xml", sitemap()], ["404.html", notFound()]];
let stale = [];
for (const [rel, text] of outputs) {
  const p = join(ROOT, rel);
  const cur = existsSync(p) ? readFileSync(p, "utf8") : null;
  if (cur === text) continue;
  if (check) stale.push(rel);
  else {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    console.log("wrote", rel);
  }
}
if (check && stale.length) {
  console.error("stale, run `node tools/build.mjs`:", stale.join(", "));
  process.exit(1);
}
