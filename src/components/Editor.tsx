import { useState, useEffect, useMemo, useRef } from "preact/hooks"
import { marked } from "marked"
import { EditorView } from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import {
  getDraft,
  saveDraft,
  clearDraft,
  formatObsidianBackupMessage,
} from "../lib/storage"
import { atomicCommitVault } from "../lib/github"
import {
  EditIcon,
  BookIcon,
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  HighlightIcon,
  CodeBlockIcon,
  ListBulletIcon,
  ListCheckIcon,
  CalloutIcon,
  TableIcon,
  DividerIcon,
  QuoteIcon,
  LinkIcon,
  SyncIcon,
  PullIcon,
} from "./Icons"
import {
  createObsidianExtensions,
  wrapSelection,
  toggleLinePrefix,
  insertSnippet,
} from "../lib/codemirrorObsidian"
import {
  SlashCommandsMenu,
  SLASH_COMMANDS,
  type SlashCommand,
} from "./SlashCommandsMenu"

interface EditorProps {
  repoFullName: string
  filePath: string
  initialContent: string
  sha: string
  token: string
  isObsidianVault?: boolean
  onCommitSuccess: (newSha: string, updatedContent: string) => void
  onClose?: () => void
  onPull?: () => void
  onSync?: () => void
  isPulling?: boolean
  isSyncing?: boolean
  draftCount?: number
  targetHeading?: { text: string; level: number; timestamp: number } | null
}

type ViewMode = "edit" | "read"

export function Editor({
  repoFullName,
  filePath,
  initialContent,
  sha: _sha,
  token,
  isObsidianVault: _isObsidianVault = false,
  onCommitSuccess,
  onClose,
  onPull,
  onSync,
  isPulling = false,
  isSyncing = false,
  draftCount = 0,
  targetHeading,
}: EditorProps) {
  const [content, setContent] = useState<string>(() => {
    const draft = getDraft(repoFullName, filePath)
    return draft !== null ? draft : initialContent
  })
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("edit")
  const [isCommitting, setIsCommitting] = useState(false)
  const [commitSuccess, setCommitSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Slash commands menu state
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState("")
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)
  const [slashMenuPos, setSlashMenuPos] = useState<{ top: number; left: number } | undefined>()

  const editorContainerRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const isInternalChangeRef = useRef(false)

  // Sync state when switching files
  useEffect(() => {
    const draft = getDraft(repoFullName, filePath)
    let nextContent = initialContent
    if (draft !== null && draft !== initialContent) {
      nextContent = draft
      setContent(draft)
      setHasRestoredDraft(true)
    } else {
      setContent(initialContent)
      setHasRestoredDraft(false)
    }

    setCommitSuccess(false)
    setError(null)
    setIsSlashMenuOpen(false)

    // Update CodeMirror document if already initialized
    if (editorViewRef.current) {
      const view = editorViewRef.current
      if (view.state.doc.toString() !== nextContent) {
        isInternalChangeRef.current = true
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: nextContent },
        })
        isInternalChangeRef.current = false
      }
    }
  }, [filePath, initialContent, repoFullName])

  // Scroll to heading when clicked from Outline
  useEffect(() => {
    if (!targetHeading) return

    if (viewMode === "edit" && editorViewRef.current) {
      const view = editorViewRef.current
      const doc = view.state.doc
      const targetText = targetHeading.text.trim().toLowerCase()
      let foundPos: number | null = null

      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i)
        const text = line.text.trim().toLowerCase()
        if (text.startsWith("#") && text.includes(targetText)) {
          foundPos = line.from
          break
        }
      }

      if (foundPos !== null) {
        view.dispatch({
          selection: { anchor: foundPos },
          effects: EditorView.scrollIntoView(foundPos, { y: "start", yMargin: 40 }),
        })
        view.focus()
      }
    } else if (viewMode === "read") {
      const headers = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".quartz-article h1, .quartz-article h2, .quartz-article h3, .quartz-article h4, .quartz-article h5, .quartz-article h6",
        ),
      )
      const targetText = targetHeading.text.trim().toLowerCase()
      const match = headers.find((h) => h.textContent?.trim().toLowerCase().includes(targetText))
      if (match) {
        match.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    }
  }, [targetHeading, viewMode])

  // Is content different from GitHub remote
  const isDirty = content !== initialContent

  const handleContentChange = (newVal: string) => {
    setContent(newVal)
    setCommitSuccess(false)
    if (newVal !== initialContent) {
      saveDraft(repoFullName, filePath, newVal)
    } else {
      clearDraft(repoFullName, filePath)
    }
  }

  // Filter slash commands
  const filteredSlashCommands = useMemo(() => {
    const q = slashQuery.trim().toLowerCase()
    if (!q) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter((cmd) => {
      return (
        cmd.title.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.keywords.toLowerCase().includes(q)
      )
    })
  }, [slashQuery])

  // Handle Slash Command Selection
  const handleSelectSlashCommand = (cmd: SlashCommand) => {
    const view = editorViewRef.current
    if (!view) return

    const cursor = view.state.selection.main.head
    const line = view.state.doc.lineAt(cursor)
    const textBeforeCursor = line.text.slice(0, cursor - line.from)
    const slashIdx = textBeforeCursor.lastIndexOf("/")

    if (slashIdx >= 0) {
      const from = line.from + slashIdx
      const to = cursor
      view.dispatch({
        changes: { from, to, insert: cmd.snippet },
        selection: {
          anchor: from + (cmd.cursorOffset !== undefined ? cmd.cursorOffset : cmd.snippet.length),
        },
      })
    }

    setIsSlashMenuOpen(false)
    setSlashQuery("")
    view.focus()
  }

  // Detect slash command at cursor position
  const checkSlashCommand = (view: EditorView) => {
    const cursor = view.state.selection.main.head
    const line = view.state.doc.lineAt(cursor)
    const textBeforeCursor = line.text.slice(0, cursor - line.from)
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/)

    if (slashMatch) {
      setSlashQuery(slashMatch[1])
      setSelectedSlashIndex(0)
      setIsSlashMenuOpen(true)
      const coords = view.coordsAtPos(cursor)
      if (coords) {
        setSlashMenuPos({ top: coords.bottom + 6, left: coords.left })
      }
    } else {
      setIsSlashMenuOpen(false)
      setSlashQuery("")
    }
  }

  // Initialize CodeMirror 6 Continuous Obsidian Editor
  useEffect(() => {
    if (!editorContainerRef.current || viewMode !== "edit") return

    if (editorViewRef.current) {
      editorViewRef.current.destroy()
      editorViewRef.current = null
    }

    const extensions = createObsidianExtensions({
      onDocChange: (newDoc) => {
        if (!isInternalChangeRef.current) {
          handleContentChange(newDoc)
        }
        if (editorViewRef.current) {
          checkSlashCommand(editorViewRef.current)
        }
      },
      onCursorActivity: (_pos) => {
        if (editorViewRef.current) {
          checkSlashCommand(editorViewRef.current)
        }
      },
      onSave: () => {
        if (isDirty && !isCommitting) {
          handleCommit()
        }
      },
      onToggleViewMode: () => {
        setViewMode((prev) => (prev === "edit" ? "read" : "edit"))
      },
    })

    const state = EditorState.create({
      doc: content,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    })

    editorViewRef.current = view

    return () => {
      view.destroy()
      editorViewRef.current = null
    }
  }, [viewMode])

  // Keydown interceptor for slash commands menu
  const handleEditorKeyDown = (e: KeyboardEvent) => {
    if (isSlashMenuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedSlashIndex((prev) =>
          filteredSlashCommands.length > 0 ? (prev + 1) % filteredSlashCommands.length : 0,
        )
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedSlashIndex((prev) =>
          filteredSlashCommands.length > 0
            ? (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
            : 0,
        )
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        const chosen = filteredSlashCommands[selectedSlashIndex]
        if (chosen) {
          handleSelectSlashCommand(chosen)
        }
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setIsSlashMenuOpen(false)
        return
      }
    }
  }

  // Direct Push in Obsidian Backup format (no custom msg prompt, clean and automatic)
  const handleCommit = async () => {
    if (!isDirty || isCommitting) return
    setIsCommitting(true)
    setError(null)
    setCommitSuccess(false)

    try {
      const [owner, repo] = repoFullName.split("/")
      const msg = formatObsidianBackupMessage()

      const filesToCommit = [{ path: filePath, content }]
      const result = await atomicCommitVault(token, owner, repo, filesToCommit, msg)

      clearDraft(repoFullName, filePath)
      setCommitSuccess(true)
      setHasRestoredDraft(false)
      onCommitSuccess(result.commitSha, content)
    } catch (err: any) {
      setError(err.message || "Failed to commit & push changes to GitHub")
    } finally {
      setIsCommitting(false)
    }
  }

  // Render Markdown for Reading Mode
  const previewHtml = useMemo(() => {
    let parsedText = content.replace(
      /\[\[(.*?)(?:\|(.*?))?\]\]/g,
      (_, target, alias) => {
        const displayText = alias || target
        return `<a class="internal internal-link" data-slug="${target}" title="${target}">${displayText}</a>`
      },
    )

    parsedText = parsedText.replace(/==([^=]+)==/g, "<mark>$1</mark>")

    parsedText = parsedText.replace(
      /^>\s*\[!([a-zA-Z]+)\]\s*(.*)$/gm,
      (_, type, title) => {
        const calloutType = type.toLowerCase()
        const calloutTitle =
          title || type.charAt(0).toUpperCase() + type.slice(1)
        return `<div class="callout callout-${calloutType}"><div class="callout-title"><strong>${calloutTitle}</strong></div>`
      },
    )

    try {
      return marked.parse(parsedText) as string
    } catch {
      return "<p>Error parsing markdown</p>"
    }
  }, [content])

  const stats = useMemo(() => {
    const words = content.trim() ? content.trim().split(/\s+/).length : 0
    const chars = content.length
    const readingTime = Math.max(1, Math.ceil(words / 200))
    return { words, chars, readingTime }
  }, [content])

  return (
    <section class="editor-workspace">
      {/* Top Editor Header */}
      <div class="editor-header">
        <div class="editor-file-info">
          <span class="editor-filepath">{filePath}</span>
          {/* Show nothing when synced; show only if unsaved draft or restored */}
          {isDirty && (
            <span class="status-pill status-draft" title="Draft saved in localStorage">
              🟡 Unsaved Draft
            </span>
          )}
          {hasRestoredDraft && (
            <span class="status-pill status-restored">
              Draft Restored
            </span>
          )}
        </div>

        <div class="editor-controls-right">
          {/* Two-State Toggle: Edit (Continuous Obsidian CodeMirror) vs Read (Quartz Article) */}
          <div class="editor-mode-toggle" role="group" aria-label="View mode toggle">
            <button
              type="button"
              class={`mode-toggle-btn ${viewMode === "edit" ? "active" : ""}`}
              onClick={() => setViewMode("edit")}
              title="Edit Mode: Continuous Obsidian Editor (Ctrl+E)"
            >
              <EditIcon />
              <span>Edit</span>
            </button>
            <button
              type="button"
              class={`mode-toggle-btn ${viewMode === "read" ? "active" : ""}`}
              onClick={() => setViewMode("read")}
              title="Read Mode: Reading View (Ctrl+E)"
            >
              <BookIcon />
              <span>Read</span>
            </button>
          </div>

          {onClose && (
            <button class="btn-close-note" onClick={onClose} title="Close note">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Quick Formatting Toolbar (Visible in Edit mode) */}
      {viewMode === "edit" && (
        <div class="editor-quick-toolbar" role="toolbar" aria-label="Quick formatting toolbar">
          <div class="toolbar-group">
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) toggleLinePrefix(editorViewRef.current, "# ")
              }}
              title="Heading 1 (#)"
            >
              H1
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) toggleLinePrefix(editorViewRef.current, "## ")
              }}
              title="Heading 2 (##)"
            >
              H2
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) toggleLinePrefix(editorViewRef.current, "### ")
              }}
              title="Heading 3 (###)"
            >
              H3
            </button>
          </div>

          <div class="toolbar-divider" />

          <div class="toolbar-group">
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) wrapSelection(editorViewRef.current, "**", "**", "bold")
              }}
              title="Bold (**text**)"
            >
              <BoldIcon />
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) wrapSelection(editorViewRef.current, "*", "*", "italic")
              }}
              title="Italic (*text*)"
            >
              <ItalicIcon />
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) wrapSelection(editorViewRef.current, "~~", "~~", "text")
              }}
              title="Strikethrough (~~text~~)"
            >
              <StrikethroughIcon />
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) wrapSelection(editorViewRef.current, "==", "==", "highlight")
              }}
              title="Highlight (==text==)"
            >
              <HighlightIcon />
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) wrapSelection(editorViewRef.current, "`", "`", "code")
              }}
              title="Inline Code (`code`)"
            >
              <CodeBlockIcon />
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) wrapSelection(editorViewRef.current, "[[", "]]", "note")
              }}
              title="Wikilink ([[note]])"
            >
              <LinkIcon />
            </button>
          </div>

          <div class="toolbar-divider" />

          <div class="toolbar-group">
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) toggleLinePrefix(editorViewRef.current, "- ")
              }}
              title="Bulleted List (- item)"
            >
              <ListBulletIcon />
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) toggleLinePrefix(editorViewRef.current, "1. ")
              }}
              title="Numbered List (1. item)"
            >
              1.
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) toggleLinePrefix(editorViewRef.current, "- [ ] ")
              }}
              title="Checklist (- [ ] task)"
            >
              <ListCheckIcon />
            </button>
          </div>

          <div class="toolbar-divider" />

          <div class="toolbar-group">
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current)
                  insertSnippet(editorViewRef.current, "> [!NOTE]\n> Note content\n", 10)
              }}
              title="Obsidian Callout (> [!NOTE])"
            >
              <CalloutIcon />
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current)
                  insertSnippet(
                    editorViewRef.current,
                    "| Column 1 | Column 2 |\n| --- | --- |\n| Item 1 | Item 2 |\n",
                  )
              }}
              title="Table"
            >
              <TableIcon />
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) toggleLinePrefix(editorViewRef.current, "> ")
              }}
              title="Quote (> quote)"
            >
              <QuoteIcon />
            </button>
            <button
              type="button"
              class="toolbar-btn"
              onClick={() => {
                if (editorViewRef.current) insertSnippet(editorViewRef.current, "---\n")
              }}
              title="Divider (---)"
            >
              <DividerIcon />
            </button>
          </div>

          <div class="toolbar-hint">
            Type <kbd class="toolbar-kbd">/</kbd> for quick commands
          </div>
        </div>
      )}

      {error && (
        <div class="editor-alert editor-alert-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {commitSuccess && (
        <div class="editor-alert editor-alert-success">
          <span>✓ Pushed to GitHub in Obsidian format!</span>
          <button onClick={() => setCommitSuccess(false)}>✕</button>
        </div>
      )}

      {/* Main Panes: Edit (Continuous CodeMirror 6) vs Read (Quartz Article) */}
      <div class={`editor-panes mode-${viewMode}`} onKeyDown={handleEditorKeyDown}>
        {viewMode === "edit" ? (
          <div class="codemirror-editor-wrapper">
            <div ref={editorContainerRef} class="codemirror-container" />

            {/* Floating Slash Commands Menu anchored to cursor */}
            {isSlashMenuOpen && (
              <SlashCommandsMenu
                query={slashQuery}
                selectedIndex={selectedSlashIndex}
                position={slashMenuPos}
                onSelect={handleSelectSlashCommand}
                onClose={() => setIsSlashMenuOpen(false)}
              />
            )}
          </div>
        ) : (
          <div class="pane-reading-view">
            <article
              class="quartz-article"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}
      </div>

      {/* Bottom Action Bar: Push, Sync, Pull & Word Stats */}
      <div class="commit-action-bar">
        <div class="bottom-git-actions">
          <button
            type="button"
            class="bottom-git-btn btn-push"
            onClick={handleCommit}
            disabled={!isDirty || isCommitting}
            title={
              isDirty
                ? "Push note to GitHub in Obsidian format (Ctrl+S)"
                : "No changes to push"
            }
          >
            {isCommitting ? (
              <>
                <span class="spinner" style={{ width: "13px", height: "13px" }}></span>
                <span>Pushing...</span>
              </>
            ) : (
              <>
                <span>↑ Push</span>
              </>
            )}
          </button>

          {onSync && (
            <button
              type="button"
              class={`bottom-git-btn btn-sync ${(draftCount || 0) > 0 ? "has-drafts" : ""}`}
              onClick={onSync}
              disabled={isSyncing || isPulling}
              title="Sync all vault drafts with GitHub"
            >
              <SyncIcon class={isSyncing ? "spin-icon" : ""} />
              <span>{isSyncing ? "Syncing..." : "Sync"}</span>
              {(draftCount || 0) > 0 && (
                <span class="draft-count-badge">{draftCount}</span>
              )}
            </button>
          )}

          {onPull && (
            <button
              type="button"
              class="bottom-git-btn btn-pull"
              onClick={onPull}
              disabled={isPulling || isSyncing}
              title="Pull latest changes from GitHub"
            >
              <PullIcon class={isPulling ? "spin-icon" : ""} />
              <span>{isPulling ? "Pulling..." : "Pull"}</span>
            </button>
          )}
        </div>

        <div class="note-stats">
          <span>{stats.words} words</span>
          <span>•</span>
          <span>{stats.chars} chars</span>
          <span>•</span>
          <span>{stats.readingTime} min read</span>
        </div>
      </div>
    </section>
  )
}
