import { JSX } from "preact"
import { useMemo, useEffect, useRef } from "preact/hooks"
import {
  HeadingIcon,
  ListBulletIcon,
  ListCheckIcon,
  CalloutIcon,
  TableIcon,
  CodeBlockIcon,
  DividerIcon,
  QuoteIcon,
  LinkIcon,
} from "./Icons"

export interface SlashCommand {
  id: string
  title: string
  description: string
  category: "Headings" | "Lists" | "Callouts" | "Blocks" | "Links"
  keywords: string
  snippet: string
  cursorOffset?: number
  icon: JSX.Element
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "h1",
    title: "Heading 1",
    description: "Large section heading",
    category: "Headings",
    keywords: "h1 heading title big large 1 #",
    snippet: "# ",
    icon: <HeadingIcon />,
  },
  {
    id: "h2",
    title: "Heading 2",
    description: "Medium section heading",
    category: "Headings",
    keywords: "h2 heading subtitle medium 2 ##",
    snippet: "## ",
    icon: <HeadingIcon />,
  },
  {
    id: "h3",
    title: "Heading 3",
    description: "Small section heading",
    category: "Headings",
    keywords: "h3 heading subheader small 3 ###",
    snippet: "### ",
    icon: <HeadingIcon />,
  },
  {
    id: "checklist",
    title: "Checklist",
    description: "Interactive task checkbox item",
    category: "Lists",
    keywords: "todo checklist task checkbox [] check",
    snippet: "- [ ] ",
    icon: <ListCheckIcon />,
  },
  {
    id: "bullet-list",
    title: "Bulleted List",
    description: "Unordered bullet point",
    category: "Lists",
    keywords: "bullet list ul unordered - *",
    snippet: "- ",
    icon: <ListBulletIcon />,
  },
  {
    id: "ordered-list",
    title: "Numbered List",
    description: "Sequential numbered item",
    category: "Lists",
    keywords: "number ordered list ol 1.",
    snippet: "1. ",
    icon: <ListBulletIcon />,
  },
  {
    id: "callout-note",
    title: "Note Callout",
    description: "Obsidian info notice box",
    category: "Callouts",
    keywords: "callout note info notice box",
    snippet: "> [!NOTE]\n> ",
    icon: <CalloutIcon />,
  },
  {
    id: "callout-tip",
    title: "Tip Callout",
    description: "Obsidian advice/tip notice box",
    category: "Callouts",
    keywords: "callout tip hint advice recommendation",
    snippet: "> [!TIP]\n> ",
    icon: <CalloutIcon />,
  },
  {
    id: "callout-warning",
    title: "Warning Callout",
    description: "Obsidian warning & alert box",
    category: "Callouts",
    keywords: "callout warning alert caution danger",
    snippet: "> [!WARNING]\n> ",
    icon: <CalloutIcon />,
  },
  {
    id: "callout-important",
    title: "Important Callout",
    description: "Obsidian high priority notice box",
    category: "Callouts",
    keywords: "callout important critical key",
    snippet: "> [!IMPORTANT]\n> ",
    icon: <CalloutIcon />,
  },
  {
    id: "quote",
    title: "Blockquote",
    description: "Direct quote or citation",
    category: "Blocks",
    keywords: "quote blockquote citation >",
    snippet: "> ",
    icon: <QuoteIcon />,
  },
  {
    id: "code-block",
    title: "Code Block",
    description: "Fenced code block",
    category: "Blocks",
    keywords: "code snippet block pre syntax",
    snippet: "```\n\n```",
    cursorOffset: 4,
    icon: <CodeBlockIcon />,
  },
  {
    id: "table",
    title: "Table",
    description: "Markdown data table",
    category: "Blocks",
    keywords: "table grid spreadsheet rows columns",
    snippet: "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |",
    icon: <TableIcon />,
  },
  {
    id: "divider",
    title: "Divider",
    description: "Horizontal separator line",
    category: "Blocks",
    keywords: "divider horizontal rule hr line break ---",
    snippet: "---\n",
    icon: <DividerIcon />,
  },
  {
    id: "wikilink",
    title: "Wikilink",
    description: "Obsidian internal [[note link]]",
    category: "Links",
    keywords: "wikilink link internal note [[]]",
    snippet: "[[",
    icon: <LinkIcon />,
  },
]

interface SlashCommandsMenuProps {
  query: string
  selectedIndex: number
  position?: { top: number; left: number }
  onSelect: (command: SlashCommand) => void
  onClose: () => void
  menuRef?: { current: HTMLDivElement | null }
}

export function SlashCommandsMenu({
  query,
  selectedIndex,
  position,
  onSelect,
  onClose: _onClose,
  menuRef,
}: SlashCommandsMenuProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const style = position
    ? {
        position: "fixed" as const,
        top: `${position.top}px`,
        left: `${position.left}px`,
      }
    : {}

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter((cmd) => {
      return (
        cmd.title.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.keywords.toLowerCase().includes(q)
      )
    })
  }, [query])

  useEffect(() => {
    if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      })
    }
  }, [selectedIndex])

  if (filteredCommands.length === 0) {
    return (
      <div ref={menuRef as any} class="slash-commands-menu empty" style={style}>
        <div class="slash-empty-message">No matching commands for "/{query}"</div>
      </div>
    )
  }

  return (
    <div ref={menuRef as any} class="slash-commands-menu" role="menu" style={style}>
      <div class="slash-header">
        <span class="slash-header-title">Insert Block</span>
        <span class="slash-header-hint">↑↓ to navigate • ↵ to insert • Esc to cancel</span>
      </div>
      <div class="slash-list">
        {filteredCommands.map((cmd, idx) => {
          const isSelected = idx === selectedIndex
          return (
            <button
              key={cmd.id}
              ref={(el) => {
                itemRefs.current[idx] = el
              }}
              type="button"
              class={`slash-item ${isSelected ? "selected" : ""}`}
              onMouseDown={(e) => {
                // Prevent blurring textarea before click fires
                e.preventDefault()
                onSelect(cmd)
              }}
            >
              <div class="slash-item-icon">{cmd.icon}</div>
              <div class="slash-item-text">
                <span class="slash-item-title">{cmd.title}</span>
                <span class="slash-item-desc">{cmd.description}</span>
              </div>
              <span class="slash-item-category">{cmd.category}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
