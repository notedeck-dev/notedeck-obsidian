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

/**
 * ノート 1 件を YAML frontmatter つきの Markdown にする。
 * 本文は MFM のまま (Obsidian では平文として読める)。CW があれば折りたたみで出す。
 */
export function noteToMarkdown(note: Note): string {
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

  const body = note.text ?? "";
  if (note.cw) {
    lines.push(`> [!note]- ${note.cw}`);
    for (const l of body.split(/\r?\n/)) lines.push(`> ${l}`);
  } else if (body) {
    lines.push(body);
  }

  if (note.files.length) {
    lines.push("");
    for (const f of note.files) {
      const img = f.type.startsWith("image/") && !f.isSensitive;
      lines.push(isHttpUrl(f.url) ? `${img ? "!" : ""}[${f.name}](${f.url})` : f.name);
    }
  }

  const quoted = note.renote;
  if (quoted && note.text) {
    lines.push("");
    lines.push(`> **${noteHandle(quoted)}** — [${noteWebUrl(quoted)}](${noteWebUrl(quoted)})`);
    for (const l of (quoted.text ?? "").split(/\r?\n/)) lines.push(`> ${l}`);
  }

  lines.push("");
  lines.push(
    `[Open in NoteDeck](${noteDeepLink(note)}) · [Open on ${note._serverHost}](${noteWebUrl(note)})`,
  );
  lines.push("");
  return lines.join("\n");
}
