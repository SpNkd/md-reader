import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { pickMarkdownDocument, saveMarkdownDocument, type BrowserFileHandle } from "./platform/web-document-provider";
import type { EditorController } from "./editor";
import "./styles.css";

type Mode = "read" | "edit" | "source";
type Theme = "system" | "light" | "dark";
type FontSize = "smaller" | "default" | "larger";

interface DocumentState {
  path: string | null;
  webHandle: BrowserFileHandle | null;
  name: string;
  markdown: string;
  savedMarkdown: string;
  dirty: boolean;
  mode: Mode;
}

interface Preferences {
  theme: Theme;
  fontSize: FontSize;
  wordWrap: boolean;
  zoom: number;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing");

const state: DocumentState = {
  path: null,
  webHandle: null,
  name: "MD Reader",
  markdown: "",
  savedMarkdown: "",
  dirty: false,
  mode: "read",
};

const preferences: Preferences = loadPreferences();
let editorController: EditorController | null = null;
let editorLoadId = 0;
let menuOpen = false;
let quitting = false;
let unlistenOpenFile: UnlistenFn | undefined;
let unlistenNativeMenu: UnlistenFn | undefined;
let unlistenExitRequested: UnlistenFn | undefined;
const openingPaths = new Set<string>();

const SAMPLE_MARKDOWN = `# Welcome to MD Reader

This is a small Markdown document running entirely in your browser.

## Try the basics

- Switch between **Read**, **Edit**, and **Source**.
- Edit a table directly in visual mode.
- Use **Save** to write the document back or download a copy.

| Feature | Where it works |
| --- | --- |
| Reading | Desktop and web |
| Editing | Desktop and web |
| Files | Local device only |

> Your files stay on your device. Nothing is uploaded.
`;

app.innerHTML = `
  <main class="window-shell">
    <header class="topbar" aria-label="Document toolbar">
      <div class="window-title-group">
        <span class="app-mark" aria-hidden="true">.md</span>
        <span id="document-name" class="document-name">MD Reader</span>
        <span id="dirty-indicator" class="dirty-indicator" hidden aria-label="Unsaved changes">●</span>
      </div>
      <nav class="toolbar-actions">
        <div class="mode-switch" role="group" aria-label="View mode">
          <button id="read-button" class="mode-button active" type="button">Read</button>
          <button id="edit-button" class="mode-button" type="button">Edit</button>
          <button id="source-button" class="mode-button" type="button">Source</button>
        </div>
        <button id="menu-button" class="icon-button" type="button" aria-label="More options" aria-expanded="false">•••</button>
        <div id="menu" class="menu" hidden>
          <button id="menu-new" type="button">New Markdown File <span>⌘N</span></button>
          <button id="menu-open" type="button">Open Markdown <span>⌘O</span></button>
          <button id="menu-save" type="button">Save <span>⌘S</span></button>
          <button id="menu-save-as" type="button">Save As… <span>⇧⌘S</span></button>
          <div class="menu-divider"></div>
          <div class="menu-label">Theme</div>
          <button data-theme="system" type="button">Follow System <span class="check" data-check="system"></span></button>
          <button data-theme="light" type="button">Light <span class="check" data-check="light"></span></button>
          <button data-theme="dark" type="button">Dark <span class="check" data-check="dark"></span></button>
          <div class="menu-label">Font Size</div>
          <button data-font-size="smaller" type="button">Smaller <span class="check" data-check="smaller"></span></button>
          <button data-font-size="default" type="button">Default <span class="check" data-check="default"></span></button>
          <button data-font-size="larger" type="button">Larger <span class="check" data-check="larger"></span></button>
          <button id="menu-wrap" type="button">Word Wrap <span id="wrap-check" class="check"></span></button>
          <div class="menu-divider"></div>
          <button id="menu-about" type="button">About MD Reader</button>
        </div>
      </nav>
    </header>
    <section id="workspace" class="workspace">
      <section id="welcome" class="welcome" aria-label="Welcome">
        <div class="welcome-card">
          <div class="welcome-mark">.md</div>
          <h1>MD Reader</h1>
          <p>Drop a Markdown file here<br /><span>or</span></p>
          <div class="welcome-actions">
            <button id="welcome-open" class="primary-button" type="button">Open Markdown</button>
            <button id="welcome-new" class="secondary-button" type="button">New File</button>
          </div>
          <button id="welcome-demo" class="text-button" type="button">Try an example</button>
          <p class="welcome-hint">.md and .markdown</p>
          <p class="privacy-note">Your files stay on your device.<br />Nothing is uploaded.</p>
        </div>
      </section>
      <article id="reader" class="content reader-content" hidden></article>
      <div id="editor-toolbar" class="editor-toolbar" hidden aria-label="Formatting toolbar">
        <select id="format-select" class="format-select" aria-label="Text style">
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="blockquote">Quote</option>
          <option value="pre">Code block</option>
        </select>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button class="format-button" data-command="bold" type="button" aria-label="Bold" title="Bold (⌘B)"><strong>B</strong></button>
        <button class="format-button" data-command="italic" type="button" aria-label="Italic" title="Italic (⌘I)"><em>I</em></button>
        <button class="format-button" data-command="strikeThrough" type="button" aria-label="Strikethrough" title="Strikethrough"><s>S</s></button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button class="format-button" data-command="insertUnorderedList" type="button" aria-label="Bullet list" title="Bullet list">•≡</button>
        <button class="format-button" data-command="insertOrderedList" type="button" aria-label="Numbered list" title="Numbered list">1≡</button>
        <button class="format-button" data-command="blockquote" type="button" aria-label="Quote" title="Quote">❝</button>
        <button class="format-button" data-command="createTable" type="button" aria-label="Insert table" title="Insert table">▦</button>
        <button class="format-button" data-command="createLink" type="button" aria-label="Insert link" title="Insert link">↗</button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button class="format-button" data-command="undo" type="button" aria-label="Undo" title="Undo (⌘Z)">↶</button>
        <button class="format-button" data-command="redo" type="button" aria-label="Redo" title="Redo (⇧⌘Z)">↷</button>
      </div>
      <div id="editor-host" class="content editor-host" hidden></div>
      <textarea id="source-editor" class="content source-editor" hidden spellcheck="false" aria-label="Raw Markdown source" placeholder="Start writing Markdown…"></textarea>
      <div id="empty-state" class="empty-state" hidden>
        <p>This document is empty.</p>
      </div>
    </section>
    <div id="drop-overlay" class="drop-overlay" hidden>
      <div class="drop-card"><span class="drop-icon">↓</span><strong>Drop Markdown file</strong><span>to open it in MD Reader</span></div>
    </div>
    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    <dialog id="confirm-dialog" class="confirm-dialog">
      <form method="dialog">
        <h2>Save changes?</h2>
        <p id="confirm-message">Your changes will be lost if you don't save them.</p>
        <div class="dialog-actions">
          <button value="cancel" type="submit">Cancel</button>
          <button id="discard-button" value="discard" class="quiet-danger" type="submit">Don’t Save</button>
          <button id="confirm-save-button" value="save" class="primary-button" type="submit">Save</button>
        </div>
      </form>
    </dialog>
    <dialog id="table-dialog" class="table-dialog">
      <form method="dialog">
        <h2>Insert table</h2>
        <p>Choose the size. The first row will be the table header.</p>
        <div class="table-fields">
          <label class="table-field">Rows <input id="table-rows" type="number" min="2" max="20" value="3" /></label>
          <label class="table-field">Columns <input id="table-columns" type="number" min="1" max="10" value="3" /></label>
        </div>
        <div class="dialog-actions">
          <button value="cancel" type="submit">Cancel</button>
          <button value="insert" class="primary-button" type="submit">Insert table</button>
        </div>
      </form>
    </dialog>
    <dialog id="about-dialog" class="about-dialog">
      <div class="about-content">
        <div class="about-mark">.md</div>
        <h2>MD Reader</h2>
        <p class="about-version">Version 0.2.1</p>
        <p>A focused, local Markdown reader and visual editor.</p>
        <p class="about-note">Your Markdown files stay on this computer. MD Reader does not upload or send them anywhere.</p>
        <a href="#" data-external-url="https://github.com/SpNkd/md-reader">View project on GitHub ↗</a>
        <form method="dialog"><button class="primary-button" type="submit">Done</button></form>
      </div>
    </dialog>
  </main>
`;

const documentName = getElement<HTMLSpanElement>("document-name");
const dirtyIndicator = getElement<HTMLSpanElement>("dirty-indicator");
const reader = getElement<HTMLElement>("reader");
const editorHost = getElement<HTMLDivElement>("editor-host");
const welcome = getElement<HTMLElement>("welcome");
const emptyState = getElement<HTMLElement>("empty-state");
const menu = getElement<HTMLDivElement>("menu");
const menuButton = getElement<HTMLButtonElement>("menu-button");
const toast = getElement<HTMLDivElement>("toast");
const confirmDialog = getElement<HTMLDialogElement>("confirm-dialog");
const tableDialog = getElement<HTMLDialogElement>("table-dialog");
const tableRowsInput = getElement<HTMLInputElement>("table-rows");
const tableColumnsInput = getElement<HTMLInputElement>("table-columns");
const aboutDialog = getElement<HTMLDialogElement>("about-dialog");
const editorToolbar = getElement<HTMLDivElement>("editor-toolbar");
const formatSelect = getElement<HTMLSelectElement>("format-select");
const sourceEditor = getElement<HTMLTextAreaElement>("source-editor");
const dropOverlay = getElement<HTMLDivElement>("drop-overlay");

bootstrap();

async function bootstrap(): Promise<void> {
  document.documentElement.classList.toggle("web-mode", !isTauri());
  applyPreferences();
  wireEvents();

  if (!isTauri()) registerServiceWorker();

  if (isTauri()) {
    try {
      unlistenOpenFile = await listen<string>("open-file", (event) => {
        void openDocument(event.payload);
      });
      unlistenNativeMenu = await listen<string>("native-menu", (event) => {
        if (event.payload === "new") void newDocument();
        else if (event.payload === "open") void chooseAndOpen();
        else if (event.payload === "save") void saveDocument();
        else if (event.payload === "save-as") void saveAs();
        else if (event.payload === "quit") void requestQuit();
        else if (event.payload === "about" && !aboutDialog.open) aboutDialog.showModal();
        else if (event.payload === "toggle-mode") void setMode(state.mode === "read" ? "edit" : "read");
        else if (event.payload === "zoom-in") adjustZoom(0.05);
        else if (event.payload === "zoom-out") adjustZoom(-0.05);
        else if (event.payload === "zoom-reset") {
          preferences.zoom = 1;
          savePreferences();
          applyPreferences();
        }
      });
      const startupPath = await invoke<string | null>("startup_file");
      if (startupPath) await openDocument(startupPath);
      unlistenExitRequested = await listen("exit-requested", () => { void requestQuit(); });
    } catch (error) {
      showToast(errorMessage(error));
    }
  }
}

function wireEvents(): void {
  getElement<HTMLButtonElement>("welcome-open").addEventListener("click", () => void chooseAndOpen());
  getElement<HTMLButtonElement>("welcome-new").addEventListener("click", () => void newDocument());
  getElement<HTMLButtonElement>("welcome-demo").addEventListener("click", () => void openDemo());
  getElement<HTMLButtonElement>("menu-new").addEventListener("click", () => void newDocument());
  getElement<HTMLButtonElement>("menu-open").addEventListener("click", () => void chooseAndOpen());
  getElement<HTMLButtonElement>("menu-save").addEventListener("click", () => void saveDocument());
  getElement<HTMLButtonElement>("menu-save-as").addEventListener("click", () => void saveAs());
  getElement<HTMLButtonElement>("read-button").addEventListener("click", () => void setMode("read"));
  getElement<HTMLButtonElement>("edit-button").addEventListener("click", () => void setMode("edit"));
  getElement<HTMLButtonElement>("source-button").addEventListener("click", () => void setMode("source"));
  sourceEditor.addEventListener("input", syncFromSource);
  getElement<HTMLButtonElement>("menu-wrap").addEventListener("click", () => {
    preferences.wordWrap = !preferences.wordWrap;
    savePreferences();
    applyPreferences();
    updateMenuChecks();
  });
  getElement<HTMLButtonElement>("menu-about").addEventListener("click", () => {
    closeMenu();
    aboutDialog.showModal();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      preferences.theme = button.dataset.theme as Theme;
      savePreferences();
      applyPreferences();
      updateMenuChecks();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-font-size]").forEach((button) => {
    button.addEventListener("click", () => {
      preferences.fontSize = button.dataset.fontSize as FontSize;
      savePreferences();
      applyPreferences();
      updateMenuChecks();
    });
  });

  menuButton.addEventListener("click", () => {
    menuOpen ? closeMenu() : openMenu();
  });
  document.addEventListener("click", (event) => {
    if (menuOpen && !menu.contains(event.target as Node) && event.target !== menuButton) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    if (key === "o") {
      event.preventDefault();
      void chooseAndOpen();
    } else if (key === "n") {
      event.preventDefault();
      void newDocument();
    } else if (key === "s" && event.shiftKey) {
      event.preventDefault();
      void saveAs();
    } else if (key === "s") {
      event.preventDefault();
      void saveDocument();
    } else if (key === "e") {
      event.preventDefault();
      void setMode(state.mode === "read" ? "edit" : "read");
    } else if (key === "+" || key === "=") {
      event.preventDefault();
      adjustZoom(0.05);
    } else if (key === "-") {
      event.preventDefault();
      adjustZoom(-0.05);
    } else if (key === "0") {
      event.preventDefault();
      preferences.zoom = 1;
      savePreferences();
      applyPreferences();
    } else if (state.mode === "edit" && (key === "b" || key === "i")) {
      event.preventDefault();
      editorController?.runCommand(key === "b" ? "bold" : "italic");
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>("a");
    if (!link) return;
    const mdPath = link.dataset.mdPath;
    if (mdPath) {
      event.preventDefault();
      if (isTauri()) void openDocument(mdPath);
      else showToast("Open linked Markdown files with Open Markdown");
    } else if (link.dataset.externalUrl) {
      event.preventDefault();
      void openExternalUrl(link.dataset.externalUrl);
    }
  });

  const workspace = getElement<HTMLElement>("workspace");
  workspace.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dropOverlay.hidden = false;
  });
  workspace.addEventListener("dragover", (event) => event.preventDefault());
  workspace.addEventListener("dragleave", (event) => {
    if (event.target === workspace) dropOverlay.hidden = true;
  });
  workspace.addEventListener("drop", (event) => {
    event.preventDefault();
    dropOverlay.hidden = true;
    const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
    const file = files[0];
    const droppedPath = file ? (file as File & { path?: string }).path : undefined;
    if (droppedPath) void openDocument(droppedPath);
    else if (file) void readDroppedBrowserFile(file);
  });

  if (isTauri()) {
    void getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        dropOverlay.hidden = false;
      } else if (event.payload.type === "drop") {
        dropOverlay.hidden = true;
        const path = event.payload.paths.find((candidate) => isMarkdownPath(candidate));
        if (path) void openDocument(path);
      } else {
        dropOverlay.hidden = true;
      }
    });

    void getCurrentWindow().onCloseRequested(async (event) => {
      if (quitting) return;
      event.preventDefault();
      await requestQuit();
    });
  }
}

async function requestQuit(): Promise<void> {
  if (quitting) return;
  syncFromActiveEditor();
  if (state.dirty) {
    const choice = await askSaveChanges();
    if (choice === "save") {
      const saved = await saveDocument();
      if (!saved) return;
    } else if (choice !== "discard") {
      return;
    }
  }
  quitting = true;
  if (isTauri()) {
    try {
      await invoke("quit_app");
    } catch (error) {
      quitting = false;
      showToast(`Could not quit: ${errorMessage(error)}`);
    }
  } else {
    window.close();
  }
}

async function readDroppedBrowserFile(file: File): Promise<void> {
  if (!isMarkdownPath(file.name)) {
    showToast("Please choose a .md or .markdown file");
    return;
  }
  try {
    const content = await file.text();
    await replaceDocument({ path: null, webHandle: null, name: file.name, content });
  } catch (error) {
    showToast(`Could not open file: ${errorMessage(error)}`);
  }
}

async function chooseAndOpen(): Promise<void> {
  closeMenu();
  if (!isTauri()) {
    const selected = await pickMarkdownDocument();
    if (selected) await replaceDocument({ path: null, webHandle: selected.handle, name: selected.name, content: selected.content });
    return;
  }
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (typeof selected === "string") await openDocument(selected);
}

async function newDocument(): Promise<void> {
  closeMenu();
  if (!(await confirmBeforeReplacing())) return;
  state.path = null;
  state.webHandle = null;
  state.name = "Untitled.md";
  state.markdown = "";
  state.savedMarkdown = "";
  state.dirty = false;
  state.mode = "edit";
  editorController?.destroy();
  editorController = null;
  renderState();
  window.setTimeout(() => editorController?.focus(), 0);
}

async function openDemo(): Promise<void> {
  closeMenu();
  if (!(await confirmBeforeReplacing())) return;
  await replaceDocument({ path: null, webHandle: null, name: "Example.md", content: SAMPLE_MARKDOWN });
}

async function openDocument(path: string): Promise<void> {
  if (!isTauri()) {
    showToast("Open linked Markdown files with Open Markdown");
    return;
  }
  if (!isMarkdownPath(path)) {
    showToast("MD Reader opens .md and .markdown files");
    return;
  }
  if (openingPaths.has(path) || (state.path === path && !state.dirty)) return;
  openingPaths.add(path);
  if (!(await confirmBeforeReplacing())) {
    openingPaths.delete(path);
    return;
  }
  try {
    const content = await invoke<string>("read_markdown", { path });
    await replaceDocument({ path, webHandle: null, name: fileName(path), content });
  } catch (error) {
    showToast(`Could not open file: ${errorMessage(error)}`);
  } finally {
    openingPaths.delete(path);
  }
}

async function replaceDocument(document: { path: string | null; webHandle: BrowserFileHandle | null; name: string; content: string }): Promise<void> {
  state.path = document.path;
  state.webHandle = document.webHandle;
  state.name = document.name;
  state.markdown = document.content;
  state.savedMarkdown = document.content;
  state.dirty = false;
  state.mode = "read";
  editorController?.destroy();
  editorController = null;
  renderState();
}

async function setMode(mode: Mode): Promise<void> {
  if (mode === state.mode || state.name === "MD Reader") return;
  syncFromActiveEditor();
  state.mode = mode;
  renderState();
}

function renderState(): void {
  documentName.textContent = state.name;
  dirtyIndicator.hidden = !state.dirty;
  const hasDocument = Boolean(state.path || state.name !== "MD Reader");
  welcome.hidden = hasDocument;
  reader.hidden = !hasDocument || state.mode !== "read";
  editorToolbar.hidden = !hasDocument || state.mode !== "edit";
  editorHost.hidden = !hasDocument || state.mode !== "edit";
  sourceEditor.hidden = !hasDocument || state.mode !== "source";
  updateEmptyState();

  getElement<HTMLButtonElement>("read-button").classList.toggle("active", state.mode === "read");
  getElement<HTMLButtonElement>("edit-button").classList.toggle("active", state.mode === "edit");
  getElement<HTMLButtonElement>("source-button").classList.toggle("active", state.mode === "source");

  if (!hasDocument) {
    editorLoadId += 1;
    editorController?.destroy();
    editorController = null;
    reader.innerHTML = "";
    editorHost.innerHTML = "";
    sourceEditor.value = "";
    return;
  }
  if (state.mode === "read") {
    editorLoadId += 1;
    editorController?.destroy();
    editorController = null;
    reader.innerHTML = renderMarkdown(state.markdown, state.path);
  } else if (state.mode === "edit") {
    editorController?.destroy();
    editorController = null;
    editorHost.innerHTML = `<div class="editor-loading">Loading editor…</div>`;
    const loadId = ++editorLoadId;
    void loadEditor(loadId);
  } else {
    editorLoadId += 1;
    editorController?.destroy();
    editorController = null;
    sourceEditor.value = state.markdown;
    window.setTimeout(() => {
      if (state.mode === "source" && !sourceEditor.hidden) sourceEditor.focus();
    }, 0);
  }
  updateMenuChecks();
}

async function loadEditor(loadId: number): Promise<void> {
  try {
    const { mountEditor } = await import("./editor");
    if (loadId !== editorLoadId || state.mode !== "edit") return;
    editorController = mountEditor({
      host: editorHost,
      toolbar: editorToolbar,
      formatSelect,
      tableDialog,
      tableRowsInput,
      tableColumnsInput,
      markdown: state.markdown,
      documentPath: state.path,
      renderMarkdown,
      onChange: (markdown) => {
        state.markdown = markdown;
        state.dirty = state.markdown !== state.savedMarkdown;
        dirtyIndicator.hidden = !state.dirty;
        updateEmptyState();
      },
      onInvalidLink: () => showToast("Only http, https, mailto, tel, and Markdown links are allowed"),
    });
    editorController.focus();
  } catch (error) {
    if (loadId === editorLoadId && state.mode === "edit") showToast(`Could not load editor: ${errorMessage(error)}`);
  }
}

function syncFromSource(): void {
  state.markdown = sourceEditor.value;
  state.dirty = state.markdown !== state.savedMarkdown;
  dirtyIndicator.hidden = !state.dirty;
  updateEmptyState();
}

function syncFromActiveEditor(): void {
  if (state.mode === "edit") editorController?.sync();
  else if (state.mode === "source") syncFromSource();
}

function updateEmptyState(): void {
  const hasDocument = Boolean(state.path || state.name !== "MD Reader");
  emptyState.hidden = !hasDocument || state.mode === "source" || Boolean(state.markdown.trim());
}

async function saveDocument(): Promise<boolean> {
  closeMenu();
  syncFromActiveEditor();
  if (!isTauri()) {
    try {
      const saved = await saveMarkdownDocument(state.markdown, state.name, state.webHandle);
      if (!saved) return false;
      state.name = saved.name;
      state.webHandle = saved.handle;
      state.savedMarkdown = state.markdown;
      state.dirty = false;
      dirtyIndicator.hidden = true;
      showToast(saved.handle ? "Saved" : "Downloaded .md");
      return true;
    } catch (error) {
      showToast(`Could not save file: ${errorMessage(error)}`);
      return false;
    }
  }
  if (!state.path) return saveAs();
  try {
    await invoke("write_markdown", { path: state.path, content: state.markdown });
    state.savedMarkdown = state.markdown;
    state.dirty = false;
    dirtyIndicator.hidden = true;
    showToast("Saved");
    return true;
  } catch (error) {
    showToast(`Could not save file: ${errorMessage(error)}`);
    return false;
  }
}

async function saveAs(): Promise<boolean> {
  closeMenu();
  syncFromActiveEditor();
  if (!isTauri()) {
    try {
      const saved = await saveMarkdownDocument(state.markdown, state.name, null);
      if (!saved) return false;
      state.path = null;
      state.name = saved.name;
      state.webHandle = saved.handle;
      state.savedMarkdown = state.markdown;
      state.dirty = false;
      renderState();
      showToast(saved.handle ? "Saved" : "Downloaded .md");
      return true;
    } catch (error) {
      showToast(`Could not save file: ${errorMessage(error)}`);
      return false;
    }
  }
  const selected = await saveDialog({
    defaultPath: state.path ?? "untitled.md",
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (typeof selected !== "string") return false;
  const path = isMarkdownPath(selected) ? selected : `${selected}.md`;
  try {
    await invoke("write_markdown", { path, content: state.markdown });
    state.path = path;
    state.webHandle = null;
    state.name = fileName(path);
    state.savedMarkdown = state.markdown;
    state.dirty = false;
    renderState();
    showToast("Saved");
    return true;
  } catch (error) {
    showToast(`Could not save file: ${errorMessage(error)}`);
    return false;
  }
}

async function confirmBeforeReplacing(): Promise<boolean> {
  if (!state.dirty) return true;
  const choice = await askSaveChanges();
  if (choice === "save") return saveDocument();
  return choice === "discard";
}

function askSaveChanges(): Promise<"save" | "discard" | "cancel"> {
  if (confirmDialog.open) confirmDialog.close("cancel");
  confirmDialog.showModal();
  return new Promise((resolve) => {
    const finish = (): void => {
      confirmDialog.removeEventListener("close", finish);
      resolve((confirmDialog.returnValue || "cancel") as "save" | "discard" | "cancel");
    };
    confirmDialog.addEventListener("close", finish, { once: true });
  });
}

function openMenu(): void {
  menuOpen = true;
  menu.hidden = false;
  menuButton.setAttribute("aria-expanded", "true");
  updateMenuChecks();
}

function closeMenu(): void {
  menuOpen = false;
  menu.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
}

function updateMenuChecks(): void {
  document.querySelectorAll<HTMLElement>("[data-check]").forEach((element) => {
    const groupValue = element.dataset.check;
    const selected = groupValue === preferences.theme || groupValue === preferences.fontSize;
    element.textContent = selected ? "✓" : "";
  });
  getElement<HTMLSpanElement>("wrap-check").textContent = preferences.wordWrap ? "✓" : "";
}

function applyPreferences(): void {
  document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.dataset.fontSize = preferences.fontSize;
  document.documentElement.style.setProperty("--zoom", String(preferences.zoom));
  document.documentElement.classList.toggle("no-wrap", !preferences.wordWrap);
  updateMenuChecks();
}

function adjustZoom(amount: number): void {
  preferences.zoom = Math.max(0.85, Math.min(1.25, Number((preferences.zoom + amount).toFixed(2))));
  savePreferences();
  applyPreferences();
}

function loadPreferences(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem("md-reader-preferences") ?? "null") as Partial<Preferences> | null;
    return {
      theme: stored?.theme === "light" || stored?.theme === "dark" ? stored.theme : "system",
      fontSize: stored?.fontSize === "smaller" || stored?.fontSize === "larger" ? stored.fontSize : "default",
      wordWrap: stored?.wordWrap !== false,
      zoom: typeof stored?.zoom === "number" ? stored.zoom : 1,
    };
  } catch {
    return { theme: "system", fontSize: "default", wordWrap: true, zoom: 1 };
  }
}

function savePreferences(): void {
  localStorage.setItem("md-reader-preferences", JSON.stringify(preferences));
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
    // Offline support is best effort; the reader still works without a service worker.
  });
}

async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path.split(/[\\/]/).pop() ?? "");
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 2600);
}

window.addEventListener("beforeunload", () => {
  unlistenOpenFile?.();
  unlistenNativeMenu?.();
  unlistenExitRequested?.();
});

function renderMarkdown(markdown: string, documentPath: string | null): string {
  const lines = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const baseDir = documentPath ? dirname(documentPath) : "";
  const output: string[] = [];
  let index = 0;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    output.push(`<p>${inlineMarkdown(paragraph.join("\n"), baseDir)}</p>`);
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^\s*(```+|~~~+)\s*([^ ]*)?\s*$/);
    if (fence) {
      flushParagraph();
      const marker = fence[1][0];
      const closing = new RegExp(`^\\s*${marker}{${fence[1].length},}\\s*$`);
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      const language = escapeHtml(fence[2] || "");
      output.push(`<pre><code${language ? ` data-language="${language}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^\s*$/.test(line)) {
      flushParagraph();
      index += 1;
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2], baseDir)}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      flushParagraph();
      output.push("<hr>");
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      output.push(`<blockquote>${renderMarkdown(quote.join("\n"), documentPath)}</blockquote>`);
      continue;
    }
    if (isTableStart(lines, index)) {
      flushParagraph();
      const tableLines = [lines[index++], lines[index++]];
      while (index < lines.length && /^\s*\|?.+\|.+\|?\s*$/.test(lines[index]) && !/^\s*$/.test(lines[index])) tableLines.push(lines[index++]);
      output.push(renderTable(tableLines, baseDir));
      continue;
    }
    if (isListLine(line)) {
      flushParagraph();
      const list = readList(lines, index, baseDir);
      output.push(list.html);
      index = list.nextIndex;
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return output.join("\n");
}

function inlineMarkdown(value: string, baseDir: string): string {
  const tokens: string[] = [];
  const stash = (html: string): string => {
    const marker = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return marker;
  };
  let text = escapeHtml(value);
  text = text.replace(/!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_, alt: string, source: string, title?: string) => {
    const original = decodeHtml(source);
    const src = imageSource(original, baseDir);
    if (!src) {
      return stash(`<span class="missing-image" data-md-src="${escapeAttribute(original)}" data-md-alt="${escapeAttribute(alt)}" role="img" aria-label="Image unavailable">🖼 ${escapeHtml(alt || original)}</span>`);
    }
    return stash(`<img src="${escapeAttribute(src)}" data-md-src="${escapeAttribute(original)}" alt="${escapeAttribute(alt)}"${title ? ` title="${escapeAttribute(title)}"` : ""}>`);
  });
  text = text.replace(/\[([^\]]+)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_, label: string, href: string, title?: string) => {
    const original = decodeHtml(href);
    const attributes = linkAttributes(original, baseDir);
    if (!attributes) return label;
    return stash(`<a ${attributes}${title ? ` title="${escapeAttribute(title)}"` : ""}>${label}</a>`);
  });
  text = text.replace(/`([^`\n]+)`/g, (_, code: string) => stash(`<code>${code}</code>`));
  text = text.replace(/(https?:\/\/[^\s<]+)/g, (url: string) => stash(`<a href="${escapeAttribute(url)}" data-external-url="${escapeAttribute(url)}" rel="noopener noreferrer">${url}</a>`));
  text = text.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, strongA: string, strongB: string) => `<strong>${strongA ?? strongB}</strong>`);
  text = text.replace(/~~(.+?)~~/g, "<del>$1</del>");
  text = text.replace(/(?<!\*)\*([^*\n]+)\*|(?<!_)_([^_\n]+)_(?!_)/g, (_, italicA: string, italicB: string) => `<em>${italicA ?? italicB}</em>`);
  text = text.replace(/  \n/g, "<br>");
  text = text.replace(/\n/g, "\n");
  return text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => tokens[Number(i)]);
}

function linkAttributes(href: string, baseDir: string): string | null {
  if (!isAllowedLinkUrl(href)) return null;
  if (/^(https?:|mailto:|tel:)/i.test(href)) return `href="${escapeAttribute(href)}" data-external-url="${escapeAttribute(href)}" rel="noopener noreferrer"`;
  const path = resolvePath(baseDir, href);
  if (!isMarkdownPath(path)) return null;
  return `href="#" data-md-path="${escapeAttribute(path)}"`;
}

function isAllowedLinkUrl(href: string): boolean {
  return !/^[A-Za-z][A-Za-z\d+.-]*:/i.test(href) || /^(https?:|mailto:|tel:)/i.test(href);
}

function imageSource(source: string, baseDir: string): string | null {
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);/i.test(source) || /^https?:\/\//i.test(source)) return source;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/i.test(source) || !isTauri()) return null;
  const absolutePath = resolvePath(baseDir, source);
  return isTauri() ? convertFileSrc(absolutePath) : absolutePath;
}

function readList(lines: string[], start: number, baseDir: string): { html: string; nextIndex: number } {
  const first = lines[start].match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
  if (!first) return { html: "", nextIndex: start + 1 };
  const items: Array<{ indent: number; marker: string; text: string; checked: boolean }> = [];
  let index = start;
  while (index < lines.length) {
    const match = lines[index].match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
    if (!match) {
      if (/^\s{2,}\S/.test(lines[index]) && items.length) {
        items[items.length - 1].text += `\n${lines[index].trim()}`;
        index += 1;
        continue;
      }
      break;
    }
    items.push({ indent: match[1].length, marker: match[2], text: match[3], checked: /^\[x\]\s+/i.test(match[3]) });
    index += 1;
  }

  const renderLevel = (position: number, indent: number): { html: string; position: number } => {
    const ordered = /^\d/.test(items[position]?.marker ?? first[2]);
    const tag = ordered ? "ol" : "ul";
    const result: string[] = [`<${tag}>`];
    let cursor = position;
    while (cursor < items.length && items[cursor].indent === indent) {
      const item = items[cursor];
      const task = item.text.match(/^\[[ xX]\]\s+(.+)$/);
      const body = task ? `<input type="checkbox" disabled ${item.checked ? "checked" : ""}> ${inlineMarkdown(task[1], baseDir)}` : inlineMarkdown(item.text, baseDir);
      result.push(`<li${task ? " class=\"task-item\"" : ""}>${body}`);
      cursor += 1;
      if (cursor < items.length && items[cursor].indent > indent) {
        const nested = renderLevel(cursor, items[cursor].indent);
        result.push(nested.html);
        cursor = nested.position;
      }
      result.push("</li>");
    }
    result.push(`</${tag}>`);
    return { html: result.join(""), position: cursor };
  };

  return { html: renderLevel(0, items[0]?.indent ?? first[1].length).html, nextIndex: index };
}

function isListLine(line: string): boolean {
  return /^\s{0,6}([-+*]|\d+[.)])\s+/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  return index + 1 < lines.length && /^\s*\|?.+\|.+\|?\s*$/.test(lines[index]) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function renderTable(lines: string[], baseDir: string): string {
  const parseRow = (row: string): string[] => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const headers = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);
  const head = headers.map((cell) => `<th>${inlineMarkdown(cell, baseDir)}</th>`).join("");
  const body = rows.map((row) => `<tr>${headers.map((_, i) => `<td>${inlineMarkdown(row[i] ?? "", baseDir)}</td>`).join("")}</tr>`).join("");
  return `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function decodeHtml(value: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

function resolvePath(base: string, relative: string): string {
  if (/^(https?:|mailto:|tel:|data:|file:)/i.test(relative) || /^[A-Za-z]:[\\/]/.test(relative) || relative.startsWith("/")) return relative;
  const separator = base.includes("\\") ? "\\" : "/";
  const parts = `${base}${separator}${relative.replace(/[\\/]/g, separator)}`.split(/[\\/]+/);
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  const prefix = /^[A-Za-z]:/.test(parts[0] ?? "") ? `${parts[0]}${separator}` : base.startsWith("/") ? separator : "";
  return prefix + resolved.join(separator);
}
