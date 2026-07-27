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
        Need funding on a new client file? Apply for a drawdown against your
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
              Facility to fund a new client file. It works just like a seller
              advance &mdash; it is simply recorded against the deal as an{" "}
              <strong>Estate Agent</strong> asset.
            </p>
            <ul className="subtle" style={{ marginBottom: 0 }}>
              <li>Apply once per file to add the first agent drawdown.</li>
              <li>
                Draw down again later against an existing agent asset without
                re-entering the file details.
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
              Your firm and user details are pre-populated into the secure Taurus
              form. Once submitted, our team prepares the agreement and the agent
              transaction is created for you &mdash; there is nothing further to
              capture in the portal.
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
