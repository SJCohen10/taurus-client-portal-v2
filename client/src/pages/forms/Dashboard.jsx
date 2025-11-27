import React from "react";
import { Link } from "react-router-dom";
import { usePortalDeals } from "../../hooks/usePortalDeals";

export default function Dashboard() {
  const { deals, loading, error } = usePortalDeals();

  return (
    <div>
      <h2>Welcome to your Taurus Portal</h2>
      <p className="subtle" style={{ marginBottom: "1.5rem" }}>
        View your deals and submit new applications linked to your firm.
      </p>

      <div className="card-grid" style={{ marginBottom: "2rem" }}>
        <section className="card">
          <h2>Quick Rates Application</h2>
          <p>
            Submit a Quick Rates application to settle Rates / Levies or
            advance funds to sellers within your Quick Bridge Limit.
          </p>
          <Link to="/quick-rates" className="button">
            Go to Quick Rates
          </Link>
        </section>

        <section className="card">
          <h2>Deals Overview</h2>
          <p>
            Below is a summary of your recent deals linked to your Contact
            and Account in Taurus.
          </p>
          <p className="subtle">
            Total deals loaded: <strong>{deals.length}</strong>
          </p>
        </section>
      </div>

      <section className="card">
        <h2>Your Deals</h2>
        {loading && <p className="subtle">Loading deals…</p>}
        {error && <p className="error">Error: {error}</p>}
        {!loading && !error && deals.length === 0 && (
          <p className="subtle">No deals found for your profile.</p>
        )}

        {!loading && !error && deals.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.9rem",
              }}
            >
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.5rem" }}>
                    Deal
                  </th>
                  <th style={{ textAlign: "left", padding: "0.5rem" }}>
                    Stage
                  </th>
                  <th style={{ textAlign: "right", padding: "0.5rem" }}>
                    Amount
                  </th>
                  <th style={{ textAlign: "left", padding: "0.5rem" }}>
                    Product
                  </th>
                  <th style={{ textAlign: "left", padding: "0.5rem" }}>
                    Account
                  </th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.deal_id || d.deal_name}>
                    <td style={{ padding: "0.5rem" }}>{d.deal_name}</td>
                    <td style={{ padding: "0.5rem" }}>{d.stage || d.status}</td>
                    <td style={{ padding: "0.5rem", textAlign: "right" }}>
                      {d.amount != null
                        ? `R ${Number(d.amount).toLocaleString()}`
                        : "—"}
                    </td>
                    <td style={{ padding: "0.5rem" }}>{d.product || "—"}</td>
                    <td style={{ padding: "0.5rem" }}>
                      {d.account_name || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
