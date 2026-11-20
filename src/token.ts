/**
 * API トークンの置き場所。Obsidian 1.11.4 以降の SecretStorage が使えればそこに置き、
 * `data.json` (vault sync / git に乗る) には残さない。使えない版では従来どおり `data.json`。
 */

/** `App.secretStorage` のうち使う分 (minAppVersion では存在しないので実行時に有無を見る) */
export interface SecretStore {
  setSecret(id: string, secret: string): void;
  getSecret(id: string): string | null;
}

/** `data.json` に残す分 */
export interface SavedToken {
  token: string;
  tokenInSecretStorage: boolean;
}

const TOKEN_SECRET_ID = "notedeck-api-token";

export function readToken(storage: SecretStore | undefined, saved: SavedToken): string {
  if (!saved.tokenInSecretStorage) return saved.token;
  try {
    return storage?.getSecret(TOKEN_SECRET_ID) ?? "";
  } catch {
    return "";
  }
}

/** 置いて読み返せたときだけ SecretStorage を正とする。それ以外は `data.json` に残す */
export function writeToken(storage: SecretStore | undefined, token: string): SavedToken {
  try {
    if (storage) {
      storage.setSecret(TOKEN_SECRET_ID, token);
      if (token && storage.getSecret(TOKEN_SECRET_ID) === token) {
        return { token: "", tokenInSecretStorage: true };
      }
    }
  } catch {
    // 置けなければ data.json に残す
  }
  return { token, tokenInSecretStorage: false };
}
