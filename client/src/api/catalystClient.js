const API_BASE =
  process.env.NODE_ENV === "development"
    ? (process.env.REACT_APP_API_BASE || "") + "/server"
    : "/server";

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim());
}

function safeResponsePreview(text) {
  if (!text) return "";
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

function parseErrorBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildApiError(res, text) {
  const parsed = parseErrorBody(text);
  const requestId = firstString(parsed?.requestId, parsed?.data?.requestId) || "";
  const technicalMessage =
    firstString(
      parsed?.error,
      parsed?.message,
      parsed?.data?.message,
      text,
    ) || `API error ${res.status}`;
  const errorCode =
    firstString(
      parsed?.data?.error_code,
      parsed?.data?.errorCode,
      parsed?.error_code,
      parsed?.errorCode,
    ) || "";

  const error = new Error(`Request failed with status ${res.status}`);
  error.status = res.status;
  error.requestId = requestId;
  error.technicalMessage = technicalMessage;
  error.errorCode = errorCode;
  error.rawBody = safeResponsePreview(text);
  if (parsed?.details) error.details = parsed.details;
  return error;
}

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
    throw buildApiError(res, text);
  }
  return res.json();
}

export { API_BASE, buildApiError, request };
