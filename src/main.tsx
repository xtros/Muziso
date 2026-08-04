import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

// Disable the default browser context menu globally
document.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
