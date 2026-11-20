import type { Note } from "./api";

/** `https://host/notes/<id>` 形式の URL を host と id に分ける */
export function parseNoteUrl(input: string): { host: string; id: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const m = url.pathname.match(/^\/notes\/([A-Za-z0-9]+)\/?$/);
  if (!m || !url.host) return null;
  return { host: url.host, id: m[1] };
}

export function noteHandle(note: Note): string {
  return `@${note.user.username}@${note.user.host ?? note._serverHost}`;
}

function isHttpUrl(s: string | undefined): s is string {
  return s !== undefined && /^https?:\/\//i.test(s);
}

/**
 * 元サーバーの URL。リモートノートは `url` / `uri`、ローカルは見たサーバーで組む。
 * `url` / `uri` はリモートサーバーが決める値なので、http(s) 以外は使わない
 */
export function noteWebUrl(note: Note): string {
  return [note.url, note.uri].find(isHttpUrl) ?? `https://${note._serverHost}/notes/${note.id}`;
}

export function noteDeepLink(note: Note): string {
  return `notedeck://${note._serverHost}/note/${encodeURIComponent(note.id)}`;
}

function compactTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

/** vault 内で使えるファイル名 (Obsidian が禁じる `* " \ / < > : | ? #` を避ける) */
export function noteFileName(note: Note): string {
  const handle = noteHandle(note).replace(/[*"\\/<>:|?#]/g, "_");
  return `${compactTimestamp(note.createdAt)} ${handle} ${note.id}.md`;
}

function yamlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

/** URL にそのまま置ける文字。本文中の URL と、リンク先に書く URL の両方でこの範囲だけ素通しする */
const URL_CHAR = "[A-Za-z0-9\\-._~:/?#@!&=+,;]|%[0-9A-Fa-f]{2}";
const URL_IN_TEXT = new RegExp(`https?://(?:${URL_CHAR})+`, "g");
const URL_UNSAFE = new RegExp(`(?!${URL_CHAR})[^]`, "gu");

/**
 * 他人が書いた文を vault の Markdown に置くための無害化。Obsidian と plugin が動作として
 * 解釈する記法 (code fence と inline code = Dataview 等の実行系、HTML、`[[wikilink]]`、
 * `![[埋め込み]]` / `![](画像)`、Templater の `<% %>`、`%%コメント%%`、`$数式$`) を
 * backslash で止める。表示では backslash が消えて元の文字が読める。URL は壊さない。
 * Templater は Markdown を見ずに `<%` を探すので、`<` と `%` の両方に付けて並びを崩す。
 * `#hashtag` は Obsidian の tag として使えるよう、既定では残す
 */
export function escapeMarkdown(text: string, hashtagsAsTags = true): string {
  const special = hashtagsAsTags ? /[\\`~<[\]%$]/g : /[\\`~<[\]%$#]/g;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    out += text.slice(last, m.index).replace(special, "\\$&") + m[0];
    last = m.index + m[0].length;
  }
  return out + text.slice(last).replace(special, "\\$&");
}

/** `[text](ここ)` に置く URL。`)` や空白でリンクの外に出られないよう percent-encode する */
export function linkTarget(url: string): string {
  return url.replace(URL_UNSAFE, (c) =>
    encodeURIComponent(c).replace(
      /[!'()*]/g,
      (x) => `%${x.charCodeAt(0).toString(16).toUpperCase()}`,
    ),
  );
}

/** 本文も CW も添付も無い renote (引用でないただの renote) なら、その renote 元 */
export function renoteOnly(note: Note): Note | null {
  return !note.text && !note.cw && !note.files.length && note.renote ? note.renote : null;
}

/** 取り込み済みファイルの frontmatter が、このノートのものか (file 名には依らない) */
export function isClipOf(frontmatter: unknown, note: Note): boolean {
  const fm = frontmatter as { notedeck?: unknown; note_id?: unknown; server?: unknown } | null;
  return fm?.notedeck === "note" && fm.note_id === note.id && fm.server === note._serverHost;
}

export interface MarkdownOptions {
  /** false なら `#hashtag` も無害化して Obsidian の tag にしない */
  hashtagsAsTags?: boolean;
}

/**
 * ノート 1 件を YAML frontmatter つきの Markdown にする。
 * 本文は MFM を無害化して置く (Obsidian では平文として読める)。CW があれば折りたたみで出す。
 */
export function noteToMarkdown(note: Note, options: MarkdownOptions = {}): string {
  const esc = (s: string) => escapeMarkdown(s, options.hashtagsAsTags ?? true);
  const oneLine = (s: string) => esc(s.replace(/\s*\r?\n\s*/g, " "));
  const fileLine = (f: Note["files"][number]) => {
    const img = f.type.startsWith("image/") && !f.isSensitive;
    return isHttpUrl(f.url)
      ? `${img ? "!" : ""}[${oneLine(f.name)}](${linkTarget(f.url)})`
      : oneLine(f.name);
  };

  const lines: string[] = ["---"];
  lines.push("notedeck: note");
  lines.push(`note_id: ${yamlString(note.id)}`);
  lines.push(`url: ${yamlString(noteWebUrl(note))}`);
  lines.push(`server: ${yamlString(note._serverHost)}`);
  lines.push(`author: ${yamlString(noteHandle(note))}`);
  if (note.user.name) lines.push(`author_name: ${yamlString(note.user.name)}`);
  lines.push(`created: ${yamlString(note.createdAt)}`);
  lines.push(`visibility: ${yamlString(note.visibility)}`);
  if (note.cw) lines.push(`cw: ${yamlString(note.cw)}`);
  if (note.replyId) lines.push(`reply_to: ${yamlString(note.replyId)}`);
  if (note.renoteId) lines.push(`renote_of: ${yamlString(note.renoteId)}`);
  lines.push("tags:");
  lines.push("  - misskey");
  lines.push("---");
  lines.push("");

  const body = esc(note.text ?? "");
  if (note.cw) {
    lines.push(`> [!note]- ${oneLine(note.cw)}`);
    for (const l of body.split(/\r?\n/)) lines.push(`> ${l}`);
  } else if (body) {
    lines.push(body);
  }

  if (note.files.length) {
    lines.push("");
    for (const f of note.files) lines.push(fileLine(f));
  }

  // 引用 (本文つき) でも、ただの renote でも、renote 元の中身を出す
  const quoted = note.renote;
  if (quoted) {
    const url = linkTarget(noteWebUrl(quoted));
    lines.push("");
    lines.push(`> **${oneLine(noteHandle(quoted))}** — [${url}](${url})`);
    for (const l of esc(quoted.text ?? "").split(/\r?\n/)) lines.push(`> ${l}`);
    for (const f of quoted.files) lines.push(`> ${fileLine(f)}`);
  }

  lines.push("");
  lines.push(
    `[Open in NoteDeck](${noteDeepLink(note)}) · [Open on ${note._serverHost}](${noteWebUrl(note)})`,
  );
  lines.push("");
  return lines.join("\n");
}
