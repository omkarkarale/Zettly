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
  if (res.ok) {
    const data = await res.json()
    return data.tree || []
  }

  const fallback = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`,
    { headers: ghHeaders(token) },
  )
  if (fallback.ok) {
    const data = await fallback.json()
    return data.tree || []
  }

  // Final fallback: discover default branch from repository metadata
  try {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: ghHeaders(token),
    })
    if (repoRes.ok) {
      const repoData = await repoRes.json()
      if (repoData.default_branch && repoData.default_branch !== branch && repoData.default_branch !== "master") {
        const defaultBranchRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/trees/${repoData.default_branch}?recursive=1`,
          { headers: ghHeaders(token) },
        )
        if (defaultBranchRes.ok) {
          const data = await defaultBranchRes.json()
          return data.tree || []
        }
      }
    }
  } catch {}

  throw new Error("Could not fetch file tree")
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
// 7. Get Branch Head (for atomic commit parent with dynamic branch discovery)
export async function getBranchHead(
  token: string,
  owner: string,
  repo: string,
  preferredBranch?: string,
): Promise<{ commitSha: string; baseTreeSha: string; branch: string }> {
  // Candidate branch names to test in priority order
  const candidates: string[] = []
  if (preferredBranch) candidates.push(preferredBranch)

  // 1. Fetch repo metadata to discover the true default_branch from GitHub
  try {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: ghHeaders(token),
    })
    if (repoRes.ok) {
      const repoData = await repoRes.json()
      if (repoData.default_branch && !candidates.includes(repoData.default_branch)) {
        candidates.push(repoData.default_branch)
      }
    }
  } catch (e) {
    console.warn("Could not fetch repo metadata for branch discovery", e)
  }

  // Common branch fallbacks
  if (!candidates.includes("main")) candidates.push("main")
  if (!candidates.includes("master")) candidates.push("master")

  // 2. Try each candidate branch
  let matchedRefData: any = null
  let resolvedBranch = ""

  for (const b of candidates) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${b}`,
        { headers: ghHeaders(token) },
      )
      if (res.ok) {
        matchedRefData = await res.json()
        resolvedBranch = b
        break
      }
    } catch {}
  }

  // 3. If candidates not matched, query all existing heads in repo
  if (!matchedRefData) {
    try {
      const refsRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/matching-refs/heads`,
        { headers: ghHeaders(token) },
      )
      if (refsRes.ok) {
        const refsList = await refsRes.json()
        if (Array.isArray(refsList) && refsList.length > 0) {
          matchedRefData = refsList[0]
          resolvedBranch = refsList[0].ref.replace(/^refs\/heads\//, "")
        }
      }
    } catch {}
  }

  if (!matchedRefData || !matchedRefData.object?.sha) {
    throw new Error(
      `Could not resolve branch head for ${owner}/${repo}. Checked branches: ${candidates.join(", ")}`,
    )
  }

  const commitSha = matchedRefData.object.sha

  // Get commit tree
  const commitRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`,
    { headers: ghHeaders(token) },
  )
  if (!commitRes.ok) throw new Error(`Could not fetch base commit for ${commitSha}`)
  const commitData = await commitRes.json()

  return {
    commitSha,
    baseTreeSha: commitData.tree.sha,
    branch: resolvedBranch,
  }
}

// 8. Atomic Multi-File Git Commit & Push (Git Database API)
export async function atomicCommitVault(
  token: string,
  owner: string,
  repo: string,
  files: AtomicFile[],
  message: string,
  branch?: string,
): Promise<{ commitSha: string; treeSha: string; branch: string }> {
  // Step 1: Dynamically resolve current remote branch head
  const { commitSha, baseTreeSha, branch: resolvedBranch } = await getBranchHead(token, owner, repo, branch)

  // Step 1.5: If there are deletions, verify them against the remote base tree
  // to avoid GitRPC::BadObjectState caused by deleting non-existent files or tree/directory objects
  let filesToProcess = files
  const deletions = files.filter((f) => f.sha === null || f.content === undefined)
  if (deletions.length > 0) {
    try {
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`,
        { headers: ghHeaders(token) },
      )
      if (treeRes.ok) {
        const treeData = await treeRes.json()
        const remoteBlobs = new Set<string>(
          (treeData.tree || [])
            .filter((item: any) => item.type === "blob")
            .map((item: any) => item.path),
        )
        // Keep file modifications, and ONLY keep deletions that actually exist as blobs on remote
        filesToProcess = files.filter((f) => {
          const isDel = f.sha === null || f.content === undefined
          if (isDel) {
            return remoteBlobs.has(f.path)
          }
          return true
        })
      }
    } catch (e) {
      console.warn("Could not verify remote base tree for deletions", e)
    }
  }

  // Deduplicate files by path (last entry wins)
  const fileMap = new Map<string, AtomicFile>()
  for (const f of filesToProcess) {
    fileMap.set(f.path, f)
  }
  const deduplicatedFiles = Array.from(fileMap.values())

  if (deduplicatedFiles.length === 0) {
    // Nothing changed on remote
    return { commitSha, treeSha: baseTreeSha, branch: resolvedBranch }
  }

  // Step 2: Create a new Tree including all changed files and verified deletions
  const treeBody = {
    base_tree: baseTreeSha,
    tree: deduplicatedFiles.map((f) => {
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
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${resolvedBranch}`,
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

  // If PATCH failed with 422 or 404 (e.g. Reference does not exist), try POST to create the reference
  if (!updateRefRes.ok) {
    const createRefRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: {
          ...ghHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: `refs/heads/${resolvedBranch}`,
          sha: commitData.sha,
        }),
      },
    )

    if (createRefRes.ok) {
      return {
        commitSha: commitData.sha,
        treeSha: treeData.sha,
        branch: resolvedBranch,
      }
    }

    const err = await updateRefRes.json().catch(() => ({}))
    throw new Error(err.message || "Failed to push commit reference to GitHub branch")
  }

  return {
    commitSha: commitData.sha,
    treeSha: treeData.sha,
    branch: resolvedBranch,
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
