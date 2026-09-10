import { AuthSession, GitHubRepo } from "./storage"

export interface AuthStatus {
  configured: boolean
  clientId: string | null
}

export interface RepoTreeItem {
  path: string
  mode: string
  type: "blob" | "tree"
  sha: string
  size?: number
  url?: string
}

export interface FileData {
  content: string
  sha: string
  path: string
}

export interface AtomicFile {
  path: string
  content?: string
  sha?: string | null
}

// 1. Auth Status & OAuth Initiation
export async function fetchAuthStatus(): Promise<AuthStatus> {
  try {
    const res = await fetch("/api/auth/status")
    if (!res.ok) throw new Error("Failed to fetch auth status")
    return await res.json()
  } catch (err) {
    console.warn("Could not reach /api/auth/status", err)
    return { configured: false, clientId: null }
  }
}

export function initiateGitHubOAuth(clientId: string, scope = "repo,read:user"): void {
  const state = Math.random().toString(36).substring(2, 15)
  sessionStorage.setItem("github_oauth_state", state)

  const redirectUri = window.location.origin + "/"
  const authUrl = new URL("https://github.com/login/oauth/authorize")
  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("scope", scope)
  authUrl.searchParams.set("state", state)

  window.location.href = authUrl.toString()
}

export async function exchangeOAuthCode(code: string): Promise<AuthSession> {
  const res = await fetch("/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  })

  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || "Failed to exchange OAuth code")
  }

  return {
    token: data.access_token,
    tokenType: data.token_type || "bearer",
    scope: data.scope,
    user: data.user,
  }
}

// 2. Direct GitHub API Calls (CORS supported by api.github.com)
function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
  }
}

function base64ToUtf8(base64: string): string {
  const clean = base64.replace(/\s/g, "")
  return decodeURIComponent(
    Array.prototype.map
      .call(atob(clean), (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join(""),
  )
}

// 3. User Repositories
export async function fetchUserRepos(token: string): Promise<GitHubRepo[]> {
  const res = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator",
    { headers: ghHeaders(token) },
  )
  if (!res.ok) throw new Error("Failed to fetch repositories")
  return await res.json()
}

// 4. Check if .obsidian folder exists in repo
export async function checkIsObsidianVault(
  token: string,
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/.obsidian`,
      { headers: ghHeaders(token) },
    )
    return res.status === 200
  } catch {
    return false
  }
}

// 5. Fetch entire tree recursively
export async function fetchRepoTree(
  token: string,
  owner: string,
  repo: string,
  branch = "main",
): Promise<RepoTreeItem[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: ghHeaders(token) },
  )
  if (!res.ok) {
    const fallback = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`,
      { headers: ghHeaders(token) },
    )
    if (!fallback.ok) throw new Error("Could not fetch file tree")
    const data = await fallback.json()
    return data.tree || []
  }
  const data = await res.json()
  return data.tree || []
}

// 6. Fetch single file content
export async function fetchFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
): Promise<FileData> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: ghHeaders(token),
  })
  if (!res.ok) throw new Error(`Failed to load file ${path}`)
  const data = await res.json()
  const content = base64ToUtf8(data.content || "")
  return {
    content,
    sha: data.sha,
    path: data.path,
  }
}

// 7. Get Branch Head (for atomic commit parent)
export async function getBranchHead(
  token: string,
  owner: string,
  repo: string,
  branch = "main",
): Promise<{ commitSha: string; baseTreeSha: string }> {
  let refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers: ghHeaders(token) },
  )

  if (!refRes.ok && branch === "main") {
    // Try master branch fallback
    refRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/master`,
      { headers: ghHeaders(token) },
    )
  }

  if (!refRes.ok) {
    throw new Error(`Could not fetch git head for branch ${branch}`)
  }

  const refData = await refRes.json()
  const commitSha = refData.object.sha

  // Get commit tree
  const commitRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`,
    { headers: ghHeaders(token) },
  )
  if (!commitRes.ok) throw new Error("Could not fetch base commit")
  const commitData = await commitRes.json()

  return {
    commitSha,
    baseTreeSha: commitData.tree.sha,
  }
}

// 8. Atomic Multi-File Git Commit & Push (Git Database API)
export async function atomicCommitVault(
  token: string,
  owner: string,
  repo: string,
  files: AtomicFile[],
  message: string,
  branch = "main",
): Promise<{ commitSha: string; treeSha: string }> {
  // Step 1: Fetch current remote branch head
  const { commitSha, baseTreeSha } = await getBranchHead(token, owner, repo, branch)

  // Step 2: Create a new Tree including all changed files and deletions
  const treeBody = {
    base_tree: baseTreeSha,
    tree: files.map((f) => {
      if (f.sha === null || f.content === undefined) {
        return {
          path: f.path,
          mode: "100644",
          type: "blob",
          sha: null,
        }
      }
      return {
        path: f.path,
        mode: "100644",
        type: "blob",
        content: f.content,
      }
    }),
  }

  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: {
      ...ghHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(treeBody),
  })

  if (!treeRes.ok) {
    const err = await treeRes.json().catch(() => ({}))
    throw new Error(err.message || "Failed to create git tree on GitHub")
  }
  const treeData = await treeRes.json()

  // Step 3: Create Git commit
  const commitBody = {
    message,
    tree: treeData.sha,
    parents: [commitSha],
  }

  const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: {
      ...ghHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commitBody),
  })

  if (!commitRes.ok) {
    const err = await commitRes.json().catch(() => ({}))
    throw new Error(err.message || "Failed to create git commit on GitHub")
  }
  const commitData = await commitRes.json()

  // Step 4: Update branch reference (Fast-forward push)
  let updateRefRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers: {
        ...ghHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sha: commitData.sha,
        force: false,
      }),
    },
  )

  if (!updateRefRes.ok && branch === "main") {
    // Try master if main ref update failed
    updateRefRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/master`,
      {
        method: "PATCH",
        headers: {
          ...ghHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sha: commitData.sha,
          force: false,
        }),
      },
    )
  }

  if (!updateRefRes.ok) {
    const err = await updateRefRes.json().catch(() => ({}))
    throw new Error(err.message || "Failed to push commit reference to GitHub branch")
  }

  return {
    commitSha: commitData.sha,
    treeSha: treeData.sha,
  }
}

// 9. Reconcile and update .obsidian/workspace.json
export function prepareUpdatedWorkspaceJson(
  currentRawJson: string | null,
  activeFilePath: string,
): string {
  let ws: any = {}
  try {
    if (currentRawJson) {
      ws = JSON.parse(currentRawJson)
    }
  } catch {
    ws = {}
  }

  // Update lastOpenFiles list (prepend active file, keep deduplicated)
  const existingFiles: string[] = Array.isArray(ws.lastOpenFiles) ? ws.lastOpenFiles : []
  ws.lastOpenFiles = [activeFilePath, ...existingFiles.filter((f) => f !== activeFilePath)]

  // Update active file in main split if structure exists
  const filename = activeFilePath.split("/").pop()?.replace(/\.md$/, "") || activeFilePath
  try {
    if (ws.main?.children?.[0]?.children?.[0]?.state?.state) {
      ws.main.children[0].children[0].state.state.file = activeFilePath
      ws.main.children[0].children[0].state.title = filename
    }
  } catch {
    // Structure differed; lastOpenFiles is already set
  }

  return JSON.stringify(ws, null, 2)
}
