# MD Reader

MD Reader is a small, focused Markdown reader and visual editor. The same Vanilla TypeScript frontend runs as a Tauri desktop app and a static browser app.

<p align="center"><i>Screenshot placeholder — a polished product screenshot can be added here.</i></p>

## Features

- Comfortable rendered reading view with GFM-style headings, lists, task lists, tables, quotes, links, images and fenced code.
- Visual formatted editor with a toolbar for headings, emphasis, lists, quotes, links, tables and code blocks, with Markdown round-trip for common blocks.
- A separate Source mode for direct raw Markdown editing when exact syntax control is needed.
- Create a new Markdown file, Open, Save, Save As, drag and drop, startup file arguments and single-instance file routing.
- Relative Markdown links and local images.
- Light, dark and system themes; font size, word wrap and zoom controls.
- UTF-8 and UTF-8 BOM support, including Cyrillic-safe file I/O.
- Native File, Edit, View, Window and Help menus.
- No account, telemetry, cloud sync, backend or database.

## Web version

Use MD Reader directly in your browser:

[Open MD Reader online](https://spnkd.github.io/md-reader/)

Files are processed locally in your browser. Nothing is uploaded.

The web app supports opening and dropping `.md`/`.markdown` files, Read/Edit/Source modes, and saving back through the File System Access API where available. Other browsers download a Markdown copy with Blob. Relative local images and linked Markdown files cannot be read automatically by a browser sandbox; open those files explicitly.

## Download

Download ready-to-install packages from [GitHub Releases](https://github.com/SpNkd/md-reader/releases) after the first release is published.

Expected release downloads:

- Windows x64: NSIS `.exe` installer.
- macOS: Apple Silicon `aarch64` and Intel `x86_64` `.dmg` installers.
- Linux x86_64: `.AppImage` and `.deb` packages.

## Supported platforms

- Windows 10 or later, x64.
- macOS 10.15 or later, Apple Silicon and Intel.
- Linux x86_64 distributions with WebKitGTK 4.1 support; CI targets Ubuntu 22.04.

## Installation

### Windows

Download the x64 NSIS `.exe` from Releases and run it. Unsigned development releases may show a Windows SmartScreen warning until the publisher is trusted.

### macOS

Choose the `.dmg` matching your Mac: `aarch64` for Apple Silicon or `x86_64` for Intel. Open it and drag `MD Reader.app` to Applications. The DMG is intentionally small because Tauri uses the system WebKit; the app bundle is larger once mounted.

The public `v0.1.0` build is not signed or notarized yet. If macOS reports that the app is “damaged” after downloading it from GitHub, remove the download quarantine after copying it to Applications, then launch it:

```bash
xattr -dr com.apple.quarantine "/Applications/MD Reader.app"
open "/Applications/MD Reader.app"
```

Future releases can remove this step after the Apple signing and notarization secrets described in `RELEASE.md` are configured.

### Linux

For AppImage, download the x86_64 file, make it executable and run it:

```bash
chmod +x ./*.AppImage
./*.AppImage
```

For Debian/Ubuntu, install the `.deb` package:

```bash
sudo apt install ./*.deb
```

## Usage

In the desktop app, choose Open Markdown or New File, drag a `.md` or `.markdown` file into the window, or pass a file path from the command line:

```bash
open -a "/Applications/MD Reader.app" "/path/to/document.md"
```

Use Read for the rendered document, Edit for the visual editor, or Source for direct raw Markdown editing. New unsaved documents are named `Untitled.md` until you use Save As. Closing the window or choosing Quit exits the application; unsaved edits prompt before exit.

In the web app, use Open Markdown, drag and drop, or Try an example. Save writes directly to the selected file in browsers that support the File System Access API; otherwise it downloads `Untitled.md` or the current document name.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + N` | New Markdown file |
| `Ctrl/Cmd + O` | Open |
| `Ctrl/Cmd + S` | Save |
| `Ctrl/Cmd + Shift + S` | Save As |
| `Ctrl/Cmd + E` | Read/Edit |
| `Ctrl/Cmd + + / - / 0` | Zoom in / out / reset |
| `Ctrl/Cmd + B / I` | Bold / italic in Edit |

## Development

Install the prerequisites for your operating system, then clone and start the development app:

```bash
git clone https://github.com/SpNkd/md-reader.git
cd md-reader
npm install
npm run tauri dev
```

For the browser version, run:

```bash
npm run web:dev
```

System prerequisites:

- Windows: Rust, Node.js 20+, Microsoft C++ Build Tools with “Desktop development with C++”, and WebView2. WebView2 is already present on supported Windows 10 and later installations in most cases.
- macOS: Rust, Node.js 20+ and Xcode Command Line Tools (`xcode-select --install`).
- Ubuntu/Debian Linux: Rust, Node.js 20+ and Tauri’s WebKitGTK dependencies:

  ```bash
  sudo apt update
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

See the [official Tauri prerequisites](https://tauri.app/start/prerequisites/) for other Linux distributions and platform-specific details.

## Building from source

Run the project checks:

```bash
npm ci
npm run check
npm run build
npm run web:build
node scripts/verify-web-build.mjs
cargo check --manifest-path src-tauri/Cargo.toml
```

`npm run web:build` produces the static `dist/` artifact. GitHub Pages builds it with the repository base path automatically; set `VITE_BASE=/md-reader/` to reproduce that layout locally.

Build a production bundle for the current operating system:

```bash
npm run tauri build
```

The GitHub release workflow builds Windows x64, macOS arm64/x86_64 and Linux x86_64 packages on their native runners. Cross-compiling installers locally is not assumed.

## Architecture

The frontend is intentionally small Vanilla TypeScript and CSS. The reader, renderer, editor, state, themes and keyboard handling are shared by desktop and web. Browser file picking and saving live in `src/platform/web-document-provider.ts`; Rust owns desktop file I/O, startup arguments, single-instance routing, native menus and packaging integration. See [ARCHITECTURE.md](ARCHITECTURE.md) for the technical rationale.

## Privacy

MD Reader is a local application. Markdown files are read and saved on the local computer; they are not uploaded, transmitted or sent to a remote service. The application has no analytics, telemetry, account system, cloud sync or backend server.

The web version is static and keeps Markdown in the browser. It does not use cookies, tracking, analytics or a server API. A lightweight service worker caches only the static app shell for best-effort offline use after the first visit.

## File associations

The Tauri bundle declares `.md` and `.markdown` as Markdown document types. After installing the application, the operating system can use MD Reader for Open With and double-click actions. If another application is already the default, choose MD Reader in Open With and select the option to always use it.

## Known limitations

- The editor is a lightweight MVP, not a full Typora-style block editor. Complex Markdown constructs may be normalized when switching through Edit and saving.
- Browser security prevents automatic access to neighboring files referenced by relative images or Markdown links. The web reader shows a safe placeholder for an unavailable local image and asks you to open linked Markdown explicitly.
- File System Access API save-back is available only in supporting secure browsers; Firefox/Safari use a normal Markdown download.
- Syntax highlighting, live preview split view, tabs, autosave and multi-window document management are outside the current MVP.
- macOS releases need Apple Developer signing and notarization secrets for a warning-free first launch; the workflow is prepared for them.
- Cross-platform installers are built in GitHub Actions; local verification on every target OS is still recommended.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the short contribution workflow. Security-sensitive reports belong in [SECURITY.md](SECURITY.md).

## License

MD Reader is released under the [MIT License](LICENSE).
