import { div, svg } from "gpui-kit";
import { v_flex, h_flex, TextView, TextareaState, Textarea } from "gpui-base";

// Comments on highlighted text, as in Plannotator: select text in a message or an attached
// file and a popover asks for the comment. A document is one selectable TextView: one
// markdown view per block made every pointer move and every frame lay out hundreds of them.
//
// TextView has no selection event. On a mouse-up after a drag (or a double-click) the
// selection is copied with the window's own Copy action, read from the clipboard, and the
// clipboard is put back. A sentinel tells "nothing selected" from "copied the same text".

const SENTINEL = "\u0000herdr-inbox-selection";
const short = (s, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

// A code file as fenced markdown, so it stays one view; long files are cut.
export function codeMarkdown(path, text, max = 400) {
  const lines = String(text ?? "").replace(/\n$/, "").split("\n");
  const lang = /\.([a-z0-9]+)$/i.exec(path)?.[1] ?? "";
  const fence = lines.some((l) => l.startsWith("```")) ? "~~~~" : "```";
  return { md: `${fence}${lang}\n${lines.slice(0, max).join("\n")}\n${fence}`, more: Math.max(0, lines.length - max) };
}

export class Notes {
  // Built in the view's init: input state cannot be made during render.
  constructor() {
    this.box = TextareaState.new({ placeholder: "Comment", rows: 2 });
    this.box.set_auto_grow(2, 8);
    this.edit = null; // a verify step's key, or "sel:<n>" for a comment being edited
    this.pop = null; // { id, target, quote, x, y, at? } while the popover is open
    this.down = null;
  }

  open(key, text, cx) {
    this.edit = key;
    this.pop = null;
    this.box.set_value(text);
    this.box.focus();
    cx.notify();
  }

  close(cx) { this.edit = null; this.pop = null; cx.notify(); }

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

  // After a drag or a double-click: what is selected, or nothing.
  grab(e, cx, id, target) {
    const down = this.down;
    this.down = null;
    const dragged = down && Math.abs(e.position.x - down.x) + Math.abs(e.position.y - down.y) > 4;
    if (!dragged && e.click_count < 2) return;
    const before = cx.read_from_clipboard();
    cx.write_to_clipboard(SENTINEL);
    window.dispatch_action("shell_root::Copy");
    const at = { x: e.local_position?.x ?? 24, y: e.local_position?.y ?? 0 };
    // The action runs after this handler returns.
    cx.timer.after(40, (cx) => {
      const text = cx.read_from_clipboard();
      cx.write_to_clipboard(before ?? "");
      const quote = text && text !== SENTINEL ? text.trim() : "";
      if (!quote) return;
      this.edit = null;
      this.pop = { id, target, quote, ...at };
      this.box.set_value("");
      this.box.focus();
      cx.notify();
    });
  }

  // opts: id (unique), target ("body" | "file:<path>"), md, list (annotations, mutated), locked, size.
  view(t, cx, { id, target, md, list, locked = false, size = 13.5 }) {
    const mine = list.map((n, i) => ({ n, i })).filter(({ n }) => n.target === target);
    const save = (index, entry) => (text, cx) => {
      if (text) { if (index < 0) list.push({ ...entry, text }); else list[index] = { ...list[index], text }; }
      else if (index >= 0) list.splice(index, 1);
      this.close(cx);
    };
    const pop = this.pop?.id === id ? this.pop : null;
    const doc = div().id(`doc-${id}`).relative().w_full().min_w(0)
      .when(!locked, (e) => e
        .on_mouse_down("left", (ev) => { this.down = ev.position; })
        .on_mouse_up("left", (ev, cx) => this.grab(ev, cx, id, target)))
      .child(TextView.markdown(`md-${id}`, md).selectable(true).text_size(size))
      .when(Boolean(pop), (e) => e.child(v_flex().id(`pop-${id}`).absolute().top(pop.y + 14).left(Math.max(0, Math.min(pop.x - 40, 360))).w(340).p(10).gap(8)
        .rounded(12).bg(t.popover).border_1().border_color(t.border).shadow_lg()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
        .child(div().pl(8).border_l(2).border_color(t.accent).text_size(12).text_color(t.muted).child(short(pop.quote, 240)))
        .child(this.editor(t, save(-1, { target, quote: pop.quote }), "Comment"))));
    const comments = mine.map(({ n, i }) => {
      const key = `sel:${i}`;
      if (this.edit === key) return v_flex().gap(6).child(div().pl(8).border_l(2).border_color(t.accent).text_size(12).text_color(t.muted).child(short(n.quote, 200))).child(this.editor(t, save(i, n)));
      return h_flex().id(`cmt-${id}-${i}`).px(10).py(7).gap(10).items_start().rounded(8).bg(t.accent + "10").border_1().border_color(t.accent + "30").text_size(12.5)
        .when(!locked, (c) => c.cursor_pointer().on_click((_e, cx) => this.open(key, n.text, cx)))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().pl(8).border_l(2).border_color(t.accent).text_color(t.muted).child(short(n.quote, 200)))
          .child(div().child(n.text)))
        .when(!locked, (c) => c.child(div().id(`del-${id}-${i}`).size(18).flex_none().flex().items_center().justify_center().rounded_full().text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Remove comment")
          .on_click((_e, cx) => { cx.stop_propagation(); list.splice(i, 1); cx.notify(); })
          .child(svg("mods/workspace-chrome/x.svg").size(11))));
    });
    return v_flex().w_full().min_w(0).gap(8).child(doc).children(comments);
  }
}
