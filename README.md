# Zettly GitOAuth Login

A modern, lightweight GitHub OAuth authentication application built for the **Zettly** digital garden ecosystem. Designed with the exact technical philosophy of **Quartz**: **Preact**, **TypeScript**, and **Quartz-inspired CSS custom properties**.

---

## ⚡ Quick Start

```bash
# Navigate to the main directory
cd d:/Mine/Projects/Zettly/main

# 1. Install dependencies
npm install

# 2. Start the development server (runs both UI & OAuth API middleware)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🔑 GitHub OAuth App Setup

To enable live authentication with your real GitHub account:

1. Go to your GitHub account: **Settings $\to$ Developer settings $\to$ OAuth Apps $\to$ New OAuth App**.
2. Fill out the application details:
   * **Application name**: `Zettly GitOAuth`
   * **Homepage URL**: `http://localhost:5173`
   * **Authorization callback URL**: `http://localhost:5173/`
3. Click **Register application**.
4. Generate a new **Client Secret** and copy your **Client ID**.
5. Open `d:/Mine/Projects/Zettly/main/.env` and enter your keys:
   ```env
   GITHUB_CLIENT_ID=your_client_id_here
   GITHUB_CLIENT_SECRET=your_client_secret_here
   ```
6. Restart `npm run dev` to reload the environment variables.

---

## 🧪 Instant Sandbox Demo Mode

Even before you register an OAuth App with GitHub, the application comes with **Instant Sandbox Demo Login**:
* Click the **"🚀 Instant Sandbox Demo Login"** button on the login screen.
* This triggers a simulated OAuth code exchange through the backend middleware, generating an active session with a full GitHub user profile payload and avatar.

---

## 🏗️ Architecture & Tech Stack

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Frontend** | [Preact](https://preactjs.com/) + TypeScript | Lightweight (3kB), reactive JSX matching Quartz's client runtime |
| **Bundler & Dev** | [Vite](https://vitejs.dev/) | Instant HMR and built-in Node.js API middleware |
| **Styling** | Quartz Theme Tokens (`theme.css`) | Schibsted Grotesk, Source Sans Pro, IBM Plex Mono, Light (`#faf8f8`) / Dark (`#161618`) modes |
| **OAuth Security** | Server-side token exchange | Safe token retrieval preventing client secret leaks or browser CORS blocks |
| **Session** | `localStorage` persistence | Automatic token storage and instant profile restore across reloads |

