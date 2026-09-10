import { useMemo } from "preact/hooks"

interface OutlineProps {
  content: string
  repoFullName: string
  isObsidianVault: boolean
  filePath: string
}

interface TocItem {
  level: number
  text: string
  slug: string
}

export function Outline({ content, repoFullName, isObsidianVault, filePath }: OutlineProps) {
  // Extract Headings
  const headings = useMemo(() => {
    const lines = content.split("\n")
    const list: TocItem[] = []

    for (const line of lines) {
      const match = line.match(/^(#{1,4})\s+(.+)$/)
      if (match) {
        const level = match[1].length
        const text = match[2].trim()
        const slug = text
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-")
        list.push({ level, text, slug })
      }
    }
    return list
  }, [content])

  // Extract YAML Frontmatter if present
  const frontmatter = useMemo(() => {
    if (!content.startsWith("---")) return null
    const end = content.indexOf("---", 3)
    if (end === -1) return null
    const raw = content.slice(3, end).trim()
    const lines = raw.split("\n")
    const props: Record<string, string> = {}
    for (const line of lines) {
      const parts = line.split(":")
      if (parts.length >= 2) {
        const key = parts[0].trim()
        const val = parts.slice(1).join(":").trim()
        props[key] = val
      }
    }
    return props
  }, [content])

  return (
    <aside class="sidebar-outline">
      {/* Vault Status Card */}
      <div class="outline-card vault-status-card">
        <div class="vault-status-header">
          <span class="vault-dot"></span>
          <span class="vault-repo-label" title={repoFullName}>
            {repoFullName.split("/")[1] || repoFullName}
          </span>
        </div>
        {filePath && (
          <div style={{ fontSize: "0.72rem", color: "var(--gray)", fontFamily: "var(--codeFont)", marginBottom: "0.4rem", wordBreak: "break-all" }}>
            {filePath}
          </div>
        )}
        <div class="vault-badge-row">
          {isObsidianVault ? (
            <span class="obsidian-verified-badge" title=".obsidian folder detected in repo">
              ✓ Obsidian Vault Verified
            </span>
          ) : (
            <span class="obsidian-warning-badge" title="No .obsidian folder detected in repo root">
              ⚠ Standard Git Repo
            </span>
          )}
        </div>
      </div>

      {/* Frontmatter Properties */}
      {frontmatter && Object.keys(frontmatter).length > 0 && (
        <div class="outline-card frontmatter-card">
          <div class="outline-card-title">Properties</div>
          <div class="frontmatter-props">
            {Object.entries(frontmatter).map(([k, v]) => (
              <div key={k} class="fm-row">
                <span class="fm-key">{k}:</span>
                <span class="fm-val">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table of Contents */}
      <div class="outline-card toc-card">
        <div class="outline-card-title">Outline</div>
        {headings.length === 0 ? (
          <div class="toc-empty">No headings found in this note.</div>
        ) : (
          <nav class="toc-nav">
            {headings.map((h, i) => (
              <div
                key={i}
                class={`toc-item toc-level-${h.level}`}
                title={h.text}
              >
                {h.text}
              </div>
            ))}
          </nav>
        )}
      </div>
    </aside>
  )
}
