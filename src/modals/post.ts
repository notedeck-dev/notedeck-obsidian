import { type App, Modal, Setting } from "obsidian";
import { type AccountPublic, accountLabel, NOTE_VISIBILITIES, type NoteVisibility } from "../api";
import type NoteDeckPlugin from "../main";

/** 本文 / アカウント / 公開範囲 / CW を入れて `notes.create` を送る。送信前の確認は NoteDeck の窓で出る */
export class PostModal extends Modal {
  private text: string;
  private cw = "";
  private visibility: NoteVisibility = "public";
  private accountId: string;
  private accounts: AccountPublic[] = [];

  constructor(
    app: App,
    private readonly plugin: NoteDeckPlugin,
    initialText: string,
  ) {
    super(app);
    this.text = initialText;
    this.accountId = plugin.settings.accountId;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    this.setTitle("Post a note via NoteDeck");

    try {
      this.accounts = await this.plugin.api.listAccounts();
    } catch (e) {
      contentEl.createEl("p", { text: this.plugin.api.describeError(e) });
      return;
    }
    if (!this.accounts.length) {
      contentEl.createEl("p", { text: "NoteDeck has no logged-in accounts." });
      return;
    }
    if (!this.accounts.some((a) => a.id === this.accountId)) this.accountId = this.accounts[0].id;

    new Setting(contentEl).setName("Account").addDropdown((d) => {
      for (const a of this.accounts) d.addOption(a.id, accountLabel(a));
      d.setValue(this.accountId).onChange((v) => {
        this.accountId = v;
      });
    });

    new Setting(contentEl).setName("Visibility").addDropdown((d) => {
      for (const v of NOTE_VISIBILITIES) d.addOption(v, v);
      d.setValue(this.visibility).onChange((v) => {
        this.visibility = v as NoteVisibility;
      });
    });

    new Setting(contentEl).setName("Content warning").addText((t) =>
      t.setPlaceholder("optional").onChange((v) => {
        this.cw = v;
      }),
    );

    new Setting(contentEl).setName("Text").addTextArea((t) => {
      t.inputEl.rows = 8;
      t.inputEl.style.width = "100%";
      t.setValue(this.text).onChange((v) => {
        this.text = v;
      });
    });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Post")
        .setCta()
        .onClick(() => void this.submit(b.buttonEl)),
    );
  }

  private async submit(button: HTMLButtonElement): Promise<void> {
    const text = this.text.trim();
    if (!text) {
      this.plugin.notice("Text is empty.");
      return;
    }
    button.disabled = true;
    this.plugin.notice("Confirm the post in the NoteDeck window…");
    try {
      await this.plugin.api.createNote({
        text,
        cw: this.cw.trim() || undefined,
        visibility: this.visibility,
        accountId: this.accountId,
      });
      this.plugin.settings.accountId = this.accountId;
      await this.plugin.saveSettings();
      this.plugin.notice("Posted.");
      this.close();
    } catch (e) {
      this.plugin.notice(this.plugin.api.describeError(e));
      button.disabled = false;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
