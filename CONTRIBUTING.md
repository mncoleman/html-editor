# Contributing

Thanks for your interest. This is a small, focused project — please read this short guide before opening a PR.

## Setup

It's a static site. No build step, no dependencies.

```sh
git clone https://github.com/mncoleman/html-editor.git
cd html-editor
python3 -m http.server 8000        # or: npx serve .
```

Open `http://localhost:8000`.

> The File System Access API needs a secure context. `localhost` counts as secure, so live-link editing works in local dev.

## Project layout

```
index.html              editor shell
css/editor.css          all styles (dark + light tokens at the top)
js/state.js             central state, undo/redo, autosave
js/blocks.js            component-library data (add new blocks here)
js/canvas.js            iframe wiring, selection, drag-drop
js/tree.js              DOM tree panel + breadcrumbs
js/properties.js        style / attrs / HTML tabs
js/blocks-panel.js      blocks sidebar + snippets/recents
js/file.js              File System Access API + import/export
js/keyboard.js          global shortcuts
js/editor.js            bootstrap & toolbar wiring
```

Modules are vanilla JS (no bundler). Each one exports a singleton on `window` (e.g. `window.Canvas`, `window.EditorState`). State changes flow through `EditorState.emit/on`.

## Code style

- Vanilla JS, no frameworks. No build step. No npm dependencies.
- Browser baseline: latest Chrome, Edge, Safari, Firefox. File System Access is Chromium-only — guard with `'showOpenFilePicker' in window` and `window.isSecureContext`.
- Two-space indent, single quotes, semicolons. Match the surrounding style.
- Keep modules small and focused. Cross-module state goes through `EditorState`.

## Common tasks

### Add a new component block

Append to `js/blocks.js`:

```js
{ cat: 'Components', name: 'Pricing card', icon: '💵', html: '<div>…</div>' }
```

Categories already in use: `Typography`, `Layout`, `Components`, `Media`, `Lists`, `Forms`, `Navigation`, `Tables`, `Raw`. Create a new category by using a new `cat` string — it'll get its own section header automatically.

The `html` string is what gets dropped into the canvas. Keep it self-contained (inline styles are fine, no external dependencies).

### Add a style control to the Properties panel

Edit `renderStyle()` in `js/properties.js`. Use the existing helpers:

- `textRow(label, value, onChange)` — free text
- `lengthRow(label, value, onChange)` — CSS length
- `selectRow(label, value, options, onChange)` — dropdown
- `colorRow(label, value, onChange)` — color picker + hex
- `sliderRow(label, value, min, max, step, onChange)` — range slider

Call `setStyle(el, 'css-property', value)` from `onChange` — that handles snapshot debouncing.

### Add a keyboard shortcut

Edit `js/keyboard.js`. `isInField()` filters out events fired while typing in an input.

### Change a theme color

Edit the CSS custom properties at the top of `css/editor.css` (`:root` for dark, `html[data-theme="light"]` for light).

## Pull requests

1. Fork, branch, work in `main` (or a feature branch).
2. Keep PRs small — one feature or one fix per PR.
3. Include a short description of *why*, plus a screenshot or GIF if it's UI-facing.
4. Test in Chrome (FSA path) and at least one non-Chromium browser (import/export path).
5. Run a quick syntax check: `for f in js/*.js; do node --check "$f"; done`.

## Reporting bugs

Open an issue with:
- Browser + OS
- Steps to reproduce
- What you expected vs. what happened
- Console output if there are errors

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE) of this project.
