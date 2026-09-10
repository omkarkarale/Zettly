import { useState, useEffect } from "preact/hooks"
import { GitHubRepo } from "../lib/storage"
import { fetchUserRepos, checkIsObsidianVault } from "../lib/github"
import { RepoIcon, SearchIcon } from "./Icons"

interface RepoModalProps {
  token: string
  isOpen: boolean
  onClose: () => void
  onSelectRepo: (repo: GitHubRepo, isObsidian: boolean) => void
}

export function RepoModal({ token, isOpen, onClose, onSelectRepo }: RepoModalProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [checkingRepo, setCheckingRepo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    setError(null)
    fetchUserRepos(token)
      .then((data) => {
        // Sort so repos named "Obsidian" or containing "obsidian" appear at top
        const sorted = [...data].sort((a, b) => {
          const aObs = a.name.toLowerCase().includes("obsidian") ? -1 : 1
          const bObs = b.name.toLowerCase().includes("obsidian") ? -1 : 1
          return aObs - bObs
        })
        setRepos(sorted)
      })
      .catch((err) => {
        setError(err.message || "Failed to load repositories from GitHub")
      })
      .finally(() => {
        setLoading(false)
      })
  }, [isOpen, token])

  if (!isOpen) return null

  const filtered = repos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase()),
  )

  const handleChooseRepo = async (repo: GitHubRepo) => {
    setCheckingRepo(repo.full_name)
    setError(null)
    try {
      const [owner, name] = repo.full_name.split("/")
      const hasObsidian = await checkIsObsidianVault(token, owner, name)
      onSelectRepo(repo, hasObsidian)
      onClose()
    } catch (err: any) {
      setError("Failed to verify vault structure: " + (err.message || String(err)))
    } finally {
      setCheckingRepo(null)
    }
  }

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div>
            <h2>Select Obsidian Vault</h2>
            <p class="modal-subtitle">
              Choose your private repository to access and edit markdown notes.
            </p>
          </div>
          <button class="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div class="repo-search-wrapper">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search repositories..."
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            class="repo-search-input"
            autoFocus
          />
        </div>

        {error && (
          <div class="alert-box alert-error" style={{ margin: "0.75rem 0" }}>
            {error}
          </div>
        )}

        <div class="repo-list">
          {loading ? (
            <div class="loading-state">
              <span class="spinner" style={{ borderColor: "var(--secondary)", borderTopColor: "transparent" }}></span>
              <span>Loading your repositories from GitHub...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div class="empty-state">No matching repositories found.</div>
          ) : (
            filtered.map((repo) => {
              const isChecking = checkingRepo === repo.full_name
              const hasObsidianName = repo.name.toLowerCase().includes("obsidian")

              return (
                <div
                  key={repo.id}
                  class={`repo-item ${hasObsidianName ? "repo-item-obsidian" : ""}`}
                  onClick={() => !isChecking && handleChooseRepo(repo)}
                >
                  <div class="repo-info">
                    <div class="repo-name-row">
                      <RepoIcon />
                      <span class="repo-title">{repo.full_name}</span>
                      {repo.private && <span class="badge-private">Private</span>}
                      {hasObsidianName && (
                        <span class="badge-vault-hint">Suggested Vault</span>
                      )}
                    </div>
                    {repo.description && (
                      <p class="repo-desc">{repo.description}</p>
                    )}
                  </div>

                  <button class="btn-select-repo" disabled={isChecking}>
                    {isChecking ? "Verifying..." : "Select Vault"}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
