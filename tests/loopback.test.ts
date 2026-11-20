import { describe, expect, it } from "vitest";
import { isLoopbackUrl } from "../src/loopback";

describe("isLoopbackUrl", () => {
  it("この端末を指す http(s) だけ通す", () => {
    expect(isLoopbackUrl("http://127.0.0.1:19820")).toBe(true);
    expect(isLoopbackUrl("http://localhost:19820/")).toBe(true);
    expect(isLoopbackUrl("https://[::1]:19820")).toBe(true);
  });
  it("他のホスト / scheme / URL でない文字列は通さない", () => {
    expect(isLoopbackUrl("http://192.168.0.2:19820")).toBe(false);
    expect(isLoopbackUrl("https://example.com")).toBe(false);
    expect(isLoopbackUrl("http://127.0.0.1.example.com")).toBe(false);
    expect(isLoopbackUrl("http://localhost@example.com")).toBe(false);
    expect(isLoopbackUrl("ftp://127.0.0.1")).toBe(false);
    expect(isLoopbackUrl("127.0.0.1:19820")).toBe(false);
    expect(isLoopbackUrl("")).toBe(false);
  });
});
