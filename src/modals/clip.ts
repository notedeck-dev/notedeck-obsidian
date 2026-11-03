import { type App, Modal, Setting } from "obsidian";
import type NoteDeckPlugin from "../main";
import { parseNoteUrl } from "../markdown";

/** ノートの URL を 1 つ受けて vault に取り込む */
export class ClipUrlModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private readonly plugin: NoteDeckPlugin,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Clip a note by URL");
    const { contentEl } = this;
    contentEl.createEl("p", {
      text: "URL of a note on a server you are logged in to in NoteDeck, e.g. https://misskey.io/notes/abc123.",
    });
    new Setting(contentEl).setName("Note URL").addText((t) => {
      t.inputEl.style.width = "100%";
      t.onChange((v) => {
        this.value = v;
      });
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.submit();
      });
    });
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Clip")
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    const parsed = parseNoteUrl(this.value);
    if (!parsed) {
      this.plugin.notice("That does not look like a note URL (https://host/notes/<id>).");
      return;
    }
    this.close();
    await this.plugin.clipNoteById(parsed.host, parsed.id);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
