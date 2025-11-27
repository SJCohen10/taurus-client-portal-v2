import { useEffect, useState } from "react";
import { usePortalContext } from "../PortalContext";

export function usePortalDeals() {
    const portal = usePortalContext();
    const email = portal?.email || "";
    const accountId = portal?.context?.accountId || portal?.context?.account_id;

    const [deals, setDeals] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!email && !accountId) return;

        async function fetchDeals() {
            try {
                setLoading(true);
                setError("");

                const params = new URLSearchParams();
                if (email) params.set("email", email);
                if (accountId) params.set("accountId", accountId);

                const res = await fetch(
                    `/server/getportaldeals?${params.toString()}`
                );
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(
                        `HTTP ${res.status}: ${text || "No response body"}`
                    );
                }

                const data = await res.json();
                setDeals(data.deals || []);
            } catch (err) {
                console.error("Error fetching portal deals:", err);
                setError(err.message || "Failed to load deals");
            } finally {
                setLoading(false);
            }
        }

        fetchDeals();
    }, [email, accountId]);

    return { deals, loading, error };
}
