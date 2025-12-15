import React, { useEffect, useState } from "react";
import { fetchPreferredFirmBankDetails } from "../../../services/portalApi";

const QUICK_BRIDGE_FORM_URL = "PASTE_YOUR_QUICK_BRIDGE_FORM_PERMALINK";

function buildUrl(baseUrl, params) {
  const u = new URL(baseUrl);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    u.searchParams.set(k, String(v));
  });
  return u.toString();
}

export default function QuickBridgeStart() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preferred, setPreferred] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        const data = await fetchPreferredFirmBankDetails();
        if (!data.hasPreferred) {
          setError("Your firm does not have a Preferred Quick Rates Bank Account set in CRM.");
          return;
        }
        setPreferred(data);
      } catch (e) {
        setError(e.message || "Failed to load preferred bank details.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function openForm() {
    if (!preferred) return;

    const url = buildUrl(QUICK_BRIDGE_FORM_URL, {
      Attorney_Firm_Bank: preferred.bankName,
      Attorney_Firm_Account_Name: preferred.accountName,
      Attorney_Firm_Account_Number: preferred.accountNumber,

      user_email: window?.portalUser?.email || "",
      product_type: "Quick Bridge",
    });

    window.location.href = url;
  }

  return (
    <div>
      <h2>Quick Bridge</h2>

      {loading && <p className="subtle">Loading preferred firm bank details…</p>}
      {error && !loading && <p className="error">{error}</p>}

      {!loading && !error && preferred && (
        <section className="card form-card">
          <p className="subtle" style={{ marginTop: 0 }}>
            Using your firm’s preferred bank account from CRM:
          </p>
          <div style={{ marginBottom: "1rem" }}>
            <div><strong>Bank:</strong> {preferred.bankName || "—"}</div>
            <div><strong>Account Name:</strong> {preferred.accountName || "—"}</div>
            <div><strong>Account Number:</strong> {preferred.accountNumber || "—"}</div>
          </div>

          <div className="form-actions">
            <button className="button" onClick={openForm}>
              Continue to Quick Bridge Form
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
