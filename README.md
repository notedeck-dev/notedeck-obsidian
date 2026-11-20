# NoteDeck for Obsidian

Bring Misskey into your vault through [NoteDeck](https://github.com/notedeck-dev/notedeck) (a Misskey client, "Misskey Pro"). The plugin talks to NoteDeck's built-in HTTP API on `127.0.0.1:19820`, so NoteDeck has to be running on the same machine. Desktop only.

## What it does

| Command / UI | What it does | Needs |
| --- | --- | --- |
| **Clip a note by URL** | Fetch a note from a server you are logged in to and write it to the vault as Markdown with YAML frontmatter (author, URL, created, visibility, CW, attachments, quote). | token (`notes.read`, on by default) |
| **Search archive and clip** | Search the notes NoteDeck has seen, across servers and accounts. Enter clips the note into the vault, Mod+Enter inserts a link at the cursor. | token + `notes.readArchive` |
| **Post a note** | Write a note (account / visibility / CW), the current selection is the initial text. NoteDeck shows its usual confirmation before sending. | token + `notes.write` |
| **Open the app's post form with selection** | Hand the selection to NoteDeck's own post form (`notedeck://compose`). | nothing |
| **Timeline** (sidebar, ribbon icon) | home / local / social / global timeline of one account. New notes arrive live from NoteDeck's event stream. Click a note to clip it, open it in NoteDeck, open it on the server or copy the link. | token (`notes.read`, `account.read`) |

Commands marked "nothing" use `notedeck://` deep links: no token, no permission, no confirmation dialog, because you are the one clicking. They just need NoteDeck installed.

Clipped notes land in the folder from settings (default `NoteDeck/`) as `<date> <time> @user@host <id>.md`. A note that is already clipped (found by the note ID in its frontmatter, so renaming or moving the file is fine) is opened instead of overwritten. A CW becomes a collapsed callout; attached images are embedded, sensitive images and other files are linked; a renote includes the renoted note.

The text of a note is written by someone else, so it is escaped before it goes into your vault: code blocks and inline code (which Dataview and similar plugins would run), HTML, `[[wikilinks]]`, `![[embeds]]` and `![](images)`, Templater's `<% %>`, `%%comments%%` and `$math$` are written with backslashes and show up as plain text. URLs stay clickable. `#hashtags` are kept as Obsidian tags by default; turn off **Keep hashtags as tags** in the plugin settings to escape them too.

NoteDeck's own local memos (`notedeck/memos/*.md`) are not touched by this plugin: that folder is already a Markdown vault, open it in Obsidian directly if you want them.

## Setup

1. In NoteDeck open **Settings → Permissions → API tokens** and issue a token. Name it `obsidian` so NoteDeck's confirmation dialogs say where a request came from. Paste it into the plugin settings.
2. External tools get a read-only permission set by default. In the same Permissions window, under the **External** principal, allow what you want to use:
   - `notes.readArchive` for **Search archive and clip**
   - `notes.write` for **Post a note**
   - `notes.read` and `account.read` are on by default (timeline, clip by URL)
3. Writes (posting) are always confirmed inside the NoteDeck window. The Obsidian notice waits until you answer there.
4. **Check connection** in the plugin settings lists the accounts NoteDeck knows.

If you changed the HTTP API port, or run a development build of NoteDeck (which uses a different port), set **NoteDeck API URL** in the plugin settings. The URL has to point at this machine (`127.0.0.1`, `localhost` or `[::1]`); the plugin does not send the token anywhere else.

The token is kept in Obsidian's secret storage on Obsidian 1.11.4 and later. On older versions it is stored in the plugin's `data.json` in plain text, which travels with the vault if you sync or commit `.obsidian/`.

### Limits

- **Clip by URL** only works for URLs on servers you are logged in to in NoteDeck (the note is fetched through that account). Remote notes are reached through the archive search instead.
- The live timeline only receives notes for streams NoteDeck itself is subscribed to (the columns you have open), filtered to the selected account but not to the selected timeline type: NoteDeck's event stream does not say which timeline a note came from. The initial list is always fetched fresh.

## Install

Not in the community plugin list yet. Manual install:

1. Download `main.js`, `manifest.json` and `styles.css` from a release (or build them, see below).
2. Put them in `<vault>/.obsidian/plugins/notedeck/`.
3. Reload Obsidian and enable **NoteDeck** under Community plugins.

## Development

```sh
npm install
npm run dev        # esbuild watch → main.js
npm run build      # production bundle
npm run lint       # biome
npm run typecheck  # tsc
npm test           # vitest
```

Point `<vault>/.obsidian/plugins/notedeck` at this directory (symlink) and reload the plugin after each build.

The plugin only uses NoteDeck's local endpoints: `POST /api/capabilities/{id}/execute`, `GET /api/{host}/notes/{id}`, `GET /api/{host}/timeline/{type}`, `GET /api/events` (SSE), plus `notedeck://` deep links. Nothing is sent anywhere else. HTTP calls go through Obsidian's `requestUrl`; the event stream uses Node's `http` because NoteDeck's API only allows its own origins for CORS.

## Relationship to NoteDeck's other integrations

Same shape as the [Raycast extension](https://github.com/notedeck-dev/notedeck-raycast) and the [Stream Deck plugin](https://github.com/notedeck-dev/notedeck-streamdeck): a thin client of NoteDeck's HTTP API, hosted and started by the other app, with nothing added to NoteDeck itself.

## License

MIT. NoteDeck itself is AGPL-3.0; this plugin is a separate client of its public API.
