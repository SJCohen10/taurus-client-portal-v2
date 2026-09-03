const API_BASE =
  process.env.NODE_ENV === "development"
    ? (process.env.REACT_APP_API_BASE || "") + "/server"
    : "/server";

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim());
}

function genericMessageForStatus(status) {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have access to this item.";
  if (status === 404) return "We could not find that item.";
  if (status === 429) return "Too many requests. Please wait a moment and then try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return "That request could not be completed.";
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

  // Only fields the server deliberately returned as a message are safe to show.
  // The raw response text is not - it can carry a stack trace or a record id -
  // so unlike before it is not a fallback here, and it is no longer attached to
  // the error at all.
  const technicalMessage =
    firstString(parsed?.error, parsed?.message, parsed?.data?.message) ||
    genericMessageForStatus(res.status);

  const errorCode =
    firstString(
      parsed?.data?.error_code,
      parsed?.data?.errorCode,
      parsed?.error_code,
      parsed?.errorCode,
    ) || "";

  // The old message was the bare "Request failed with status 500", which told
  // the user nothing and threw away everything useful. Carry the safe message,
  // and the request id so a report can be traced back to a log line.
  const reference = requestId ? ` Reference: ${requestId}` : "";

  const error = new Error(`${technicalMessage}${reference}`);
  error.status = res.status;
  error.requestId = requestId;
  error.technicalMessage = technicalMessage;
  error.errorCode = errorCode;
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
