import { useState, useEffect, useMemo, useRef } from "preact/hooks"
import { marked } from "marked"
import {
  getDraft,
  saveDraft,
  clearDraft,
  formatObsidianBackupMessage,
} from "../lib/storage"
import { atomicCommitVault } from "../lib/github"

interface EditorProps {
  repoFullName: string
  filePath: string
  initialContent: string
  sha: string
  token: string
  isObsidianVault?: boolean
  onCommitSuccess: (newSha: string, updatedContent: string) => void
  onClose?: () => void
}

type ViewMode = "split" | "edit" | "preview"

export function Editor({
  repoFullName,
  filePath,
  initialContent,
  sha: _sha,
  token,
  isObsidianVault = false,
  onCommitSuccess,
  onClose,
}: EditorProps) {
  const [content, setContent] = useState<string>(() => {
    const draft = getDraft(repoFullName, filePath)
    return draft !== null ? draft : initialContent
  })
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("split")
  const [useObsidianFormat, setUseObsidianFormat] = useState(isObsidianVault)
  const [commitMessage, setCommitMessage] = useState(() =>
    isObsidianVault ? formatObsidianBackupMessage() : `Update ${filePath.split("/").pop() || "note.md"}`,
  )
  const [isCommitting, setIsCommitting] = useState(false)
  const [commitSuccess, setCommitSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync state when switching files
  useEffect(() => {
    const draft = getDraft(repoFullName, filePath)
    if (draft !== null && draft !== initialContent) {
      setContent(draft)
      setHasRestoredDraft(true)
    } else {
      setContent(initialContent)
      setHasRestoredDraft(false)
    }
    const filename = filePath.split("/").pop() || "note.md"
    if (isObsidianVault) {
      setCommitMessage(formatObsidianBackupMessage())
      setUseObsidianFormat(true)
    } else {
      setCommitMessage(`Update ${filename}`)
      setUseObsidianFormat(false)
    }
    setCommitSuccess(false)
    setError(null)
  }, [filePath, initialContent, repoFullName, isObsidianVault])

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

  // Handle Tab key in textarea for clean indentation & Ctrl+S for quick commit
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault()
      if (isDirty && !isCommitting) {
        handleCommit()
      }
      return
    }

    if (e.key === "Tab") {
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const val = textarea.value
      const updated = val.substring(0, start) + "  " + val.substring(end)
      handleContentChange(updated)
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2
      }, 0)
    }
  }

  // Toggle between Obsidian backup format and custom message
  const toggleObsidianFormat = (enable: boolean) => {
    setUseObsidianFormat(enable)
    if (enable) {
      setCommitMessage(formatObsidianBackupMessage())
    } else {
      const filename = filePath.split("/").pop() || "note.md"
      setCommitMessage(`Update ${filename}`)
    }
  }

  // Commit & Push note to GitHub -> Clear draft on success (never touches .obsidian)
  const handleCommit = async () => {
    if (!isDirty || isCommitting) return
    setIsCommitting(true)
    setError(null)
    setCommitSuccess(false)

    try {
      const [owner, repo] = repoFullName.split("/")
      const msg =
        (useObsidianFormat ? formatObsidianBackupMessage() : commitMessage.trim()) ||
        `Update ${filePath.split("/").pop()}`

      // Strictly commit only the edited note file — never touch .obsidian
      const filesToCommit = [{ path: filePath, content }]

      const result = await atomicCommitVault(token, owner, repo, filesToCommit, msg)

      // Clear draft immediately from localStorage to free memory and prevent lag!
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

  // Render Markdown to Quartz HTML Preview
  const previewHtml = useMemo(() => {
    // Process Obsidian wikilinks: [[link|text]] or [[link]]
    let parsedText = content.replace(/\[\[(.*?)(?:\|(.*?))?\]\]/g, (_, target, alias) => {
      const displayText = alias || target
      return `<a class="internal internal-link" data-slug="${target}" title="${target}">${displayText}</a>`
    })

    // Process Obsidian Callouts: > [!NOTE] etc.
    parsedText = parsedText.replace(
      /^>\s*\[!([a-zA-Z]+)\]\s*(.*)$/gm,
      (_, type, title) => {
        const calloutType = type.toLowerCase()
        const calloutTitle = title || type.charAt(0).toUpperCase() + type.slice(1)
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
      {/* Top Editor Toolbar */}
      <div class="editor-header">
        <div class="editor-file-info">
          <span class="editor-filepath">{filePath}</span>
          {isDirty ? (
            <span class="status-pill status-draft" title="Draft saved in localStorage">
              🟡 Unsaved Draft
            </span>
          ) : (
            <span class="status-pill status-synced" title="Synchronized with GitHub">
              🟢 Synced
            </span>
          )}
          {hasRestoredDraft && (
            <span class="status-pill status-restored">
              Draft Restored from LocalStorage
            </span>
          )}
        </div>

        <div class="editor-controls-right">
          <div class="editor-mode-selector">
            <button
              class={`mode-btn ${viewMode === "edit" ? "active" : ""}`}
              onClick={() => setViewMode("edit")}
            >
              Edit
            </button>
            <button
              class={`mode-btn ${viewMode === "split" ? "active" : ""}`}
              onClick={() => setViewMode("split")}
            >
              Split
            </button>
            <button
              class={`mode-btn ${viewMode === "preview" ? "active" : ""}`}
              onClick={() => setViewMode("preview")}
            >
              Preview
            </button>
          </div>
          {onClose && (
            <button class="btn-close-note" onClick={onClose} title="Close note">
              ✕
            </button>
          )}
        </div>
      </div>

      {error && (
        <div class="editor-alert editor-alert-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {commitSuccess && (
        <div class="editor-alert editor-alert-success">
          <span>✓ Successfully committed & pushed to GitHub. Local draft cleared!</span>
          <button onClick={() => setCommitSuccess(false)}>✕</button>
        </div>
      )}

      {/* Main Split Panels */}
      <div class={`editor-panes mode-${viewMode}`}>
        {(viewMode === "edit" || viewMode === "split") && (
          <div class="pane-editor">
            <textarea
              ref={textareaRef}
              class="markdown-textarea"
              value={content}
              onInput={(e) => handleContentChange((e.target as HTMLInputElement).value)}
              onKeyDown={handleKeyDown}
              placeholder="Write your Obsidian markdown note here..."
              spellcheck={false}
            />
          </div>
        )}

        {(viewMode === "preview" || viewMode === "split") && (
          <div class="pane-preview">
            <article
              class="quartz-article"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}
      </div>

      {/* Bottom Commit & Push Action Bar */}
      <div class="commit-action-bar">
        <div class="commit-input-group">
          {isObsidianVault && (
            <button
              type="button"
              class={`btn-format-toggle ${useObsidianFormat ? "active" : ""}`}
              onClick={() => toggleObsidianFormat(!useObsidianFormat)}
              title={
                useObsidianFormat
                  ? "Using Obsidian Git 'vault backup: YYYY-MM-DD HH:mm:ss' format. Click to type custom message."
                  : "Click to use standard Obsidian Git vault backup format."
              }
            >
              {useObsidianFormat ? "⚡ Obsidian Format" : "✏️ Custom Msg"}
            </button>
          )}

          <div class="commit-input-wrapper">
            <input
              type="text"
              class="commit-message-input"
              value={commitMessage}
              onInput={(e) => {
                setCommitMessage((e.target as HTMLInputElement).value)
                setUseObsidianFormat(false)
              }}
              placeholder="Commit message (e.g. Update note ideas)"
              disabled={!isDirty || isCommitting}
            />
            {useObsidianFormat && (
              <button
                type="button"
                class="btn-refresh-timestamp"
                onClick={() => setCommitMessage(formatObsidianBackupMessage())}
                title="Update timestamp to now"
              >
                ↻
              </button>
            )}
          </div>

          <button
            class="btn-commit-push"
            onClick={handleCommit}
            disabled={!isDirty || isCommitting}
            title={isDirty ? "Commit and push changes to GitHub (Ctrl+S)" : "No changes to commit"}
          >
            {isCommitting ? (
              <>
                <span class="spinner" style={{ width: "14px", height: "14px" }}></span>
                Pushing...
              </>
            ) : (
              <>↑ Commit & Push</>
            )}
          </button>
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

