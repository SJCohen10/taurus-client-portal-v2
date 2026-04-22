const API_BASE =
  process.env.NODE_ENV === "development"
    ? (process.env.REACT_APP_API_BASE || "") + "/server"
    : "/server";

async function request(path, { method = "GET", query, body, signal } = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    });
  }

  const res = await fetch(url.toString().replace(window.location.origin, ""), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    const requestId = parsed?.requestId;
    const baseMessage = parsed?.error || text || `API error ${res.status}`;
    const message = requestId
      ? `API error ${res.status}: ${baseMessage} (requestId: ${requestId})`
      : `API error ${res.status}: ${baseMessage}`;
    const error = new Error(message);
    error.status = res.status;
    if (requestId) error.requestId = requestId;
    if (parsed?.details) error.details = parsed.details;
    throw error;
  }
  return res.json();
}

export { API_BASE, request };
