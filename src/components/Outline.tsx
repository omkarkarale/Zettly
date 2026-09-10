import { useMemo } from "preact/hooks"

interface OutlineProps {
  content: string
  repoFullName?: string
  isObsidianVault?: boolean
  filePath?: string
  onSelectHeading?: (headingText: string, level: number) => void
}

interface TocItem {
  level: number
  text: string
  slug: string
}

export function Outline({
  content,
  onSelectHeading,
}: OutlineProps) {
  // Extract Headings
  const headings = useMemo(() => {
    if (!content) return []
    const lines = content.split("\n")
    const list: TocItem[] = []

    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)$/)
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

  return (
    <aside class="sidebar-outline">
      <div class="outline-card toc-card">
        <div class="outline-card-title">OUTLINE</div>
        {headings.length === 0 ? (
          <div class="toc-empty">No headings in this note</div>
        ) : (
          <nav class="toc-nav" aria-label="Document outline">
            {headings.map((h, i) => (
              <button
                key={`${h.slug}-${i}`}
                type="button"
                class={`toc-item toc-level-${h.level}`}
                onClick={() => {
                  if (onSelectHeading) {
                    onSelectHeading(h.text, h.level)
                  }
                }}
                title={`Jump to ${h.text}`}
              >
                <span class="toc-bullet">•</span>
                <span class="toc-text">{h.text}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
    </aside>
  )
}
