import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, terminals, theme, run, window, keys, exec } from "herdr";

export default class WorkspaceStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "mod.open:cmdk-plus");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  // This space's background terminals (herdr.bg = dev | setup), by their labels.
  background(space) {
    return terminals().filter((x) => x.state === "live" && x.labels?.["herdr.bg"] && x.labels["herdr.bg.space"] === space?.id);
  }

  chip(x, t) {
    const l = x.labels, dev = l["herdr.bg"] === "dev";
    const url = l["herdr.url"];
    const text = dev ? (url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "dev") : "setup";
    return h_flex().id(`bg-${x.address}`).h(20).px(6).gap(5).items_center().rounded(5).flex_none().text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(dev && url ? "Open the URL · right-click: show the log" : "Show the log")
      .on_click(() => (dev && url ? exec("open", [url]) : run("terminal.peek", { terminal: x.address })))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); run("terminal.peek", { terminal: x.address }); })
      .child(div().text_color(dev ? t.ansi2 : t.dim).child(dev ? "●" : "◌"))
      .child(div().child(text));
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).text_size(11.5).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(h_flex().gap(4).items_center().children(this.background(space).map((x) => this.chip(x, t))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("mod.open", { name: "cmdk-plus" })).child(this.hint(t)));
  }
}
