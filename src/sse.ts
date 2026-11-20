import * as http from "node:http";
import * as https from "node:https";
import { isLoopbackUrl, NOT_LOOPBACK_MESSAGE } from "./loopback";

/**
 * `/api/events` (Server-Sent Events) の購読。Obsidian の renderer から直接 `fetch` すると
 * CORS で止まるので、デスクトップ限定で Node の http を使う。切れたら指数バックオフで繋ぎ直す。
 */

export interface SseHandlers {
  onEvent: (type: string, data: unknown) => void;
  onState: (state: "connecting" | "open" | "closed", error?: string) => void;
}

export interface SseSubscription {
  close(): void;
}

const MAX_BACKOFF_MS = 30_000;

export function subscribeSse(
  baseUrl: string,
  token: string,
  types: string[],
  handlers: SseHandlers,
): SseSubscription {
  if (!isLoopbackUrl(baseUrl)) {
    handlers.onState("closed", NOT_LOOPBACK_MESSAGE);
    return { close: () => {} };
  }
  let closed = false;
  let req: http.ClientRequest | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1_000;

  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/api/events`);
  if (types.length) url.searchParams.set("type", types.join(","));
  const lib = url.protocol === "https:" ? https : http;

  const scheduleRetry = (reason: string) => {
    if (closed) return;
    handlers.onState("closed", reason);
    retryTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  const connect = () => {
    if (closed) return;
    handlers.onState("connecting");
    req = lib.request(
      url,
      { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          // token が無効 / 権限が無いときは繋ぎ直しても同じなので止める
          if (res.statusCode === 401 || res.statusCode === 403) {
            handlers.onState("closed", `HTTP ${res.statusCode}`);
          } else {
            scheduleRetry(`HTTP ${res.statusCode}`);
          }
          return;
        }
        backoff = 1_000;
        handlers.onState("open");
        res.setEncoding("utf8");
        let buffer = "";
        let eventType = "message";
        let dataLines: string[] = [];
        const dispatch = () => {
          if (dataLines.length) {
            const raw = dataLines.join("\n");
            let data: unknown = raw;
            try {
              data = JSON.parse(raw);
            } catch {
              // JSON でなければ文字列のまま渡す
            }
            handlers.onEvent(eventType, data);
          }
          eventType = "message";
          dataLines = [];
        };
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let idx = buffer.indexOf("\n");
          while (idx >= 0) {
            const line = buffer.slice(0, idx).replace(/\r$/, "");
            buffer = buffer.slice(idx + 1);
            if (line === "") dispatch();
            else if (line.startsWith("event:")) eventType = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
            // `:` で始まる行は keep-alive コメント、`id:` / `retry:` は使わない
            idx = buffer.indexOf("\n");
          }
        });
        res.on("end", () => scheduleRetry("stream ended"));
        res.on("error", (e) => scheduleRetry(e.message));
      },
    );
    req.on("error", (e) => scheduleRetry(e.message));
    req.end();
  };

  connect();

  return {
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      req?.destroy();
      handlers.onState("closed");
    },
  };
}
