import React, { useMemo } from "react";

/**
 * Embed the Zoho Quick Rates form with optional prefill.
 *
 * @param {string} baseUrl - The Zoho Forms public permalink.
 * @param {object} prefill - Map of fieldLinkName -> value
 */
export default function QRFormEmbed({ baseUrl, prefill = {}, title = "Application Form" }) {
  const src = useMemo(() => {
    try {
      const url = new URL(baseUrl);
      Object.entries(prefill).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim()) {
          url.searchParams.set(key, value);
        }
      });
      return url.toString();
    } catch (err) {
      console.error("Invalid Zoho form base URL:", baseUrl, err);
      return baseUrl;
    }
  }, [baseUrl, prefill]);

  return (
    <iframe
      title={title}
      src={src}
      style={{
        width: "100%",
        minHeight: "80vh",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
        background: "var(--surface)",
      }}
      allowFullScreen
    />
  );
}
