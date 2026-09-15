export interface BrowserWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserWritable>;
}

export interface BrowserDocument {
  name: string;
  content: string;
  handle: BrowserFileHandle | null;
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<BrowserFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<BrowserFileHandle>;
}

const markdownPickerTypes = [{
  description: "Markdown document",
  accept: { "text/markdown": [".md", ".markdown"] },
}];

export async function pickMarkdownDocument(): Promise<BrowserDocument | null> {
  const pickerWindow = window as FilePickerWindow;
  if (pickerWindow.showOpenFilePicker) {
    try {
      const handles = await pickerWindow.showOpenFilePicker({ multiple: false, types: markdownPickerTypes });
      const handle = handles[0];
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: file.name, content: await file.text(), handle };
    } catch (error) {
      if (isAbortError(error)) return null;
      // A browser can expose the picker API but still reject it in an
      // embedded or non-secure context. The input element is the portable fallback.
    }
  }

  return pickWithInput();
}

export async function saveMarkdownDocument(
  content: string,
  suggestedName: string,
  existingHandle: BrowserFileHandle | null,
): Promise<{ name: string; handle: BrowserFileHandle | null } | null> {
  if (existingHandle) {
    await writeToHandle(existingHandle, content);
    const file = await existingHandle.getFile();
    return { name: file.name, handle: existingHandle };
  }

  const pickerWindow = window as FilePickerWindow;
  if (pickerWindow.showSaveFilePicker) {
    try {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: markdownFileName(suggestedName),
        types: markdownPickerTypes,
      });
      await writeToHandle(handle, content);
      const file = await handle.getFile();
      return { name: file.name, handle };
    } catch (error) {
      if (isAbortError(error)) return null;
      // The API can exist but be unavailable on an insecure origin such as
      // plain localhost. Keep the browser-compatible download fallback.
    }
  }

  downloadMarkdown(content, markdownFileName(suggestedName));
  return { name: markdownFileName(suggestedName), handle: null };
}

async function pickWithInput(): Promise<BrowserDocument | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,text/markdown,text/plain";
    let settled = false;
    const finish = (documentValue: BrowserDocument | null): void => {
      if (settled) return;
      settled = true;
      resolve(documentValue);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      void file.text().then((content) => finish({ name: file.name, content, handle: null })).catch(() => finish(null));
    }, { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    input.click();
  });
}

async function writeToHandle(handle: BrowserFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

function downloadMarkdown(content: string, name: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function markdownFileName(name: string): string {
  const trimmed = name.trim() || "Untitled.md";
  return /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
