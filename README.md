# HTML Editor

A free, browser-based visual HTML editor. Drop in any `.html` file, edit it visually like Pinegrow or Webflow, and save back to your local disk with live changes.

**Live:** https://mncoleman.github.io/html-editor/

## Features

- **Live local file editing** — link to a file on your disk and `⌘S` writes the edits straight back (Chrome/Edge/Arc via the File System Access API).
- **Click-to-select, drag-to-drop** editing of any element on the canvas.
- **Component library** — 40+ blocks across Typography, Layout, Components, Media, Lists, Forms, Navigation, Tables.
- **Drag from sidebar into canvas** with precise drop-zone indicators (before / after / inside).
- **DOM tree** panel with collapse, drag-reorder, and click-to-select.
- **Properties panel** — visual editing of typography, layout, spacing, background, border, effects.
- **Class chips, attribute editor, raw outer/inner HTML** editor for every element.
- **Inline text editing** — double-click any text element.
- **Undo / redo** with full document snapshots.
- **Autosave** to localStorage (restore last session on page reload).
- **Snippets** — save any selection as a reusable block.
- **Device preview** — desktop / tablet / mobile frames.
- **Preview mode** — hides editor chrome to see the page as a visitor would.
- **Dark and light themes.**

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘S` / `Ctrl+S` | Save to linked file (or export) |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `⌘D` | Duplicate selection |
| `Delete` / `Backspace` | Delete selection |
| `Esc` | Deselect |
| `⌘↑` / `⌘↓` | Move selection up / down |
| `P` | Toggle preview mode |
| Double-click | Edit text inline |

## How it works

The user's HTML loads into a sandboxed iframe. The editor reaches in (same-origin) to listen for clicks, attach a `MutationObserver`, and write style/attribute/HTML changes. An overlay layer in the parent document renders the selection outline, hover highlight, and drop indicators.

For "live local editing" the editor uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API). Once you pick a file, the browser hands the editor a persistent write handle. Saving calls `createWritable()` and writes the current HTML back to disk. No upload, no server, no extension required.

Safari and Firefox don't support File System Access — they fall back to import / export (file picker in, `.html` download out).

## Local development

It's a static site. Any static server works:

```sh
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`.

## Architecture

```
index.html              — editor shell (toolbar + 3-pane workspace + statusbar)
css/editor.css          — all styling, dark/light tokens
js/state.js             — global state, undo/redo, autosave, snippets, recents
js/blocks.js            — component library (block definitions)
js/canvas.js            — iframe wiring, selection overlay, drag-drop, hover
js/tree.js              — DOM tree panel + status-bar breadcrumbs
js/properties.js        — style/attributes/HTML tabs
js/blocks-panel.js      — blocks sidebar + snippets/recent files
js/file.js              — File System Access API, import/export
js/keyboard.js          — global shortcuts
js/editor.js            — bootstrap, toolbar wiring, empty state
```

## License

MIT
