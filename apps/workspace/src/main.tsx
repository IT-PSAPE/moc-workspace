import React from "react";
import ReactDOM from "react-dom/client";
import { ClientProvider } from "@moc/client";
import App from "./App";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClientProvider>
      <App />
    </ClientProvider>
  </React.StrictMode>,
);
