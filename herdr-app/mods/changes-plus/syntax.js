// Syntax colors for diff rows: a small tokenizer that runs once when a diff loads, so a
// frame only draws spans. Lines are tokenized in diff order; a block comment or a
// template string carries over to the next line, which is right for most hunks.

const KEYWORDS = {
  js: "abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let namespace new null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield",
  rust: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
  py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield",
  sh: "case do done elif else esac export fi for function if in local return then until while",
  css: "",
  json: "true false null",
  toml: "true false",
};
const PRIMITIVES = new Set("string number boolean bigint symbol any unknown never object void u8 u16 u32 u64 usize i8 i16 i32 i64 isize f32 f64 bool str char".split(" "));
const SETS = Object.fromEntries(Object.entries(KEYWORDS).map(([k, v]) => [k, new Set(v.split(" "))]));

const EXT = {
  ts: "js", tsx: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", mts: "js", cts: "js",
  rs: "rust", py: "py", sh: "sh", bash: "sh", zsh: "sh", css: "css", scss: "css",
  json: "json", jsonc: "json", toml: "toml", yaml: "toml", yml: "toml", md: "md", mdx: "md",
};

export function languageOf(path) {
  const ext = /\.([a-z0-9]+)$/i.exec(path ?? "")?.[1]?.toLowerCase();
  return EXT[ext] ?? null;
}

const LINE_COMMENT = { js: "//", rust: "//", css: null, py: "#", sh: "#", toml: "#", json: null };
const BLOCK = { js: true, rust: true, css: true };

// One line → [{ text, kind }], kind one of keyword string comment number type fn plain.
// `state.inBlock` / `state.inTemplate` carry across lines.
export function tokenize(line, lang, state) {
  if (!lang) return null;
  if (lang === "md") return markdownLine(line);
  const out = [];
  const push = (text, kind) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  const keywords = SETS[lang] ?? new Set(), lineComment = LINE_COMMENT[lang];
  let i = 0;
  while (i < line.length) {
    if (state.inBlock) {
      const end = line.indexOf("*/", i);
      if (end < 0) { push(line.slice(i), "comment"); return out; }
      push(line.slice(i, end + 2), "comment"); i = end + 2; state.inBlock = false; continue;
    }
    if (state.inTemplate) {
      const end = templateEnd(line, i);
      if (end < 0) { push(line.slice(i), "string"); return out; }
      push(line.slice(i, end + 1), "string"); i = end + 1; state.inTemplate = false; continue;
    }
    const rest = line.slice(i), c = line[i];
    if (lineComment && rest.startsWith(lineComment)) { push(rest, "comment"); return out; }
    if (BLOCK[lang] && rest.startsWith("/*")) { state.inBlock = true; continue; }
    if (c === "`" && lang === "js") {
      const end = templateEnd(line, i + 1);
      if (end < 0) { push(rest, "string"); state.inTemplate = true; return out; }
      push(line.slice(i, end + 1), "string"); i = end + 1; continue;
    }
    if (c === '"' || c === "'") {
      // A Rust lifetime ('a) is not a string.
      if (c === "'" && lang === "rust" && /^'[a-z_]\w*(?!')/.test(rest)) { const m = /^'[a-z_]\w*/.exec(rest)[0]; push(m, "type"); i += m.length; continue; }
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
      push(line.slice(i, j + 1), "string"); i = j + 1; continue;
    }
    const num = /^(?:0x[\da-f_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?)(?:n|u8|u16|u32|u64|usize|i32|i64|f32|f64)?\b/i.exec(rest);
    if (num && !/[\w$]/.test(line[i - 1] ?? "")) { push(num[0], "number"); i += num[0].length; continue; }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      const w = word[0], after = line.slice(i + w.length);
      const kind = PRIMITIVES.has(w) && lang !== "json" ? "type"
        : keywords.has(w) ? "keyword"
        : /^\s*(?:!\s*)?\(/.test(after) || (lang === "rust" && after.startsWith("!")) ? "fn"
        : /^[A-Z]/.test(w) ? "type"
        : lang === "json" || lang === "toml" ? (/^\s*[:=]/.test(after) ? "fn" : "plain")
        : "plain";
      push(w, kind); i += w.length; continue;
    }
    push(c, "plain"); i += 1;
  }
  return out;
}

function templateEnd(line, from) {
  for (let j = from; j < line.length; j++) {
    if (line[j] === "\\") { j++; continue; }
    if (line[j] === "`") return j;
  }
  return -1;
}

function markdownLine(line) {
  if (/^#{1,6}\s/.test(line)) return [{ text: line, kind: "keyword" }];
  if (/^\s*([-*+]|\d+\.)\s/.test(line)) { const m = /^\s*([-*+]|\d+\.)/.exec(line)[0]; return [{ text: m, kind: "number" }, ...inlineCode(line.slice(m.length))]; }
  if (/^\s*>/.test(line)) return [{ text: line, kind: "comment" }];
  return inlineCode(line);
}

function inlineCode(text) {
  const out = [];
  for (const part of text.split(/(`[^`]*`)/)) if (part) out.push({ text: part, kind: part.startsWith("`") ? "string" : "plain" });
  return out;
}

// Colors from the theme's ANSI palette, so the diff follows the theme.
export function syntaxColors(t) {
  return { keyword: t.ansi5, string: t.ansi2, comment: t.dim, number: t.ansi3, type: t.ansi6, fn: t.ansi4, plain: t.foreground };
}

// Adds `spans` to the code rows of a diff (kinds "+", "-", " "), in place.
export function highlightRows(rows, path) {
  const lang = languageOf(path);
  if (!lang) return rows;
  const state = { inBlock: false, inTemplate: false };
  for (const r of rows) if (r.kind === "+" || r.kind === "-" || r.kind === " ") r.spans = tokenize(r.text, lang, state);
  return rows;
}
