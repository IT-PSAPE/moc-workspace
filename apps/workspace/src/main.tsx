import React from "react";
import "@moc/ui/theme.css";
import "@moc/ui/primitives.css";
import ReactDOM from "react-dom/client";
import { ClientProvider } from "@moc/client";
import App from "./App";
import "./styles.css";
import "@moc/ui/utilities.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClientProvider>
      <App />
    </ClientProvider>
  </React.StrictMode>,
);
