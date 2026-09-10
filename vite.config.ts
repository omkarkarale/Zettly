import { defineConfig, loadEnv } from "vite"
import preact from "@preact/preset-vite"
import type { IncomingMessage, ServerResponse } from "http"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")

  return {
    plugins: [
      preact(),
      {
        name: "github-oauth-api",
        configureServer(server) {
          server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
            const url = new URL(req.url ?? "/", `http://${req.headers.host}`)

            // 1. OAuth status & public config endpoint
            if (url.pathname === "/api/auth/status" && req.method === "GET") {
              const clientId = env.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID || ""
              const hasSecret = Boolean(env.GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET)

              res.setHeader("Content-Type", "application/json")
              res.end(
                JSON.stringify({
                  configured: Boolean(clientId && hasSecret),
                  clientId: clientId || null,
                }),
              )
              return
            }

            // 2. Token Exchange Endpoint
            if (url.pathname === "/api/auth/token" && req.method === "POST") {
              let body = ""
              req.on("data", (chunk: any) => {
                body += chunk
              })

              req.on("end", async () => {
                try {
                  const { code } = JSON.parse(body || "{}")

                  if (!code) {
                    res.statusCode = 400
                    res.setHeader("Content-Type", "application/json")
                    res.end(JSON.stringify({ error: "missing_code", error_description: "Authorization code is required" }))
                    return
                  }

                  const clientId = env.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID
                  const clientSecret = env.GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET

                  if (!clientId || !clientSecret) {
                    res.statusCode = 400
                    res.setHeader("Content-Type", "application/json")
                    res.end(
                      JSON.stringify({
                        error: "credentials_missing",
                        error_description:
                          "GitHub Client ID or Secret is not configured in .env file.",
                      }),
                    )
                    return
                  }

                  // Exchange code with GitHub API
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
                    res.statusCode = 400
                    res.setHeader("Content-Type", "application/json")
                    res.end(JSON.stringify(tokenData))
                    return
                  }

                  // Fetch user details with token
                  const userRes = await fetch("https://api.github.com/user", {
                    headers: {
                      Authorization: `Bearer ${tokenData.access_token}`,
                      "User-Agent": "Zettly-GitOAuth-App",
                    },
                  })
                  const userData = await userRes.json()

                  res.setHeader("Content-Type", "application/json")
                  res.end(
                    JSON.stringify({
                      ...tokenData,
                      user: userData,
                    }),
                  )
                } catch (err: any) {
                  res.statusCode = 500
                  res.setHeader("Content-Type", "application/json")
                  res.end(JSON.stringify({ error: "server_error", message: err.message }))
                }
              })
              return
            }

            // 3. User Profile Endpoint
            if (url.pathname === "/api/auth/user" && req.method === "GET") {
              const authHeader = req.headers.authorization
              if (!authHeader?.startsWith("Bearer ")) {
                res.statusCode = 401
                res.setHeader("Content-Type", "application/json")
                res.end(JSON.stringify({ error: "unauthorized" }))
                return
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
                res.setHeader("Content-Type", "application/json")
                res.end(JSON.stringify(userData))
              } catch (err: any) {
                res.statusCode = 500
                res.setHeader("Content-Type", "application/json")
                res.end(JSON.stringify({ error: "fetch_failed", message: err.message }))
              }
              return
            }

            next()
          })
        },
      },
    ],
    server: {
      port: 5173,
    },
  }
})
