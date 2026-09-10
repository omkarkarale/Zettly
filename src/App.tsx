import { useState, useEffect } from "preact/hooks"
import { SproutIcon, RepoIcon, SyncIcon, PullIcon, PlusIcon } from "./components/Icons"
import { ThemeToggle } from "./components/ThemeToggle"
import { LoginCard } from "./components/LoginCard"
import { RepoModal } from "./components/RepoModal"
import { FileExplorer } from "./components/FileExplorer"
import { Editor } from "./components/Editor"
import { Outline } from "./components/Outline"
import {
  AuthSession,
  getStoredSession,
  saveSession,
  clearSession,
  getStoredRepo,
  saveStoredRepo,
  GitHubRepo,
  listDraftPaths,
  clearAllDrafts,
  getDraft,
  clearDraft,
  renameDraft,
  hasDraft,
  formatObsidianBackupMessage,
} from "./lib/storage"
import {
  AuthStatus,
  fetchAuthStatus,
  exchangeOAuthCode,
  fetchRepoTree,
  fetchFileContent,
  checkIsObsidianVault,
  atomicCommitVault,
  RepoTreeItem,
  FileData,
} from "./lib/github"

export function App() {
  const [session, setSession] = useState<AuthSession | null>(getStoredSession)
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [isLoadingAuth, setIsLoadingAuth] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // Active Vault & Repo state
  const [activeRepo, setActiveRepo] = useState<string | null>(getStoredRepo)
  const [isObsidianVault, setIsObsidianVault] = useState<boolean>(false)
  const [isRepoModalOpen, setIsRepoModalOpen] = useState(false)
  const [repoTree, setRepoTree] = useState<RepoTreeItem[]>([])
  const [isLoadingTree, setIsLoadingTree] = useState(false)

  // Active File & Multi-tab state (starts null / empty: nothing is opened by default)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [activeFileData, setActiveFileData] = useState<FileData | null>(null)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [isLoadingFile, setIsLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  // Git Sync & Pull state
  const [draftCount, setDraftCount] = useState<number>(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: "info" | "success" | "error" } | null>(null)

  const showToast = (message: string, type: "info" | "success" | "error" = "success") => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4500)
  }

  // Refresh draft count from localStorage
  const refreshDrafts = () => {
    if (activeRepo) {
      const drafts = listDraftPaths(activeRepo)
      setDraftCount(drafts.length)
    } else {
      setDraftCount(0)
    }
  }

  // Poll draft buffer periodically to keep badge updated across tabs/edits
  useEffect(() => {
    refreshDrafts()
    const interval = setInterval(refreshDrafts, 1500)
    return () => clearInterval(interval)
  }, [activeRepo])

  // 1. Initial OAuth and URL callback handling
  useEffect(() => {
    fetchAuthStatus().then(setAuthStatus)

    const url = new URL(window.location.href)
    const code = url.searchParams.get("code")
    const errorParam = url.searchParams.get("error_description") || url.searchParams.get("error")

    if (errorParam) {
      setAuthError(decodeURIComponent(errorParam))
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }

    if (code) {
      setIsLoadingAuth(true)
      window.history.replaceState({}, document.title, window.location.pathname)

      exchangeOAuthCode(code)
        .then((newSession) => {
          saveSession(newSession)
          setSession(newSession)
          setAuthError(null)
        })
        .catch((err) => {
          setAuthError(err.message || "OAuth code exchange failed")
        })
        .finally(() => {
          setIsLoadingAuth(false)
        })
    }
  }, [])

  // 2. Load active repo tree & verify .obsidian (DO NOT auto-open any note!)
  useEffect(() => {
    if (!session || !activeRepo) return

    const [owner, name] = activeRepo.split("/")
    setIsLoadingTree(true)
    setFileError(null)

    Promise.all([
      fetchRepoTree(session.token, owner, name),
      checkIsObsidianVault(session.token, owner, name),
    ])
      .then(([tree, isVault]) => {
        setRepoTree(tree)
        setIsObsidianVault(isVault)
        // Nothing is auto-opened: selectedPath and activeFileData remain null
      })
      .catch((err) => {
        setFileError(err.message || "Failed to load repository tree")
      })
      .finally(() => {
        setIsLoadingTree(false)
      })
  }, [session, activeRepo])

  // 3. Load File Content when user clicks a note
  const handleSelectFile = async (path: string) => {
    if (!session || !activeRepo) return
    setSelectedPath(path)
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
    setIsLoadingFile(true)
    setFileError(null)

    const [owner, name] = activeRepo.split("/")
    try {
      const data = await fetchFileContent(session.token, owner, name, path)
      setActiveFileData(data)
    } catch (err: any) {
      setFileError(err.message || `Failed to load file ${path}`)
    } finally {
      setIsLoadingFile(false)
    }
  }

  // 4. Create New Note
  const handleCreateNewNote = (folder = "") => {
    // Generate an untitled filename that doesn't conflict
    let baseName = "Untitled"
    let candidate = folder ? `${folder}/${baseName}.md` : `${baseName}.md`
    let counter = 1

    while (repoTree.some((t) => t.path.toLowerCase() === candidate.toLowerCase())) {
      candidate = folder ? `${folder}/${baseName} ${counter}.md` : `${baseName} ${counter}.md`
      counter++
    }

    const title = candidate.split("/").pop()?.replace(/\.md$/, "") || "Untitled"
    setSelectedPath(candidate)
    setOpenTabs((prev) => (prev.includes(candidate) ? prev : [...prev, candidate]))
    setActiveFileData({
      path: candidate,
      content: `# ${title}\n\n`,
      sha: "",
    })
  }

  // 4b. Rename Note
  const handleRenameFile = (oldPath: string, newPath: string) => {
    if (!activeRepo) return
    if (repoTree.some((t) => t.path.toLowerCase() === newPath.toLowerCase())) {
      showToast(`A note named "${newPath.split("/").pop()}" already exists`, "error")
      return
    }

    setRepoTree((prev) =>
      prev.map((t) => (t.path === oldPath ? { ...t, path: newPath } : t)),
    )
    setOpenTabs((prev) => prev.map((t) => (t === oldPath ? newPath : t)))
    renameDraft(activeRepo, oldPath, newPath)
    refreshDrafts()

    if (selectedPath === oldPath) {
      setSelectedPath(newPath)
      setActiveFileData((prev) => (prev ? { ...prev, path: newPath } : null))
    }

    showToast(`✓ Renamed to ${newPath.split("/").pop()}`, "success")
  }

  // 4d. Delete Note (blocked if note is not empty)
  const handleDeleteFile = async (filePath: string) => {
    if (!activeRepo) return
    const fileName = filePath.split("/").pop() || filePath

    // Check if file is non-empty
    let content = ""
    if (activeFileData && activeFileData.path === filePath) {
      content = activeFileData.content
    } else {
      const draft = getDraft(activeRepo, filePath)
      if (draft !== null) {
        content = draft
      } else {
        const treeItem = repoTree.find((t) => t.path === filePath)
        if (treeItem && treeItem.size !== undefined && treeItem.size > 0) {
          showToast(`Cannot delete "${fileName}": file is not empty`, "error")
          return
        }
        if (session) {
          const [owner, name] = activeRepo.split("/")
          try {
            const remote = await fetchFileContent(session.token, owner, name, filePath)
            content = remote.content
          } catch {
            content = ""
          }
        }
      }
    }

    if (content.trim().length > 0) {
      showToast(`Cannot delete "${fileName}": file is not empty. Clear contents first to delete.`, "error")
      return
    }

    if (!window.confirm(`Are you sure you want to delete the empty note "${fileName}"?`)) {
      return
    }

    setRepoTree((prev) => prev.filter((t) => t.path !== filePath))
    clearDraft(activeRepo, filePath)
    refreshDrafts()

    setOpenTabs((prev) => {
      const updated = prev.filter((t) => t !== filePath)
      if (selectedPath === filePath) {
        if (updated.length > 0) {
          const next = updated[updated.length - 1]
          handleSelectFile(next)
        } else {
          setSelectedPath(null)
          setActiveFileData(null)
        }
      }
      return updated
    })

    showToast(`✓ Deleted empty note ${fileName}`, "info")
  }

  // 4e. Delete Folder (blocked if folder is not empty)
  const handleDeleteFolder = (folderPath: string) => {
    const folderName = folderPath.split("/").pop() || folderPath
    const hasChildren = repoTree.some(
      (item) => item.path.startsWith(folderPath + "/") && item.path !== folderPath
    )

    if (hasChildren) {
      showToast(`Cannot delete "${folderName}": folder is not empty`, "error")
      return
    }

    if (!window.confirm(`Are you sure you want to delete the empty folder "${folderName}"?`)) {
      return
    }

    setRepoTree((prev) =>
      prev.filter((item) => item.path !== folderPath && !item.path.startsWith(folderPath + "/"))
    )
    showToast(`✓ Deleted empty folder "${folderName}"`, "info")
  }

  // 4f. Rename Folder
  const handleRenameFolder = (oldFolderPath: string) => {
    const oldName = oldFolderPath.split("/").pop() || oldFolderPath
    const newName = window.prompt(`Rename folder "${oldName}" to:`, oldName)
    if (!newName || !newName.trim() || newName.trim() === oldName) return

    const cleanNewName = newName.trim().replace(/[\/\\]/g, "")
    const parentParts = oldFolderPath.split("/").slice(0, -1)
    const newFolderPath = parentParts.length > 0 ? `${parentParts.join("/")}/${cleanNewName}` : cleanNewName

    setRepoTree((prev) =>
      prev.map((item) => {
        if (item.path === oldFolderPath) {
          return { ...item, path: newFolderPath }
        }
        if (item.path.startsWith(oldFolderPath + "/")) {
          return {
            ...item,
            path: `${newFolderPath}${item.path.slice(oldFolderPath.length)}`,
          }
        }
        return item
      })
    )

    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab === oldFolderPath) return newFolderPath
        if (tab.startsWith(oldFolderPath + "/")) {
          return `${newFolderPath}${tab.slice(oldFolderPath.length)}`
        }
        return tab
      })
    )

    if (selectedPath && selectedPath.startsWith(oldFolderPath + "/")) {
      const updatedPath = `${newFolderPath}${selectedPath.slice(oldFolderPath.length)}`
      setSelectedPath(updatedPath)
      setActiveFileData((prev) => (prev ? { ...prev, path: updatedPath } : null))
    }

    showToast(`✓ Renamed folder to "${cleanNewName}"`, "success")
  }

  // 4g. Create Folder
  const handleCreateFolder = (parentFolderPath = "") => {
    const folderName = window.prompt("Enter new folder name:")
    if (!folderName || !folderName.trim()) return

    const cleanName = folderName.trim().replace(/[\/\\]/g, "")
    const targetFolder = parentFolderPath ? `${parentFolderPath}/${cleanName}` : cleanName

    handleCreateNewNote(targetFolder)
    showToast(`✓ Created folder "${cleanName}"`, "success")
  }

  // 4h. Open in New Tab
  const handleOpenInNewTab = (path: string) => {
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
    handleSelectFile(path)
  }

  // 4i. Open to Right
  const handleOpenToRight = (path: string) => {
    handleOpenInNewTab(path)
    showToast(`Opened "${path.split("/").pop()?.replace(/\.md$/, "")}" to the right`, "info")
  }

  // 4j. Open in New Window
  const handleOpenInNewWindow = async (path: string) => {
    let content = ""
    if (activeFileData && activeFileData.path === path) {
      content = activeFileData.content
    } else {
      const draft = getDraft(activeRepo || "", path)
      if (draft !== null) {
        content = draft
      } else if (session && activeRepo) {
        const [owner, name] = activeRepo.split("/")
        try {
          const remote = await fetchFileContent(session.token, owner, name, path)
          content = remote.content
        } catch {
          content = "# Note\n\n(Could not load remote content)"
        }
      }
    }

    const title = path.split("/").pop()?.replace(/\.md$/, "") || "Note"
    const newWin = window.open("", "_blank", "width=860,height=700,menubar=no,toolbar=no")
    if (newWin) {
      newWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${title} - Zettly</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              line-height: 1.6;
              padding: 2.5rem;
              max-width: 800px;
              margin: 0 auto;
              background-color: #161618;
              color: #f4f4f5;
            }
            pre {
              background: #202022;
              padding: 1.25rem;
              border-radius: 8px;
              white-space: pre-wrap;
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-size: 14px;
              border: 1px solid #2e2e32;
            }
            h1 { color: #84a59d; font-size: 1.75rem; margin-top: 0; }
            .header-bar {
              border-bottom: 1px solid #2e2e32;
              padding-bottom: 0.75rem;
              margin-bottom: 1.5rem;
              display: flex;
              justify-content: space-between;
              align-items: center;
              color: #a0a0a5;
              font-size: 0.85rem;
            }
          </style>
        </head>
        <body>
          <div class="header-bar">
            <span><strong>${path}</strong></span>
            <span>Zettly Standalone Viewer</span>
          </div>
          <h1>${title}</h1>
          <pre>${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
        </body>
        </html>
      `)
      newWin.document.close()
    } else {
      showToast("Popup blocked. Please allow popups for this site.", "error")
    }
  }

  // 4k. Close Tab
  const handleCloseTab = (tabPath: string, e?: MouseEvent) => {
    if (e) e.stopPropagation()
    setOpenTabs((prev) => {
      const updated = prev.filter((p) => p !== tabPath)
      if (selectedPath === tabPath) {
        if (updated.length > 0) {
          const nextTab = updated[updated.length - 1]
          handleSelectFile(nextTab)
        } else {
          setSelectedPath(null)
          setActiveFileData(null)
        }
      }
      return updated
    })
  }

  // 5. Quick search / Go to file focus
  const handleQuickSearch = () => {
    const input = document.querySelector(".explorer-search-input") as HTMLInputElement
    if (input) {
      input.focus()
      input.select()
    }
  }

  // 6. Global Keyboard Shortcuts (Ctrl+N, Ctrl+O)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        handleCreateNewNote()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault()
        handleQuickSearch()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [repoTree, activeRepo])

  // 7. Handle Repo Switch
  const handleSelectRepo = (repo: GitHubRepo, isObsidian: boolean) => {
    setActiveRepo(repo.full_name)
    setIsObsidianVault(isObsidian)
    saveStoredRepo(repo.full_name)
    setSelectedPath(null)
    setActiveFileData(null)
    setOpenTabs([])
  }

  // 8. Update state on successful commit from Editor
  const handleCommitSuccess = (newSha: string, updatedContent: string) => {
    refreshDrafts()
    if (activeFileData) {
      setActiveFileData({
        ...activeFileData,
        sha: newSha,
        content: updatedContent,
      })

      // Add to tree if it was a newly created note
      if (!repoTree.some((t) => t.path === activeFileData.path)) {
        setRepoTree((prev) => [
          ...prev,
          {
            path: activeFileData.path,
            type: "blob",
            mode: "100644",
            sha: newSha,
          },
        ])
      }
    }
  }

  // 9. Git Pull from GitHub (refreshes tree and active file)
  const handlePull = async () => {
    if (!session || !activeRepo || isPulling || isSyncing) return
    setIsPulling(true)
    const [owner, name] = activeRepo.split("/")

    try {
      const tree = await fetchRepoTree(session.token, owner, name)
      setRepoTree(tree)

      if (selectedPath) {
        try {
          const freshData = await fetchFileContent(session.token, owner, name, selectedPath)
          setActiveFileData(freshData)
        } catch {
          // File may be newly created local draft not on remote yet
        }
      }
      refreshDrafts()
      showToast("✓ Pulled latest vault changes from GitHub", "success")
    } catch (err: any) {
      showToast(`Pull failed: ${err.message || "Network error"}`, "error")
    } finally {
      setIsPulling(false)
    }
  }

  // 10. Git Commit & Sync (Obsidian Vault Workflow)
  const handleFullSync = async () => {
    if (!session || !activeRepo || isSyncing || isPulling) return
    setIsSyncing(true)
    const [owner, name] = activeRepo.split("/")

    try {
      const draftPaths = listDraftPaths(activeRepo)

      if (draftPaths.length === 0) {
        // No pending drafts -> just pull latest remote changes
        await handlePull()
        showToast("✓ Vault is already up to date with remote", "info")
        return
      }

      // Collect all modified files from drafts
      const filesToCommit: { path: string; content: string }[] = []
      for (const p of draftPaths) {
        const draftContent = getDraft(activeRepo, p)
        if (draftContent !== null) {
          filesToCommit.push({ path: p, content: draftContent })
        }
      }

      // Commit strictly the draft note files — never touch .obsidian
      const backupMsg = formatObsidianBackupMessage()
      const result = await atomicCommitVault(
        session.token,
        owner,
        name,
        filesToCommit,
        backupMsg,
      )

      // Clear all drafts immediately from localStorage!
      clearAllDrafts(activeRepo)
      refreshDrafts()

      // Refresh file tree to reflect all newly pushed files
      const updatedTree = await fetchRepoTree(session.token, owner, name)
      setRepoTree(updatedTree)

      // If active file was among drafts, update its local content and SHA
      if (selectedPath) {
        const matchingDraft = filesToCommit.find((f) => f.path === selectedPath)
        if (matchingDraft) {
          setActiveFileData({
            path: selectedPath,
            content: matchingDraft.content,
            sha: result.commitSha,
          })
        }
      }

      showToast(`✓ Vault Synced: pushed ${draftPaths.length} note(s)!`, "success")
    } catch (err: any) {
      showToast(`Sync failed: ${err.message || "Network error"}`, "error")
    } finally {
      setIsSyncing(false)
    }
  }

  const handleCloseActiveNote = () => {
    if (selectedPath) {
      handleCloseTab(selectedPath)
    } else {
      setSelectedPath(null)
      setActiveFileData(null)
    }
  }

  const handleSignOut = () => {
    clearSession()
    setSession(null)
    setActiveRepo(null)
    setRepoTree([])
    setSelectedPath(null)
    setActiveFileData(null)
    setOpenTabs([])
    setDraftCount(0)
  }

  // Check if README.md exists in repo
  const readmeItem = repoTree.find((t) => t.path.toLowerCase() === "readme.md")

  return (
    <div class="app-layout-root">
      {/* Quartz Navigation Header */}
      <header class="quartz-header">
        <div class="header-left">
          <a href="/" class="brand-link">
            <SproutIcon />
            <span class="brand-title">Zettly</span>
          </a>

          {session && (
            <div class="header-repo-selector">
              <button
                class="repo-trigger-btn"
                onClick={() => setIsRepoModalOpen(true)}
                title="Switch Vault or Repository"
              >
                <RepoIcon />
                <span class="repo-name-text">
                  {activeRepo ? activeRepo : "Select Obsidian Vault..."}
                </span>
                {isObsidianVault && (
                  <span class="header-vault-badge">Obsidian</span>
                )}
              </button>
            </div>
          )}
        </div>

        <div class="header-right">
          {session && activeRepo && (
            <div class="header-git-actions">
              <button
                class="header-git-btn btn-pull"
                onClick={handlePull}
                disabled={isPulling || isSyncing}
                title="Pull latest changes from GitHub"
              >
                <PullIcon class={isPulling ? "spin-icon" : ""} />
                <span class="git-btn-text">{isPulling ? "Pulling..." : "Pull"}</span>
              </button>

              <button
                class={`header-git-btn btn-sync ${draftCount > 0 ? "has-drafts" : ""}`}
                onClick={handleFullSync}
                disabled={isSyncing || isPulling}
                title={
                  draftCount > 0
                    ? `Commit & Sync ${draftCount} unpushed draft(s) with Obsidian backup`
                    : "Sync vault with GitHub remote"
                }
              >
                <SyncIcon class={isSyncing ? "spin-icon" : ""} />
                <span class="git-btn-text">{isSyncing ? "Syncing..." : "Sync"}</span>
                {draftCount > 0 && (
                  <span class="draft-count-badge">{draftCount}</span>
                )}
              </button>
            </div>
          )}

          <ThemeToggle />

          {session && (
            <div class="header-user-badge">
              <img
                src={session.user.avatar_url}
                alt={session.user.login}
                class="user-tiny-avatar"
              />
              <span class="user-handle">@{session.user.login}</span>
              <button class="btn-logout-small" onClick={handleSignOut} title="Sign Out">
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Toast Notification Banner */}
      {toast && (
        <div class={`app-toast toast-${toast.type}`}>
          <span class="toast-message">{toast.message}</span>
          <button class="toast-close" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {/* Main View Area */}
      {!session ? (
        <main class="main-auth-container">
          <LoginCard
            authStatus={authStatus}
            isLoading={isLoadingAuth}
            error={authError}
          />
        </main>
      ) : !activeRepo ? (
        <main class="main-unselected-container">
          <div class="select-vault-card">
            <div class="card-icon-wrapper">
              <RepoIcon />
            </div>
            <h2>Connect Your Obsidian Vault</h2>
            <p>
              Choose your private or public GitHub repository containing your notes and <code>.obsidian</code> folder.
            </p>
            <button
              class="btn-primary-action"
              onClick={() => setIsRepoModalOpen(true)}
            >
              Browse Repositories
            </button>
          </div>
        </main>
      ) : (
        /* Full Quartz 3-Column Layout */
        <main class="quartz-layout-container">
          {/* Left Column: Explorer (All folders collapsed by default) */}
          <FileExplorer
            tree={repoTree}
            selectedPath={selectedPath}
            repoFullName={activeRepo}
            isLoading={isLoadingTree}
            onSelectFile={handleSelectFile}
            onOpenInNewTab={handleOpenInNewTab}
            onOpenToRight={handleOpenToRight}
            onOpenInNewWindow={handleOpenInNewWindow}
            onCreateFile={handleCreateNewNote}
            onCreateFolder={handleCreateFolder}
            onRenameFile={handleRenameFile}
            onRenameFolder={handleRenameFolder}
            onDeleteFile={handleDeleteFile}
            onDeleteFolder={handleDeleteFolder}
            onShowToast={showToast}
          />

          {/* Center Column: Editor or Obsidian Default Opening Screen */}
          <section class="quartz-editor-container">
            {/* Obsidian Multi-Tab Strip */}
            <div class="obsidian-tab-strip">
              {openTabs.length === 0 ? (
                <div class="obsidian-tab-item active">
                  <span>New tab</span>
                </div>
              ) : (
                openTabs.map((tabPath) => {
                  const isActive = selectedPath === tabPath
                  const tabTitle = tabPath.split("/").pop()?.replace(/\.md$/, "") || tabPath
                  const isDraft = hasDraft(activeRepo, tabPath)

                  return (
                    <div
                      key={tabPath}
                      class={`obsidian-tab-item ${isActive ? "active" : ""}`}
                      onClick={() => handleSelectFile(tabPath)}
                      title={tabPath}
                    >
                      <span class="tab-title">{tabTitle}</span>
                      {isDraft && (
                        <span class="tab-draft-dot" title="Unsaved changes in buffer">
                          ●
                        </span>
                      )}
                      <button
                        class="tab-close-btn"
                        title="Close tab"
                        onClick={(e) => handleCloseTab(tabPath, e)}
                      >
                        ✕
                      </button>
                    </div>
                  )
                })
              )}

              <button
                class="obsidian-tab-plus"
                title="New tab (Obsidian welcome)"
                onClick={() => {
                  setSelectedPath(null)
                  setActiveFileData(null)
                }}
              >
                <PlusIcon />
              </button>
            </div>

            {isLoadingFile ? (
              <div class="editor-loading-state">
                <span class="spinner" style={{ borderColor: "var(--secondary)", borderTopColor: "transparent" }}></span>
                <span>Fetching note from GitHub...</span>
              </div>
            ) : fileError ? (
              <div class="alert-box alert-error" style={{ margin: "2rem" }}>
                <strong>Error:</strong> {fileError}
              </div>
            ) : activeFileData && selectedPath ? (
              <Editor
                key={activeFileData.path}
                repoFullName={activeRepo}
                filePath={activeFileData.path}
                initialContent={activeFileData.content}
                sha={activeFileData.sha}
                token={session.token}
                isObsidianVault={isObsidianVault}
                onCommitSuccess={handleCommitSuccess}
                onClose={handleCloseActiveNote}
              />
            ) : (
              /* Obsidian Default Opening State */
              <div class="obsidian-default-state">
                <div class="obsidian-welcome-actions">
                  <button class="obsidian-action-row" onClick={() => handleCreateNewNote()}>
                    <span class="action-text">Create new note</span>
                    <span class="action-shortcut">Ctrl + N</span>
                  </button>

                  <button class="obsidian-action-row" onClick={handleQuickSearch}>
                    <span class="action-text">Go to file</span>
                    <span class="action-shortcut">Ctrl + O</span>
                  </button>

                  {readmeItem && (
                    <button
                      class="obsidian-action-row"
                      onClick={() => handleSelectFile(readmeItem.path)}
                    >
                      <span class="action-text">Open README</span>
                    </button>
                  )}

                  <button class="obsidian-action-row" onClick={() => setIsRepoModalOpen(true)}>
                    <span class="action-text">Switch Vault</span>
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Right Column: Outline & Metadata */}
          <Outline
            content={activeFileData?.content || ""}
            repoFullName={activeRepo}
            isObsidianVault={isObsidianVault}
            filePath={activeFileData?.path || ""}
          />
        </main>
      )}

      {/* Repository Selector Modal */}
      {session && (
        <RepoModal
          token={session.token}
          isOpen={isRepoModalOpen}
          onClose={() => setIsRepoModalOpen(false)}
          onSelectRepo={handleSelectRepo}
        />
      )}
    </div>
  )
}
