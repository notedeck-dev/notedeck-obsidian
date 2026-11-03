import { type App, Keymap, SuggestModal } from "obsidian";
import type { ArchiveHit } from "../api";
import type NoteDeckPlugin from "../main";

/**
 * `notes.searchArchive` (手元の索引、サーバーとアカウント横断) を引く。
 * Enter = vault に取り込んで開く、Mod+Enter = カーソル位置にリンクを挿入。
 */
export class SearchArchiveModal extends SuggestModal<ArchiveHit> {
  private latestQuery = "";

  constructor(
    app: App,
    private readonly plugin: NoteDeckPlugin,
  ) {
    super(app);
    this.setPlaceholder("Search notes NoteDeck has seen (empty = recent)");
    this.setInstructions([
      { command: "↵", purpose: "clip into vault" },
      { command: "mod ↵", purpose: "insert link at cursor" },
    ]);
    this.scope.register(["Mod"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
  }

  async getSuggestions(query: string): Promise<ArchiveHit[]> {
    this.latestQuery = query;
    try {
      const hits = await this.plugin.api.searchArchive({
        query: query.trim() || undefined,
        limit: 30,
      });
      // 打鍵の途中で古い応答が後から届いても捨てる
      return this.latestQuery === query ? hits : [];
    } catch (e) {
      this.plugin.notice(this.plugin.api.describeError(e));
      return [];
    }
  }

  renderSuggestion(hit: ArchiveHit, el: HTMLElement): void {
    el.createDiv({ cls: "notedeck-note__head" }, (head) => {
      head.createSpan({ cls: "notedeck-note__name", text: `@${hit.username}` });
      head.createSpan({ text: `${hit.serverHost} · ${new Date(hit.createdAt).toLocaleString()}` });
    });
    el.createDiv({ cls: "notedeck-note__text", text: (hit.text ?? "").slice(0, 200) });
  }

  onChooseSuggestion(hit: ArchiveHit, evt: MouseEvent | KeyboardEvent): void {
    if (Keymap.isModEvent(evt)) {
      void this.plugin.insertNoteLink(hit.serverHost, hit.id);
    } else {
      void this.plugin.clipNoteById(hit.serverHost, hit.id);
    }
  }
}
