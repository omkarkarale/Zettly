export default async function handler(req: any, res: any) {
  const clientId = process.env.GITHUB_CLIENT_ID || ""
  const hasSecret = Boolean(process.env.GITHUB_CLIENT_SECRET)

  res.setHeader("Content-Type", "application/json")
  return res.status(200).json({
    configured: Boolean(clientId && hasSecret),
    clientId: clientId || null,
  })
}

