export interface EditorController {
  focus(): void;
  sync(): void;
  runCommand(command: string, value?: string): void;
  destroy(): void;
}

interface EditorOptions {
  host: HTMLDivElement;
  toolbar: HTMLDivElement;
  formatSelect: HTMLSelectElement;
  tableDialog: HTMLDialogElement;
  tableRowsInput: HTMLInputElement;
  tableColumnsInput: HTMLInputElement;
  markdown: string;
  documentPath: string | null;
  renderMarkdown(markdown: string, documentPath: string | null): string;
  onChange(markdown: string): void;
  onInvalidLink(): void;
}

export function mountEditor(options: EditorOptions): EditorController {
  options.host.innerHTML = `<div class="editor-surface" contenteditable="true" role="textbox" aria-label="Markdown editor" spellcheck="true">${options.renderMarkdown(options.markdown, options.documentPath)}</div>`;
  const surface = options.host.querySelector<HTMLDivElement>(".editor-surface");
  if (!surface) throw new Error("Editor surface is missing");

  let savedSelection: Range | null = null;

  const sync = (): void => options.onChange(htmlToMarkdown(surface));
  const rememberSelection = (): void => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (surface.contains(range.commonAncestorContainer)) savedSelection = range.cloneRange();
  };
  const restoreSelection = (): void => {
    surface.focus();
    if (!savedSelection) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(savedSelection);
  };
  const updateToolbarState = (): void => {
    options.toolbar.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => {
      const command = button.dataset.command;
      const active = command
        ? ["bold", "italic", "strikeThrough", "insertUnorderedList", "insertOrderedList"].includes(command) && document.queryCommandState(command)
        : false;
      button.classList.toggle("active", active);
    });
    const block = document.queryCommandValue("formatBlock").replace(/[<>]/g, "").toLowerCase();
    const normalizedBlock = block === "div" ? "p" : block;
    if (["p", "h1", "h2", "h3", "blockquote", "pre"].includes(normalizedBlock)) options.formatSelect.value = normalizedBlock;
  };

  const runCommand = (command: string, value?: string): void => {
    restoreSelection();
    if (command === "createLink") {
      const url = window.prompt("Link URL", "https://");
      if (!url) return;
      const trimmedUrl = url.trim();
      if (!isAllowedLinkUrl(trimmedUrl)) {
        options.onInvalidLink();
        return;
      }
      document.execCommand("createLink", false, trimmedUrl);
    } else if (command === "createTable") {
      rememberSelection();
      options.tableRowsInput.value = "3";
      options.tableColumnsInput.value = "3";
      options.tableDialog.returnValue = "";
      options.tableDialog.showModal();
      return;
    } else if (command === "blockquote") {
      document.execCommand("formatBlock", false, "blockquote");
    } else if (command === "formatBlock") {
      document.execCommand("formatBlock", false, value ?? "p");
    } else {
      document.execCommand(command, false);
    }
    sync();
    rememberSelection();
    updateToolbarState();
  };

  const toolbarButtons = Array.from(options.toolbar.querySelectorAll<HTMLButtonElement>("[data-command]"));
  const buttonHandlers = toolbarButtons.map((button) => {
    const preventFocusLoss = (event: MouseEvent): void => event.preventDefault();
    const execute = (): void => runCommand(button.dataset.command ?? "");
    button.addEventListener("mousedown", preventFocusLoss);
    button.addEventListener("click", execute);
    return { button, preventFocusLoss, execute };
  });
  const formatHandler = (): void => runCommand("formatBlock", options.formatSelect.value);
  options.formatSelect.addEventListener("change", formatHandler);

  const tableCloseHandler = (): void => {
    if (options.tableDialog.returnValue !== "insert") return;
    const rows = parseTableDimension(options.tableRowsInput.value, 2, 20);
    const columns = parseTableDimension(options.tableColumnsInput.value, 1, 10);
    if (rows === null || columns === null) return;
    restoreSelection();
    document.execCommand("insertHTML", false, createTableHtml(rows, columns));
    sync();
    rememberSelection();
    updateToolbarState();
  };
  options.tableDialog.addEventListener("close", tableCloseHandler);

  surface.addEventListener("input", sync);
  surface.addEventListener("keyup", updateToolbarState);
  surface.addEventListener("mouseup", updateToolbarState);
  surface.addEventListener("blur", rememberSelection);
  updateToolbarState();

  return {
    focus: () => surface.focus(),
    sync,
    runCommand,
    destroy: () => {
      options.tableDialog.removeEventListener("close", tableCloseHandler);
      options.formatSelect.removeEventListener("change", formatHandler);
      buttonHandlers.forEach(({ button, preventFocusLoss, execute }) => {
        button.removeEventListener("mousedown", preventFocusLoss);
        button.removeEventListener("click", execute);
      });
      surface.remove();
    },
  };
}

function parseTableDimension(input: string, minimum: number, maximum: number): number | null {
  const value = Number.parseInt(input, 10);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function createTableHtml(rows: number, columns: number): string {
  const header = Array.from({ length: columns }, (_, index) => `<th>Header ${index + 1}</th>`).join("");
  const body = Array.from({ length: rows - 1 }, () => `<tr>${Array.from({ length: columns }, () => "<td>Cell</td>").join("")}</tr>`).join("");
  return `<div class="table-scroll"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div><p><br></p>`;
}

function htmlToMarkdown(root: HTMLElement): string {
  const blocks = Array.from(root.children).map((child) => nodeToMarkdown(child)).filter(Boolean);
  const markdown = blocks.join("\n\n").replace(/[ \t]+\n/g, "\n").trim();
  return markdown ? `${markdown}\n` : "";
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return Array.from(node.childNodes).map(nodeToMarkdown).join("");
  const children = () => Array.from(node.childNodes).map(nodeToMarkdown).join("");
  switch (node.tagName.toLowerCase()) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      return `${"#".repeat(Number(node.tagName.slice(1)))} ${children().trim()}`;
    case "p": return children().trim();
    case "strong": case "b": return `**${children()}**`;
    case "em": case "i": return `*${children()}*`;
    case "del": case "s": return `~~${children()}~~`;
    case "code": return node.parentElement?.tagName.toLowerCase() === "pre" ? children() : `\`${children()}\``;
    case "pre": return `\`\`\`\n${children().replace(/\n$/, "")}\n\`\`\``;
    case "br": return "  \n";
    case "hr": return "---";
    case "blockquote": return children().split("\n").map((line) => `> ${line}`).join("\n");
    case "a": {
      const href = node.dataset.mdPath || node.dataset.externalUrl || node.getAttribute("href") || "";
      return `[${children()}](${href})`;
    }
    case "img": return `![${node.getAttribute("alt") ?? ""}](${node.dataset.mdSrc ?? node.getAttribute("src") ?? ""})`;
    case "span": return node.dataset.mdSrc ? `![${node.dataset.mdAlt ?? ""}](${node.dataset.mdSrc})` : children();
    case "ul": case "ol": return listToMarkdown(node, node.tagName.toLowerCase() === "ol");
    case "li": return children().trim();
    case "table": return tableToMarkdown(node);
    case "div": return children().trim();
    case "input": return node.getAttribute("type") === "checkbox" ? `[${node.hasAttribute("checked") ? "x" : " "}]` : "";
    default: return children();
  }
}

function listToMarkdown(list: HTMLElement, ordered: boolean, depth = 0): string {
  const indent = "  ".repeat(depth);
  return Array.from(list.children).filter((child): child is HTMLElement => child.tagName.toLowerCase() === "li").map((item, index) => {
    const nested = Array.from(item.children).find((child) => child.tagName.toLowerCase() === (ordered ? "ol" : "ul")) as HTMLElement | undefined;
    const clone = item.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("ul, ol").forEach((child) => child.remove());
    let text = Array.from(clone.childNodes).map(nodeToMarkdown).join("").trim();
    const checkbox = item.querySelector<HTMLInputElement>("input[type=checkbox]");
    if (checkbox) text = `[${checkbox.checked ? "x" : " "}] ${text.replace(/^\[[ xX]\]\s*/, "")}`;
    const marker = ordered ? `${index + 1}.` : "-";
    return `${indent}${marker} ${text}${nested ? `\n${listToMarkdown(nested, nested.tagName.toLowerCase() === "ol", depth + 1)}` : ""}`;
  }).join("\n");
}

function tableToMarkdown(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll("tr")).map((row) => Array.from(row.children).map((cell) => nodeToMarkdown(cell).replace(/\n/g, " ").trim()));
  if (rows.length === 0) return "";
  return [
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function isAllowedLinkUrl(href: string): boolean {
  return !/^[A-Za-z][A-Za-z\d+.-]*:/i.test(href) || /^(https?:|mailto:|tel:)/i.test(href);
}
