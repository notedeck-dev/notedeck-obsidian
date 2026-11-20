import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.hoisted(() => vi.fn());
vi.mock("obsidian", () => ({ requestUrl }));

import { NoteDeckApiError, NoteDeckClient } from "../src/api";

const client = new NoteDeckClient(() => ({ baseUrl: "http://127.0.0.1:19820", token: "" }));

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return null;
}

beforeEach(() => {
  requestUrl.mockReset();
});

describe("NoteDeckClient のエラー", () => {
  it("生ルートの { error: CODE, message } を code と文に分けて読む", async () => {
    requestUrl.mockResolvedValue({
      status: 404,
      json: { error: "NOT_FOUND", message: "No account for host: x.example" },
    });
    const e = await caught(client.getNote("x.example", "n1"));
    expect(e).toBeInstanceOf(NoteDeckApiError);
    expect(e).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      message: "No account for host: x.example",
    });
  });
  it("生ルートの 401 は unauthorized のまま", async () => {
    requestUrl.mockResolvedValue({
      status: 401,
      json: { error: "UNAUTHORIZED", message: "Missing or invalid credentials" },
    });
    expect(await caught(client.getNote("x.example", "n1"))).toMatchObject({ code: "unauthorized" });
  });
  it("capability ルートの { code, error } はそのまま読む", async () => {
    requestUrl.mockResolvedValue({
      status: 403,
      json: { ok: false, code: "permission_denied", error: "denied for external principal" },
    });
    expect(await caught(client.listAccounts())).toMatchObject({
      status: 403,
      code: "permission_denied",
      message: "denied for external principal",
    });
  });
  it("200 でも { ok: true } でない応答は NoteDeckApiError にする", async () => {
    requestUrl.mockResolvedValue({ status: 200, json: { hello: "world" } });
    expect(await caught(client.listAccounts())).toBeInstanceOf(NoteDeckApiError);
  });
  it("{ ok: true, result } は result を返す", async () => {
    requestUrl.mockResolvedValue({ status: 200, json: { ok: true, result: [] } });
    expect(await client.listAccounts()).toEqual([]);
  });
});

const rawNote = {
  id: "n1",
  createdAt: "2026-11-04T01:02:03.000Z",
  text: "hi",
  user: { id: "u1", username: "alice" },
  files: [],
};

describe("NoteDeckClient の検査", () => {
  it("loopback でない API URL には何も送らない", async () => {
    const remote = new NoteDeckClient(() => ({ baseUrl: "https://example.com", token: "" }));
    expect(await caught(remote.listAccounts())).toMatchObject({ code: "not_loopback" });
    expect(await caught(remote.getNote("x.example", "n1"))).toMatchObject({ code: "not_loopback" });
    expect(requestUrl).not.toHaveBeenCalled();
  });
  it("応答が来なければ timeout にする", async () => {
    vi.useFakeTimers();
    try {
      requestUrl.mockReturnValue(new Promise(() => {}));
      const p = caught(client.listAccounts());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await p).toMatchObject({ status: 0, code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("NoteDeck の窓での確認を待つ notes.create は timeout にしない", async () => {
    vi.useFakeTimers();
    try {
      requestUrl.mockReturnValue(new Promise(() => {}));
      let settled = false;
      void caught(client.createNote({ text: "hi" })).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(settled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it("生ルートの 200 が note の形でなければ bad_response にする", async () => {
    requestUrl.mockResolvedValue({ status: 200, json: { hello: "world" } });
    expect(await caught(client.timeline("x.example", "home"))).toMatchObject({
      code: "bad_response",
    });
    expect(await caught(client.getNote("x.example", "n1"))).toMatchObject({ code: "bad_response" });
    requestUrl.mockResolvedValue({ status: 200, json: [rawNote, { id: "n2" }] });
    expect(await caught(client.timeline("x.example", "home"))).toMatchObject({
      code: "bad_response",
    });
  });
  it("note の形なら通す", async () => {
    requestUrl.mockResolvedValue({ status: 200, json: [rawNote] });
    expect(await client.timeline("x.example", "home")).toEqual([rawNote]);
    requestUrl.mockResolvedValue({ status: 200, json: rawNote });
    expect(await client.getNote("x.example", "n1")).toEqual(rawNote);
  });
  it("capability の result が配列でなければ bad_response にする", async () => {
    requestUrl.mockResolvedValue({ status: 200, json: { ok: true, result: { a: 1 } } });
    expect(await caught(client.listAccounts())).toMatchObject({ code: "bad_response" });
    expect(await caught(client.searchArchive({}))).toMatchObject({ code: "bad_response" });
  });
});
