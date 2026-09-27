import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DevApp } from "./app/App.js";
import "./styles/global.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DevApp
        apiBaseUrl={
          import.meta.env.VITE_API_BASE ??
          (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3847")
        }
      />
    </StrictMode>,
  );
}
