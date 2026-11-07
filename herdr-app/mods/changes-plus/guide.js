import { div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, Scrollbar, v_virtual_list } from "gpui-base";
import { Notes } from "./blocks.js";
import { appHome, readTextFile, writeTextFile, shared, settings, notify } from "herdr";

// A guided review an agent sent with inbox_guide (herdr-inbox.ts), as one long page:
// the intent, then every chapter in the agent's order with its overview and the files
// it covers, diffed from the patch stored beside the item. Each chapter takes a comment;
// the verdict at the bottom sends them, and the agent's extension delivers it.
// Chapter overviews take block comments (blocks.js); a diff line takes a comment by a
// click on its number, shown under that file's diff. All go out with the verdict.

const DIR = () => `${appHome()}/data/inbox/items`;
const ROW = 20;
// A file's diff scrolls in a box at most this tall: only its visible rows are built,
// so a long review costs no more per frame than a short one.
const DIFF_MAX = 480;
const CHAPTERS_MAX = 11;

// The patch as { file: { lines, add, del } }, hunks only.
export function parsePatch(patch) {
  const files = {};
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    const lines = chunk.replace(/\n$/, "").split("\n");
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(lines[0] ?? "");
    if (!head) continue;
    const plus = lines.find((l) => l.startsWith("+++ "));
    const minus = lines.find((l) => l.startsWith("--- "));
    const path = plus && plus !== "+++ /dev/null" ? plus.slice(6) : minus && minus !== "--- /dev/null" ? minus.slice(6) : head[2];
    const first = lines.findIndex((l) => l.startsWith("@@"));
    const body = first < 0 ? [] : lines.slice(first);
    files[path] = {
      lines: body,
      add: body.filter((l) => l.startsWith("+")).length,
      del: body.filter((l) => l.startsWith("-")).length,
      binary: lines.some((l) => l.startsWith("Binary files")),
    };
  }
  return files;
}

export const guideRef = () => shared("changes.guide");

// The chapters, with "Everything else" for files the agent left unplaced.
export function chapters(g) {
  const list = [...(g?.sections ?? [])];
  if (g?.unplacedFiles?.length) list.push({ title: "Everything else", overview: "Files the guide did not place in a chapter.", diffs: g.unplacedFiles.map((file) => ({ file, summary: "" })) });
  return list;
}

export class Guide {
  // Built in the view's init: input state cannot be made during render.
  constructor() {
    this.id = null; this.item = null; this.files = {}; this.error = null; this.open = new Set();
    this.viewed = new Set(); this.fold = new Map();
    this.notes = new Notes(); this.annotations = []; this.lines = [];
    this.boxes = Array.from({ length: CHAPTERS_MAX }, () => {
      const s = TextareaState.new({ placeholder: "Comment on this chapter", rows: 2 });
      s.set_auto_grow(2, 6);
      return s;
    });
  }

  load(cx, diffRows) {
    const ref = guideRef();
    if (!ref?.id || ref.id === this.id) return;
    this.id = ref.id; this.item = null; this.files = {}; this.error = null; this.open = new Set();
    this.at = ref.chapter ?? 0;
    // Viewed files, kept per review: ticking one folds it away.
    this.viewed = new Set(JSON.parse(localStorage.getItem(`viewed:${ref.id}`) ?? "[]")); this.fold = new Map();
    for (const b of this.boxes) b.set_value("");
    this.annotations = []; this.lines = []; this.notes.edit = null;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${DIR()}/${ref.id}.json`);
        if (!text) throw new Error("This review is gone");
        const item = JSON.parse(text);
        const patch = (await readTextFile(`${DIR()}/${ref.id}.patch`)) ?? "";
        if (this.id !== ref.id) return;
        this.item = item;
        this.files = parsePatch(patch);
        for (const f of Object.values(this.files)) f.rows = diffRows(f.lines);
      } catch (e) { this.error = e?.message ?? String(e); }
      cx.notify();
    });
  }

  setViewed(files, on, cx) {
    for (const f of files) { on ? this.viewed.add(f) : this.viewed.delete(f); this.fold.delete(f); }
    localStorage.setItem(`viewed:${this.id}`, JSON.stringify([...this.viewed]));
    cx.notify();
  }

  // Folded: what the person last chose with the chevron, else whether it is viewed.
  folded(key, viewed) { return this.fold.get(key) ?? viewed; }
  toggle(key, viewed, cx) { this.fold.set(key, !this.folded(key, viewed)); cx.notify(); }

  // A Linear checkbox: a small rounded square, filled with the accent once ticked.
  check(t, id, on, action) {
    return div().id(id).size(16).flex_none().rounded(4).border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background)
      .flex().items_center().justify_center().cursor_pointer().hover((s) => s.border_color(t.accent))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .when(on, (e) => e.child(svg("mods/workspace-chrome/check.svg").size(11).text_color(t.accent_foreground)));
  }

  comments() {
    return chapters(this.item?.guide).map((_c, i) => ({ section: i, text: this.boxes[i]?.value().trim() ?? "" })).filter((c) => c.text);
  }

  send(verdict, cx) {
    const item = this.item;
    if (!item || item.answer) return;
    const lines = this.lines.map((l) => ({ ...l }));
    const answer = { at: new Date().toISOString(), verdict, comments: [...this.comments(), ...lines], ...(this.annotations.length ? { annotations: this.annotations.map((n) => ({ ...n })) } : {}) };
    item.answer = answer; item.state = "answered";
    cx.notify();
    cx.spawn(async (cx) => {
      const path = `${DIR()}/${item.id}.json`;
      try {
        const text = await readTextFile(path);
        const fresh = JSON.parse(text);
        fresh.answer = answer; fresh.state = "answered"; fresh.read_at ??= answer.at;
        await writeTextFile(path, `${JSON.stringify(fresh, null, 1)}\n`, text);
      } catch (e) { notify({ title: "Could not send the review", body: String(e), level: "error" }); item.answer = null; }
      cx.notify();
    });
  }

  // A diff line's number is its comment button: { id, on, click }, null where none applies.
  mark(file, r) {
    if (r.number === undefined || !"+- ".includes(r.kind) || !r.kind) return null;
    const side = r.kind === "-" ? "old" : "new", key = `L:${file}:${side}:${r.number}`;
    const existing = this.lines.find((l) => l.file === file && l.line === r.number && l.side === side);
    return { id: `dl-${file}-${side}${r.number}`, on: Boolean(existing), click: (cx) => (this.item.answer ? null : this.notes.open(key, existing?.text ?? "", cx)) };
  }

  // The file's line comments and the open editor, under its diff.
  lineComments(t, file, f) {
    const answered = this.item.answer, own = (answered?.comments ?? this.lines).filter((l) => l.file === file && l.line !== undefined);
    const prefix = `L:${file}:`, editing = this.notes.edit?.startsWith(prefix) ? this.notes.edit : null;
    if (!own.length && !editing) return null;
    const card = (l) => {
      const key = `${prefix}${l.side}:${l.line}`;
      if (key === editing) return null;
      return h_flex().id(`lc-${key}`).gap(8).px(10).py(6).items_start().rounded(8).bg(t.accent + "12").border_1().border_color(t.accent + "30").text_size(12.5)
        .when(!answered, (e) => e.cursor_pointer().on_click((_e, cx) => this.notes.open(key, l.text, cx)))
        .child(div().flex_none().text_size(11.5).text_color(t.accent).child(`${l.side === "old" ? "was " : ""}line ${l.line}`))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .when(Boolean(l.code?.trim()), (e) => e.child(div().truncate().text_size(11).text_color(t.dim).font_family(settings().font_family ?? "JetBrains Mono").child(l.code)))
          .child(div().child(l.text)))
        .when(!answered, (e) => e.child(div().id(`ld-${key}`).size(18).flex_none().flex().items_center().justify_center().rounded_full().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Remove comment")
          .on_click((_e, cx) => { cx.stop_propagation(); this.lines = this.lines.filter((x) => x !== l); cx.notify(); })
          .child(svg("mods/workspace-chrome/x.svg").size(11))));
    };
    let editor = null;
    if (editing) {
      const [, side, number] = editing.slice(prefix.length).match(/^(old|new):(\d+)$/), line = Number(number);
      const row = f?.rows.find((r) => r.number === line && (r.kind === "-") === (side === "old"));
      editor = v_flex().gap(4)
        .child(div().text_size(11.5).text_color(t.accent).child(`${side === "old" ? "Removed line" : "Line"} ${line}`))
        .child(this.notes.editor(t, (text, cx) => {
          this.lines = this.lines.filter((l) => !(l.file === file && l.line === line && l.side === side));
          if (text) this.lines.push({ file, line, side, code: row?.text?.trim() ?? "", text });
          this.notes.close(cx);
        }));
    }
    return v_flex().gap(6).p(10).border_t(1).border_color(t.border).children(own.map(card)).when(Boolean(editor), (e) => e.child(editor));
  }

  file(t, d, diffRow) {
    const f = this.files[d.file];
    const parts = d.file.split("/"), name = parts.pop();
    const id = `diff-${d.file}`;
    const height = f ? Math.min(DIFF_MAX, f.rows.length * ROW) : 0;
    const viewed = this.viewed.has(d.file), folded = this.folded(d.file, viewed);
    return v_flex().flex_none().rounded(10).border_1().border_color(t.border).overflow_hidden()
      .child(h_flex().id(`fh-${d.file}`).h(36).px(12).gap(9).items_center().bg(t.surface).when(!folded, (e) => e.border_b(1).border_color(t.border)).cursor_pointer()
        .on_click((_e, cx) => this.toggle(d.file, viewed, cx))
        .child(this.check(t, `fv-${d.file}`, viewed, (cx) => this.setViewed([d.file], !viewed, cx)))
        .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(12).text_color(t.dim))
        .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().flex_none().font_medium().text_color(viewed ? t.muted : t.foreground).child(name)))
        .when(Boolean(f), (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`)).child(div().text_size(11).text_color(t.ansi1).child(`\u2212${f.del}`))))
      .when(folded, (e) => e)
      .when(!folded && Boolean(d.summary), (e) => e.child(div().px(12).py(8).text_size(12.5).text_color(t.muted).border_b(1).border_color(t.border).child(d.summary)))
      .when(!folded, (e) => e.child(!f ? div().p(12).text_size(12).text_color(t.dim).child("Not in the patch")
        : f.binary ? div().p(12).text_size(12).text_color(t.dim).child("Binary file")
        : !f.rows.length ? div().p(12).text_size(12).text_color(t.dim).child("No text changes")
        : div().h(height).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
          .child(v_virtual_list(id, f.rows.length, ROW, (i) => String(i), (range) => f.rows.slice(range.start, range.end).map((r) => diffRow(r, t, this.mark(d.file, r))))
            .on_item_click((key, cx) => this.mark(d.file, f.rows[Number(key)])?.click(cx))
            .size_full())
          .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0())))
      .when(!folded && Boolean(f), (e) => e.child(this.lineComments(t, d.file, f) ?? div()));
  }

  chapter(t, ch, i, diffRow, cx) {
    const box = this.boxes[i], commenting = this.open.has(i) || Boolean(box?.value().trim());
    const files = ch.diffs.map((d) => d.file), seen = files.filter((f) => this.viewed.has(f)).length;
    const done = files.length > 0 && seen === files.length, key = `chapter-${i}`, folded = this.folded(key, done);
    return v_flex().gap(12).pt(i ? 22 : 0).when(i > 0, (e) => e.border_t(1).border_color(t.border))
      .child(h_flex().id(`ch-${i}`).gap(10).items_center().cursor_pointer()
        .on_click((_e, cx) => this.toggle(key, done, cx))
        .child(this.check(t, `cv-${i}`, done, (cx) => { this.fold.delete(key); this.setViewed(files, !done, cx); }))
        .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(12).text_color(t.dim))
        .child(div().size(22).flex_none().rounded_full().bg(t.accent + "22").text_size(11.5).font_semibold().text_color(t.accent).flex().items_center().justify_center().child(String(i + 1)))
        .child(div().flex_1().min_w(0).text_size(16).font_semibold().text_color(done ? t.muted : t.foreground).child(ch.title))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(seen && !done ? `${seen} of ${files.length} viewed` : `${files.length} ${files.length === 1 ? "file" : "files"}`)))
      .when(!folded, (e) => e
        .child(v_flex().w_full().min_w(0).gap(2).children(this.notes.view(t, cx, { id: `ov-${this.id}-${i}`, target: `chapter:${i}`, md: ch.overview, list: this.item.answer ? this.item.answer.annotations ?? [] : this.annotations, locked: Boolean(this.item.answer), size: 13 })))
        .children(ch.diffs.map((d) => this.file(t, d, diffRow))))
      .when(!folded && Boolean(box) && !this.item.answer, (e) => e.child(commenting
        ? div().w_full().px(12).py(9).rounded(12).border_1().border_color(t.border).text_size(13).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Textarea.new(box).w_full())
        : h_flex().id(`comment-${i}`).h(28).px(12).gap(6).items_center().self_start().rounded_full().border_1().border_color(t.border).text_size(12).text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.open.add(i); box.focus(); cx.notify(); })
          .child(svg("mods/workspace-chrome/square-pen.svg").size(12)).child("Comment")));
  }

  render(t, cx, select, diffRow) {
    const frame = v_flex().id("guide").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13);
    const top = h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).child(select);
    if (!guideRef()?.id) return frame.child(top).child(div().p(14).text_color(t.dim).child("No guided review open. Agents send one with inbox_guide; it opens from the Inbox."));
    if (this.error) return frame.child(top).child(div().p(14).text_color(t.dim).child(this.error));
    if (!this.item) return frame.child(top);
    const g = this.item.guide ?? {}, list = chapters(g), files = Object.keys(this.files).length;
    const seen = Object.keys(this.files).filter((f) => this.viewed.has(f)).length;
    top.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(`${list.length} ${list.length === 1 ? "chapter" : "chapters"} \u00b7 ${files} ${files === 1 ? "file" : "files"}`))
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().w(80).h(4).rounded_full().bg(t.raised).child(div().h_full().rounded_full().bg(t.accent).w(files ? Math.round(80 * seen / files) : 0)))
        .child(div().text_size(12).text_color(t.muted).child(`${seen}/${files} viewed`)));

    const answered = this.item.answer;
    const button = (id, label, primary, verdict) => div().id(id).h(30).px(14).flex().items_center().rounded_full().text_size(12.5).font_medium().cursor_pointer()
      .when(primary, (e) => e.bg(t.solid).text_color(t.solid_foreground))
      .when(!primary, (e) => e.border_1().border_color(t.border).hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => this.send(verdict, cx)).child(label);
    const count = this.comments().length + this.lines.length + this.annotations.length;
    const footer = answered
      ? h_flex().flex_none().h(48).px(16).gap(8).items_center().border_t(1).border_color(t.border).text_size(12.5).text_color(t.dim)
        .child(svg("mods/workspace-chrome/circle-check.svg").size(14).text_color(t.done))
        .child(div().child(answered.verdict === "approve" ? "You approved this review" : "You requested changes"))
      : h_flex().flex_none().h(52).px(16).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().text_size(12).text_color(t.dim).child(count ? `${count} ${count === 1 ? "comment" : "comments"}` : "No comments"))
        .child(button("changes", "Request changes", false, "changes"))
        .child(button("approve", "Looks good", true, "approve"));

    // One chapter at a time: every diff on screen is a virtual list the host fills in JS twice a
    // frame, so a page of all chapters (35 files) rebuilt ~1,700 rows a frame while scrolling.
    const at = Math.max(0, Math.min(this.at ?? 0, list.length - 1));
    const go = (i) => (_e, cx) => { this.at = i; cx.notify(); };
    const contents = v_flex().gap(1).children(list.map((ch, i) => {
      const names = ch.diffs.map((d) => d.file), seen = names.filter((f) => this.viewed.has(f)).length, done = names.length > 0 && seen === names.length;
      return h_flex().id(`toc-${i}`).h(28).px(8).gap(10).items_center().rounded(6).cursor_pointer()
        .when(i === at, (e) => e.bg(t.selected)).hover((s) => s.bg(i === at ? t.selected : t.hover))
        .on_click(go(i))
        .child(div().w(16).flex_none().text_size(11.5).text_color(i === at ? t.accent : t.dim).child(String(i + 1)))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(done ? t.muted : t.foreground).child(ch.title))
        .child(div().flex_none().text_size(11).text_color(done ? t.done : t.dim).child(done ? "Viewed" : seen ? `${seen}/${names.length}` : `${names.length} ${names.length === 1 ? "file" : "files"}`));
    }));
    const next = at + 1 < list.length
      ? h_flex().id("guide-next").h(34).px(14).gap(8).items_center().self_end().rounded_full().border_1().border_color(t.border).text_size(12.5).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click(go(at + 1))
        .child(div().text_color(t.dim).child("Next")).child(div().font_medium().child(list[at + 1].title))
      : null;

    return frame.child(top)
      .child(v_flex().id(`guide-body-${this.id}-${at}`).flex_1().min_h(0).overflow_y_scrollbar()
        .child(v_flex().w_full().max_w(980).px(20).py(18).gap(22)
          .child(v_flex().gap(8)
            .child(div().text_size(20).font_semibold().child(g.title ?? this.item.subject))
            .when(at === 0 && Boolean(g.intent), (e) => e.child(div().text_size(13.5).text_color(t.muted).child(g.intent))))
          .when(list.length > 1, (e) => e.child(contents))
          .when(list.length > 0, (e) => e.child(this.chapter(t, list[at], at, diffRow, cx)))
          .when(Boolean(next), (e) => e.child(next))))
      .child(footer);
  }
}
