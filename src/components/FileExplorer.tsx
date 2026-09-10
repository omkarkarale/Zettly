import { useState, useMemo } from "preact/hooks"
import { RepoTreeItem } from "../lib/github"
import { hasDraft } from "../lib/storage"
import {
  FolderIcon,
  FileIcon,
  ChevronIcon,
  SearchIcon,
  PlusIcon,
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
  onCreateFile: (folderPath: string) => void
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
  depth = 0,
}: {
  node: TreeNode
  selectedPath: string | null
  repoFullName: string
  onSelectFile: (path: string) => void
  depth?: number
}) {
  const [open, setOpen] = useState(false)
  const isSelected = selectedPath === node.path
  const isDraft = hasDraft(repoFullName, node.path)

  if (node.type === "tree") {
    return (
      <div class="tree-group">
        <div
          class="tree-node tree-folder"
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          onClick={() => setOpen(!open)}
        >
          <ChevronIcon open={open} />
          <FolderIcon />
          <span class="tree-label">{node.name}</span>
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
      onClick={() => onSelectFile(node.path)}
      title={node.path}
    >
      <FileIcon />
      <span class="tree-label">{node.name.replace(/\.md$/, "")}</span>
      {isDraft && <span class="draft-indicator" title="Unsaved draft in localStorage">●</span>}
    </div>
  )
}

export function FileExplorer({
  tree,
  selectedPath,
  repoFullName,
  isLoading,
  onSelectFile,
  onCreateFile,
}: FileExplorerProps) {
  const [query, setQuery] = useState("")
  const nestedTree = useMemo(() => buildNestedTree(tree), [tree])

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

  return (
    <aside class="sidebar-explorer">
      <div class="explorer-header">
        <span class="explorer-title">Explorer</span>
        <button
          class="btn-new-note"
          onClick={() => onCreateFile("")}
          title="Create New Note in Root"
        >
          <PlusIcon /> Note
        </button>
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

      <div class="explorer-tree">
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
            />
          ))
        )}
      </div>
    </aside>
  )
}
