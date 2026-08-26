import React from "react";
import { createRoot } from "react-dom/client";
import DashboardClient from "../../app/DashboardClient";
import "../../app/globals.css";

(window as unknown as { __TRAFFIC_OFFLINE__: boolean }).__TRAFFIC_OFFLINE__ = true;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DashboardClient user={{ displayName: "本機使用者", email: "GitHub Pages 版" }} />
  </React.StrictMode>,
);
