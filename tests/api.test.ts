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
