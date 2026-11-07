// Syntax colors for diff rows from Shiki, run in a warm local server
// (~/.config/herdr-app/tools/shiki/server.mjs): grammars load once, results are cached by
// content, and a frame only draws spans. Rows draw plain until their colors arrive.
import { exec, appHome, home } from "herdr";

const URL = "http://127.0.0.1:47173";
let starting = null;

// Starts the server once and waits until it answers; a second start finds the port taken.
function start() {
  starting ??= (async () => {
    const server = `${appHome()}/tools/shiki/server.mjs`;
    const fnm = `${home()}/.local/share/fnm/aliases/default/bin/node`;
    const script = `N="${fnm}"; [ -x "$N" ] || N=$(command -v node); nohup "$N" "${server}" >/tmp/herdr-shiki.log 2>&1 &
for i in $(seq 1 100); do curl -sf ${URL}/health >/dev/null && exit 0; sleep 0.05; done; exit 1`;
    const r = await exec("sh", ["-c", script]);
    starting = null;
    return r.code === 0;
  })();
  return starting;
}

async function post(body) {
  const r = await fetch(`${URL}/highlight`, { method: "POST", body });
  if (!r.ok) throw new Error(`shiki ${r.status}`);
  return r.json();
}

// The old side (removed and context lines) and the new side (added and context lines) of a
// file's rows, each as one text, so a comment or string spanning lines highlights right.
function sides(rows) {
  const old = { text: [], rows: [] }, neu = { text: [], rows: [] };
  rows.forEach((r, i) => {
    if (r.kind === "-" || r.kind === " ") { old.text.push(r.text); old.rows.push(i); }
    if (r.kind === "+" || r.kind === " ") { neu.text.push(r.text); neu.rows.push(i); }
  });
  return { old, neu };
}

const dark = (t) => {
  const hex = /^#?([\da-f]{6})/i.exec(t.background ?? "")?.[1];
  if (!hex) return false;
  const n = parseInt(hex, 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 128;
};

// Colors the rows of each file in place: files is [{ path, rows }]. Context rows take the
// new side's colors. Resolves false when the server can't be reached.
export async function highlight(files, t) {
  const parts = files.map(({ path, rows }) => ({ path, rows, ...sides(rows) }));
  const body = JSON.stringify({
    theme: dark(t) ? "dark" : "light",
    files: parts.flatMap((p, i) => [
      { key: `${i}o`, path: p.path, text: p.old.text.join("\n") },
      { key: `${i}n`, path: p.path, text: p.neu.text.join("\n") },
    ]),
  });
  let result;
  try { result = await post(body); }
  catch {
    if (!(await start())) return false;
    try { result = await post(body); } catch { return false; }
  }
  const palette = result.palette.map((c) => c || null);
  const decode = (flat) => {
    const spans = [];
    for (let k = 0; k < flat.length; k += 2) spans.push({ text: flat[k], color: palette[flat[k + 1]] });
    return spans;
  };
  parts.forEach((p, i) => {
    const old = result.files[`${i}o`], neu = result.files[`${i}n`];
    if (old) p.old.rows.forEach((row, line) => { if (p.rows[row].kind === "-" && old[line]) p.rows[row].spans = decode(old[line]); });
    if (neu) p.neu.rows.forEach((row, line) => { if (neu[line]) p.rows[row].spans = decode(neu[line]); });
  });
  return true;
}
