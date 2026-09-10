import {
  EditorView,
  keymap,
  ViewPlugin,
  Decoration,
  type DecorationSet,
} from "@codemirror/view"
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language"
import { tags as t } from "@lezer/highlight"
import { markdown } from "@codemirror/lang-markdown"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"

/**
 * Obsidian Markdown Syntax Highlight Style
 * - Headings with larger sizes
 * - Bold styled in Obsidian's signature accent/pink color
 * - Italic, monospace, lists, blockquotes
 */
export const obsidianHighlightStyle = HighlightStyle.define([
  {
    tag: t.heading1,
    fontSize: "1.85em",
    fontWeight: "700",
    lineHeight: "1.3",
  },
  {
    tag: t.heading2,
    fontSize: "1.45em",
    fontWeight: "700",
    lineHeight: "1.35",
  },
  {
    tag: t.heading3,
    fontSize: "1.2em",
    fontWeight: "600",
    lineHeight: "1.4",
  },
  {
    tag: t.heading4,
    fontSize: "1.05em",
    fontWeight: "600",
  },
  {
    tag: t.strong,
    fontWeight: "700",
    color: "var(--obsidian-bold, #ff79c6)",
  },
  {
    tag: t.emphasis,
    fontStyle: "italic",
    color: "inherit",
  },
  {
    tag: t.strikethrough,
    textDecoration: "line-through",
    opacity: "0.6",
  },
  {
    tag: t.monospace,
    fontFamily: "var(--codeFont)",
    fontSize: "0.88em",
    backgroundColor: "var(--highlight)",
    borderRadius: "3px",
    padding: "0.1em 0.3em",
  },
  {
    tag: t.quote,
    fontStyle: "italic",
    color: "var(--darkgray)",
  },
  {
    tag: t.link,
    color: "var(--secondary)",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
  {
    tag: t.url,
    color: "var(--secondary)",
    opacity: "0.8",
  },
  {
    tag: t.processingInstruction,
    color: "var(--gray)",
    opacity: "0.6",
  },
])

/**
 * Obsidian Live Preview Decoration Plugin:
 * When the cursor is NOT on a line, markdown formatting marks
 * (e.g. `**` or `*`) are softened/hidden so the formatted text shines.
 * When the cursor is on the line, the marks are fully visible for editing.
 */
const hiddenMarkDeco = Decoration.mark({ class: "cm-formatting-dim" })

export const obsidianLivePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.computeDecorations(view)
    }

    update(update: any) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.computeDecorations(update.view)
      }
    }

    computeDecorations(view: EditorView) {
      const cursor = view.state.selection.main.head
      const cursorLine = view.state.doc.lineAt(cursor).number
      const widgets: any[] = []

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (node.name === "EmphasisMark" || node.name === "HeaderMark") {
              const nodeLine = view.state.doc.lineAt(node.from).number
              if (nodeLine !== cursorLine) {
                widgets.push(hiddenMarkDeco.range(node.from, node.to))
              }
            }
          },
        })
      }
      return Decoration.set(widgets, true)
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)

/**
 * CodeMirror Theme blending into Quartz Light & Dark Themes
 */
export const obsidianTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "1rem",
      fontFamily: "var(--bodyFont)",
      backgroundColor: "transparent",
      color: "var(--dark)",
    },
    ".cm-content": {
      caretColor: "var(--secondary)",
      padding: "2rem 2.5rem 10rem 2.5rem",
      maxWidth: "820px",
      margin: "0 auto",
      lineHeight: "1.7",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--secondary)",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--obsidian-selection, rgba(66, 153, 225, 0.35)) !important",
    },
    ".cm-line": {
      padding: "0.1rem 0",
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "inherit",
    },
    ".cm-formatting-dim": {
      opacity: "0.35",
      transition: "opacity 0.15s ease",
    },
  },
  { dark: true },
)

/**
 * Formatting Utilities for Toolbar and Shortcuts
 */
export function wrapSelection(
  view: EditorView,
  prefix: string,
  suffix: string = prefix,
  placeholder: string = "text",
) {
  const { from, to } = view.state.selection.main
  const selectedText = view.state.sliceDoc(from, to)

  if (selectedText) {
    view.dispatch({
      changes: { from, to, insert: `${prefix}${selectedText}${suffix}` },
      selection: {
        anchor: from + prefix.length + selectedText.length + suffix.length,
      },
    })
  } else {
    view.dispatch({
      changes: { from, to, insert: `${prefix}${placeholder}${suffix}` },
      selection: {
        anchor: from + prefix.length,
        head: from + prefix.length + placeholder.length,
      },
    })
  }
  view.focus()
}

export function toggleLinePrefix(view: EditorView, prefix: string) {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  const currentLineText = line.text

  let newLineText: string
  if (currentLineText.startsWith(prefix)) {
    newLineText = currentLineText.slice(prefix.length)
  } else {
    const clean = prefix.startsWith("#")
      ? currentLineText.replace(/^#{1,6}\s*/, "")
      : prefix.startsWith("-")
        ? currentLineText.replace(
            /^(\s*[-*+]\s+\[[ xX]?\]\s*|\s*[-*+]\s*|\s*\d+\.\s*)/,
            "",
          )
        : currentLineText
    newLineText = prefix + clean
  }

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: newLineText },
    selection: { anchor: line.from + newLineText.length },
  })
  view.focus()
}

export function insertSnippet(
  view: EditorView,
  snippet: string,
  cursorOffset?: number,
) {
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: {
      anchor: from + (cursorOffset !== undefined ? cursorOffset : snippet.length),
    },
  })
  view.focus()
}

/**
 * Builds the complete CodeMirror extensions array
 */
export function createObsidianExtensions(options: {
  onDocChange: (content: string) => void
  onCursorActivity?: (cursorPos: number) => void
  onSave?: () => void
  onToggleViewMode?: () => void
}) {
  const customKeymap = keymap.of([
    indentWithTab,
    {
      key: "Mod-s",
      run: () => {
        if (options.onSave) {
          options.onSave()
          return true
        }
        return false
      },
    },
    {
      key: "Mod-e",
      run: () => {
        if (options.onToggleViewMode) {
          options.onToggleViewMode()
          return true
        }
        return false
      },
    },
    ...defaultKeymap,
    ...historyKeymap,
  ])

  const listenerExtension = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      options.onDocChange(update.state.doc.toString())
    }
    if (update.selectionSet && options.onCursorActivity) {
      options.onCursorActivity(update.state.selection.main.head)
    }
  })

  return [
    history(),
    markdown(),
    syntaxHighlighting(obsidianHighlightStyle),
    obsidianTheme,
    obsidianLivePreviewPlugin,
    EditorView.lineWrapping,
    customKeymap,
    listenerExtension,
  ]
}
