import { ItemView, Menu, setIcon, type WorkspaceLeaf } from "obsidian";
import { type AccountPublic, accountLabel, isNote, type Note } from "../api";
import type NoteDeckPlugin from "../main";
import { noteDeepLink, noteHandle, noteWebUrl, renoteOnly } from "../markdown";
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
  private accountSelectEl: HTMLSelectElement | null = null;
  private paused = false;
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
    refresh.addEventListener("click", () => void this.start());

    this.accountSelectEl = accountSelect;
    await this.start();
  }

  /** 読み直して購読も張り直す (起動時に繋がらなかった / 401・403 で止まった購読もここで戻る) */
  private async start(): Promise<void> {
    await this.reload();
    if (this.accounts.length) this.subscribe();
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
    // 未取得 (起動時に NoteDeck が落ちていた等) ならアカウントから取り直す
    if (!this.accounts.length) {
      try {
        // token の無いアカウント (ゲスト) では timeline を取れない
        this.accounts = (await this.plugin.api.listAccounts()).filter((a) => a.hasToken);
      } catch (e) {
        this.setStatus(this.plugin.api.describeError(e));
        return;
      }
      const accountSelect = this.accountSelectEl;
      accountSelect?.empty();
      for (const a of this.accounts)
        accountSelect?.createEl("option", { value: a.id, text: accountLabel(a) });
      if (!this.accounts.some((a) => a.id === this.plugin.settings.accountId) && this.accounts[0]) {
        this.plugin.settings.accountId = this.accounts[0].id;
        await this.plugin.saveSettings();
      }
      if (accountSelect) accountSelect.value = this.plugin.settings.accountId;
    }
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
    this.sse = subscribeSse(this.plugin.settings.baseUrl, this.plugin.getToken(), ["note"], {
      onEvent: (type, data) => {
        // 本体の type filter は前方一致で `notification` / `note-updated` も届くので、note だけ見る
        if (type !== "note") return;
        const payload = data as { accountId?: string; note?: unknown } | null;
        const note = payload?.note;
        if (!isNote(note) || payload?.accountId !== this.plugin.settings.accountId) return;
        if (this.notes.some((n) => n.id === note.id)) return;
        // 全部描き直すと scroll が飛ぶので、先頭に 1 件足して溢れた末尾を外すだけにする
        this.notes = [note, ...this.notes];
        this.listEl?.prepend(this.noteEl(note));
        if (this.notes.length > MAX_NOTES) {
          this.notes.length = MAX_NOTES;
          this.listEl?.lastElementChild?.remove();
        }
      },
      onState: (state, error) => {
        if (state === "closed" && error) {
          this.paused = true;
          this.setStatus(`Live updates paused: ${error}`);
        } else if (state === "open" && this.paused) {
          // 繋ぎ直せたら、切れていた間の分ごと読み直して表示を戻す
          this.paused = false;
          void this.reload();
        }
      },
    });
  }

  private render(): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    for (const note of this.notes) list.appendChild(this.noteEl(note));
  }

  private noteEl(note: Note): HTMLElement {
    const el = createDiv({ cls: "notedeck-note" });
    el.createDiv({ cls: "notedeck-note__head" }, (head) => {
      head.createSpan({ cls: "notedeck-note__name", text: note.user.name || note.user.username });
      head.createSpan({ text: noteHandle(note) });
      head.createSpan({ text: new Date(note.createdAt).toLocaleTimeString() });
    });
    // ただの renote は renote 元の中身を出す (誰が renote したかは上の行に残る)
    const shown = renoteOnly(note) ?? note;
    if (shown !== note)
      el.createDiv({ cls: "notedeck-note__renote", text: `Renote of ${noteHandle(shown)}` });
    if (shown.cw)
      el.createDiv({ cls: "notedeck-note__text notedeck-note__cw", text: `CW: ${shown.cw}` });
    else
      el.createDiv({
        cls: "notedeck-note__text",
        text: shown.text ?? (shown.renoteId ? "(renote)" : ""),
      });
    if (shown.files.length)
      el.createDiv({ cls: "notedeck-note__files", text: `${shown.files.length} attachment(s)` });
    el.addEventListener("click", (evt) => this.showMenu(note, evt));
    return el;
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
