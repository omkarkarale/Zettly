import { render } from "preact"
import { App } from "./App"
import "./styles/theme.css"
import "./styles/app.css"

const container = document.getElementById("app")
if (container) {
  render(<App />, container)
}

