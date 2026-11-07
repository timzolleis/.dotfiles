// A warm Shiki highlighter for Herdr's diff views (mods/changes-plus/shiki.js).
//
// POST /highlight  { theme: "light" | "dark", files: [{ key, path, text }] }
//   → { palette: string[], files: { [key]: line[] } }
//   A line is a flat array: text, palette index, text, palette index, ...
// GET /health → "ok"
//
// One process stays up so grammars load once; it exits after IDLE_MS without a
// request. Results are cached by content, so reopening a review costs a lookup.

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { createHighlighter, bundledLanguagesInfo } from "shiki";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

const PORT = Number(process.env.HERDR_SHIKI_PORT ?? 47173);
const IDLE_MS = 30 * 60_000;
const THEMES = { light: "github-light-default", dark: "github-dark-default" };
const MAX_LINE = 1000;
const CACHE_MAX = 2000;

// Extension and file name → Shiki language id, from Shiki's own aliases.
const byName = new Map();
for (const info of bundledLanguagesInfo) for (const name of [info.id, ...(info.aliases ?? [])]) byName.set(name.toLowerCase(), info.id);
const FILE_NAMES = { dockerfile: "docker", makefile: "make", justfile: "just", ".zshrc": "shellscript", ".bashrc": "shellscript", "cargo.lock": "toml" };

export function languageOf(path) {
  const name = basename(path).toLowerCase();
  if (FILE_NAMES[name]) return FILE_NAMES[name];
  const ext = /\.([^.]+)$/.exec(name)?.[1];
  return (ext && byName.get(ext)) ?? null;
}

const highlighter = await createHighlighter({
  themes: Object.values(THEMES),
  langs: [],
  // Oniguruma is VS Code's own regex engine: exact grammars, and faster cold than the JS engine
  // (632 vs 892 ms on an 84-file review; 10 ms either way once cached).
  engine: createOnigurumaEngine(import("shiki/wasm")),
});
const loading = new Map();
const loadLanguage = (lang) => {
  if (highlighter.getLoadedLanguages().includes(lang)) return Promise.resolve(true);
  if (!loading.has(lang)) loading.set(lang, highlighter.loadLanguage(lang).then(() => true, () => false));
  return loading.get(lang);
};

// Palette per response; colors are few, indexes keep the JSON small.
function encode(tokenLines, palette, index) {
  return tokenLines.map((tokens) => {
    const out = [];
    for (const { content, color } of tokens) {
      const c = color ?? "";
      let i = index.get(c);
      if (i === undefined) { i = palette.length; palette.push(c); index.set(c, i); }
      if (out.length && out[out.length - 1] === i) out[out.length - 2] += content;
      else out.push(content, i);
    }
    return out;
  });
}

const cache = new Map();
async function tokensFor({ path, text }, theme) {
  const lang = languageOf(path);
  if (!lang || !(await loadLanguage(lang))) return null;
  const key = createHash("sha1").update(`${theme}\0${lang}\0${text}`).digest("base64");
  let lines = cache.get(key);
  if (lines) { cache.delete(key); cache.set(key, lines); return lines; }
  lines = highlighter.codeToTokensBase(text, { lang, theme: THEMES[theme], tokenizeMaxLineLength: MAX_LINE });
  cache.set(key, lines);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return lines;
}

let idle;
const touch = () => { clearTimeout(idle); idle = setTimeout(() => process.exit(0), IDLE_MS); };

const server = createServer(async (req, res) => {
  touch();
  if (req.method === "GET" && req.url === "/health") return res.end("ok");
  if (req.method !== "POST" || req.url !== "/highlight") { res.statusCode = 404; return res.end(); }
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { theme = "light", files = [] } = JSON.parse(body);
    const palette = [], index = new Map(), out = {};
    for (const file of files) {
      const lines = await tokensFor(file, theme === "dark" ? "dark" : "light");
      if (lines) out[file.key] = encode(lines, palette, index);
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ palette, files: out }));
  } catch (error) {
    res.statusCode = 400;
    res.end(String(error?.message ?? error));
  }
});

// A second copy started by a race finds the port taken and leaves.
server.on("error", (error) => { if (error.code === "EADDRINUSE") process.exit(0); throw error; });
server.listen(PORT, "127.0.0.1", () => {
  touch();
  // Grammars the diffs here mostly need, loaded after the port answers.
  for (const lang of ["typescript", "tsx", "javascript", "json", "markdown", "rust", "css", "shellscript", "yaml", "toml", "sql", "html"]) void loadLanguage(lang);
});
