import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Layout from "./Layout";
import RoleBasedDashboard from "./pages/dashboard/RoleBasedDashboard";
// import QuickRatesAdvance from "./pages/forms/property/QuickRatesAdvance";
import QuickBridgeStart from "./pages/forms/property/QuickBridgeStart";
import SellerProceedsStart from "./pages/forms/property/SellerProceedsStart";

// Use basename "/app" only in production (Catalyst hosting)
const basename =
  process.env.NODE_ENV === "production" ? "/app" : "/";

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<Layout />}>
          {/* Default + explicit dashboard routes */}
          <Route index element={<RoleBasedDashboard />} />
          <Route path="dashboard" element={<RoleBasedDashboard />} />

          {/* Existing Quick Rates route */}
          <Route path="quick-rates" element={<QuickBridgeStart />} />
          <Route path="seller-proceeds" element={<SellerProceedsStart />} />

        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
