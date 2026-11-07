import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, layout, openOverlay, closeOverlay, props, agents, focused, appHome, readTextFile, writeTextFile, watchFolder, notify, playSound, shared, setShared, run, exec } from "herdr";
import * as fs from "fs/promises";
import { Notes, codeMarkdown } from "./blocks.js";

// The Herdr Inbox: what pi agents send the person (herdr-inbox.ts writes one JSON file per
// item), plus agents whose status is blocked. One mod, three views (props.view):
//   side    the sidebar list; a click opens the item in the panel
//   panel   the right panel: list on top, the item below
//   screen  the full work area: list left, the item right
// Answers, read and archive marks are written into the item's own file; the agent's
// extension watches the folder and delivers the answer to its session. Items are grouped by
// thread, with the thread's plan (data/inbox/steps/<thread>.json) in the item header.
// Block comments, action ticks and verify marks all go out with one Send.

const ROOT = () => `${appHome()}/data/inbox`;
const DIR = () => `${ROOT()}/items`;
const STEPS = () => `${ROOT()}/steps`;
const view = () => props()?.view ?? "panel";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function ago(iso) {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return "";
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
const base = (p) => String(p ?? "").split("/").filter(Boolean).pop() ?? "";

// What an item asks of the person now. Withdrawn questions and actions no longer count.
const liveQuestions = (item) => (item.questions ?? []).filter((q) => !q.withdrawn);
const liveActions = (item) => (item.actions ?? []).filter((a) => !a.withdrawn);
function needOf(item) {
  if (item.archived_at) return "archived";
  if (item.kind === "reply") return "reply";
  if (item.answer || item.withdrawn_at) return "done";
  if (item.kind === "verify") return "verify";
  if (liveQuestions(item).length) return "ask";
  if (liveActions(item).length) return "act";
  return item.read_at ? "done" : "update";
}
// Only these ping (toast, sound, the count); updates just badge.
const NEEDS = ["agent", "ask", "act", "verify"];
// Still waiting for a Send: comments may be added and sent.
const isOpen = (item) => !item.answer && !item.archived_at && !item.withdrawn_at && item.kind !== "reply";

// What matters to the person, top to bottom. A stopped question (the agent cannot go on)
// outranks everything; within a level the oldest waiting comes first.
const LEVELS = [
  { id: "stopped", label: "Blocks agent", tag: "Blocks agent" },
  { id: "verify", label: "Verify", tag: "Verify" },
  { id: "ask", label: "Asks", tag: "Asks" },
  { id: "act", label: "To do", tag: "Do" },
  { id: "update", label: "Updates", tag: "Update" },
  { id: "done", label: "Done", tag: "" },
];
function levelOf(row) {
  if (row.need === "agent") return "stopped";
  if (row.need === "ask" && liveQuestions(row).some((q) => q.stopped)) return "stopped";
  return row.need;
}

// Open the inbox where the item can be read: the panel, unless the full screen shows.
function openPanel() {
  const center = find(layout(), "center");
  if (center?.active === "inbox-screen") return;
  run("layout.select", { stack: "panel-body", child: "inbox-panel" });
  run("layout.show", { id: "panel" });
}
export function showScreen(on) {
  run("layout.select", { stack: "center", child: on ? "inbox-screen" : "main" });
  if (on && !find(layout(), "panel")?.hidden && find(layout(), "panel-body")?.active === "inbox-panel") run("layout.hide", { id: "panel" });
}

const STEP_DONE = "mods/workspace-chrome/check.svg";
const newId = () => `ibx_${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0")}`;

export default class Inbox extends View {
  init(_props, cx) {
    // The right-click menu is a popup copy of this mod: it only draws the menu.
    if (props()?.menu) return;
    this.items = [];
    this.sel = new Set();
    this.order = [];
    this.steps = new Map();
    this.files = new Map();
    this.drafts = new Map();
    this.loaded = false;
    this.typing = new Set();
    // Input state cannot be made during render: one set, bound to the shown item (bind()).
    this.note = TextareaState.new({ placeholder: "Add a note (optional)", rows: 2 });
    this.note.set_auto_grow(2, 8);
    this.inputs = Array.from({ length: 12 }, () => InputState.new({ placeholder: "Write your own answer" }));
    this.reply = InputState.new({ placeholder: "Reply to the agent in this thread" });
    this.reply.on("submit", (_e, cx) => this.sendReply(cx));
    this.notes = new Notes();
    this.track(this.note, "note");
    this.track(this.reply, "reply");
    this.track(this.notes.box, "box");
    this.inputs.forEach((input, n) => this.track(input, `in${n}`));
    this.bound = null;
    this.handle = cx.focus_handle();
    this.shown = false;
    this.refresh(cx);
    cx.timer.every(60000, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      try {
        await fs.mkdir(DIR(), { recursive: true }).catch(() => {});
        await fs.mkdir(STEPS(), { recursive: true }).catch(() => {});
        for (;;) {
          await watchFolder(ROOT());
          this.refresh(cx);
        }
      } catch {}
    });
  }

  // While a box has the keyboard, digits and Escape belong to it.
  track(state, name) {
    state.on("focus", () => this.typing.add(name));
    state.on("blur", () => this.typing.delete(name));
  }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const names = (await fs.readdir(DIR()).catch(() => [])).filter((n) => n.endsWith(".json") && !n.startsWith("."));
        const items = [];
        for (const name of names) {
          const text = await readTextFile(`${DIR()}/${name}`).catch(() => null);
          if (!text) continue;
          try { items.push(JSON.parse(text)); } catch {}
        }
        items.sort((a, b) => b.created_at.localeCompare(a.created_at));
        this.items = items;
        const steps = new Map();
        for (const name of (await fs.readdir(STEPS()).catch(() => [])).filter((n) => n.endsWith(".json"))) {
          try {
            const s = JSON.parse((await readTextFile(`${STEPS()}/${name}`).catch(() => null)) ?? "null");
            if (s?.thread && Array.isArray(s.steps)) steps.set(s.thread, s);
          } catch {}
        }
        this.steps = steps;
        for (const item of items) if (isOpen(item)) this.draft(item);
        this.alert();
        this.loaded = true;
      } finally {
        this.loading = false;
        cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  // A toast and a sound for each new item that needs the person, once across every copy
  // of this mod. Updates make neither: they only badge.
  alert() {
    const seen = shared("inbox.alerted");
    const live = this.items.filter((i) => !i.archived_at && !i.answer && !i.read_at && NEEDS.includes(needOf(i)));
    if (!Array.isArray(seen)) { setShared("inbox.alerted", live.map((i) => i.id)); return; }
    const fresh = live.filter((i) => !seen.includes(i.id));
    if (!fresh.length) return;
    setShared("inbox.alerted", [...seen, ...fresh.map((i) => i.id)].slice(-300));
    for (const i of fresh) {
      const need = needOf(i);
      notify({
        title: { ask: `${i.from?.name ?? "Agent"} asks`, act: `${i.from?.name ?? "Agent"} needs you`, verify: "Check this" }[need] ?? i.from?.name ?? "Agent",
        body: liveQuestions(i)[0]?.prompt ?? liveActions(i)[0]?.text ?? i.subject,
        level: i.questions?.some((q) => q.stopped) ? "warning" : "info",
        timeout: 10000,
        action: { name: "layout.select", args: { stack: "center", child: "inbox-screen" } },
      });
    }
    playSound("blocked");
  }

  // The person's answer in progress: picks, texts, actions, verify marks, comments, a note.
  draft(item) {
    if (this.drafts.has(item.id)) return this.drafts.get(item.id);
    const d = { picks: {}, texts: {}, note: "", actions: {}, verify: {}, annotations: [] };
    for (const q of item.questions ?? []) d.picks[q.key] = [];
    this.drafts.set(item.id, d);
    return d;
  }

  // The input boxes show this item's draft; the one they showed keeps its text.
  bind(item) {
    if (this.bound === item.id) return;
    const old = this.items.find((i) => i.id === this.bound), od = old && this.drafts.get(old.id);
    if (od) {
      od.note = this.note.value();
      liveQuestions(old).forEach((q, n) => { od.texts[q.key] = this.inputs[n].value(); });
    }
    const d = this.draft(item);
    this.note.set_value(d.note);
    const live = liveQuestions(item);
    this.inputs.forEach((input, n) => input.set_value(d.texts[live[n]?.key] ?? ""));
    this.notes.edit = null;
    this.bound = item.id;
  }

  async update(id, change) {
    const path = `${DIR()}/${id}.json`;
    const text = await readTextFile(path);
    if (!text) return;
    const item = JSON.parse(text);
    change(item);
    await writeTextFile(path, `${JSON.stringify(item, null, 1)}\n`, text);
  }

  write(cx, id, change) {
    // Optimistic: the row moves at once; the file follows.
    const item = this.items.find((i) => i.id === id);
    if (item) change(item);
    cx.notify();
    cx.spawn(async (cx) => {
      try { await this.update(id, change); }
      catch (e) { notify({ title: "Could not save to the inbox", body: String(e), level: "error" }); }
      this.refresh(cx);
    });
  }

  // One Send: answers, actions, verify marks, comments and the note.
  send(item, cx) {
    const d = this.drafts.get(item.id);
    if (!d) return;
    const here = this.bound === item.id;
    const answers = liveQuestions(item).map((q, n) => {
      const picked = d.picks[q.key] ?? [], text = (here ? this.inputs[n].value() : d.texts[q.key] ?? "").trim();
      return { key: q.key, ...(picked.length ? { picked } : {}), ...(text ? { text } : {}), ...(!picked.length && !text ? { skipped: true } : {}) };
    });
    const actions = liveActions(item).map((a) => ({ key: a.key, done: Boolean(d.actions[a.key]) }));
    const verify = (item.verify?.steps ?? []).filter((s) => d.verify[s.key]?.result).map((s) => ({ key: s.key, result: d.verify[s.key].result, ...(d.verify[s.key].note ? { note: d.verify[s.key].note } : {}) }));
    const annotations = d.annotations.map((n) => ({ ...n }));
    const note = (here ? this.note.value() : d.note).trim();
    const at = new Date().toISOString();
    this.write(cx, item.id, (i) => {
      i.answer = {
        at,
        ...(answers.length ? { answers } : {}),
        ...(actions.length ? { actions } : {}),
        ...(verify.length ? { verify } : {}),
        ...(annotations.length ? { annotations } : {}),
        ...(note ? { note } : {}),
      };
      i.state = "answered";
      i.read_at ??= at;
    });
  }

  // A free-text reply in the item's thread: a new item the agent's extension delivers like an answer.
  sendReply(cx) {
    const item = this.current, text = this.reply.value().trim();
    if (!item?.from?.session || !text) return;
    const at = new Date().toISOString(), id = newId();
    const reply = { v: 1, id, kind: "reply", created_at: at, from: item.from, subject: `Reply: ${text.slice(0, 60)}`, thread: item.thread, body: text, questions: [], reply_to: item.id, author: "person", state: "answered", read_at: at, answer: { at, note: text } };
    this.items.unshift(reply);
    this.reply.set_value("");
    cx.notify();
    cx.spawn(async (cx) => {
      try { await writeTextFile(`${DIR()}/${id}.json`, `${JSON.stringify(reply, null, 1)}\n`, null); }
      catch (e) { notify({ title: "Could not send the reply", body: String(e), level: "error" }); }
      this.refresh(cx);
    });
  }

  select(id, cx) {
    setShared("inbox.selected", id);
    const item = this.items.find((i) => i.id === id);
    if (item && !item.read_at && needOf(item) === "update") this.write(cx, id, (i) => { i.read_at = new Date().toISOString(); });
    cx.notify();
  }

  // Click: one item; cmd-click toggles; shift-click spans from the anchor.
  click(id, e, cx) {
    const mods = e?.modifiers ?? {};
    if (mods.platform) {
      if (this.sel.has(id) && this.sel.size > 1) this.sel.delete(id); else this.sel.add(id);
      this.anchor = id;
    } else if (mods.shift && this.anchor && this.order.includes(this.anchor)) {
      const a = this.order.indexOf(this.anchor), b = this.order.indexOf(id);
      this.sel = new Set(this.order.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else { this.sel = new Set([id]); this.anchor = id; }
    this.select(id, cx);
  }

  // The ids an action applies to: the selection when it holds the row, else the row.
  targets(id) { return this.sel.has(id) ? [...this.sel] : [id]; }

  archive(ids, cx, on = true) {
    const gone = new Set(ids), cursor = shared("inbox.selected");
    if (on && gone.has(cursor)) {
      const at = this.order.indexOf(cursor);
      const next = [...this.order.slice(at + 1), ...this.order.slice(0, at).reverse()].find((i) => !gone.has(i) && !i.startsWith("agent:"));
      this.sel = new Set(next ? [next] : []);
      setShared("inbox.selected", next ?? null);
    }
    const at = new Date().toISOString();
    for (const id of ids) this.write(cx, id, (i) => { i.archived_at = on ? at : null; });
  }

  move(step, cx) {
    const ids = this.order.filter((i) => !i.startsWith("agent:")), cur = ids.indexOf(shared("inbox.selected"));
    const next = ids[Math.max(0, Math.min(ids.length - 1, cur < 0 ? 0 : cur + step))];
    if (!next) return;
    this.sel = new Set([next]); this.anchor = next;
    this.select(next, cx);
  }

  // The right-click menu, in its own popup.
  openMenu(r) {
    const ids = this.targets(r.id), items = ids.map((id) => this.items.find((i) => i.id === id)).filter(Boolean);
    openOverlay({ mod: "inbox-plus", kind: "popup", width: 210, height: 170, props: { menu: { ids, terminal: ids.length === 1 ? r.from?.terminal : null, thread: ids.length === 1 ? r.thread : null, unread: items.every((i) => i.read_at) } } });
  }

  menuView(t) {
    const { ids, terminal, thread, unread } = props().menu, overlay = props().overlay;
    const edit = (change) => {
      closeOverlay(overlay);
      for (const id of ids) this.update(id, change).catch((e) => notify({ title: "Could not save to the inbox", body: String(e), level: "error" }));
    };
    const item = (id, label, hint, action) => h_flex().id(id).h(30).px(10).gap(8).rounded(7).items_center().text_size(13).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(action).child(div().flex_1().child(label)).child(div().text_size(11.5).text_color(t.dim).child(hint ?? ""));
    const now = () => new Date().toISOString();
    return v_flex().w_full().p(5).bg(t.popover)
      .child(item("m-archive", ids.length > 1 ? `Archive ${ids.length} items` : "Archive", "a", () => edit((i) => { i.archived_at = now(); })))
      .child(item("m-read", unread ? "Mark unread" : "Mark read", "", () => edit((i) => { i.read_at = unread ? null : (i.read_at ?? now()); })))
      .when(Boolean(terminal), (e) => e.child(item("m-goto", "Go to agent", "", () => { closeOverlay(overlay); run("pane.focus", { terminal }); })))
      .when(Boolean(thread), (e) => e.child(item("m-thread", "Open thread", "", () => { closeOverlay(overlay); setShared("inbox.thread", thread); })));
  }

  // Every row: blocked agents, then items (replies are shown inside their item).
  rows() {
    const asked = new Set(this.items.filter((i) => needOf(i) === "ask").map((i) => i.from?.terminal));
    const blocked = agents().filter((a) => a.status === "blocked" && !asked.has(a.address))
      .map((a) => ({ id: `agent:${a.address}`, agent: a, need: "agent", subject: a.title || "Waits for you", created_at: null, thread: "Blocked agents" }));
    return [...blocked, ...this.items.map((i) => ({ ...i, need: needOf(i) })).filter((r) => r.need !== "archived" && r.need !== "reply")];
  }

  // Rows by level (LEVELS order); within a level the oldest waiting first, done newest first.
  levels() {
    const thread = shared("inbox.thread");
    const rows = this.rows().filter((r) => !thread || r.thread === thread).map((r) => ({ ...r, level: levelOf(r) }));
    const keep = new Set(rows.filter((r) => r.level === "done").sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 40).map((r) => r.id));
    return LEVELS.map((l) => {
      const list = rows.filter((r) => r.level === l.id && (l.id !== "done" || keep.has(r.id)));
      list.sort((a, b) => (l.id === "done" ? -1 : 1) * (a.created_at ?? "").localeCompare(b.created_at ?? ""));
      return { ...l, rows: list };
    }).filter((l) => l.rows.length);
  }

  who(row) {
    if (row.agent) return { name: row.agent.space_name || row.agent.program?.name || "Agent", program: row.agent.program };
    const a = agents().find((x) => x.address === row.from?.terminal);
    return { name: row.from?.name || a?.space_name || base(row.from?.root) || "Agent", program: a?.program, live: a, place: base(row.from?.root) || base(row.from?.cwd) };
  }

  badge(t, need, compact) {
    const spec = { agent: ["Blocked", t.blocked], ask: ["Asks", t.blocked], act: ["To do", t.blocked], verify: ["Verify", t.blocked], update: ["New", t.accent] }[need];
    if (!spec) return null;
    if (compact) return div().size(7).flex_none().rounded(4).bg(need === "update" ? t.dim : spec[1]);
    return div().flex_none().px(8).h(20).rounded_full().bg(spec[1] + (need === "update" ? "18" : "22")).text_size(11).font_medium().text_color(need === "update" ? t.muted : spec[1]).flex().items_center().child(spec[0]);
  }

  icon(t, who, size = 16) {
    const p = who.program;
    if (p?.icon) return p.tint ? svg(p.icon).size(size).flex_none().text_color(t.muted) : image(p.icon).size(size).flex_none();
    return div().size(size).flex_none().rounded(4).bg(t.raised).text_size(9).text_color(t.muted).flex().items_center().justify_center().child((who.name[0] ?? "?").toUpperCase());
  }

  row(t, r, selected, cx, compact) {
    const who = this.who(r), urgent = r.level === "stopped";
    const unread = r.need !== "done";
    const lead = liveQuestions(r)[0]?.prompt ?? liveActions(r)[0]?.text ?? r.verify?.steps?.[0]?.text;
    const tag = LEVELS.find((l) => l.id === r.level)?.tag;
    return h_flex().id(`row-${r.id}`).px(10).gap(9).flex_none().rounded(8).cursor_pointer()
      .h(compact ? 30 : 46).items_center()
      .when(selected, (e) => e.bg(t.selected))
      .hover((s) => s.bg(selected ? t.selected : t.hover))
      .on_click((e, cx) => {
        if (r.agent) { run("pane.focus", { pane: r.agent.pane }); return; }
        if (compact) this.select(r.id, cx); else this.click(r.id, e, cx);
        if (view() === "side") openPanel();
      })
      .on_mouse_down("right", (_e, cx) => { if (r.agent) return; cx.stop_propagation(); if (!this.sel.has(r.id)) { this.sel = new Set([r.id]); this.anchor = r.id; this.select(r.id, cx); } this.openMenu(r); })
      .child(this.icon(t, who, compact ? 15 : 18))
      .child(compact
        ? div().flex_1().min_w(0).truncate().text_color(unread ? t.foreground : t.muted).child(r.subject)
        : v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_size(13).font_medium().text_color(unread ? t.foreground : t.muted).child(r.subject))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child([who.name, r.thread && r.thread !== who.name ? r.thread : null, lead].filter(Boolean).join(" · "))))
      .child(compact ? this.badge(t, r.need, true) ?? div()
        : div().flex_none().text_size(11).text_color(urgent ? t.blocked : t.dim).child(tag ?? ""))
      .when(Boolean(r.created_at), (e) => e.child(div().flex_none().w(compact ? 26 : 30).text_right().text_size(11).text_color(t.dim).child(ago(r.created_at))));
  }

  list(t, cx, sel = shared("inbox.selected")) {
    this.order = this.levels().flatMap((g) => g.rows.map((r) => r.id));
    if (sel && !this.sel.has(sel) && this.sel.size <= 1) this.sel = new Set([sel]);
    return this.levels().flatMap((g) => [
      h_flex().id(`grp-${g.id}`).px(8).pt(12).pb(4).flex_none().gap(6).items_center().text_size(11.5).font_medium()
        .child(div().min_w(0).truncate().text_color(g.id === "stopped" ? t.blocked : g.id === "done" || g.id === "update" ? t.dim : t.foreground).child(g.label))
        .child(div().flex_none().text_color(t.dim).child(String(g.rows.length)))
        .child(div().flex_1())
        .when(g.id === "update" || g.id === "done", (e) => e.child(div().id(`arch-${g.id}`).px(6).h(18).flex().items_center().rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.archive(g.rows.map((r) => r.id), cx)).child("Archive all"))),
      ...g.rows.map((r) => this.row(t, r, this.sel.has(r.id) || r.id === sel, cx, false)),
    ]);
  }

  // The thread's plan: one chip per step.
  stepsStrip(t, thread) {
    const steps = this.steps.get(thread)?.steps;
    if (!steps?.length) return null;
    const mark = (s) => s.status === "done" ? svg(STEP_DONE).size(11).flex_none().text_color(t.done)
      : s.status === "doing" ? div().size(7).flex_none().rounded(4).bg(t.accent)
      : s.status === "waiting" ? div().size(7).flex_none().rounded(4).bg(t.blocked)
      : div().size(7).flex_none().rounded(4).border_1().border_color(t.input);
    return h_flex().flex_wrap().gap_x(14).gap_y(4).pt(2)
      .children(steps.map((s) => h_flex().gap(6).items_center().text_size(12)
        .text_color(s.status === "doing" ? t.foreground : s.status === "done" ? t.dim : t.muted)
        .child(mark(s)).child(div().child(s.title))));
  }

  // The attached file's text, read once.
  fileText(path, cx) {
    if (this.files.has(path)) return this.files.get(path);
    this.files.set(path, undefined);
    cx.spawn(async (cx) => {
      this.files.set(path, (await readTextFile(path).catch(() => null)) ?? null);
      cx.notify();
    });
    return undefined;
  }

  // A render error shows in place of the item, and is kept in data/inbox/error.log.
  detail(t, item, cx) {
    try { return this.detailOf(t, item, cx); }
    catch (e) {
      const text = `${e?.stack ?? e}`;
      readTextFile(`${ROOT()}/error.log`).catch(() => null).then((old) => writeTextFile(`${ROOT()}/error.log`, text, old ?? null)).catch(() => {});
      return div().p(16).text_size(12).text_color(t.blocked).child(text);
    }
  }

  // One item in full: the message, then what it asks, then the answer. Reply box below.
  detailOf(t, item, cx) {
    if (!item) return v_flex().flex_1().items_center().justify_center().gap(6).text_color(t.dim)
      .child(svg("mods/inbox-plus/inbox.svg").size(22).text_color(t.dim))
      .child(div().text_size(13).child(this.items.length ? "Select an item" : "Nothing yet. Agents' questions show up here."));
    this.current = item;
    const who = this.who(item), open = isOpen(item);
    if (open) this.bind(item);
    const d = open ? this.drafts.get(item.id) : null;
    const locked = !open;
    const annotations = open ? d.annotations : item.answer?.annotations ?? [];
    const button = (id, label, primary, action, enabled = true) => div().id(id).h(30).px(14).flex().items_center().rounded_full().text_size(12.5).font_medium()
      .when(primary, (e) => e.bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim))
      .when(!primary, (e) => e.border_1().border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover)))
      .when(enabled, (e) => e.cursor_pointer().on_click(action)).child(label);
    const replyTo = item.reply_to && this.items.find((i) => i.id === item.reply_to);
    const header = v_flex().gap(6).pb(12).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(17).font_semibold().child(item.subject))
        .when(Boolean(item.from?.terminal), (e) => e.child(button("goto", "Go to agent", false, () => run("pane.focus", { terminal: item.from.terminal }))))
        .child(div().id("archive").size(30).flex_none().flex().items_center().justify_center().rounded_full().text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(item.archived_at ? "Unarchive" : "Archive")
          .on_click((_e, cx) => this.write(cx, item.id, (i) => { i.archived_at = i.archived_at ? null : new Date().toISOString(); }))
          .child(svg("mods/workspace-chrome/archive.svg").size(15))))
      .child(h_flex().gap(6).items_center().text_size(12).text_color(t.dim)
        .child(this.icon(t, who, 14)).child(div().text_color(t.muted).child(who.name))
        .when(Boolean(item.from?.branch), (e) => e.child(svg("mods/workspace-chrome/git-branch.svg").size(12)).child(div().child(item.from.branch)))
        .child(div().child(`· ${ago(item.created_at) === "now" ? "just now" : `${ago(item.created_at)} ago`}`))
        .when(Boolean(item.thread), (e) => e.child(div().min_w(0).truncate().child(`· ${item.thread}`))))
      .when(Boolean(this.stepsStrip(t, item.thread)), (e) => e.child(this.stepsStrip(t, item.thread)))
      .when(Boolean(replyTo), (e) => e.child(h_flex().id("reply-to").gap(6).items_center().text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => this.select(replyTo.id, cx)).child(div().child("In reply to")).child(div().min_w(0).truncate().text_color(t.muted).child(replyTo.subject))));

    const body = item.body ? this.notes.view(t, cx, { id: `body-${item.id}`, target: "body", md: item.body, list: annotations, locked }) : null;
    const attachments = (item.attachments ?? []).map((path, k) => this.attachment(t, item, path, k, annotations, locked, cx));
    const live = liveQuestions(item);
    const withdrawn = (item.questions ?? []).filter((q) => q.withdrawn);
    const questions = live.map((q, n) => this.question(t, item, q, n, d, open, cx));
    const actions = liveActions(item).length ? this.actionsCard(t, item, d, open) : null;
    const verify = item.verify ? this.verifyCard(t, item, d, open) : null;
    const answered = item.answer ? this.answered(t, item) : null;
    const replies = this.items.filter((i) => i.kind === "reply" && i.reply_to === item.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const noteBox = open ? div().w_full().min_h(52).px(12).py(9).rounded(12).border_1().border_color(t.border).bg(t.background).text_size(13).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Textarea.new(this.note).w_full()) : null;

    // The pinned bar: what the Send will carry, and the buttons.
    const parts = open ? this.summary(item, d) : [];
    const bar = open ? h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(parts.join(" · ")))
      .child(button("send", "Send", true, (_e, cx) => this.send(item, cx), parts.length > 0 || NEEDS.includes(needOf(item)))) : null;
    const replyRow = item.from?.session ? h_flex().gap(8).items_center()
      .child(div().h(32).flex_1().min_w(0).px(14).flex().items_center().rounded_full().border_1().border_color(t.border).bg(t.background).text_size(13)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.reply).w_full()))
      .child(button("reply", "Reply", false, (_e, cx) => this.sendReply(cx))) : null;

    return v_flex().size_full().flex_1().min_w(0).min_h(0).overflow_hidden()
      .child(v_flex().id(`detail-${item.id}`).w_full().flex_1().min_h(0).items_center().overflow_y_scrollbar()
        .child(v_flex().w_full().max_w(760).px(24).py(16).gap(12)
          .child(header)
          .when(Boolean(body), (e) => e.child(body))
          .children(attachments)
          .children(questions)
          .when(withdrawn.length > 0, (e) => e.child(v_flex().gap(2).children(withdrawn.map((q) => div().text_size(12).text_color(t.dim).line_through().child(q.prompt)))))
          .when(Boolean(actions), (e) => e.child(actions))
          .when(Boolean(verify), (e) => e.child(verify))
          .when(Boolean(answered), (e) => e.child(answered))
          .children(replies.map((r) => h_flex().gap(8).px(14).py(8).rounded(10).bg(t.raised).text_size(13)
            .child(div().flex_none().text_size(12).text_color(t.dim).child(`You · ${ago(r.created_at)}`)).child(div().flex_1().min_w(0).child(r.body))))
          .when(open, (e) => e.child(noteBox))))
      .when(open || Boolean(replyRow), (e) => e.child(v_flex().w_full().flex_none().items_center().border_t(1).border_color(t.border)
        .child(v_flex().w_full().max_w(760).px(24).py(10).gap(8).when(open, (c) => c.child(bar)).when(Boolean(replyRow), (c) => c.child(replyRow)))));
  }

  // What the Send will carry.
  summary(item, d) {
    const parts = [];
    const live = liveQuestions(item);
    const answered = live.filter((q, n) => (d.picks[q.key] ?? []).length || (this.bound === item.id ? this.inputs[n].value().trim() : (d.texts[q.key] ?? "").trim())).length;
    if (live.length) parts.push(`${answered} of ${live.length} answered`);
    const acts = liveActions(item);
    if (acts.length) parts.push(`${acts.filter((a) => d.actions[a.key]).length} of ${acts.length} done`);
    const steps = item.verify?.steps ?? [];
    if (steps.length) parts.push(`${steps.filter((s) => d.verify[s.key]?.result).length} of ${steps.length} checked`);
    if (d.annotations.length) parts.push(`${d.annotations.length} ${d.annotations.length === 1 ? "comment" : "comments"}`);
    return parts;
  }

  attachment(t, item, path, k, annotations, locked, cx) {
    const text = this.fileText(path, cx), md = /\.(md|markdown|mdx)$/i.test(path), id = `att-${item.id}-${k}`, target = `file:${path}`;
    const code = text && !md ? codeMarkdown(path, text) : null;
    return v_flex().flex_none().rounded(10).border_1().border_color(t.border).overflow_hidden()
      .child(h_flex().h(34).px(12).gap(8).items_center().bg(t.surface).border_b(1).border_color(t.border)
        .child(svg("mods/workspace-chrome/file-text.svg").size(13).text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().child(base(path)))
        .child(div().flex_none().max_w(260).truncate().text_size(11).text_color(t.dim).child(path.replace(/^\/Users\/[^/]+/, "~"))))
      .child(v_flex().w_full().min_w(0).p(12).gap(2)
        .when(text === undefined, (e) => e.child(div().text_size(12).text_color(t.dim).child("Loading…")))
        .when(text === null, (e) => e.child(div().text_size(12).text_color(t.dim).child("Cannot read this file")))
        .when(Boolean(text) && md, (e) => e.child(this.notes.view(t, cx, { id, target, md: text, list: annotations, locked, size: 13 })))
        .when(Boolean(code), (e) => e.child(this.notes.view(t, cx, { id, target, md: code?.md ?? "", list: annotations, locked, size: 13 })))
        .when(Boolean(code?.more), (e) => e.child(div().pt(6).text_size(11.5).text_color(t.dim).child(`${code.more} more lines not shown`))));
  }

  question(t, item, q, n, d, open, cx) {
    const picks = d?.picks[q.key] ?? [];
    const answer = item.answer?.answers?.find((a) => a.key === q.key);
    const chosen = open ? picks : answer?.picked ?? [];
    const choice = (c, i) => {
      const on = chosen.includes(c.label);
      return h_flex().id(`c-${q.key}-${i}`).px(12).py(8).gap(10).rounded(10).items_center().text_size(13)
        .border_1().border_color(on ? t.accent : t.border).when(on, (e) => e.bg(t.accent + "14"))
        .when(open, (e) => e.cursor_pointer().hover((s) => s.bg(on ? t.accent + "1f" : t.hover)).on_click((_e, cx) => {
          d.picks[q.key] = q.kind === "multi" ? (on ? picks.filter((p) => p !== c.label) : [...picks, c.label]) : on ? [] : [c.label];
          cx.notify();
        }))
        .child(div().size(15).flex_none().rounded(q.kind === "multi" ? 4 : 8).border_1().border_color(on ? t.accent : t.input).when(on, (e) => e.bg(t.accent))
          .flex().items_center().justify_center().when(on, (e) => e.child(svg("mods/workspace-chrome/check.svg").size(11).text_color(t.accent_foreground))))
        .child(div().flex_1().min_w(0).child(c.label))
        .when(q.recommended === c.label, (e) => e.child(div().flex_none().text_size(11).text_color(t.accent).child("Recommended")))
        .when(open && i < 9, (e) => e.child(div().flex_none().w(14).text_right().text_size(11).text_color(t.dim).child(String(i + 1))));
    };
    return v_flex().p(14).gap(10).rounded(10).bg(t.surface).border_1().border_color(q.stopped && open ? t.blocked + "88" : t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(11).font_medium().text_color(t.dim).child(`Question ${n + 1}`))
        .when(Boolean(q.stopped), (e) => e.child(div().px(8).h(18).rounded_full().bg(t.blocked + "22").text_size(10.5).text_color(t.blocked).flex().items_center().child("Agent stopped"))))
      .child(div().text_size(14).font_semibold().child(q.prompt))
      .when(Boolean(q.context), (e) => e.child(TextView.markdown(`ctx-${item.id}-${q.key}`, q.context).selectable(true).text_size(12.5).text_color(t.muted)))
      .children((q.choices ?? []).map(choice))
      .when(open && Boolean(d), (e) => e.child(div().h(34).px(14).flex().items_center().rounded_full().border_1().border_color(t.border).bg(t.background).text_size(13)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.inputs[n]).w_full())))
      .when(!open && Boolean(answer?.text), (e) => e.child(div().px(10).py(7).rounded(6).bg(t.raised).text_size(13).child(answer.text)))
      .when(!open && Boolean(answer?.skipped), (e) => e.child(div().text_size(12).text_color(t.dim).child("Skipped")));
  }

  // Something only the person can do: a checkbox each.
  actionsCard(t, item, d, open) {
    const done = (a) => (open ? Boolean(d.actions[a.key]) : Boolean(item.answer?.actions?.find((x) => x.key === a.key)?.done));
    return v_flex().p(14).gap(8).rounded(10).bg(t.surface).border_1().border_color(t.border)
      .child(div().text_size(11).font_medium().text_color(t.dim).child("For you to do"))
      .children(liveActions(item).map((a) => h_flex().id(`act-${a.key}`).gap(10).items_start().py(2)
        .when(open, (e) => e.cursor_pointer().on_click((_e, cx) => { d.actions[a.key] = !d.actions[a.key]; cx.notify(); }))
        .child(div().size(16).mt(1).flex_none().rounded(4).border_1().border_color(done(a) ? t.accent : t.input).when(done(a), (e) => e.bg(t.accent))
          .flex().items_center().justify_center().when(done(a), (e) => e.child(svg("mods/workspace-chrome/check.svg").size(11).text_color(t.accent_foreground))))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(13.5).text_color(done(a) ? t.muted : t.foreground).child(a.text))
          .when(Boolean(a.detail), (e) => e.child(div().text_size(12.5).text_color(t.muted).child(a.detail))))));
  }

  // Steps to check in a running app: pass or fail each, a note on a fail.
  verifyCard(t, item, d, open) {
    const v = item.verify, marks = open ? d.verify : Object.fromEntries((item.answer?.verify ?? []).map((r) => [r.key, r]));
    const pill = (id, label, color, on, action) => div().id(id).h(24).px(11).flex().items_center().rounded_full().text_size(12).font_medium()
      .border_1().border_color(on ? color : t.border).when(on, (e) => e.bg(color + "22").text_color(color)).when(!on, (e) => e.text_color(t.muted))
      .when(open, (e) => e.cursor_pointer().hover((s) => s.bg(on ? color + "30" : t.hover)).on_click(action)).child(label);
    return v_flex().p(14).gap(8).rounded(10).bg(t.surface).border_1().border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(11).font_medium().text_color(t.dim).child("Verify"))
        .when(Boolean(v.url), (e) => e.child(div().id("verify-url").min_w(0).truncate().text_size(12.5).text_color(t.accent).cursor_pointer().hover((s) => s.underline())
          .on_click(() => exec("open", [v.url])).child(v.url))))
      .children(v.steps.map((s, n) => {
        const m = marks[s.key], key = `v:${item.id}:${s.key}`;
        const set = (result) => (_e, cx) => {
          if (m?.result === result) delete d.verify[s.key]; else d.verify[s.key] = { result, note: result === "fail" ? m?.note : undefined };
          if (result === "fail" && m?.result !== "fail") this.notes.open(key, "", cx); else cx.notify();
        };
        return v_flex().gap(6).py(4).when(n > 0, (e) => e.border_t(1).border_color(t.border))
          .child(h_flex().gap(10).items_start()
            .child(div().w(16).flex_none().text_size(12).text_color(t.dim).child(String(n + 1)))
            .child(div().flex_1().min_w(0).text_size(13.5).child(s.text))
            .child(h_flex().flex_none().gap(6)
              .child(pill(`pass-${s.key}`, "Pass", t.done, m?.result === "pass", set("pass")))
              .child(pill(`fail-${s.key}`, "Fail", t.ansi1, m?.result === "fail", set("fail")))))
          .when(m?.result === "fail" && this.notes.edit !== key && Boolean(m?.note), (e) => e.child(div().id(`vn-${key}`).ml(26).px(10).py(6).rounded(8).bg(t.ansi1 + "12").text_size(12.5)
            .when(open, (c) => c.cursor_pointer().on_click((_e, cx) => this.notes.open(key, m.note, cx))).child(m.note)))
          .when(this.notes.edit === key, (e) => e.child(div().ml(26).child(this.notes.editor(t, (text, cx) => { if (d.verify[s.key]) d.verify[s.key].note = text || undefined; this.notes.close(cx); }, "Save note"))));
      }));
  }

  answered(t, item) {
    const a = item.answer;
    return v_flex().gap(6).px(14).py(10).rounded(10).bg(t.raised)
      .child(h_flex().gap(8).items_center().text_size(12).text_color(t.dim)
        .child(svg("mods/workspace-chrome/circle-check.svg").size(14).text_color(t.done))
        .child(div().child(ago(a.at) === "now" ? "You answered just now" : `You answered ${ago(a.at)} ago`)))
      .when(Boolean(a.note), (e) => e.child(div().text_size(13).child(a.note)));
  }

  // Shown: the screen is the stack's child, or the panel holds the inbox and is open.
  isShown() {
    const root = layout();
    if (view() === "screen") return find(root, "center")?.active === "inbox-screen";
    return !find(root, "panel")?.hidden && find(root, "panel-body")?.active === "inbox-panel";
  }

  // Escape closes it, and the keyboard goes back to the terminal.
  close() {
    if (view() === "screen") showScreen(false);
    else run("layout.hide", { id: "panel" });
    const pane = focused()?.pane;
    if (pane) run("pane.focus", { pane });
  }

  onKey(e, cx) {
    // In a box, Escape leaves the box first.
    if (e.key === "escape" && (this.notes.pop || this.notes.armed)) { this.notes.close(cx); this.handle.focus(); cx.stop_propagation(); return; }
    if (e.key === "escape" && this.typing.size) { this.typing.clear(); this.handle.focus(); cx.stop_propagation(); cx.notify(); return; }
    if (e.key === "escape") { cx.stop_propagation(); this.close(); return; }
    if (this.typing.size) return;
    const k = e.key, mods = e.modifiers ?? {};
    if (k === "a" && mods.platform) {
      cx.stop_propagation();
      const group = this.levels().find((g) => g.rows.some((r) => r.id === shared("inbox.selected"))) ?? this.levels()[0];
      this.sel = new Set(group?.rows.filter((r) => !r.agent).map((r) => r.id)); cx.notify();
    } else if (k === "a" && !mods.control && !mods.alt) {
      const ids = [...this.sel].filter((i) => !i.startsWith("agent:"));
      if (ids.length) this.archive(ids, cx);
    } else if (k === "j" || k === "down") { cx.stop_propagation(); this.move(1, cx); }
    else if (k === "k" || k === "up") { cx.stop_propagation(); this.move(-1, cx); }
    else if (k === "enter") { const item = this.items.find((i) => i.id === shared("inbox.selected")); if (item && isOpen(item)) this.note.focus(); }
    else this.keyPick(e, cx);
  }

  keyPick(e, cx) {
    const item = this.items.find((i) => i.id === shared("inbox.selected"));
    if (!item || needOf(item) !== "ask") return;
    const live = liveQuestions(item), d = this.drafts.get(item.id);
    const q = live.find((q) => q.kind !== "text" && !(d.picks[q.key] ?? []).length) ?? live[0];
    const n = Number(e.key);
    if (!q || !(n >= 1 && n <= (q.choices?.length ?? 0))) return;
    const label = q.choices[n - 1].label, picks = d.picks[q.key];
    d.picks[q.key] = q.kind === "multi" ? (picks.includes(label) ? picks.filter((p) => p !== label) : [...picks, label]) : [label];
    cx.notify();
  }

  render(cx) {
    if (props()?.menu) return this.menuView(theme());
    const t = theme();
    const v = view();
    const rows = this.rows();
    const needs = rows.filter((r) => NEEDS.includes(r.need)).length;
    const updates = rows.filter((r) => r.need === "update").length;
    // The tab bar's Inbox button shows the counts.
    if (this.loaded && shared("inbox.needs") !== needs) setShared("inbox.needs", needs);
    if (this.loaded && shared("inbox.updates") !== updates) setShared("inbox.updates", updates);
    const pill = (n, color) => div().min_w(18).h(18).px(6).flex_none().rounded_full().bg(color + "24").text_size(11).font_semibold().text_color(color).flex().items_center().justify_center().child(String(n));
    const count = needs ? pill(needs, t.blocked) : null;
    const fresh = updates ? pill(updates, t.muted) : null;
    const iconButton = (id, icon, tip, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded_full().text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(action).child(svg(icon).size(14));

    if (v === "side") {
      if (narrow()) {
        return v_flex().size_full().bg(t.chrome).items_center().pt(10)
          .child(div().id("inbox-rail").size(26).rounded(6).flex().items_center().justify_center().cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click(() => showScreen(true))
            .child(needs ? div().text_size(11).font_semibold().text_color(t.blocked).child(String(needs)) : svg("mods/inbox-plus/inbox.svg").size(14).text_color(t.dim)));
      }
      const shown = this.levels().filter((g) => g.id !== "done").flatMap((g) => g.rows).slice(0, 12);
      return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
        .child(h_flex().px(16).h(36).pt(10).flex_none().items_center().gap(6)
          .child(div().id("inbox-title").text_size(11.5).font_medium().text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => showScreen(true)).child("Inbox"))
          .when(Boolean(count), (e) => e.child(count))
          .when(Boolean(fresh), (e) => e.child(fresh))
          .child(div().flex_1())
          .child(iconButton("inbox-expand", "mods/inbox-plus/inbox.svg", "Open the inbox", () => showScreen(true))))
        .when(this.loaded && !shown.length, (e) => e.child(div().px(16).py(4).text_size(12).text_color(t.dim).child("Nothing waits on you")))
        .child(v_flex().id("inbox-side").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar().children(shown.map((r) => this.row(t, r, false, cx, true))));
    }

    // With nothing picked, the screen opens on the most urgent item.
    const first = this.levels().flatMap((g) => g.rows).find((r) => !r.agent);
    const selected = this.items.find((i) => i.id === shared("inbox.selected")) ?? (v === "screen" ? this.items.find((i) => i.id === first?.id) : undefined);
    const header = h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(13).font_semibold().child("Inbox"))
      .when(Boolean(count), (e) => e.child(count))
      .when(Boolean(fresh), (e) => e.child(fresh))
      .when(Boolean(shared("inbox.thread")), (e) => e.child(h_flex().id("thread-chip").h(20).pl(8).pr(5).gap(4).min_w(0).items_center().rounded_full().bg(t.raised).text_size(11.5).text_color(t.muted).cursor_pointer()
        .hover((s) => s.text_color(t.foreground)).tooltip("Show every thread").on_click(() => setShared("inbox.thread", null))
        .child(div().min_w(0).truncate().child(shared("inbox.thread"))).child(svg("mods/workspace-chrome/x.svg").size(10))))
      .child(div().flex_1())
      .child(v === "screen"
        ? iconButton("inbox-close", "mods/workspace-chrome/x.svg", "Back to the terminals", () => showScreen(false))
        : iconButton("inbox-full", "mods/workspace-chrome/panel-right.svg", "Full screen", () => showScreen(true)));
    const list = v_flex().id(`inbox-list-${v}`).min_h(0).px(6).pb(8).overflow_y_scrollbar().children(this.list(t, cx, selected?.id));
    // Opening takes the keyboard, so Escape reaches it.
    const shown = this.isShown();
    // Focus may not move during render: a task does it right after.
    if (shown && !this.shown) cx.spawn(async () => this.handle.focus());
    this.shown = shown;
    const frame = v_flex().id("inbox").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_mouse_down("left", () => this.handle.focus())
      .on_key_down((e, cx) => this.onKey(e, cx));
    if (!this.loaded) return frame;
    if (v === "screen") {
      return frame.child(header).child(h_flex().flex_1().min_h(0)
        .child(list.w(360).flex_none().h_full().border_r(1).border_color(t.border))
        .child(this.detail(t, selected, cx)));
    }
    return frame.child(header)
      .child(list.flex_none().max_h(selected ? 260 : 10000).border_b(selected ? 1 : 0).border_color(t.border))
      .when(Boolean(selected), (e) => e.child(this.detail(t, selected, cx)));
  }
}
