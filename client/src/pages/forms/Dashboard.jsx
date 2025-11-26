import React from "react";
import { Link } from "react-router-dom";

export default function Dashboard() {
  return (
    <div>
      <h2>Welcome to your Taurus Portal</h2>
      <p className="subtle" style={{ marginBottom: "1.5rem" }}>
        From here you can submit applications and track activity linked
        to your firm.
      </p>

      <div className="card-grid">
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
          <h2>More Products (Coming Soon)</h2>
          <p>
            Seller Proceeds Bridging, Agency Advances and more will be
            added to this portal as they go live.
          </p>
          <button className="button secondary" disabled>
            Not yet available
          </button>
        </section>
      </div>
    </div>
  );
}
