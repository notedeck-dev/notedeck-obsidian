import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeSse } from "../src/sse";

async function listen(
  handler: http.RequestListener,
): Promise<{ url: string; server: http.Server }> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

/** 指定の status だけ返すサーバーに繋ぎ、最初の closed までを待つ */
async function closedAfter(status: number): Promise<{ error?: string; timers: number }> {
  const { url, server } = await listen((_req, res) => {
    res.statusCode = status;
    res.end();
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    return await new Promise((resolve) => {
      const sub = subscribeSse(url, "", ["note"], {
        onEvent: () => {},
        onState: (state, error) => {
          if (state !== "closed" || !error) return;
          // scheduleRetry は onState の後に timer を張るので 1 tick 待って数える
          queueMicrotask(() => {
            resolve({ error, timers: vi.getTimerCount() });
            sub.close();
          });
        },
      });
    });
  } finally {
    vi.useRealTimers();
    server.close();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("subscribeSse", () => {
  it("5xx は繋ぎ直す", async () => {
    expect(await closedAfter(500)).toEqual({ error: "HTTP 500", timers: 1 });
  });
  it("401 / 403 は繋ぎ直さない", async () => {
    expect(await closedAfter(401)).toEqual({ error: "HTTP 401", timers: 0 });
    expect(await closedAfter(403)).toEqual({ error: "HTTP 403", timers: 0 });
  });
  it("loopback でない URL には繋がない", () => {
    const states: [string, string | undefined][] = [];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const sub = subscribeSse("https://example.com", "", ["note"], {
      onEvent: () => {},
      onState: (state, error) => states.push([state, error]),
    });
    expect(states).toHaveLength(1);
    expect(states[0][0]).toBe("closed");
    expect(states[0][1]).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    sub.close();
  });
  it("event / data を組み立てて渡し、流れが終わったら繋ぎ直す", async () => {
    let requested = "";
    const { url, server } = await listen((req, res) => {
      requested = req.url ?? "";
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      // 行の途中で chunk が切れても、CRLF でも、コメント行が挟まっても組み立てる
      res.write(": keep-alive\n\nevent: no");
      res.write('te\ndata: {"a":');
      res.write("1}\n\nevent: text\r\ndata: line1\r\ndata: line2\r\n\r\n");
      res.end('data: {"b":2}\n\n');
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const events: [string, unknown][] = [];
      const states: string[] = [];
      const result = await new Promise<{ error?: string; timers: number }>((resolve) => {
        const sub = subscribeSse(url, "", ["note"], {
          onEvent: (type, data) => events.push([type, data]),
          onState: (state, error) => {
            states.push(state);
            if (state !== "closed" || !error) return;
            queueMicrotask(() => {
              resolve({ error, timers: vi.getTimerCount() });
              sub.close();
            });
          },
        });
      });
      expect(requested).toBe("/api/events?type=note");
      expect(events).toEqual([
        ["note", { a: 1 }],
        ["text", "line1\nline2"],
        ["message", { b: 2 }],
      ]);
      expect(states.slice(0, 2)).toEqual(["connecting", "open"]);
      expect(result).toEqual({ error: "stream ended", timers: 1 });
      // close の後は timer が残らない
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      server.close();
    }
  });
});
