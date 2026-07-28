import React from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { usePortalContext } from "../../PortalContext";
import QRFormEmbed from "../../components/QRFormEmbed";
import { fetchMyDeals } from "../../services/portalApi";
import {
  AGENT_ADVANCE_FORM_URL,
  AGENT_FURTHER_ADVANCE_VALUE,
  isAgentAdvanceEnabled,
  buildAgentDrawdownPayload,
  buildAgentReadvancePayload,
  findAgentDealById,
  resolveAgentDefaultBankDetailId,
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

  // Only ever an opaque deal id, in both modes. The deal's reference number and
  // transfer conditions are resolved from the caller's own deals list below —
  // never taken from the URL — so a tampered id simply resolves to nothing.
  const dealId = String(searchParams.get("dealId") || "").trim();

  const [showForm, setShowForm] = React.useState(isReadvance || autoStart);

  const bankOptions = React.useMemo(
    () => (Array.isArray(context?.bankDetails) ? context.bankDetails : []),
    [context?.bankDetails]
  );
  const defaultBankDetailId = resolveAgentDefaultBankDetailId(context);
  const [selectedBankDetailId, setSelectedBankDetailId] = React.useState(defaultBankDetailId);

  // Apply the default once context arrives, without overwriting a user selection.
  React.useEffect(() => {
    setSelectedBankDetailId((prev) => (prev ? prev : defaultBankDetailId));
  }, [defaultBankDetailId]);

  const selectedBank = React.useMemo(
    () => bankOptions.find((bank) => bank.id === selectedBankDetailId) || null,
    [bankOptions, selectedBankDetailId]
  );

  const [deal, setDeal] = React.useState(null);
  const [dealLoading, setDealLoading] = React.useState(Boolean(dealId));
  const [dealError, setDealError] = React.useState("");
  const portalEmail = portal?.email || "";

  React.useEffect(() => {
    if (!dealId) {
      setDeal(null);
      setDealLoading(false);
      setDealError("");
      return undefined;
    }

    let cancelled = false;
    const lookupFailedMessage = isReadvance
      ? "We could not load the deal this readvance was started from. Please enter the deal reference number in the form below."
      : "We could not load the deal this drawdown was started from. Please complete the deal details in the form below.";

    setDealLoading(true);
    setDealError("");

    (async () => {
      try {
        const payload = await fetchMyDeals(portalEmail);
        if (cancelled) return;
        const match = findAgentDealById(payload?.deals, dealId);
        setDeal(match);
        setDealError(match ? "" : lookupFailedMessage);
      } catch (err) {
        if (cancelled) return;
        setDeal(null);
        setDealError(lookupFailedMessage);
      } finally {
        if (!cancelled) setDealLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dealId, portalEmail, isReadvance]);

  const prefill = React.useMemo(
    () =>
      isReadvance
        ? buildAgentReadvancePayload({
            context,
            bankDetailId: selectedBankDetailId,
            deal,
          })
        : buildAgentDrawdownPayload({
            context,
            bankDetailId: selectedBankDetailId,
            deal,
          }),
    [isReadvance, context, selectedBankDetailId, deal]
  );

  // Hard route gate: block deep-linking for ineligible accounts. Unauthenticated
  // users never reach here — ProtectedAppShell enforces auth before this renders,
  // and within the app shell the portal context is already resolved. (Kept after
  // the hooks above so hook order stays stable across renders.)
  if (!isAgentAdvanceEnabled(context)) {
    return <Navigate to="/" replace />;
  }

  const propertyRefNumber = prefill.property_ref_number || "";
  // Don't mount the iframe until the prefill is settled — Zoho only reads the
  // query params at load, so a later change would remount and discard input. Both
  // modes need the context (contact + bank) and, when launched from a deal, the
  // deal lookup.
  const prefillPending = Boolean(portal?.loading) || dealLoading;

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

          {/* Shown in both modes: the form expects Firm_Bank_Details_id on every
              submission, so the firm should see (and be able to change) which of
              its AVS-verified accounts the drawdown will be paid into. */}
          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>
              Desired Firm Bank Account
            </h3>

            {bankOptions.length ? (
              <>
                <select
                  value={selectedBankDetailId}
                  onChange={(e) => setSelectedBankDetailId(e.target.value)}
                  style={{ width: "100%", padding: "0.6rem" }}
                >
                  {bankOptions.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.label}
                    </option>
                  ))}
                </select>

                <div style={{ marginTop: "0.75rem" }}>
                  <div style={{ marginBottom: "0.4rem" }}>
                    <strong>Bank:</strong> {selectedBank?.bank || "—"}
                  </div>
                  <div style={{ marginBottom: "0.4rem" }}>
                    <strong>Account name:</strong> {selectedBank?.name || "—"}
                  </div>
                  <div style={{ marginBottom: "0.4rem" }}>
                    <strong>Account number:</strong>{" "}
                    {selectedBank?.accountNumber
                      ? `****${String(selectedBank.accountNumber).slice(-4)}`
                      : "—"}
                  </div>
                </div>
              </>
            ) : (
              <p className="error" style={{ margin: 0 }}>
                No AVS-verified bank accounts are configured for your firm yet.
              </p>
            )}
          </div>

          {propertyRefNumber && (
            <p className="subtle" style={{ marginBottom: "1rem" }}>
              This drawdown will be recorded against deal{" "}
              <strong>{propertyRefNumber}</strong>
              {deal?.property_description ? ` — ${deal.property_description}` : ""}.
            </p>
          )}

          {dealError && (
            <p className="error" style={{ marginBottom: "1rem" }}>
              {dealError}
            </p>
          )}

          {prefillPending ? (
            <p className="subtle" style={{ marginTop: 0 }}>
              {isReadvance ? "Loading your deal details…" : "Loading your firm and deal details…"}
            </p>
          ) : (
            /* Embedded like the Quick Bridge form (QRFormEmbed). key forces an
               iframe refresh so Zoho prefill updates when the selection changes. */
            <QRFormEmbed
              baseUrl={AGENT_ADVANCE_FORM_URL}
              prefill={prefill}
              title={PAGE_TITLE}
              key={[
                isReadvance ? "readvance" : "start",
                selectedBankDetailId || "no-bank",
                dealId || "no-deal",
              ].join("|")}
            />
          )}
        </>
      )}
    </div>
  );
}
