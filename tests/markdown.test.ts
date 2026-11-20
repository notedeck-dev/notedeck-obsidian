import { describe, expect, it } from "vitest";
import type { Note } from "../src/api";
import {
  escapeMarkdown,
  isClipOf,
  noteFileName,
  noteToMarkdown,
  noteWebUrl,
  parseNoteUrl,
  renoteOnly,
} from "../src/markdown";

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
  it("http(s) でない url / uri は使わず、見たサーバーで組む", () => {
    expect(noteWebUrl(note({ url: "javascript:alert(1)", uri: "file:///etc/hosts" }))).toBe(
      "https://misskey.example/notes/abc123",
    );
    expect(noteWebUrl(note({ url: "javascript:alert(1)", uri: "https://other.example/n/x" }))).toBe(
      "https://other.example/n/x",
    );
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
  it("http(s) でない添付の URL はリンクにしない", () => {
    const md = noteToMarkdown(
      note({
        files: [
          {
            id: "f1",
            name: "a.png",
            type: "image/png",
            url: "javascript:alert(1)",
            thumbnailUrl: null,
            isSensitive: false,
          },
        ],
      }),
    );
    expect(md).not.toContain("javascript:");
    expect(md).toContain("\na.png\n");
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
  it("本文だけの renote は renote 元の本文と添付を出す", () => {
    const md = noteToMarkdown(
      note({
        text: null,
        renoteId: "q1",
        renote: note({
          id: "q1",
          text: "original",
          user: { ...note().user, username: "bob" },
          files: [
            {
              id: "f1",
              name: "a.png",
              type: "image/png",
              url: "https://x/a.png",
              thumbnailUrl: null,
              isSensitive: false,
            },
          ],
        }),
      }),
    );
    expect(md).toContain("> **@bob@misskey.example**");
    expect(md).toContain("> original");
    expect(md).toContain("> ![a.png](https://x/a.png)");
  });
  it("本文・CW・添付名・引用の記法を無効化する", () => {
    const md = noteToMarkdown(
      note({
        text: "```dataviewjs\nevil()\n```\n[[Secret]] ![[Secret]] ![](https://t/p.png) <% tp.x %> <img src=x>",
        cw: "[[cw]]\n<b>",
        files: [
          {
            id: "f1",
            name: "a](https://evil/x) ![[b]].pdf",
            type: "application/pdf",
            url: "https://x/a) ![](https://t/p.png",
            thumbnailUrl: null,
            isSensitive: false,
          },
        ],
        renoteId: "q1",
        renote: note({ id: "q1", text: "![[q]]", user: { ...note().user, username: "[[bob]]" } }),
      }),
    );
    const body = md.slice(md.indexOf("\n---\n") + 5);
    expect(body).not.toMatch(/^\s*(```|~~~)/m);
    expect(body).not.toMatch(/(?<!\\)\[\[/);
    expect(body).not.toMatch(/(?<!\\)<[a-z%!/]/i);
    expect(body).not.toContain("<%");
    expect(body).not.toMatch(/(?<!\\)\]\(https:\/\/t\/p/);
    expect(body).not.toMatch(/(?<!\\)\]\(https:\/\/evil/);
    expect(body).toContain("> [!note]- \\[\\[cw\\]\\] \\<b>");
    expect(body).toContain("(https://x/a%29%20!%5B%5D%28https://t/p.png)");
  });
  it("#hashtag は既定で残し、指定すれば無効化する", () => {
    expect(noteToMarkdown(note({ text: "hi #tag" }))).toContain("\nhi #tag\n");
    expect(noteToMarkdown(note({ text: "hi #tag" }), { hashtagsAsTags: false })).toContain(
      "\nhi \\#tag\n",
    );
  });
});

describe("escapeMarkdown", () => {
  it("fence / HTML / wikilink / 埋め込み / Templater / コメント / 数式を無効化する", () => {
    expect(escapeMarkdown("```js\n~~~")).toBe("\\`\\`\\`js\n\\~\\~\\~");
    expect(escapeMarkdown("<script>")).toBe("\\<script>");
    expect(escapeMarkdown("[[a]] ![[b]] ![c](d)")).toBe("\\[\\[a\\]\\] !\\[\\[b\\]\\] !\\[c\\](d)");
    expect(escapeMarkdown("<% tp.file.title %>")).toBe("\\<\\% tp.file.title \\%>");
    expect(escapeMarkdown("%%hidden%% $x$")).toBe("\\%\\%hidden\\%\\% \\$x\\$");
    expect(escapeMarkdown("`$= evil()`")).toBe("\\`\\$= evil()\\`");
  });
  it("元からある backslash は二重にして、後ろの記号を生かさない", () => {
    expect(escapeMarkdown("\\`x\\`")).toBe("\\\\\\`x\\\\\\`");
  });
  it("URL は壊さない (URL に使える文字だけ)", () => {
    const url = "https://example.com/~u/a%20b?q=1&r=2#frag";
    expect(escapeMarkdown(`see ${url} ok`)).toBe(`see ${url} ok`);
    expect(escapeMarkdown("https://x/`$=1`")).toBe("https://x/\\`\\$=1\\`");
    expect(escapeMarkdown("https://x/%%a")).toBe("https://x/\\%\\%a");
  });
  it("#hashtag は指定したときだけ無効化する", () => {
    expect(escapeMarkdown("#a")).toBe("#a");
    expect(escapeMarkdown("#a https://x/#f", false)).toBe("\\#a https://x/#f");
  });
});

describe("renoteOnly", () => {
  it("本文も CW も添付も無い renote だけ、renote 元を返す", () => {
    const src = note({ id: "q1" });
    expect(renoteOnly(note({ text: null, renoteId: "q1", renote: src }))).toBe(src);
    expect(renoteOnly(note({ text: "quote", renoteId: "q1", renote: src }))).toBeNull();
    expect(renoteOnly(note({ text: null }))).toBeNull();
  });
});

describe("isClipOf", () => {
  it("frontmatter の note_id と server で同じノートか判定する", () => {
    const fm = { notedeck: "note", note_id: "abc123", server: "misskey.example" };
    expect(isClipOf(fm, note())).toBe(true);
    expect(isClipOf({ ...fm, note_id: "other" }, note())).toBe(false);
    expect(isClipOf({ ...fm, server: "other.example" }, note())).toBe(false);
    expect(isClipOf(undefined, note())).toBe(false);
  });
});
