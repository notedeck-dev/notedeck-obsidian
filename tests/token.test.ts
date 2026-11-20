import { describe, expect, it } from "vitest";
import { readToken, type SecretStore, writeToken } from "../src/token";

function store(over: Partial<SecretStore> = {}): SecretStore & { secrets: Map<string, string> } {
  const secrets = new Map<string, string>();
  return {
    secrets,
    setSecret: (id, secret) => void secrets.set(id, secret),
    getSecret: (id) => secrets.get(id) ?? null,
    ...over,
  };
}

describe("writeToken / readToken", () => {
  it("SecretStorage が使えればそこに置き、data.json には残さない", () => {
    const s = store();
    const saved = writeToken(s, "abc");
    expect(saved).toEqual({ token: "", tokenInSecretStorage: true });
    expect(readToken(s, saved)).toBe("abc");
  });
  it("SecretStorage が無い版では data.json に残す", () => {
    const saved = writeToken(undefined, "abc");
    expect(saved).toEqual({ token: "abc", tokenInSecretStorage: false });
    expect(readToken(undefined, saved)).toBe("abc");
  });
  it("置けなかった / 読み返せなかったら data.json に残す", () => {
    const throwing = store({
      setSecret: () => {
        throw new Error("nope");
      },
    });
    expect(writeToken(throwing, "abc")).toEqual({ token: "abc", tokenInSecretStorage: false });
    const lossy = store({ getSecret: () => null });
    expect(writeToken(lossy, "abc")).toEqual({ token: "abc", tokenInSecretStorage: false });
  });
  it("空にしたら、前の値が SecretStorage に残っていても読まない", () => {
    const s = store({
      setSecret: (_id, secret) => {
        if (!secret) throw new Error("empty");
      },
      getSecret: () => "old",
    });
    const saved = writeToken(s, "");
    expect(saved).toEqual({ token: "", tokenInSecretStorage: false });
    expect(readToken(s, saved)).toBe("");
  });
});
