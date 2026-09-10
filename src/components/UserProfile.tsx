import { AuthSession } from "../lib/storage"

interface UserProfileProps {
  session: AuthSession
  onSignOut: () => void
}

export function UserProfile({ session, onSignOut }: UserProfileProps) {
  const user = session.user

  const maskToken = (token: string) => {
    if (token.length <= 10) return "••••••••••"
    return token.substring(0, 7) + "••••••••••••••••••••" + token.substring(token.length - 4)
  }

  return (
    <div class="card">
      <div class="profile-header">
        <img
          src={user.avatar_url}
          alt={user.login}
          class="profile-avatar"
          loading="lazy"
        />
        <div class="profile-names">
          <h2>{user.name || user.login}</h2>
          <a
            href={user.html_url}
            target="_blank"
            rel="noopener noreferrer"
            class="profile-username"
          >
            @{user.login} ↗
          </a>
        </div>
      </div>

      {user.bio && <p class="profile-bio">{user.bio}</p>}

      <div class="profile-stats">
        <div>
          <div class="stat-val">{user.public_repos}</div>
          <div class="stat-lbl">Repos</div>
        </div>
        <div>
          <div class="stat-val">{user.followers}</div>
          <div class="stat-lbl">Followers</div>
        </div>
        <div>
          <div class="stat-val">{user.following}</div>
          <div class="stat-lbl">Following</div>
        </div>
      </div>

      <div class="token-preview">
        <span class="token-text" title="Active Git OAuth Access Token">
          🔑 {maskToken(session.token)}
        </span>
        <span class="token-badge">Active</span>
      </div>

      <button class="btn-signout" onClick={onSignOut}>
        Sign Out
      </button>
    </div>
  )
}

