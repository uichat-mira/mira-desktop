export const getConfiguredPushBrokerBaseUrl = () => {
  const value = process.env.MIRA_PUSH_BROKER_URL?.trim();
  if (!value) {
    throw new Error("MIRA_PUSH_BROKER_URL is not configured");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MIRA_PUSH_BROKER_URL is invalid");
  }

  const isLocalDevelopment =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !isLocalDevelopment) {
    throw new Error("MIRA_PUSH_BROKER_URL must use HTTPS");
  }

  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
};
