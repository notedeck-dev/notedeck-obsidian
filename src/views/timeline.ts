import { ItemView, Menu, setIcon, type WorkspaceLeaf } from "obsidian";
import { type AccountPublic, accountLabel, type Note } from "../api";
import type NoteDeckPlugin from "../main";
import { noteDeepLink, noteHandle, noteWebUrl } from "../markdown";
import type { TimelineType } from "../settings";
import { type SseSubscription, subscribeSse } from "../sse";

export const TIMELINE_VIEW_TYPE = "notedeck-timeline";
const TIMELINE_TYPES: TimelineType[] = ["home", "local", "social", "global"];
const MAX_NOTES = 100;

/**
 * サイドバーのタイムライン。初期表示は `/api/{host}/timeline/{type}`、
 * 以後は `/api/events` の `note` イベント (NoteDeck 自身が購読中のストリーム) で先頭に足す。
 */
export class TimelineView extends ItemView {
  private accounts: AccountPublic[] = [];
  private notes: Note[] = [];
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private sse: SseSubscription | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: NoteDeckPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return TIMELINE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "NoteDeck timeline";
  }

  getIcon(): string {
    return "layout-list";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("notedeck-timeline");

    const toolbar = root.createDiv({ cls: "notedeck-timeline__toolbar" });
    const accountSelect = toolbar.createEl("select");
    const typeSelect = toolbar.createEl("select");
    for (const t of TIMELINE_TYPES) typeSelect.createEl("option", { value: t, text: t });
    typeSelect.value = this.plugin.settings.timelineType;
    const refresh = toolbar.createEl("button", { attr: { "aria-label": "Refresh" } });
    setIcon(refresh, "refresh-cw");

    this.statusEl = root.createDiv({ cls: "notedeck-timeline__status" });
    this.listEl = root.createDiv({ cls: "notedeck-timeline__list" });

    accountSelect.addEventListener("change", () => {
      this.plugin.settings.accountId = accountSelect.value;
      void this.plugin.saveSettings();
      void this.reload();
    });
    typeSelect.addEventListener("change", () => {
      this.plugin.settings.timelineType = typeSelect.value as TimelineType;
      void this.plugin.saveSettings();
      void this.reload();
    });
    refresh.addEventListener("click", () => void this.reload());

    try {
      this.accounts = await this.plugin.api.listAccounts();
    } catch (e) {
      this.setStatus(this.plugin.api.describeError(e));
      return;
    }
    for (const a of this.accounts)
      accountSelect.createEl("option", { value: a.id, text: accountLabel(a) });
    if (!this.accounts.some((a) => a.id === this.plugin.settings.accountId) && this.accounts[0]) {
      this.plugin.settings.accountId = this.accounts[0].id;
      await this.plugin.saveSettings();
    }
    accountSelect.value = this.plugin.settings.accountId;

    await this.reload();
    this.subscribe();
  }

  async onClose(): Promise<void> {
    this.sse?.close();
    this.sse = null;
  }

  private currentAccount(): AccountPublic | undefined {
    return this.accounts.find((a) => a.id === this.plugin.settings.accountId);
  }

  private setStatus(text: string): void {
    this.statusEl?.setText(text);
  }

  private async reload(): Promise<void> {
    const account = this.currentAccount();
    if (!account) {
      this.setStatus("NoteDeck has no logged-in accounts.");
      return;
    }
    this.setStatus("Loading…");
    try {
      this.notes = await this.plugin.api.timeline(
        account.host,
        this.plugin.settings.timelineType,
        30,
      );
      this.setStatus(`${this.notes.length} notes · ${account.host}`);
    } catch (e) {
      this.notes = [];
      this.setStatus(this.plugin.api.describeError(e));
    }
    this.render();
  }

  private subscribe(): void {
    this.sse?.close();
    const { baseUrl, token } = this.plugin.settings;
    this.sse = subscribeSse(baseUrl, token, ["note"], {
      onEvent: (_type, data) => {
        const payload = data as { accountId?: string; note?: Note } | null;
        const note = payload?.note;
        if (!note || payload?.accountId !== this.plugin.settings.accountId) return;
        if (this.notes.some((n) => n.id === note.id)) return;
        this.notes = [note, ...this.notes].slice(0, MAX_NOTES);
        this.render();
      },
      onState: (state, error) => {
        if (state === "closed" && error) this.setStatus(`Live updates paused: ${error}`);
      },
    });
  }

  private render(): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    for (const note of this.notes) {
      const el = list.createDiv({ cls: "notedeck-note" });
      el.createDiv({ cls: "notedeck-note__head" }, (head) => {
        head.createSpan({ cls: "notedeck-note__name", text: note.user.name || note.user.username });
        head.createSpan({ text: noteHandle(note) });
        head.createSpan({ text: new Date(note.createdAt).toLocaleTimeString() });
      });
      if (note.cw)
        el.createDiv({ cls: "notedeck-note__text notedeck-note__cw", text: `CW: ${note.cw}` });
      else
        el.createDiv({
          cls: "notedeck-note__text",
          text: note.text ?? (note.renoteId ? "(renote)" : ""),
        });
      if (note.files.length)
        el.createDiv({ cls: "notedeck-note__files", text: `${note.files.length} attachment(s)` });
      el.addEventListener("click", (evt) => this.showMenu(note, evt));
    }
  }

  private showMenu(note: Note, evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle("Clip into vault")
        .setIcon("scissors")
        .onClick(() => void this.plugin.clipNote(note)),
    );
    menu.addItem((i) =>
      i
        .setTitle("Open in NoteDeck")
        .setIcon("external-link")
        .onClick(() => window.open(noteDeepLink(note))),
    );
    menu.addItem((i) =>
      i
        .setTitle(`Open on ${note._serverHost}`)
        .setIcon("globe")
        .onClick(() => window.open(noteWebUrl(note))),
    );
    menu.addItem((i) =>
      i
        .setTitle("Copy link")
        .setIcon("link")
        .onClick(() => void navigator.clipboard.writeText(noteWebUrl(note))),
    );
    menu.showAtMouseEvent(evt);
  }
}
