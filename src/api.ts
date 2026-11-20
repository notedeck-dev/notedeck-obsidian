import { requestUrl } from "obsidian";
import { isLoopbackUrl, NOT_LOOPBACK_MESSAGE } from "./loopback";

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

/** 人の確認を待たない呼び出しの上限 */
const REQUEST_TIMEOUT_MS = 15_000;

function badResponse(): NoteDeckApiError {
  return new NoteDeckApiError(200, "bad_response", "Unexpected response from the API URL.");
}

/** 表示と取り込みが前提にしている形だけ見る (生ルートと `/api/events` の note) */
export function isNote(v: unknown): v is Note {
  const n = v as Partial<Note> | null;
  return (
    typeof n === "object" &&
    n !== null &&
    typeof n.id === "string" &&
    typeof n.createdAt === "string" &&
    typeof n.user?.username === "string" &&
    Array.isArray(n.files) &&
    (n.renote == null || isNote(n.renote))
  );
}

export class NoteDeckClient {
  constructor(private readonly target: () => ApiTarget) {}

  baseUrl(): string {
    return this.target().baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const { token } = this.target();
    if (!isLoopbackUrl(this.baseUrl())) {
      throw new NoteDeckApiError(0, "not_loopback", NOT_LOOPBACK_MESSAGE);
    }
    let res: Awaited<ReturnType<typeof requestUrl>>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = requestUrl({
        url: `${this.baseUrl()}${path}`,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        throw: false,
      });
      // `requestUrl` には timeout も中断も無いので、待つのをやめるだけ (要求自体は残る)
      res = await (timeoutMs
        ? Promise.race([
            pending,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new NoteDeckApiError(0, "timeout", "No response in time.")),
                timeoutMs,
              );
            }),
          ])
        : pending);
    } catch (e) {
      if (e instanceof NoteDeckApiError) throw e;
      // 接続できない = NoteDeck が起動していない (または URL / ポート違い)
      throw new NoteDeckApiError(0, "unreachable", e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
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
  async execute<T>(
    capabilityId: string,
    params?: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const data = await this.request<{ ok?: boolean; result: T }>(
      "POST",
      `/api/capabilities/${encodeURIComponent(capabilityId)}/execute`,
      params ?? {},
      timeoutMs,
    );
    // 200 でも NoteDeck の形でない (URL が別のサービスを指している等) なら result は無い
    if (data.ok !== true) throw badResponse();
    return data.result;
  }

  async listAccounts(): Promise<AccountPublic[]> {
    const accounts = await this.execute<AccountPublic[]>("account.list");
    if (!Array.isArray(accounts)) throw badResponse();
    return accounts;
  }

  createNote(params: CreateNoteParams): Promise<{ id: string }> {
    // NoteDeck の窓で本人が確認するまで返らないので、待つのを切らない
    return this.execute<{ id: string }>("notes.create", { ...params }, 0);
  }

  async searchArchive(params: {
    query?: string;
    limit?: number;
    accountIds?: string[];
  }): Promise<ArchiveHit[]> {
    const hits = await this.execute<ArchiveHit[]>("notes.searchArchive", { ...params });
    if (!Array.isArray(hits)) throw badResponse();
    return hits;
  }

  /** 生のノート (添付・ユーザー情報つき)。host はログイン中のアカウントのサーバーでなければならない */
  async getNote(host: string, noteId: string): Promise<Note> {
    const note = await this.request<unknown>(
      "GET",
      `/api/${encodeURIComponent(host)}/notes/${encodeURIComponent(noteId)}`,
    );
    if (!isNote(note)) throw badResponse();
    return note;
  }

  async timeline(host: string, type: string, limit = 30): Promise<Note[]> {
    const notes = await this.request<unknown>(
      "GET",
      `/api/${encodeURIComponent(host)}/timeline/${encodeURIComponent(type)}?limit=${limit}`,
    );
    if (!Array.isArray(notes) || !notes.every(isNote)) throw badResponse();
    return notes;
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
      case "not_loopback":
        return e.message;
      case "timeout":
        return "NoteDeck did not answer in time.";
      case "bad_response":
        return "Unexpected response. Is the API URL in settings pointing at NoteDeck?";
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
