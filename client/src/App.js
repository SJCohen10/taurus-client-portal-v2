import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Layout from "./Layout";
import Dashboard from "./pages/forms/Dashboard";
import QuickRatesAdvance from "./pages/forms/property/QuickRatesAdvance";

// Use basename "/app" only in production (Catalyst hosting)
const basename =
  process.env.NODE_ENV === "production" ? "/app" : "/";

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="quick-rates" element={<QuickRatesAdvance />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
