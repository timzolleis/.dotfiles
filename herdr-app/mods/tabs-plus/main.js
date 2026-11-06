import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, run, openOverlay, theme, window, shared, layout, settings, keys, nextCommand } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// A command's shortcut as bound, in the platform's symbols ("⌘E"); null when unbound.
function shortcut(action) {
  const mac = window()?.platform === "macos";
  const sym = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+" };
  const b = keys().find((k) => k.action === action);
  return b ? b.keys.split("-").map((p) => sym[p.toLowerCase()] ?? p.toUpperCase()).join("") : null;
}
const tip = (label, action) => { const k = shortcut(action); return k ? `${label}  ${k}` : label; };

function togglePanel(id) {
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  if (panel && !panel.hidden && body?.active === id) run("layout.hide", { id: "panel" });
  else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
}
function toggleInbox() {
  const screen = find(layout(), "center")?.active === "inbox-screen";
  run("layout.select", { stack: "center", child: screen ? "main" : "inbox-screen" });
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    // keys.json "layout:tim": "cmd-e": "tabs-plus.changes" and the like.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "inbox") toggleInbox();
        else if (c === "files" || c === "changes") togglePanel(c);
        cx.notify();
      }
    });
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const all = space?.tabs ?? [];
    const settled = all.filter(c => c.settled && !c.active);
    const shown = this.unfolded ? all : all.filter(c => !settled.includes(c));
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const pane = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const task = terminals().find(x => x.address === pane?.terminal)?.labels?.["herdr.task"];
      const name = /^(tb)?\d+$/.test(c.name) ? task ?? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(28).px(11).gap(6).rounded_full().items_center().flex_none().text_size(12.5).font_medium()
        .bg(c.active ? t.selected : t.background).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(c.active ? t.selected : t.hover).text_color(t.foreground))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
          if (find(layout(), "center")?.active === "inbox-screen") run("layout.select", { stack: "center", child: "main" });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(200).truncate().child(c.zoomed ? `${name} Z` : name))
        // The thinking orb (github.com/Jakubantalik/thinking-orbs), pre-rendered as an animated
        // WebP: it plays without a script, where a spinning SVG turned every frame.
        .when(c.status === "working", el => el.child(image(`mods/tabs-plus/orb-${settings().dark ? "dark" : "light"}.webp`).size(16).flex_none()))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(24).px(10).gap(6).flex_none().items_center().rounded_full()
        .text_size(12.5).font_medium().bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(on ? t.selected : t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .tooltip(tip(label, `tabs-plus.${id}`))
        .on_click(() => togglePanel(id)).child(svg(icon).size(14)).child(label);
    };
    const center = find(root, "center"), screen = center?.active === "inbox-screen", needs = Number(shared("inbox.needs") ?? 0), updates = Number(shared("inbox.updates") ?? 0);
    const pill = (id) => h_flex().id(id).h(28).flex_none().items_center().rounded_full().border_1().border_color(t.border).text_size(12.5).font_medium();
    const inboxButton = pill("inbox-button").px(11).gap(7)
      .bg(screen ? t.selected : t.background).text_color(screen || needs > 0 ? t.foreground : t.muted)
      .hover(s => s.bg(screen ? t.selected : t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
      .tooltip(tip(screen ? "Back to the terminals" : "Inbox", "tabs-plus.inbox"))
      .on_click(toggleInbox)
      .child(svg("mods/inbox/inbox.svg").size(14)).child("Inbox")
      .when(needs > 0, el => el.child(div().text_size(12).font_semibold().text_color(t.blocked).child(String(needs))))
      // Updates wait quietly: a dim count, only when nothing needs the person.
      .when(needs === 0 && updates > 0, el => el.child(div().text_size(12).text_color(t.dim).child(String(updates))));
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(2).items_center().bg(t.background).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item))
        .when(settled.length > 0, el => el.child(h_flex().id("tabs-settled").h(28).px(8).flex_none().items_center().rounded_full().text_size(12).text_color(t.dim)
          .hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
          .tooltip(this.unfolded ? "Fold settled tabs" : "Show settled tabs")
          .on_click((_e, cx) => { this.unfolded = !this.unfolded; cx.notify(); })
          .child(this.unfolded ? "−" : `+${settled.length}`))))
      .child(pill("tab-new").w(28).justify_center().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .tooltip(tip("New tab", "tab.new"))
        .on_click(() => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })).child(svg("mods/workspace-chrome/plus.svg").size(14)))
      .child(div().w(4))
      .child(inboxButton)
      .child(div().w(4))
      .child(pill("panels").px(1).gap(1)
        .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
        .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg"))))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-plus/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-plus/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-plus/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
