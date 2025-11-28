// client/src/pages/dashboard/RoleBasedDashboard.jsx
import React from "react";
import ParalegalDashboard from "./ParalegalDashboard";

export default function RoleBasedDashboard() {
    // In future, role will come from Catalyst / portalUser
    const role = window?.portalUser?.role || "paralegal";

    switch (role) {
        // case "agent":
        //   return <AgentDashboard />;
        // case "seller":
        //   return <SellerDashboard />;
        // case "raf_attorney":
        //   return <RafAttorneyDashboard />;
        case "paralegal":
        default:
            return <ParalegalDashboard />;
    }
}
