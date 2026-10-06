export type HostNotificationConfigErrorCode =
  | "BROKER_NOT_CONFIGURED"
  | "BROKER_INVALID_URL"
  | "BROKER_HTTPS_REQUIRED";

export class HostNotificationConfigError extends Error {
  constructor(
    public readonly code: HostNotificationConfigErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HostNotificationConfigError";
  }
}

export const getConfiguredPushBrokerBaseUrl = () => {
  const value = process.env.MIRA_PUSH_BROKER_URL?.trim();
  if (!value) {
    throw new HostNotificationConfigError(
      "BROKER_NOT_CONFIGURED",
      "MIRA_PUSH_BROKER_URL is not configured",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HostNotificationConfigError(
      "BROKER_INVALID_URL",
      "MIRA_PUSH_BROKER_URL is invalid",
    );
  }

  const isLocalDevelopment =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !isLocalDevelopment) {
    throw new HostNotificationConfigError(
      "BROKER_HTTPS_REQUIRED",
      "MIRA_PUSH_BROKER_URL must use HTTPS",
    );
  }

  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
};
