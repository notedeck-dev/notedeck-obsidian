import { describe, expect, it } from "vitest";
import type { Note } from "../src/api";
import { noteFileName, noteToMarkdown, noteWebUrl, parseNoteUrl } from "../src/markdown";

function note(over: Partial<Note> = {}): Note {
  return {
    id: "abc123",
    _accountId: "acc",
    _serverHost: "misskey.example",
    createdAt: "2026-11-04T01:02:03.000Z",
    text: "hello\nworld",
    cw: null,
    user: { id: "u1", username: "alice", host: null, name: 'Alice "A"', avatarUrl: null },
    visibility: "public",
    files: [],
    reactions: {},
    renoteCount: 0,
    repliesCount: 0,
    ...over,
  };
}

describe("parseNoteUrl", () => {
  it("https://host/notes/<id> を host と id に分ける", () => {
    expect(parseNoteUrl("https://misskey.io/notes/9abcXYZ")).toEqual({
      host: "misskey.io",
      id: "9abcXYZ",
    });
    expect(parseNoteUrl(" https://misskey.io/notes/9abcXYZ/ ")).toEqual({
      host: "misskey.io",
      id: "9abcXYZ",
    });
  });
  it("ノート以外の URL と URL でない文字列は null", () => {
    expect(parseNoteUrl("https://misskey.io/@alice")).toBeNull();
    expect(parseNoteUrl("9abcXYZ")).toBeNull();
  });
});

describe("noteWebUrl", () => {
  it("リモートノートは url を、ローカルは見たサーバーで組む", () => {
    expect(noteWebUrl(note({ url: "https://other.example/notes/x" }))).toBe(
      "https://other.example/notes/x",
    );
    expect(noteWebUrl(note())).toBe("https://misskey.example/notes/abc123");
  });
});

describe("noteFileName", () => {
  it("日時 + ハンドル + id で、Obsidian が禁じる文字を含まない", () => {
    const name = noteFileName(note({ user: { ...note().user, username: "a/b" } }));
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2} \d{4} @a_b@misskey\.example abc123\.md$/);
    expect(name).not.toMatch(/[*"\\/<>:|?#]/);
  });
});

describe("noteToMarkdown", () => {
  it("frontmatter に出自を書き、本文をそのまま置く", () => {
    const md = noteToMarkdown(note());
    expect(md.startsWith('---\nnotedeck: note\nnote_id: "abc123"\n')).toBe(true);
    expect(md).toContain('author: "@alice@misskey.example"');
    expect(md).toContain('author_name: "Alice \\"A\\""');
    expect(md).toContain("\n---\n\nhello\nworld\n");
    expect(md).toContain("[Open in NoteDeck](notedeck://misskey.example/note/abc123)");
  });
  it("CW は折りたたみ callout にする", () => {
    const md = noteToMarkdown(note({ cw: "spoiler" }));
    expect(md).toContain('cw: "spoiler"');
    expect(md).toContain("> [!note]- spoiler\n> hello\n> world");
  });
  it("画像は埋め込み、センシティブと非画像はリンク", () => {
    const md = noteToMarkdown(
      note({
        files: [
          {
            id: "f1",
            name: "a.png",
            type: "image/png",
            url: "https://x/a.png",
            thumbnailUrl: null,
            isSensitive: false,
          },
          {
            id: "f2",
            name: "b.png",
            type: "image/png",
            url: "https://x/b.png",
            thumbnailUrl: null,
            isSensitive: true,
          },
          {
            id: "f3",
            name: "c.pdf",
            type: "application/pdf",
            url: "https://x/c.pdf",
            thumbnailUrl: null,
            isSensitive: false,
          },
        ],
      }),
    );
    expect(md).toContain("![a.png](https://x/a.png)");
    expect(md).toContain("\n[b.png](https://x/b.png)");
    expect(md).toContain("\n[c.pdf](https://x/c.pdf)");
  });
  it("引用は本文の後に blockquote で足す", () => {
    const md = noteToMarkdown(
      note({
        renoteId: "q1",
        renote: note({ id: "q1", text: "quoted", user: { ...note().user, username: "bob" } }),
      }),
    );
    expect(md).toContain('renote_of: "q1"');
    expect(md).toContain("> **@bob@misskey.example**");
    expect(md).toContain("> quoted");
  });
});
