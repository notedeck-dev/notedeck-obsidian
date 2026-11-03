import { type App, PluginSettingTab, Setting } from "obsidian";
import type NoteDeckPlugin from "./main";

export type TimelineType = "home" | "local" | "social" | "global";

export interface NoteDeckSettings {
  /** 内蔵 HTTP API の URL。リリース版は 19820、開発版は別ポート */
  baseUrl: string;
  /** NoteDeck の 権限設定 → API トークン で発行した永続トークン */
  token: string;
  /** 取り込んだノートを置く vault 内のフォルダ */
  clipFolder: string;
  /** 最後に使ったアカウント (投稿 / タイムラインの既定) */
  accountId: string;
  timelineType: TimelineType;
}

export const DEFAULT_SETTINGS: NoteDeckSettings = {
  baseUrl: "http://127.0.0.1:19820",
  token: "",
  clipFolder: "NoteDeck",
  accountId: "",
  timelineType: "home",
};

export class NoteDeckSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: NoteDeckPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("NoteDeck API URL")
      .setDesc(
        "Base URL of NoteDeck's built-in HTTP API. Leave the default unless you changed the port.",
      )
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.baseUrl)
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (v) => {
            this.plugin.settings.baseUrl = v.trim() || DEFAULT_SETTINGS.baseUrl;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("API token")
      .setDesc(
        'Issued in NoteDeck: Settings → Permissions → API tokens. Name it "obsidian" so NoteDeck shows where requests come from.',
      )
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(this.plugin.settings.token).onChange(async (v) => {
          this.plugin.settings.token = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Clip folder")
      .setDesc("Vault folder that clipped notes are written to.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.clipFolder)
          .setValue(this.plugin.settings.clipFolder)
          .onChange(async (v) => {
            this.plugin.settings.clipFolder =
              v.trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SETTINGS.clipFolder;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Check connection")
      .setDesc("Lists the accounts NoteDeck is logged in to.")
      .addButton((b) =>
        b.setButtonText("Check").onClick(async () => {
          b.setDisabled(true);
          try {
            const accounts = await this.plugin.api.listAccounts();
            const names = accounts.map((a) => `@${a.username}@${a.host}`).join(", ");
            this.plugin.notice(
              accounts.length
                ? `Connected. Accounts: ${names}`
                : "Connected, but NoteDeck has no accounts.",
            );
          } catch (e) {
            this.plugin.notice(this.plugin.api.describeError(e));
          } finally {
            b.setDisabled(false);
          }
        }),
      );
  }
}
