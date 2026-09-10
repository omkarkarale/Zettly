import { LockIcon, GitHubIcon } from "./Icons"
import { AuthStatus, initiateGitHubOAuth } from "../lib/github"

interface LoginCardProps {
  authStatus: AuthStatus | null
  isLoading: boolean
  error: string | null
}

export function LoginCard({ authStatus, isLoading, error }: LoginCardProps) {
  const isConfigured = Boolean(authStatus?.configured && authStatus.clientId)

  const handleGitHubClick = () => {
    if (!authStatus?.clientId) return
    initiateGitHubOAuth(authStatus.clientId)
  }

  return (
    <div class="card">
      <div class="card-header">
        <div class="card-icon-wrapper">
          <LockIcon />
        </div>
        <h1 class="card-title">GitOAuth Access</h1>
        <p class="card-subtitle">
          Connect your GitHub account to manage, author, and sync your digital garden.
        </p>
      </div>

      {error && (
        <div class="alert-box alert-error" role="alert">
          <div>
            <strong>Error: </strong> {error}
          </div>
        </div>
      )}

      {!isConfigured && (
        <div class="alert-box alert-warning">
          <div>
            <strong>Setup Required:</strong> Add your <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> to your <code>.env</code> file (or Vercel Environment Variables).
          </div>
        </div>
      )}

      <button
        class="btn-github"
        onClick={handleGitHubClick}
        disabled={!isConfigured || isLoading}
      >
        {isLoading ? (
          <>
            <span class="spinner"></span> Connecting to GitHub...
          </>
        ) : (
          <>
            <GitHubIcon /> Sign in with GitHub
          </>
        )}
      </button>
    </div>
  )
}
