export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" })
  }

  // Support both parsed req.body or raw JSON string
  let body = req.body
  if (typeof body === "string") {
    try {
      body = JSON.parse(body)
    } catch {
      body = {}
    }
  }

  const { code } = body || {}
  if (!code) {
    return res.status(400).json({
      error: "missing_code",
      error_description: "Authorization code is required",
    })
  }

  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return res.status(400).json({
      error: "credentials_missing",
      error_description:
        "GitHub Client ID or Secret is not configured in Vercel Environment Variables.",
    })
  }

  try {
    const githubRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    })

    const tokenData = await githubRes.json()
    if (tokenData.error) {
      return res.status(400).json(tokenData)
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "Zettly-GitOAuth-App",
      },
    })
    const userData = await userRes.json()

    return res.status(200).json({
      ...tokenData,
      user: userData,
    })
  } catch (err: any) {
    return res.status(500).json({ error: "server_error", message: err.message })
  }
}

