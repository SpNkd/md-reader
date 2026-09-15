# MD Reader — architecture

## Stack

Tauri 2, Rust, Vite and vanilla TypeScript/CSS. There is no SPA framework or UI kit. Tauri keeps the native shell and file integration small while the frontend stays a single eagerly loaded reader surface.

## Markdown and editor

The app uses a small local GFM-oriented renderer in `src/main.ts`. It supports headings, paragraphs, emphasis, strike, links, images, fenced code, quotes, lists, task lists, tables and rules. Text and raw HTML are escaped; URL schemes are allow-listed. Local image URLs are converted through Tauri's asset protocol relative to the open document.

Edit mode lazily creates a `contenteditable` surface from the rendered HTML. This is intentionally a small MVP compromise instead of shipping a large ProseMirror/Milkdown stack: the user edits formatted blocks, while a DOM serializer writes Markdown back. The reader path never loads an editor dependency.

## File handling and OS integration

Rust owns UTF-8/BOM-aware reads and writes and validates Markdown extensions. Tauri's dialog plugin supplies native Open and Save As dialogs. The opener plugin sends external links to the system browser. The single-instance plugin focuses the existing window and emits a file-open event. Tauri bundle metadata declares `.md` and `.markdown` associations for Windows, macOS and Linux; generated installers still need verification on each target OS.

## Startup and state

The initial argument is read by a Rust command. Subsequent arguments from the single-instance plugin are delivered as events. The frontend keeps one small document state object and localStorage preferences. The editor surface is created only after Edit is selected.

## Size expectations

The frontend has no runtime framework and only small Tauri API/plugin clients. Native binary size and installer compression depend on platform WebView/runtime packaging; measure them with `npm run tauri build -- --no-bundle` and platform-specific bundle commands after the toolchain is installed.
