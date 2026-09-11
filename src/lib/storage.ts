export interface GitHubUser {
  login: string
  id: number
  avatar_url: string
  html_url: string
  name: string | null
  company: string | null
  blog: string | null
  location: string | null
  email: string | null
  bio: string | null
  public_repos: number
  followers: number
  following: number
}

export interface AuthSession {
  token: string
  tokenType: string
  scope?: string
  user: GitHubUser
}

export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  private: boolean
  html_url: string
  description: string | null
  default_branch: string
  updated_at: string
}

const SESSION_KEY = "zettly_git_session"
const REPO_KEY = "zettly_active_repo"
const DRAFT_PREFIX = "zettly_draft:"

// 1. Session Storage
export function getStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AuthSession
  } catch {
    return null
  }
}

export function saveSession(session: AuthSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch (e) {
    console.error("Failed to save auth session", e)
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(REPO_KEY)
  } catch (e) {
    console.error("Failed to clear auth session", e)
  }
}

// 2. Active Repository
export function getStoredRepo(): string | null {
  return localStorage.getItem(REPO_KEY)
}

export function saveStoredRepo(repoFullName: string): void {
  localStorage.setItem(REPO_KEY, repoFullName)
}

// 3. Draft Buffer (cleared the moment it's committed to GitHub)
function getDraftKey(repoFullName: string, filePath: string): string {
  return `${DRAFT_PREFIX}${repoFullName}:${filePath}`
}

export function getDraft(repoFullName: string, filePath: string): string | null {
  try {
    return localStorage.getItem(getDraftKey(repoFullName, filePath))
  } catch {
    return null
  }
}

export function saveDraft(repoFullName: string, filePath: string, content: string): void {
  try {
    localStorage.setItem(getDraftKey(repoFullName, filePath), content)
  } catch (e) {
    console.warn("Failed to buffer draft in localStorage", e)
  }
}

export function clearDraft(repoFullName: string, filePath: string): void {
  try {
    localStorage.removeItem(getDraftKey(repoFullName, filePath))
  } catch (e) {
    console.warn("Failed to clear draft", e)
  }
}

export function hasDraft(repoFullName: string, filePath: string): boolean {
  return Boolean(getDraft(repoFullName, filePath))
}

export function renameDraft(repoFullName: string, oldPath: string, newPath: string): void {
  const content = getDraft(repoFullName, oldPath)
  if (content !== null) {
    saveDraft(repoFullName, newPath, content)
    clearDraft(repoFullName, oldPath)
  }
}


// List all files that have unpushed drafts in this repository
export function listDraftPaths(repoFullName: string): string[] {
  const prefix = `${DRAFT_PREFIX}${repoFullName}:`
  const paths: string[] = []

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) {
        paths.push(key.substring(prefix.length))
      }
    }
  } catch (e) {
    console.warn("Failed to inspect draft keys", e)
  }
  return paths
}

// Clear all unpushed drafts for this repository (called after full sync)
export function clearAllDrafts(repoFullName: string): void {
  const paths = listDraftPaths(repoFullName)
  for (const p of paths) {
    clearDraft(repoFullName, p)
  }
}

// Standard Obsidian Git commit message formatter: vault backup: YYYY-MM-DD HH:mm:ss
export function formatObsidianBackupMessage(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const min = pad(date.getMinutes())
  const s = pad(date.getSeconds())

  return `vault backup: ${y}-${m}-${d} ${h}:${min}:${s}`
}

// 4. Pending Deletions Buffer (tracks deleted files until committed to GitHub)
const DELETION_PREFIX = "zettly_pending_del:"

function getDeletionKey(repoFullName: string): string {
  return `${DELETION_PREFIX}${repoFullName}`
}

export function listPendingDeletions(repoFullName: string): string[] {
  try {
    const raw = localStorage.getItem(getDeletionKey(repoFullName))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function setPendingDeletions(repoFullName: string, paths: string[]): void {
  try {
    localStorage.setItem(getDeletionKey(repoFullName), JSON.stringify(paths))
  } catch (e) {
    console.warn("Failed to set pending deletions", e)
  }
}

export function addPendingDeletion(repoFullName: string, filePath: string): void {
  try {
    const current = listPendingDeletions(repoFullName)
    if (!current.includes(filePath)) {
      current.push(filePath)
      localStorage.setItem(getDeletionKey(repoFullName), JSON.stringify(current))
    }
  } catch (e) {
    console.warn("Failed to buffer pending deletion in localStorage", e)
  }
}

export function clearPendingDeletion(repoFullName: string, filePath: string): void {
  try {
    const current = listPendingDeletions(repoFullName).filter((p) => p !== filePath)
    localStorage.setItem(getDeletionKey(repoFullName), JSON.stringify(current))
  } catch (e) {
    console.warn("Failed to clear pending deletion", e)
  }
}

export function clearAllPendingDeletions(repoFullName: string): void {
  try {
    localStorage.removeItem(getDeletionKey(repoFullName))
  } catch (e) {
    console.warn("Failed to clear all pending deletions", e)
  }
}
