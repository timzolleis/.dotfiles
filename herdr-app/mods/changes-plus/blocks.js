import { div, svg } from "gpui-kit";
import { v_flex, h_flex, TextView, TextareaState, Textarea } from "gpui-base";
import { settings } from "herdr";

// Block-level comments. TextView.markdown has no selection event, so a text is split into
// blocks (heading, paragraph, list item, table row, quote, callout, each line of a fenced
// code block) and each is drawn as its own row with a "+" that shows on hover. A comment
// shows under its block. This file is copied as-is into changes-plus (guide overviews):
// keep both in step.

const short = (s) => (s.length > 300 ? `${s.slice(0, 300)}…` : s);

export function splitBlocks(md) {
  const out = [], lines = String(md ?? "").split("\n");
  let para = [], fence = null, callout = null;
  const flush = () => {
    if (para.length) {
      const text = para.join("\n");
      out.push({ kind: para[0].startsWith(">") ? "quote" : "p", md: text, quote: short(para.map((l) => l.replace(/^>\s?/, "").trim()).join(" ")) });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], fenceMark = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      if (fenceMark) fence = null; else out.push({ kind: "code", md: line, quote: line });
      continue;
    }
    if (fenceMark) { flush(); callout = null; fence = fenceMark[1]; continue; }
    const start = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(line);
    if (start) { flush(); callout = { kind: "callout", type: start[1].toUpperCase(), lines: start[2] ? [start[2]] : [], md: start[2], quote: short(start[2] || start[1].toLowerCase()) }; out.push(callout); continue; }
    if (callout && /^>/.test(line)) { callout.lines.push(line.replace(/^>\s?/, "")); callout.md = callout.lines.join("\n"); callout.quote = short(callout.md.replace(/\n/g, " ")); continue; }
    callout = null;
    if (!line.trim()) { flush(); continue; }
    if (/^#{1,6}\s/.test(line)) { flush(); out.push({ kind: "h", md: line, quote: line.replace(/^#+\s*/, "") }); continue; }
    if (/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      flush();
      const item = line.trim();
      out.push({ kind: "li", md: item, quote: short(item.replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s*)?/, "")), depth: Math.floor(/^\s*/.exec(line)[0].length / 2) });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flush();
      if (/^[\s|:-]+$/.test(line) && line.includes("-")) continue;
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      out.push({ kind: "row", cells, header: /^[\s|:-]+$/.test(lines[i + 1] ?? "x") && (lines[i + 1] ?? "").includes("-"), md: line, quote: cells.join(" | ") });
      continue;
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { flush(); continue; }
    const last = out[out.length - 1];
    if (/^\s+\S/.test(line) && !para.length && last?.kind === "li") { last.md += `\n${line.trim()}`; last.quote = short(`${last.quote} ${line.trim()}`); continue; }
    para.push(line);
  }
  flush();
  return out;
}

// A code file as one block per line.
export function codeBlocks(text, max = 300) {
  const lines = String(text ?? "").replace(/\n$/, "").split("\n");
  return { blocks: lines.slice(0, max).map((l) => ({ kind: "code", md: l, quote: l })), more: Math.max(0, lines.length - max) };
}

export class Notes {
  // Built in the view's init: input state cannot be made during render.
  constructor() {
    this.box = TextareaState.new({ placeholder: "Comment", rows: 2 });
    this.box.set_auto_grow(2, 8);
    this.edit = null;
    this.hover = null;
  }

  open(key, text, cx) {
    this.edit = key;
    this.box.set_value(text);
    this.box.focus();
    cx.notify();
  }

  close(cx) { this.edit = null; cx.notify(); }

  // The comment box with Cancel and Save, for whatever `open` was called for.
  editor(t, save, label = "Save") {
    const button = (id, text, primary, action) => div().id(id).h(26).px(12).flex().items_center().rounded_full().text_size(12).font_medium().cursor_pointer()
      .when(primary, (e) => e.bg(t.solid).text_color(t.solid_foreground))
      .when(!primary, (e) => e.border_1().border_color(t.border).hover((s) => s.bg(t.hover)))
      .on_click(action).child(text);
    return v_flex().gap(6)
      .child(div().w_full().px(12).py(8).rounded(10).border_1().border_color(t.accent).bg(t.background).text_size(13)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Textarea.new(this.box).w_full()))
      .child(h_flex().gap(6).justify_end()
        .child(button("note-cancel", "Cancel", false, (_e, cx) => this.close(cx)))
        .child(button("note-save", label, true, (_e, cx) => save(this.box.value().trim(), cx))));
  }

  // opts: id (unique), target, md or blocks, list (annotations, mutated), locked, size, numbers.
  view(t, cx, { id, target, md, blocks, list, locked = false, size = 13.5, numbers = false }) {
    const all = blocks ?? splitBlocks(md), mono = settings().font_family ?? "JetBrains Mono";
    return all.map((b, i) => {
      const key = `${id}:${i}`, line = numbers ? i + 1 : undefined;
      const note = list.find((n) => n.target === target && n.block === i);
      const lit = this.hover === key || this.edit === key;
      const markdown = (text, extra) => TextView.markdown(`${id}-${i}${extra ?? ""}`, text).selectable(true).text_size(size);
      let body;
      if (b.kind === "code") {
        body = h_flex().gap(10).font_family(mono).text_size(size - 2).py(1).px(8).bg(t.raised)
          .when(numbers, (e) => e.child(div().w(30).flex_none().text_right().text_color(t.dim).child(String(i + 1))))
          .child(div().flex_1().min_w(0).truncate().child(b.md || " "));
      } else if (b.kind === "row") {
        body = h_flex().gap(12).py(1).children(b.cells.map((c, n) => div().flex_1().min_w(0).when(b.header, (e) => e.font_semibold()).child(markdown(c, `-c${n}`))));
      } else if (b.kind === "callout") {
        const color = { IMPORTANT: t.accent, WARNING: t.blocked, CAUTION: t.ansi1, TIP: t.done, NOTE: t.muted }[b.type] ?? t.muted;
        body = v_flex().gap(4).pl(12).pr(10).py(8).rounded(8).border_l(2).border_color(color).bg(color + "14")
          .child(div().text_size(11.5).font_semibold().text_color(color).child(b.type[0] + b.type.slice(1).toLowerCase()))
          .child(markdown(b.md));
      } else {
        body = div().when(b.kind === "li", (e) => e.pl((b.depth ?? 0) * 16)).when(b.kind === "h", (e) => e.pt(6)).child(markdown(b.md));
      }
      const add = locked ? null : div().id(`add-${key}`).size(20).mt(1).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
        .when(lit || Boolean(note), (e) => e.child(svg(note ? "mods/workspace-chrome/square-pen.svg" : "mods/workspace-chrome/plus.svg").size(12).text_color(note ? t.accent : t.dim)))
        .hover((s) => s.bg(t.hover))
        .tooltip(note ? "Edit comment" : "Comment on this block")
        .on_click((_e, cx) => this.open(key, note?.text ?? "", cx));
      const save = (text, cx) => {
        const at = list.findIndex((n) => n.target === target && n.block === i);
        if (text) {
          const entry = { target, block: i, quote: b.quote, text, ...(line ? { line } : {}) };
          if (at < 0) list.push(entry); else list[at] = entry;
        } else if (at >= 0) list.splice(at, 1);
        this.close(cx);
      };
      return v_flex().id(`blk-${key}`).w_full().min_w(0).flex_none()
        .on_hover((hovered, cx) => { if (hovered) this.hover = key; else if (this.hover === key) this.hover = null; else return; cx.notify(); })
        .child(h_flex().w_full().gap(4).items_start()
          .when(!locked, (e) => e.child(add))
          .child(div().flex_1().min_w(0).w_full().when(Boolean(note), (e) => e.border_l(2).border_color(t.accent).pl(8)).child(body)))
        .when(Boolean(note) && this.edit !== key, (e) => e.child(h_flex().id(`cmt-${key}`).ml(locked ? 10 : 26).my(3).px(10).py(6).gap(8).items_start().rounded(8)
          .bg(t.accent + "12").border_1().border_color(t.accent + "30").text_size(12.5)
          .when(!locked, (c) => c.cursor_pointer().on_click((_e, cx) => this.open(key, note.text, cx)))
          .child(div().flex_1().min_w(0).child(note.text))
          .when(!locked, (c) => c.child(div().id(`del-${key}`).size(18).flex_none().flex().items_center().justify_center().rounded_full().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip("Remove comment")
            .on_click((_e, cx) => { cx.stop_propagation(); save("", cx); })
            .child(svg("mods/workspace-chrome/x.svg").size(11))))))
        .when(this.edit === key, (e) => e.child(div().ml(26).my(4).child(this.editor(t, save))));
    });
  }
}
