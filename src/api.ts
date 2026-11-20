import { requestUrl } from "obsidian";

/**
 * NoteDeck の内蔵 HTTP API (既定 127.0.0.1:19820) の薄いクライアント。
 * 認証は Bearer トークン (NoteDeck の 権限設定 → API トークン で発行)。
 * Obsidian の `requestUrl` を使うので CORS の制約を受けない (API は tauri / dev の origin しか許さない)。
 */

export interface ApiTarget {
  baseUrl: string;
  token: string;
}

export interface AccountPublic {
  id: string;
  host: string;
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  software: string;
  hasToken: boolean;
}

export interface NoteUser {
  id: string;
  username: string;
  host: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface DriveFile {
  id: string;
  name: string;
  type: string;
  url: string;
  thumbnailUrl: string | null;
  isSensitive: boolean;
}

/** notecli の NormalizedNote (生ルート `/api/{host}/notes/{id}` と `/api/events` の note が返す形) */
export interface Note {
  id: string;
  _accountId: string;
  _serverHost: string;
  createdAt: string;
  text: string | null;
  cw: string | null;
  user: NoteUser;
  visibility: string;
  files: DriveFile[];
  reactions: Record<string, number>;
  renoteCount: number;
  repliesCount: number;
  replyId?: string;
  renoteId?: string;
  renote?: Note | null;
  reply?: Note | null;
  uri?: string;
  url?: string;
  localOnly?: boolean;
}

/** `notes.searchArchive` の 1 行 (note projection + 見たアカウントとサーバー) */
export interface ArchiveHit {
  id: string;
  userId: string;
  username: string;
  text?: string;
  createdAt: string;
  replyId?: string;
  renoteId?: string;
  accountId: string;
  serverHost: string;
}

export type NoteVisibility = "public" | "home" | "followers" | "specified";
export const NOTE_VISIBILITIES: NoteVisibility[] = ["public", "home", "followers", "specified"];

export interface CreateNoteParams {
  text: string;
  cw?: string;
  visibility?: NoteVisibility;
  accountId?: string;
}

/** `{ ok: false, code, error }` を HTTP status ごと持つエラー。status 0 は接続できなかったとき */
export class NoteDeckApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NoteDeckApiError";
  }
}

export class NoteDeckClient {
  constructor(private readonly target: () => ApiTarget) {}

  baseUrl(): string {
    return this.target().baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const { token } = this.target();
    let res: Awaited<ReturnType<typeof requestUrl>>;
    try {
      res = await requestUrl({
        url: `${this.baseUrl()}${path}`,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        throw: false,
      });
    } catch (e) {
      // 接続できない = NoteDeck が起動していない (または URL / ポート違い)
      throw new NoteDeckApiError(0, "unreachable", e instanceof Error ? e.message : String(e));
    }
    let data: Record<string, unknown> = {};
    try {
      data = (res.json ?? {}) as Record<string, unknown>;
    } catch {
      data = {};
    }
    if (res.status < 200 || res.status >= 300) {
      // capability ルートは `{ code, error: 文 }`、生ルートは `{ error: CODE, message: 文 }`
      const raw = typeof data.message === "string" ? data.message : undefined;
      const code =
        typeof data.code === "string"
          ? data.code
          : res.status === 401
            ? "unauthorized"
            : raw !== undefined && typeof data.error === "string"
              ? data.error
              : "http_error";
      const message = raw ?? (typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
      throw new NoteDeckApiError(res.status, code, message);
    }
    return data as T;
  }

  /** `POST /api/capabilities/{id}/execute` → `result` */
  async execute<T>(capabilityId: string, params?: Record<string, unknown>): Promise<T> {
    const data = await this.request<{ ok?: boolean; result: T }>(
      "POST",
      `/api/capabilities/${encodeURIComponent(capabilityId)}/execute`,
      params ?? {},
    );
    // 200 でも NoteDeck の形でない (URL が別のサービスを指している等) なら result は無い
    if (data.ok !== true) {
      throw new NoteDeckApiError(200, "bad_response", "Unexpected response from the API URL.");
    }
    return data.result;
  }

  listAccounts(): Promise<AccountPublic[]> {
    return this.execute<AccountPublic[]>("account.list");
  }

  createNote(params: CreateNoteParams): Promise<{ id: string }> {
    return this.execute<{ id: string }>("notes.create", { ...params });
  }

  searchArchive(params: {
    query?: string;
    limit?: number;
    accountIds?: string[];
  }): Promise<ArchiveHit[]> {
    return this.execute<ArchiveHit[]>("notes.searchArchive", { ...params });
  }

  /** 生のノート (添付・ユーザー情報つき)。host はログイン中のアカウントのサーバーでなければならない */
  getNote(host: string, noteId: string): Promise<Note> {
    return this.request<Note>(
      "GET",
      `/api/${encodeURIComponent(host)}/notes/${encodeURIComponent(noteId)}`,
    );
  }

  timeline(host: string, type: string, limit = 30): Promise<Note[]> {
    return this.request<Note[]>(
      "GET",
      `/api/${encodeURIComponent(host)}/timeline/${encodeURIComponent(type)}?limit=${limit}`,
    );
  }

  /** 人向けのエラー文。NoteDeck 側の権限 / 確認の仕組みに沿って案内する */
  describeError(e: unknown): string {
    if (!(e instanceof NoteDeckApiError)) {
      return `NoteDeck: ${e instanceof Error ? e.message : String(e)}`;
    }
    switch (e.code) {
      case "unreachable":
        return "NoteDeck is not running (or the API URL in settings is wrong).";
      case "unauthorized":
        return "Invalid API token. Issue one in NoteDeck: Settings → Permissions → API tokens.";
      case "permission_denied":
        return `Not allowed for external tools. Allow it under Settings → Permissions → External. ${e.message}`;
      case "user_cancelled":
        return "Cancelled in NoteDeck.";
      default:
        return `NoteDeck: ${e.code}: ${e.message}`;
    }
  }
}

export function accountLabel(a: AccountPublic): string {
  const handle = `@${a.username}@${a.host}`;
  return a.displayName ? `${a.displayName} (${handle})` : handle;
}

/** `notedeck://` deep link。トークンも権限も要らない (本人がリンクを踏んだ扱い) */
export function deepLink(path: string, params?: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") qs.set(k, v);
  }
  const q = qs.toString();
  return `notedeck://${path}${q ? `?${q}` : ""}`;
}

export function openDeepLink(path: string, params?: Record<string, string | undefined>): void {
  window.open(deepLink(path, params));
}
