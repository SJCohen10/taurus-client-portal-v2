import React from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { usePortalContext } from "../../PortalContext";
import QRFormEmbed from "../../components/QRFormEmbed";
import {
  AGENT_ADVANCE_FORM_URL,
  AGENT_FURTHER_ADVANCE_VALUE,
  isAgentAdvanceEnabled,
  buildAgentBaselinePayload,
  buildAgentReadvancePayload,
} from "./agentAdvanceHelpers";

const PAGE_TITLE = "Conveyancing Firm Agent Facility";

export default function AgentAdvance() {
  const portal = usePortalContext();
  const context = portal?.context || null;
  const [searchParams] = useSearchParams();

  // Readvance mode is signalled by the same Initial_Advance_Further_Advance param
  // Quick Bridge uses; a first drawdown launched from the Actions button uses
  // ?start=1 to open the embedded form directly.
  const isReadvance =
    String(searchParams.get("Initial_Advance_Further_Advance") || "")
      .trim()
      .toLowerCase() === AGENT_FURTHER_ADVANCE_VALUE.toLowerCase();
  const autoStart = searchParams.get("start") === "1";

  const [showForm, setShowForm] = React.useState(isReadvance || autoStart);

  // Hard route gate: block deep-linking for ineligible accounts. Unauthenticated
  // users never reach here — ProtectedAppShell enforces auth before this renders,
  // and within the app shell the portal context is already resolved. (Kept after
  // the hooks above so hook order stays stable across renders.)
  if (!isAgentAdvanceEnabled(context)) {
    return <Navigate to="/" replace />;
  }

  const prefill = isReadvance
    ? buildAgentReadvancePayload()
    : buildAgentBaselinePayload(context);

  return (
    <div>
      <h2>{PAGE_TITLE}</h2>
      <p className="subtle" style={{ marginBottom: "1rem" }}>
        Do your Estate Agents need funding on a client file? Apply for a drawdown against your
        approved Conveyancing Firm Agent Facility.
      </p>

      {!showForm ? (
        <>
          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>
              How the Agent Facility works
            </h3>
            <p className="subtle" style={{ marginTop: 0 }}>
              Draw down against your firm&rsquo;s approved Conveyancing Firm Agent
              Facility to settle your agents. It works just like a Quick-Bridge
              advance but is simply recorded against the deal as an{" "}
              <strong>Estate Agent</strong> transaction.
            </p>
            <ul className="subtle" style={{ marginBottom: 0 }}>
              <li>Apply here to add a Agent Facility draw down against a property transfer.</li>
              <li>
                Receive the Schedule for signature in your inbox
              </li>
              <li>
                Once processed, the agent asset appears on your dashboard
                alongside the deal&rsquo;s other assets.
              </li>
            </ul>
          </div>

          <div className="notice-card" style={{ marginBottom: "1.25rem" }}>
            <strong>What happens after you apply?</strong>
            <p className="subtle" style={{ marginBottom: 0 }}>
              Once submitted, you will receive the Schedule agreement in your inbox for signature by an authorized signatory of the firm. An agent
              transaction is created for you and can be viewed on your dashboard once the Schedule is signed and processed.
            </p>
          </div>

          <button
            className="button accent"
            type="button"
            onClick={() => setShowForm(true)}
          >
            Apply for a Drawdown
          </button>
        </>
      ) : (
        <>
          <p className="subtle" style={{ marginBottom: "1rem" }}>
            {isReadvance
              ? "Complete the final step below to confirm your readvance drawdown."
              : "Complete the application below. Your firm and user details are pre-populated where possible."}
          </p>

          {/* Embedded exactly like the Quick Bridge form (QRFormEmbed). key forces
              an iframe refresh so Zoho prefill updates when the mode changes. */}
          <QRFormEmbed
            baseUrl={AGENT_ADVANCE_FORM_URL}
            prefill={prefill}
            title={PAGE_TITLE}
            key={isReadvance ? "readvance" : "start"}
          />
        </>
      )}
    </div>
  );
}
