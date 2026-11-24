const { ApiError } = require("../errors");

function createServiceClient({
  baseUrl,
  serviceKey,
  timeoutMs = 3000,
  fetchImpl = fetch,
  service,
}) {
  return async (path, { body, requestId } = {}) => {
    if (!baseUrl || !serviceKey || serviceKey.length < 32) {
      throw new ApiError(
        503,
        "DEPENDENCY_UNAVAILABLE",
        service + " is not configured.",
      );
    }
    const url = new URL(path, baseUrl);
    if (!["http:", "https:"].includes(url.protocol))
      throw new ApiError(
        503,
        "DEPENDENCY_UNAVAILABLE",
        service + " URL is invalid.",
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: body ? "POST" : "GET",
        headers: {
          "X-Service-Key": serviceKey,
          "X-Request-Id": requestId,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: "error",
      });
      if (response.status === 404) return undefined;
      if (response.status === 400 && service === "Locations") {
        throw new ApiError(
          400,
          "INVALID_LOCATION",
          "The selected location could not be resolved.",
        );
      }
      if (!response.ok) throw new Error("Dependency rejected request");
      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        "DEPENDENCY_UNAVAILABLE",
        service + " is temporarily unavailable. Retry the request.",
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
module.exports = { createServiceClient };
