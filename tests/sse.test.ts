import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeSse } from "../src/sse";

/** 指定の status だけ返すサーバーに繋ぎ、最初の closed までを待つ */
async function closedAfter(status: number): Promise<{ error?: string; timers: number }> {
  const server = http.createServer((_req, res) => {
    res.statusCode = status;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    return await new Promise((resolve) => {
      const sub = subscribeSse(`http://127.0.0.1:${port}`, "", ["note"], {
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
});
