import React from "react";
import ReactDOM from "react-dom/client";
import "./App.css";
import App from "./App";
import { PortalProvider } from "./PortalContext";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <PortalProvider>
      <App />
    </PortalProvider>
  </React.StrictMode>
);
