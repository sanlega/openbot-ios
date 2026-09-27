import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DevApp } from "@openbot/ui";
import "@openbot/ui/styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DevApp apiBaseUrl={import.meta.env.VITE_API_BASE ?? window.location.origin} />
    </StrictMode>,
  );
}
