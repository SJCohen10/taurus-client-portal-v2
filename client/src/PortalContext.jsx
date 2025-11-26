import React, { createContext, useContext } from "react";

export const PortalContext = createContext(null);

/**
 * Hook to access portal-wide context:
 * - user (from Catalyst)
 * - context (CRM data from getportalusercontext)
 * - email (resolved login email)
 * - loading / error flags
 */
export function usePortalContext() {
  return useContext(PortalContext);
}
