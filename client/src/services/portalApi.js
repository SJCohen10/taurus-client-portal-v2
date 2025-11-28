// client/src/services/portalApi.js

const API_BASE = "/server"; // Catalyst function base path

async function handleResponse(res) {
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
    }
    return res.json();
}

// Deals for the logged-in portal user (paralegal / conveyancer)
export async function fetchMyDeals() {
    const email = window?.portalUser?.email;
    if (!email) {
        throw new Error("Missing logged-in user email");
    }

    const res = await fetch(`${API_BASE}/getportaldeals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contact_email: email,
            scope: "my_deals", // backend can start using this later
        }),
    });

    return handleResponse(res);
}

// Firm deals (will rely on backend using scope + email to resolve the firm)
export async function fetchFirmDeals() {
    const email = window?.portalUser?.email;
    if (!email) {
        throw new Error("Missing logged-in user email");
    }

    const res = await fetch(`${API_BASE}/getportaldeals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contact_email: email,
            scope: "firm_deals",
        }),
    });

    return handleResponse(res);
}
