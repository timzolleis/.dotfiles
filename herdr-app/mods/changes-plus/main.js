import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { highlight } from "./shiki.js";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, shared, setShared, props, openOverlay, closeOverlay, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const found = find(child, id); if (found) return found; }
  return null;
}
// The panel shows Changes. Hidden, it runs no git: timers and watches keep running in a
// hidden copy, and a build's events would each start a status and a diff.
const shown = () => { const root = layout(); return !find(root, "panel")?.hidden && find(root, "panel-body")?.active === "changes"; };
// Events only under these can't change what git shows (ignored or git's own storage).
const NOISE = /\/(node_modules|target|\.next|\.turbo|dist|build|coverage|\.cache)\/|\/\.git\/(objects|logs)\/|\.DS_Store$/;
const noise = (paths) => paths.length > 0 && paths.every((p) => NOISE.test(p));

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
// What the list compares, as in Plannotator's review: the working tree against HEAD,
// the branch's commits since it left main, or everything a PR would show.
const MODES = [
  { id: "uncommitted", label: "Uncommitted" },
  { id: "committed", label: "Committed" },
  { id: "base", label: "vs main" },
];
const BASES = ["origin/main", "origin/master", "main", "master"];
// Shared, so the select's popup (another copy of this mod) can set it.
const modeOf = () => MODES.find((m) => m.id === shared("changes.mode"))?.id ?? "uncommitted";
const modeLabel = (id, ref) => id === "base" ? `vs ${ref ?? "main"}` : MODES.find((m) => m.id === id)?.label;

function addStats(stats, stdout) {
  for (const entry of stdout.split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
    stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
  }
}

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.mode = modeOf();
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          const paths = await watchFolder(root);
          if (this.watched === root && !noise(paths)) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (props()?.modeMenu) return;
    if (!shown()) { this.stale = true; return; }
    if (this.loading || this.busy) return;
    this.stale = false;
    const { cwd, on } = location(), context = key(), mode = this.mode;
    if (context !== this.context || mode !== this.listed) {
      this.context = context; this.listed = mode; this.root = null; this.files = []; this.open = null; this.base = null;
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context || this.mode !== mode) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {}, files = [];
        let entries, base = null;
        if (mode === "uncommitted") {
          const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
          if (status.code !== 0) throw new Error(status.stderr);
          const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
          for (const result of results) {
            if (result.code !== 0) throw new Error(result.stderr);
            addStats(stats, result.stdout);
          }
          entries = status.stdout.split("\0").filter(Boolean);
          for (const entry of entries.slice(0, 1000)) {
            const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
            const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
            const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
            files.push({ path, status: s, fresh, ...(stats[path] ?? { add: 0, del: 0 }) });
          }
        } else {
          if (head.code !== 0) throw new Error("No commits yet");
          for (const ref of BASES) {
            const mb = await git(["merge-base", "--end-of-options", ref, "HEAD"]);
            if (mb.code === 0) { base = { ref, sha: mb.stdout.trim() }; break; }
          }
          if (!base) throw new Error("No main branch to compare with");
          // Committed: base..HEAD. vs main: base against the working tree, untracked files too.
          const range = mode === "committed" ? [base.sha, "HEAD"] : [base.sha];
          const [names, numstat, count] = await Promise.all([
            git(["diff", ...range, "--name-status", "-z", "--no-renames"]),
            git(["diff", ...range, "--numstat", "-z", "--no-renames"]),
            git(["rev-list", "--count", `${base.sha}..HEAD`]),
          ]);
          for (const r of [names, numstat]) if (r.code !== 0) throw new Error(r.stderr);
          addStats(stats, numstat.stdout);
          base.commits = Number(count.stdout.trim()) || 0;
          const parts = names.stdout.split("\0").filter(Boolean);
          entries = [];
          for (let i = 0; i + 1 < parts.length; i += 2) entries.push({ path: parts[i + 1], status: parts[i][0] === "T" ? "M" : parts[i][0] });
          if (mode === "base") {
            const untracked = await git(["ls-files", "--others", "--exclude-standard", "-z"]);
            for (const path of untracked.stdout.split("\0").filter(Boolean)) entries.push({ path, status: "A", fresh: true });
          }
          for (const e of entries.slice(0, 1000)) files.push({ ...e, fresh: Boolean(e.fresh), ...(stats[e.path] ?? { add: 0, del: 0 }) });
        }
        if (key() !== context || this.mode !== mode) return;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.base = base; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && files.length) this.open = files[0].path;
        if (this.open) {
          try { await this.load(this.open, context); this.light(cx); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context && this.mode === mode) { this.error = e?.message ?? String(e); this.files = []; this.setLines([]); this.open = null; } }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    const mode = this.mode, range = mode === "uncommitted" ? (this.hasHead ? ["HEAD"] : []) : mode === "committed" ? [this.base.sha, "HEAD"] : [this.base.sha];
    if (file.fresh || (mode === "uncommitted" && !this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...range, "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.mode === mode && this.open === path) this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  modeMenu(t) {
    const on = modeOf(), ref = props()?.baseRef;
    return v_flex().w_full().p(5).bg(t.popover).text_size(12.8)
      .children(MODES.map((m) => h_flex().id(`mode-${m.id}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => { setShared("changes.mode", m.id); closeOverlay(props().overlay); })
        .child(div().flex_1().child(modeLabel(m.id, ref)))
        .when(m.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none()))));
  }

  setLines(lines) {
    // The 10 s refresh reloads the open diff: the same text keeps its rows and their colors.
    const text = lines.join("\n");
    if (text === this.linesText) return;
    this.linesText = text;
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map(line => line.length * 7 + 50));
  }

  // Colors the open diff once; rows draw plain until Shiki answers.
  light(cx) {
    const rows = this.rows, path = this.open;
    if (!path || rows.lit || !rows.some((r) => r.kind === "+" || r.kind === "-" || r.kind === " ")) return;
    rows.lit = true;
    cx.spawn(async (cx) => { if ((await highlight([{ path, rows }], theme())) && this.rows === rows) cx.notify(); });
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); this.light(cx); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (this.mode !== "uncommitted" || !this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  diffRow({ kind, number, text, spans }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    const gutter = div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number));
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(gutter)
      .child(spans
        ? h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().children(spans.map((s) => div().flex_none().text_color(s.color ?? t.foreground).child(s.text)))
        : div().flex_1().min_w(0).truncate().child(text));
  }

  render(cx) {
    if (props()?.modeMenu) return this.modeMenu(theme());
    if (modeOf() !== this.mode) { this.mode = modeOf(); this.loading = false; this.refresh(cx); }
    else if (key() !== this.context || (this.stale && shown())) this.refresh(cx);
    const uncommitted = this.mode === "uncommitted";
    const empty = uncommitted ? "No uncommitted changes" : this.mode === "committed" ? "No commits on this branch" : "Nothing differs from main";
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    // A select, like Plannotator's diff picker: the button opens this mod's menu as a popup.
    const select = h_flex().id("mode-select").h(28).pl(12).pr(9).gap(6).flex_none().items_center().rounded_full().border_1().border_color(t.border).text_size(12).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => openOverlay({ mod: "changes-plus", kind: "popup", width: 190, height: 112, props: { modeMenu: true, baseRef: this.base?.ref } }))
      .child(div().child(modeLabel(this.mode, this.base?.ref)))
      .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.dim));
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    return v_flex().id("changes").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(select)
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .child(v_flex().id("changes-list").flex_none().h(Math.min(200, Math.max(44, this.files.length * 28 + 12))).overflow_y_scrollbar().p(6).border_b(1).border_color(t.border).children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
          .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "" : this.root ? empty : "No folder")))))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes"))))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .when(!uncommitted && Boolean(this.base), (e) => e.child(h_flex().flex_none().h(32).px(14).gap(6).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().child(this.mode === "committed" ? `merge-base..HEAD` : `merge-base..working tree`))
        .child(div().child("·")).child(div().font_family(settings().font_family ?? "JetBrains Mono").child(this.base?.sha.slice(0, 7) ?? ""))
        .child(div().flex_1()).child(div().child(`${this.base?.commits ?? 0} commits on branch`))))
      .when(uncommitted, (e) => e.child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit"))));
  }
}
