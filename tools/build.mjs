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

const SITE = "https://dantr4n.github.io/kawari-landing-page/";
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

const outputs = [...VARIANTS.map((v) => [v.out, build(v)]), ["sitemap.xml", sitemap()]];
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
