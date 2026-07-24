import React from "react";
import { Navigate } from "react-router-dom";
import { usePortalContext } from "../../PortalContext";
import {
  isAgentAdvanceEnabled,
  buildAgentBaselinePayload,
  openAgentAdvanceForm,
} from "./agentAdvanceHelpers";

export default function AgentAdvance() {
  const portal = usePortalContext();
  const context = portal?.context || null;
  const [message, setMessage] = React.useState("");

  // Hard route gate: block deep-linking for ineligible accounts. Unauthenticated
  // users never reach here — ProtectedAppShell enforces auth before this renders,
  // and within the app shell the portal context is already resolved.
  if (!isAgentAdvanceEnabled(context)) {
    return <Navigate to="/" replace />;
  }

  function handleApply() {
    const result = openAgentAdvanceForm(buildAgentBaselinePayload(context));
    if (!result.opened) {
      setMessage(
        "Your browser blocked the application window. Please allow popups for the Taurus Client Portal and try again."
      );
      return;
    }
    if (result.usedFallback) {
      setMessage("The application form was opened in a new tab.");
    } else {
      setMessage("");
    }
  }

  return (
    <div>
      <h2>Agent Advance</h2>
      <p className="subtle" style={{ marginBottom: "1rem" }}>
        Draw down against your firm&rsquo;s master loan agreement to fund an estate
        agent&rsquo;s commission.
      </p>

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>How Agent Advance works</h3>
        <p className="subtle" style={{ marginTop: 0 }}>
          Agent Advance lets your firm advance an estate agent&rsquo;s commission on a
          qualifying matter, funded against your firm&rsquo;s master loan agreement with
          Taurus Capital. It works just like a seller advance &mdash; it is simply
          recorded against the deal as an <strong>Estate Agent</strong> asset.
        </p>
        <ul className="subtle" style={{ marginBottom: 0 }}>
          <li>Apply once per matter to add the first agent transaction.</li>
          <li>
            Draw down again later against an existing agent asset without re-entering
            the deal details.
          </li>
          <li>
            Once processed, the agent asset appears on your dashboard alongside the
            deal&rsquo;s other assets.
          </li>
        </ul>
      </div>

      <div className="notice-card" style={{ marginBottom: "1.25rem" }}>
        <strong>What happens after you apply?</strong>
        <p className="subtle" style={{ marginBottom: 0 }}>
          The application opens in a secure Taurus form. Once submitted, our team
          prepares the agreement and the agent transaction is created for you &mdash;
          there is nothing further to capture in the portal.
        </p>
      </div>

      <button className="button accent" type="button" onClick={handleApply}>
        Apply / Draw Down
      </button>

      {message && (
        <p className="subtle" style={{ marginTop: "0.75rem" }}>
          {message}
        </p>
      )}
    </div>
  );
}
