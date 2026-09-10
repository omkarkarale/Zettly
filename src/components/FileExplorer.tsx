import { useState, useMemo, useRef, useEffect } from "preact/hooks"
import { RepoTreeItem } from "../lib/github"
import { hasDraft } from "../lib/storage"
import {
  FolderIcon,
  FileIcon,
  ChevronIcon,
  SearchIcon,
  PlusIcon,
  MoreIcon,
  EditIcon,
  CopyIcon,
  LinkIcon,
  TrashIcon,
  NewTabIcon,
  SplitIcon,
  ExternalLinkIcon,
} from "./Icons"

export interface TreeNode {
  name: string
  path: string
  type: "tree" | "blob"
  children?: TreeNode[]
}

interface FileExplorerProps {
  tree: RepoTreeItem[]
  selectedPath: string | null
  repoFullName: string
  isLoading?: boolean
  onSelectFile: (path: string) => void
  onOpenInNewTab: (path: string) => void
  onOpenToRight: (path: string) => void
  onOpenInNewWindow: (path: string) => void
  onCreateFile: (folderPath: string) => void
  onCreateFolder: (parentFolderPath: string) => void
  onRenameFile: (oldPath: string, newPath: string) => void
  onRenameFolder: (oldFolderPath: string) => void
  onDeleteFile: (path: string) => void
  onDeleteFolder: (folderPath: string) => void
  onShowToast?: (message: string, type?: "info" | "success" | "error") => void
}

function buildNestedTree(items: RepoTreeItem[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", type: "tree", children: [] }

  // Filter out internal non-content folders like .git, .obsidian, .trash
  const filtered = items.filter(
    (item) =>
      !item.path.startsWith(".git/") &&
      !item.path.startsWith(".obsidian/") &&
      !item.path.startsWith(".trash/") &&
      item.path !== ".git" &&
      item.path !== ".obsidian" &&
      item.path !== ".trash",
  )

  for (const item of filtered) {
    const parts = item.path.split("/")
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      current.children = current.children || []

      let child = current.children.find((c) => c.name === part)
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          type: isLast && item.type === "blob" ? "blob" : "tree",
          children: isLast && item.type === "blob" ? undefined : [],
        }
        current.children.push(child)
      }
      current = child
    }
  }

  // Sort: folders first (alphabetical), then files
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name, undefined, { numeric: true })
      return a.type === "tree" ? -1 : 1
    })
    for (const n of nodes) {
      if (n.children) sortNodes(n.children)
    }
  }

  if (root.children) sortNodes(root.children)
  return root.children || []
}

function TreeItemView({
  node,
  selectedPath,
  repoFullName,
  onSelectFile,
  onCreateFile,
  onOpenContextMenu,
  renamingPath,
  onCommitRename,
  depth = 0,
}: {
  node: TreeNode
  selectedPath: string | null
  repoFullName: string
  onSelectFile: (path: string) => void
  onCreateFile: (folderPath: string) => void
  onOpenContextMenu: (e: MouseEvent, node: TreeNode) => void
  renamingPath: string | null
  onCommitRename: (oldPath: string, newName: string) => void
  depth?: number
}) {
  const [open, setOpen] = useState(false)
  const isSelected = selectedPath === node.path
  const isDraft = hasDraft(repoFullName, node.path)
  const isRenaming = renamingPath === node.path

  const [renameText, setRenameText] = useState(node.name.replace(/\.md$/, ""))
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming) {
      setRenameText(node.name.replace(/\.md$/, ""))
      setTimeout(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus()
          renameInputRef.current.select()
        }
      }, 50)
    }
  }, [isRenaming, node.name])

  const handleRenameSubmit = () => {
    const trimmed = renameText.trim()
    if (trimmed && trimmed !== node.name.replace(/\.md$/, "")) {
      onCommitRename(node.path, trimmed)
    } else {
      onCommitRename(node.path, "") // cancel
    }
  }

  const handleRenameKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleRenameSubmit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onCommitRename(node.path, "") // cancel
    }
  }

  if (node.type === "tree") {
    return (
      <div class="tree-group">
        <div
          class="tree-node tree-folder"
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          onClick={() => setOpen(!open)}
          onContextMenu={(e) => {
            e.preventDefault()
            onOpenContextMenu(e, node)
          }}
        >
          <ChevronIcon open={open} />
          <FolderIcon />
          <span class="tree-label">{node.name}</span>

          {/* Outline-inspired Folder Hover Actions */}
          <div class="tree-actions-hover" onClick={(e) => e.stopPropagation()}>
            <button
              class="tree-action-btn"
              title={`New file inside ${node.name}`}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(true)
                onCreateFile(node.path)
              }}
            >
              <PlusIcon />
            </button>

            <button
              class="tree-action-btn"
              title="Folder options"
              onClick={(e) => {
                e.stopPropagation()
                onOpenContextMenu(e, node)
              }}
            >
              <MoreIcon />
            </button>
          </div>
        </div>

        {open && node.children && (
          <div class="tree-children">
            {node.children.map((child) => (
              <TreeItemView
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                repoFullName={repoFullName}
                onSelectFile={onSelectFile}
                onCreateFile={onCreateFile}
                onOpenContextMenu={onOpenContextMenu}
                renamingPath={renamingPath}
                onCommitRename={onCommitRename}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Only highlight markdown or text notes
  const isMd = node.name.endsWith(".md")

  return (
    <div
      class={`tree-node tree-file ${isSelected ? "tree-selected" : ""} ${!isMd ? "tree-file-other" : ""}`}
      style={{ paddingLeft: `${depth * 14 + 26}px` }}
      onClick={() => {
        if (!isRenaming) onSelectFile(node.path)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onOpenContextMenu(e, node)
      }}
      title={node.path}
    >
      <FileIcon />

      {isRenaming ? (
        <input
          ref={renameInputRef}
          type="text"
          class="tree-rename-input"
          value={renameText}
          onClick={(e) => e.stopPropagation()}
          onInput={(e) => setRenameText((e.target as HTMLInputElement).value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={handleRenameSubmit}
        />
      ) : (
        <span class="tree-label">{node.name.replace(/\.md$/, "")}</span>
      )}

      {isDraft && !isRenaming && (
        <span class="draft-indicator" title="Unsaved draft in localStorage">
          ●
        </span>
      )}

      {/* Outline-inspired File Hover Actions */}
      {!isRenaming && (
        <div class="tree-actions-hover" onClick={(e) => e.stopPropagation()}>
          <button
            class="tree-action-btn"
            title="File options"
            onClick={(e) => {
              e.stopPropagation()
              onOpenContextMenu(e, node)
            }}
          >
            <MoreIcon />
          </button>
        </div>
      )}
    </div>
  )
}


export function FileExplorer({
  tree,
  selectedPath,
  repoFullName,
  isLoading,
  onSelectFile,
  onOpenInNewTab,
  onOpenToRight,
  onOpenInNewWindow,
  onCreateFile,
  onCreateFolder,
  onRenameFile,
  onRenameFolder,
  onDeleteFile,
  onDeleteFolder,
  onShowToast,
}: FileExplorerProps) {
  const [query, setQuery] = useState("")
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: TreeNode
  } | null>(null)

  const nestedTree = useMemo(() => buildNestedTree(tree), [tree])

  // Close context menu on outside click or escape
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null)
    }
    window.addEventListener("click", handleGlobalClick)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("click", handleGlobalClick)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  // Filter tree when searching
  const filteredTree = useMemo(() => {
    if (!query.trim()) return nestedTree
    const q = query.toLowerCase()

    function filterNodes(nodes: TreeNode[]): TreeNode[] {
      const results: TreeNode[] = []
      for (const node of nodes) {
        if (node.type === "blob") {
          if (node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)) {
            results.push(node)
          }
        } else if (node.children) {
          const matchingChildren = filterNodes(node.children)
          if (matchingChildren.length > 0) {
            results.push({ ...node, children: matchingChildren })
          }
        }
      }
      return results
    }

    return filterNodes(nestedTree)
  }, [nestedTree, query])

  const handleOpenContextMenu = (e: MouseEvent, node: TreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node,
    })
  }

  const handleCommitRename = (oldPath: string, newName: string) => {
    setRenamingPath(null)
    if (!newName) return

    const parts = oldPath.split("/")
    parts[parts.length - 1] = `${newName}.md`
    const newPath = parts.join("/")

    if (newPath !== oldPath && onRenameFile) {
      onRenameFile(oldPath, newPath)
    }
  }

  return (
    <aside class="sidebar-explorer">
      <div class="explorer-header">
        <span class="explorer-title">Explorer</span>
      </div>

      <div class="explorer-search">
        <SearchIcon />
        <input
          type="text"
          placeholder="Filter notes..."
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          class="explorer-search-input"
        />
        {query && (
          <button class="search-clear" onClick={() => setQuery("")}>
            ✕
          </button>
        )}
      </div>

      <div
        class="explorer-tree"
        onContextMenu={(e) => {
          // If right-clicked on empty area of tree
          if ((e.target as HTMLElement).classList.contains("explorer-tree") || (e.target as HTMLElement).classList.contains("tree-empty")) {
            e.preventDefault()
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              node: { name: "Root", path: "", type: "tree", children: [] },
            })
          }
        }}
      >
        {isLoading ? (
          <div class="loading-state" style={{ padding: "2rem 1rem" }}>
            <span class="spinner" style={{ borderColor: "var(--secondary)", borderTopColor: "transparent" }}></span>
            <span>Loading notes...</span>
          </div>
        ) : filteredTree.length === 0 ? (
          <div class="tree-empty">No markdown notes found.</div>
        ) : (
          filteredTree.map((node) => (
            <TreeItemView
              key={node.path}
              node={node}
              selectedPath={selectedPath}
              repoFullName={repoFullName}
              onSelectFile={onSelectFile}
              onCreateFile={onCreateFile}
              onOpenContextMenu={handleOpenContextMenu}
              renamingPath={renamingPath}
              onCommitRename={handleCommitRename}
            />
          ))
        )}
      </div>

      {/* Floating Context Menu */}
      {contextMenu && (
        <div
          class="tree-context-menu"
          style={{
            top: `${Math.min(contextMenu.y, window.innerHeight - 280)}px`,
            left: `${Math.min(contextMenu.x, window.innerWidth - 190)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.node.type === "blob" ? (
            /* File Context Menu */
            <>
              <button
                class="context-menu-item"
                onClick={() => {
                  onOpenInNewTab(contextMenu.node.path)
                  setContextMenu(null)
                }}
              >
                <NewTabIcon />
                <span>Open in new tab</span>
              </button>

              <button
                class="context-menu-item"
                onClick={() => {
                  onOpenToRight(contextMenu.node.path)
                  setContextMenu(null)
                }}
              >
                <SplitIcon />
                <span>Open to right</span>
              </button>

              <button
                class="context-menu-item"
                onClick={() => {
                  onOpenInNewWindow(contextMenu.node.path)
                  setContextMenu(null)
                }}
              >
                <ExternalLinkIcon />
                <span>Open in new window</span>
              </button>

              <div class="context-menu-divider" />

              <button
                class="context-menu-item"
                onClick={() => {
                  setRenamingPath(contextMenu.node.path)
                  setContextMenu(null)
                }}
              >
                <EditIcon />
                <span>Rename</span>
              </button>

              <button
                class="context-menu-item"
                onClick={() => {
                  const title = contextMenu.node.name.replace(/\.md$/, "")
                  navigator.clipboard.writeText(`[[${title}]]`)
                  onShowToast?.(`✓ Copied [[${title}]] to clipboard`, "info")
                  setContextMenu(null)
                }}
              >
                <LinkIcon />
                <span>Copy Wikilink</span>
              </button>

              <button
                class="context-menu-item"
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.node.path)
                  onShowToast?.(`✓ Copied relative path to clipboard`, "info")
                  setContextMenu(null)
                }}
              >
                <CopyIcon />
                <span>Copy Path</span>
              </button>

              <div class="context-menu-divider" />

              <button
                class="context-menu-item menu-item-danger"
                onClick={() => {
                  onDeleteFile(contextMenu.node.path)
                  setContextMenu(null)
                }}
              >
                <TrashIcon />
                <span>Delete</span>
              </button>
            </>
          ) : (
            /* Folder Context Menu */
            <>
              <button
                class="context-menu-item"
                onClick={() => {
                  onCreateFile(contextMenu.node.path)
                  setContextMenu(null)
                }}
              >
                <PlusIcon />
                <span>New File</span>
              </button>

              <button
                class="context-menu-item"
                onClick={() => {
                  onCreateFolder(contextMenu.node.path)
                  setContextMenu(null)
                }}
              >
                <FolderIcon />
                <span>New Folder</span>
              </button>

              {contextMenu.node.path && (
                <button
                  class="context-menu-item"
                  onClick={() => {
                    onRenameFolder(contextMenu.node.path)
                    setContextMenu(null)
                  }}
                >
                  <EditIcon />
                  <span>Rename</span>
                </button>
              )}

              {contextMenu.node.path && (
                <button
                  class="context-menu-item"
                  onClick={() => {
                    navigator.clipboard.writeText(contextMenu.node.path)
                    onShowToast?.(`✓ Copied folder path to clipboard`, "info")
                    setContextMenu(null)
                  }}
                >
                  <CopyIcon />
                  <span>Copy Path</span>
                </button>
              )}

              {contextMenu.node.path && (
                <>
                  <div class="context-menu-divider" />
                  <button
                    class="context-menu-item menu-item-danger"
                    onClick={() => {
                      // Check if folder is not empty
                      if (contextMenu.node.children && contextMenu.node.children.length > 0) {
                        onShowToast?.(`Cannot delete "${contextMenu.node.name}": folder is not empty`, "error")
                      } else {
                        onDeleteFolder(contextMenu.node.path)
                      }
                      setContextMenu(null)
                    }}
                  >
                    <TrashIcon />
                    <span>Delete</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  )
}

