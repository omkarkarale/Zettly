export default async function handler(req: any, res: any) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized" })
  }

  const token = authHeader.replace("Bearer ", "").trim()

  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Zettly-GitOAuth-App",
      },
    })
    const userData = await userRes.json()
    return res.status(200).json(userData)
  } catch (err: any) {
    return res.status(500).json({ error: "fetch_failed", message: err.message })
  }
}

