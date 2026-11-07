// Cmd-K command bar. Opens as a popup (mod.open:cmdk-plus). One input, one list.
// Empty query: Needs you, Recent, Actions. Typing: one fuzzy-ranked list under group
// headers (agents, spaces and tabs, inbox, commands, layouts). ">" first: commands only.
//
// Energy: the index is built once, in init (the inbox folder is read once, with fs, no exec).
// render() only draws: it never ranks or reads. Ranking runs when the query changes, and
// only the rows that fit are drawn. No timers, loops, frames or transitions.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, spaces, terminals, commands, layouts, keys, layout, focused, run, theme, props, closeOverlay, openOverlay, shared, setShared, window, appHome, readTextFile } from "herdr";
import * as fs from "fs/promises";

const HEAD = 30, ROW = 34, LIST_MAX = 408;
const CAP = { agents: 6, nav: 8, inbox: 6, commands: 10, layouts: 4 };
const GROUPS = {
  needs: "Needs you", recent: "Recent", actions: "Actions",
  agents: "Agents", nav: "Spaces and tabs", inbox: "Inbox", commands: "Commands", layouts: "Layouts",
};
const ICON = (n) => `mods/workspace-chrome/${n}.svg`;
const INBOX_ICON = "mods/inbox-plus/inbox.svg";

function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) {
    const f = find(c, id);
    if (f) return f;
  }
  return null;
}

// ---- key bindings, as the platform writes them ("⌘⇧L") ----
const MODS = ["cmd", "ctrl", "shift", "alt", "option"];
const KEYSYM = { left: "←", right: "→", up: "↑", down: "↓", enter: "↵", escape: "Esc", backspace: "⌫", tab: "⇥", space: "Space", pageup: "PgUp", pagedown: "PgDn" };
function formatKeys(spec, mac) {
  const sym = { cmd: mac ? "⌘" : "Ctrl", ctrl: mac ? "⌃" : "Ctrl", shift: mac ? "⇧" : "Shift", alt: mac ? "⌥" : "Alt", option: mac ? "⌥" : "Alt" };
  const parts = [];
  let rest = spec;
  for (;;) {
    const m = MODS.find((x) => rest.startsWith(`${x}-`) && rest.length > x.length + 1);
    if (!m) break;
    parts.push(sym[m]);
    rest = rest.slice(m.length + 1);
  }
  parts.push(KEYSYM[rest.toLowerCase()] ?? rest.toUpperCase());
  return mac ? parts.join("") : parts.join("+");
}
// action -> "⌘K": global and the shown layout's keys first, the terminal's last.
function bindings() {
  const mac = window()?.platform === "macos";
  const lay = shared("layout");
  const rank = (s) => (s === `layout:${lay}` ? 0 : s === "global" ? 1 : s === "terminal" ? 3 : s.startsWith("layout:") ? 9 : 2);
  const map = new Map(), best = new Map();
  for (const k of keys()) {
    const r = rank(k.section);
    if (r >= 9) continue;
    if (!best.has(k.action) || r < best.get(k.action)) { best.set(k.action, r); map.set(k.action, formatKeys(k.keys, mac)); }
  }
  return map;
}

// ---- readable command names: tab.new -> "New tab" ----
const NOUN = new Set(["space", "tab", "pane", "layout", "agent", "window", "overlay", "mod"]);
const LABELS = {
  "terminal.copy": "Copy", "terminal.paste": "Paste", "terminal.paste_image": "Paste image",
  "terminal.search": "Search terminal", "terminal.open": "New terminal", "terminal.scroll": "Scroll terminal",
  "terminal.show": "Show terminal", "terminal.right_click": "Terminal right-click",
  "app.whats_new": "What's new", "app.check_updates": "Check for updates", "app.update_core": "Update core",
  "app.update": "Restart to update", "app.welcome": "Welcome", "app.palette": "Command palette",
  "app.help": "Keyboard shortcuts", "app.feedback": "Send feedback", "app.zoom_in": "Zoom in",
  "app.zoom_out": "Zoom out", "app.zoom_reset": "Reset zoom", "app.hide_others": "Hide others", "app.show_all": "Show all",
  "agent.next": "Next agent", "agent.prev": "Previous agent", "tab.next": "Next tab", "tab.prev": "Previous tab",
  "space.next": "Next space", "space.prev": "Previous space",
};
function readable(name) {
  if (LABELS[name]) return LABELS[name];
  const [ns, verb] = name.split(".");
  const v = (verb ?? ns).replace(/_/g, " ");
  const phrase = v[0].toUpperCase() + v.slice(1);
  return NOUN.has(ns) && verb ? `${phrase} ${ns}` : phrase;
}
// Never offered: the escape hatch, and plumbing that needs a context.
const HIDDEN = new Set(["app.reset", "overlay.close", "app.palette"]);

// ---- fuzzy matching: prefix, then word start, then subsequence ----
const alnum = /[\p{L}\p{N}]/u;
const starts = (s, j) => j === 0 || !alnum.test(s[j - 1]);
const span = (a, n) => Array.from({ length: n }, (_, i) => a + i);
function match1(q, text) {
  const s = text.toLowerCase();
  const i = s.indexOf(q);
  if (i === 0) return { score: 4000 - text.length, idx: span(0, q.length) };
  for (let j = i; j >= 0; j = s.indexOf(q, j + 1)) if (starts(s, j)) return { score: 3000 - j, idx: span(j, q.length) };
  // each query letter at the start of a later word: "nt" -> New Tab
  const acro = [];
  let pos = 0;
  for (const c of q) {
    let j = pos;
    while (j < s.length && !(s[j] === c && starts(s, j))) j++;
    if (j >= s.length) { acro.length = 0; break; }
    acro.push(j);
    pos = j + 1;
  }
  if (acro.length === q.length && q.length > 1) return { score: 2500 - acro[0], idx: acro };
  if (i > 0) return { score: 2000 - i, idx: span(i, q.length) };
  const sub = [];
  pos = 0;
  for (const c of q) {
    const j = s.indexOf(c, pos);
    if (j < 0) return null;
    sub.push(j);
    pos = j + 1;
  }
  return { score: 1000 - (sub[sub.length - 1] - sub[0]) - sub[0], idx: sub };
}
function match(q, text) {
  if (!q.includes(" ")) return match1(q, text);
  // several words: every word must match somewhere
  let score = Infinity;
  const idx = [];
  for (const w of q.split(/\s+/).filter(Boolean)) {
    const m = match1(w, text);
    if (!m) return null;
    score = Math.min(score, m.score);
    idx.push(...m.idx);
  }
  return { score: score - 200, idx: [...new Set(idx)].sort((a, b) => a - b) };
}
function rate(q, it) {
  const m = match(q, it.label);
  if (m) return { score: m.score + (it.bonus ?? 0), idx: m.idx };
  const h = match(q, it.hay ?? "");
  return h ? { score: h.score - 1500 + (it.bonus ?? 0), idx: null } : null;
}
function runsOf(text, idx) {
  if (!idx?.length) return [[text, false]];
  const on = new Set(idx), out = [];
  for (let i = 0; i < text.length; i++) {
    const hit = on.has(i);
    if (out.length && out[out.length - 1][1] === hit) out[out.length - 1][0] += text[i];
    else out.push([text[i], hit]);
  }
  return out;
}

// ---- inbox, as inbox-plus reads it ----
const liveQuestions = (i) => (i.questions ?? []).filter((q) => !q.withdrawn);
const liveActions = (i) => (i.actions ?? []).filter((a) => !a.withdrawn);
function needOf(item) {
  if (item.archived_at) return "archived";
  if (item.kind === "reply") return "reply";
  if (item.answer || item.withdrawn_at) return "done";
  if (item.kind === "verify") return "verify";
  if (liveQuestions(item).length) return "ask";
  if (liveActions(item).length) return "act";
  return item.read_at ? "done" : "update";
}
const ASKS = ["ask", "act", "verify"];
const base = (p) => String(p ?? "").split("/").filter(Boolean).pop() ?? "";
function openInboxItem(id) {
  setShared("inbox.selected", id);
  const center = find(layout(), "center");
  if (center?.active === "inbox-screen") return;
  if (find(layout(), "panel-body")) {
    run("layout.select", { stack: "panel-body", child: "inbox-panel" });
    run("layout.show", { id: "panel" });
  } else if (find(layout(), "inbox-screen")) run("layout.select", { stack: "center", child: "inbox-screen" });
}

// ---- where I have been: tab ids, newest first, kept across opens ----
function remember(...tabIds) {
  const old = shared("cmdk.recent") ?? [];
  const next = [...new Set([...tabIds.filter(Boolean), ...old])].slice(0, 10);
  if (next.join() !== old.join()) setShared("cmdk.recent", next);
}
const activeTab = () => spaces().find((s) => s.active)?.tabs.find((t) => t.active)?.id;

function tabName(sp, tab) {
  return tab.named ? { label: tab.name, sub: sp.name } : { label: sp.name, sub: sp.tabs.length > 1 ? `Tab ${tab.name}` : "" };
}

export default class CmdK extends View {
  init(_props, cx) {
    this.query = "";
    this.at = 0;
    this.top = 0;
    this.wheel = 0;
    this.inbox = [];
    this.build();
    this.rows = this.rank();
    this.input = InputState.new({ placeholder: "Search, or type > for commands" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      this.at = 0;
      this.top = 0;
      this.rows = this.rank();
      cx.notify();
    });
    this.input.on("submit", () => this.go(this.selectable()[this.at]));
    this.input.focus();
    cx.timer.after(150, () => this.input.focus());
    this.handle = cx.focus_handle();
    // The inbox folder, once.
    cx.spawn(async (cx) => {
      try {
        const dir = `${appHome()}/data/inbox/items`;
        const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith(".json") && !n.startsWith("."));
        const out = [];
        for (const n of names) {
          const text = await readTextFile(`${dir}/${n}`).catch(() => null);
          if (!text) continue;
          try {
            const i = JSON.parse(text), need = needOf(i);
            if (need === "archived" || need === "reply") continue;
            const stopped = need === "ask" && liveQuestions(i).some((q) => q.stopped);
            out.push({ id: i.id, subject: i.subject ?? "", thread: i.thread ?? "", who: i.from?.name || base(i.from?.root), terminal: i.from?.terminal, need, stopped, created_at: i.created_at ?? "" });
          } catch {}
        }
        out.sort((a, b) => b.created_at.localeCompare(a.created_at));
        this.inbox = out;
        this.build();
        this.rows = this.rank();
        this.at = Math.min(this.at, Math.max(0, this.selectable().length - 1));
      } catch {}
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  // ---- the index: every thing that can be run, made once ----
  build() {
    const keysOf = this.keymap ?? (this.keymap = bindings());
    const hint = (a) => keysOf.get(a) ?? "";
    const lay = layout();
    const ss = spaces();
    const ags = agents();
    const tl = new Map(terminals().map((x) => [x.address, x.labels ?? {}]));
    const here = activeTab();
    const go = (fn) => () => { this.close(); fn(); };
    const items = { needs: [], agents: [], nav: [], inbox: [], actions: [], commands: [], layouts: [] };
    this.tabItem = new Map();

    // agents
    const asked = new Set(this.inbox.filter((i) => i.need === "ask").map((i) => i.terminal));
    for (const a of ags) {
      const labels = tl.get(a.address) ?? {};
      const sp = ss.find((s) => s.id === a.space);
      const tab = sp?.tabs.find((t) => t.id === a.tab);
      const task = labels["herdr.task"];
      const named = tab?.named ? tab.name : null;
      const name = task || named || a.space_name || a.program?.name || a.address;
      const sub = [name !== a.space_name ? a.space_name : null, labels["herdr.now"]].filter(Boolean).join(" · ");
      const it = {
        id: `agent:${a.address}`, group: "agents", label: name, sub, hay: `${name} ${a.space_name} ${a.program?.name ?? ""} ${a.status} ${task ?? ""} ${a.title ?? ""}`,
        program: a.program, mark: a.status, bonus: a.status === "blocked" ? 80 : 0,
        go: go(() => { remember(here, a.tab); run("pane.focus", { pane: a.pane }); }),
      };
      items.agents.push(it);
      if (a.status === "blocked" && !asked.has(a.address)) items.needs.push({ ...it, id: `need:${a.address}`, pill: "Needs you" });
    }

    // spaces and tabs
    for (const sp of ss) {
      const cur = sp.tabs.find((t) => t.active) ?? sp.tabs[0];
      items.nav.push({
        id: `space:${sp.id}`, group: "nav", label: sp.name, sub: sp.branch ?? sp.machine ?? "", hay: `${sp.name} ${sp.branch ?? ""} space`,
        icon: ICON("layers"), mark: sp.status,
        go: go(() => { remember(here, cur?.id); run("space.select", { id: sp.id }); }),
      });
      for (const tab of sp.tabs) {
        const n = tabName(sp, tab);
        const it = {
          id: `tab:${tab.id}`, group: "nav", label: n.label, sub: n.sub, hay: `${sp.name} ${tab.name} tab`,
          icon: ICON("terminal"), mark: tab.status, current: tab.id === here,
          go: go(() => { remember(here, tab.id); run("tab.select", { id: tab.id }); }),
        };
        this.tabItem.set(tab.id, { it, changed: tab.changed_at ?? 0 });
        if (tab.named || sp.tabs.length > 1) items.nav.push(it);
      }
    }

    // inbox
    for (const i of this.inbox) {
      const asks = ASKS.includes(i.need);
      const tag = i.stopped ? "Blocks agent" : { ask: "Asks", act: "To do", verify: "Verify" }[i.need];
      const it = {
        id: `inbox:${i.id}`, group: "inbox", label: i.subject || "Untitled", sub: [i.who, i.thread].filter(Boolean).join(" · "),
        hay: `${i.subject} ${i.thread} ${i.who}`, icon: INBOX_ICON, pill: asks ? tag : null, dimmed: i.need === "done",
        go: go(() => openInboxItem(i.id)),
      };
      items.inbox.push(it);
      if (asks) items.needs.push(it);
    }

    // curated actions, for the current space
    const space = ss.find((s) => s.active);
    const panelOk = (id) => Boolean(find(lay, "panel-body")?.children?.some((c) => c.id === id));
    const showPanel = (id) => () => { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); };
    const act = (id, label, icon, action, fn, hay = "") => ({ id: `act:${id}`, group: "actions", label, icon, hint: hint(action), hay: `${label} ${hay}`, bonus: 100, go: go(fn), curated: true });
    items.actions.push(act("agent", "New agent tab", ICON("plus"), "", () => run("tab.new", { argv: ["pi"] }), "pi"));
    if (space) items.actions.push(act("worktree", "New worktree", ICON("branch"), "", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space.id, folder: focused()?.cwd ?? space.folder, action: "new" } }), "branch git"));
    if (panelOk("changes")) items.actions.push(act("changes", "Show Changes", ICON("git-compare"), "tabs-plus.changes", showPanel("changes"), "diff git"));
    if (panelOk("files")) items.actions.push(act("files", "Show Files", ICON("files"), "tabs-plus.files", showPanel("files"), "tree folder"));
    if (find(lay, "inbox-screen")) items.actions.push(act("inbox", "Show Inbox", INBOX_ICON, "tabs-plus.inbox", () => run("layout.select", { stack: "center", child: "inbox-screen" }), "messages"));
    if (find(lay, "sidebar")) items.actions.push(act("sidebar", "Toggle sidebar", ICON("panel-left"), "layout.toggle:sidebar", () => run("layout.toggle", { id: "sidebar" }), "hide show"));
    items.actions.push(act("layout", "Switch layout", ICON("layers"), "layout.switch", () => run("layout.switch")));
    items.actions.push(act("settings", "Settings", ICON("settings"), "app.settings", () => run("app.settings"), "preferences"));

    // commands: every one that needs no argument; the curated ones above stand in for two
    const covered = new Set(["app.settings", "layout.switch"]);
    for (const c of commands()) {
      if (c.args.some((a) => a.required) || HIDDEN.has(c.name) || covered.has(c.name)) continue;
      const label = readable(c.name);
      items.commands.push({ id: `cmd:${c.name}`, group: "commands", label, sub: "", hay: `${label} ${c.name} ${c.about}`, icon: ICON("square-pen"), hint: hint(c.name), go: go(() => run(c.name)) });
    }
    items.commands.sort((a, b) => a.label.localeCompare(b.label));

    // layouts
    const cur = shared("layout");
    for (const name of layouts()) {
      items.layouts.push({ id: `layout:${name}`, group: "layouts", label: name, sub: name === cur ? "current" : "Switch layout", hay: `${name} layout`, icon: ICON("layers"), go: go(() => run("layout.switch", { name })) });
    }
    this.items = items;
  }

  // ---- the list for the query: rows of headers and items ----
  rank() {
    const raw = this.query;
    const cmdOnly = raw.startsWith(">");
    const q = (cmdOnly ? raw.slice(1) : raw).trim().toLowerCase();
    const I = this.items;
    const rows = [];
    const section = (group, list) => {
      if (!list.length) return;
      rows.push({ kind: "head", label: GROUPS[group] });
      for (const [it, idx] of list) rows.push({ kind: "item", it, idx });
    };
    const plain = (list) => list.map((it) => [it, null]);

    if (cmdOnly) {
      const all = [...I.actions, ...I.commands];
      const list = q ? all.map((it) => ({ it, r: rate(q, it) })).filter((x) => x.r).sort((a, b) => b.r.score - a.r.score).map((x) => [x.it, x.r.idx]) : plain(all);
      section("commands", list.slice(0, 40));
    } else if (!q) {
      section("needs", plain(I.needs).slice(0, 6));
      const here = activeTab();
      const mru = (shared("cmdk.recent") ?? []).filter((id) => id !== here && this.tabItem.has(id));
      const rest = [...this.tabItem.entries()].filter(([id, v]) => id !== here && v.changed && !mru.includes(id)).sort((a, b) => b[1].changed - a[1].changed).map(([id]) => id);
      section("recent", [...mru, ...rest].slice(0, 5).map((id) => [{ ...this.tabItem.get(id).it, id: `recent:${id}` }, null]));
      section("actions", plain(I.actions));
    } else {
      const ranked = (list, cap) => list.map((it) => ({ it, r: rate(q, it) })).filter((x) => x.r).sort((a, b) => b.r.score - a.r.score).slice(0, cap);
      const groups = [
        ["agents", ranked(I.agents, CAP.agents)],
        ["nav", ranked(I.nav, CAP.nav)],
        ["inbox", ranked(I.inbox, CAP.inbox)],
        ["commands", ranked([...I.actions, ...I.commands], CAP.commands)],
        ["layouts", ranked(I.layouts, CAP.layouts)],
      ].filter(([, l]) => l.length);
      // stable: groups with the better top match come first
      groups.map((g, n) => [g, n]).sort((a, b) => b[0][1][0].r.score - a[0][1][0].r.score || a[1] - b[1]).forEach(([[g, l]]) => section(g, l.map((x) => [x.it, x.r.idx])));
    }
    return rows;
  }

  selectable() {
    return this.rows.filter((r) => r.kind === "item");
  }

  go(row) {
    if (row) row.it.go();
  }

  mark(t, st, pill) {
    if (pill) return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child(pill);
    if (st === "working") return svg("mods/tabs-plus/working.svg").size(11).mx(1).flex_none().text_color(t.working);
    if (st === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    if (st === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    if (st === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
    return null;
  }

  icon(t, it) {
    const p = it.program;
    if (p?.icon) return p.tint ? svg(p.icon).size(15).flex_none().text_color(t.muted) : image(p.icon).w(15).h(15).flex_none();
    return svg(it.icon ?? ICON("terminal")).size(15).flex_none().text_color(t.dim);
  }

  render() {
    const t = theme();
    const rows = this.rows;
    const sel = this.selectable();
    this.at = Math.max(0, Math.min(this.at, sel.length - 1));
    const cur = sel[this.at];
    const h = (r) => (r.kind === "head" ? HEAD : ROW);
    const total = rows.length ? rows.reduce((n, r) => n + h(r), 0) : ROW;
    const height = Math.min(LIST_MAX, total);

    // Keep the selected row in view: the first row to draw (this.top) moves only as far as it must.
    const si = Math.max(0, rows.indexOf(cur));
    let top = Math.min(this.top, si);
    if (rows[si - 1]?.kind === "head" && top > si - 1) top = si - 1;
    const fits = (from) => rows.slice(from, si + 1).reduce((n, r) => n + h(r), 0) <= height;
    while (top < si && !fits(top)) top++;
    this.top = top;
    const shown = [];
    let used = 0;
    for (let i = top; i < rows.length && used + h(rows[i]) <= height + 0.5; i++) { shown.push(rows[i]); used += h(rows[i]); }

    const query = this.query.startsWith(">") ? this.query.slice(1).trim() : this.query.trim();

    const row = (r) => {
      if (r.kind === "head") {
        return h_flex().h(HEAD).flex_none().px(10).pb(5).items_end().text_size(11.5).font_medium().text_color(t.dim).child(r.label);
      }
      const it = r.it, on = r === cur;
      const label = r.idx?.length
        ? h_flex().max_w(380).min_w(0).overflow_hidden().whitespace_nowrap().children(runsOf(it.label, r.idx).map(([s, hit]) => div().flex_none().text_color(hit ? t.accent : t.foreground).when(hit, (e) => e.font_semibold()).child(s)))
        : div().max_w(380).min_w(0).truncate().text_color(it.dimmed ? t.muted : t.foreground).child(it.label);
      const mark = this.mark(t, it.mark === "idle" && it.group !== "agents" ? null : it.mark, it.pill);
      return h_flex()
        .id(`ck-${it.id}`)
        .h(ROW).flex_none().px(10).gap(10).items_center().rounded(8).cursor_pointer()
        .when(on, (e) => e.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.go(r))
        .child(this.icon(t, it))
        .child(label)
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(it.current ? [it.sub, "current"].filter(Boolean).join(" · ") : (it.sub ?? "")))
        .when(Boolean(mark), (e) => e.child(mark))
        .when(Boolean(it.hint), (e) => e.child(div().flex_none().text_size(11.5).text_color(t.dim).child(it.hint)));
    };

    const list = rows.length
      ? shown.map(row)
      : [h_flex().h(ROW).px(10).items_center().text_color(t.dim).child(`Nothing matches "${query}"`)];

    return v_flex()
      .id("cmdk")
      .track_focus(this.handle)
      .w_full()
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key, ctrl = e.modifiers.control;
        if (k === "escape") return this.close();
        if (k === "down" || (ctrl && k === "n")) this.at = (this.at + 1) % Math.max(1, sel.length);
        else if (k === "up" || (ctrl && k === "p")) this.at = (this.at + sel.length - 1) % Math.max(1, sel.length);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(
        h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
          .child(svg(ICON("search")).size(15).flex_none().text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(14).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("ck-list")
          .p(6)
          .h(height + 12)
          .overflow_hidden()
          .on_scroll_wheel((e, cx) => {
            // The selection follows the wheel, one row per 30px.
            this.wheel -= e.delta.y;
            const step = Math.trunc(this.wheel / 30);
            if (!step) return;
            this.wheel -= step * 30;
            this.at = Math.max(0, Math.min(this.at + step, sel.length - 1));
            cx.notify();
          })
          .children(list),
      );
  }
}
