import React from "react";
import "@moc/ui/theme.css";
import ReactDOM from "react-dom/client";
import { ClientProvider } from "@moc/client";
import Portal from "./Portal";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClientProvider>
      <Portal />
    </ClientProvider>
  </React.StrictMode>,
);
