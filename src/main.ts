import { type Editor, MarkdownView, Notice, normalizePath, Plugin, type TFile } from "obsidian";
import { type Note, NoteDeckClient, openDeepLink } from "./api";
import { noteFileName, noteToMarkdown, noteWebUrl } from "./markdown";
import { ClipUrlModal } from "./modals/clip";
import { PostModal } from "./modals/post";
import { SearchArchiveModal } from "./modals/search";
import { DEFAULT_SETTINGS, type NoteDeckSettings, NoteDeckSettingTab } from "./settings";
import { TIMELINE_VIEW_TYPE, TimelineView } from "./views/timeline";

export default class NoteDeckPlugin extends Plugin {
  settings: NoteDeckSettings = { ...DEFAULT_SETTINGS };
  api = new NoteDeckClient(() => ({ baseUrl: this.settings.baseUrl, token: this.settings.token }));

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new NoteDeckSettingTab(this.app, this));
    this.registerView(TIMELINE_VIEW_TYPE, (leaf) => new TimelineView(leaf, this));

    this.addRibbonIcon("layout-list", "NoteDeck timeline", () => void this.openTimeline());

    this.addCommand({
      id: "open-timeline",
      name: "Open timeline in sidebar",
      callback: () => void this.openTimeline(),
    });
    this.addCommand({
      id: "post-note",
      name: "Post a note (selection as text)",
      callback: () => new PostModal(this.app, this, this.selectedText()).open(),
    });
    this.addCommand({
      id: "compose-in-notedeck",
      name: "Open NoteDeck's post form with selection",
      editorCallback: (editor: Editor) =>
        openDeepLink("compose", { text: editor.getSelection() || undefined }),
    });
    this.addCommand({
      id: "search-archive",
      name: "Search NoteDeck's archive and clip",
      callback: () => new SearchArchiveModal(this.app, this).open(),
    });
    this.addCommand({
      id: "clip-url",
      name: "Clip a note by URL",
      callback: () => new ClipUrlModal(this.app, this).open(),
    });
  }

  onunload(): void {
    // registerView で登録した leaf は Obsidian が detach する
  }

  async loadSettings(): Promise<void> {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...((await this.loadData()) as Partial<NoteDeckSettings> | null),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  notice(text: string): void {
    new Notice(text, 6_000);
  }

  private selectedText(): string {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getSelection() ?? "";
  }

  async openTimeline(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: TIMELINE_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** 生ノートを取って vault に書く。同じノートが既にあれば上書きせずそれを開く */
  async clipNoteById(host: string, noteId: string): Promise<void> {
    let note: Note;
    try {
      note = await this.api.getNote(host, noteId);
    } catch (e) {
      this.notice(this.api.describeError(e));
      return;
    }
    await this.clipNote(note);
  }

  async clipNote(note: Note): Promise<TFile | null> {
    const folder = normalizePath(this.settings.clipFolder);
    const path = normalizePath(`${folder}/${noteFileName(note)}`);
    let file = this.app.vault.getFileByPath(path);
    if (file) {
      this.notice("Already clipped. Opening the existing note.");
    } else {
      try {
        if (!this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        file = await this.app.vault.create(path, noteToMarkdown(note));
      } catch (e) {
        this.notice(`Could not write ${path}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
      this.notice(`Clipped to ${path}`);
    }
    await this.app.workspace.getLeaf(false).openFile(file);
    return file;
  }

  /** カーソル位置に元サーバーの URL を Markdown リンクで挿す */
  async insertNoteLink(host: string, noteId: string): Promise<void> {
    const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (!editor) {
      this.notice("Open a Markdown file to insert a link.");
      return;
    }
    let note: Note;
    try {
      note = await this.api.getNote(host, noteId);
    } catch (e) {
      this.notice(this.api.describeError(e));
      return;
    }
    const url = noteWebUrl(note);
    const label = (note.text ?? note.cw ?? url).split(/\r?\n/)[0].slice(0, 60);
    editor.replaceSelection(`[${label}](${url})`);
  }
}
