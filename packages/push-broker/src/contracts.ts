export const BROKER_SCHEMA_VERSION = 1;
export const ELIGIBILITY_EVENT = "final_transition_first_seen";
export const EVENT_TYPE = "assistant-message";

export type ProviderPlatform = "android" | "ios";
export type RegistrationAction = "register" | "refresh";

export type RegistrationRequest = {
  schemaVersion: 1;
  installationId: string;
  platform: ProviderPlatform;
  providerToken: string;
  installationPublicKey: string;
  requestNonce: string;
  issuedAt: string;
  installationSignature: string;
};

export type InstallationRevokeRequest = {
  schemaVersion: 1;
  installationId: string;
  requestNonce: string;
  issuedAt: string;
  installationSignature: string;
};

export type BindingApprovalRequest = {
  schemaVersion: 1;
  installationId: string;
  hostId: string;
  hostPublicKey: string;
  sourceScope: string[];
  bindingNonce: string;
  bindingExpiresAt: string;
  installationSignature: string;
};

export type BindingRevokeRequest = {
  schemaVersion: 1;
  installationId: string;
  hostId: string;
  requestNonce: string;
  issuedAt: string;
  installationSignature: string;
};

export type NotificationEventRequest = {
  schemaVersion: 1;
  eventType: typeof EVENT_TYPE;
  installationId: string;
  eventId: string;
  hostId: string;
  sourceId: string;
  canonicalMessageId: string;
  eligibilityEvent: typeof ELIGIBILITY_EVENT;
  occurredAt: string;
  expiresAt: string;
  hostSignature: string;
};

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;
const SOURCE_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PROVIDER_TOKEN_MAX_LENGTH = 16 * 1024;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
) => Object.keys(value).every((key) => allowed.includes(key));

const readIdentifier = (value: unknown) =>
  typeof value === "string" && IDENTIFIER_PATTERN.test(value) ? value : null;

const readSourceId = (value: unknown) =>
  typeof value === "string" && SOURCE_PATTERN.test(value) ? value : null;

const readTimestamp = (value: unknown) => {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const canonical = new Date(time).toISOString();
  return value === canonical ? value : null;
};

const readBase64Url = (value: unknown, maxLength = 4096) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  BASE64URL_PATTERN.test(value)
    ? value
    : null;

const readProviderToken = (value: unknown) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= PROVIDER_TOKEN_MAX_LENGTH
    ? value
    : null;

export const normalizeSourceScope = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    return null;
  }
  const parsed = value.map(readSourceId);
  if (parsed.some((item) => item === null)) return null;
  return [...new Set(parsed as string[])].sort();
};

export const canonicalJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite canonical number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return \`[\${value.map(canonicalJson).join(",")}]\`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return \`{\${keys
      .map((key) => \`\${JSON.stringify(key)}:\${canonicalJson(value[key])}\`)
      .join(",")}}\`;
  }
  throw new Error("Unsupported canonical value");
};

export const parseRegistrationRequest = (
  value: unknown,
): RegistrationRequest | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "installationId",
      "platform",
      "providerToken",
      "installationPublicKey",
      "requestNonce",
      "issuedAt",
      "installationSignature",
    ]) ||
    value.schemaVersion !== BROKER_SCHEMA_VERSION
  ) return null;

  const installationId = readIdentifier(value.installationId);
  const platform =
    value.platform === "android" || value.platform === "ios"
      ? value.platform
      : null;
  const providerToken = readProviderToken(value.providerToken);
  const installationPublicKey = readBase64Url(value.installationPublicKey, 128);
  const requestNonce = readIdentifier(value.requestNonce);
  const issuedAt = readTimestamp(value.issuedAt);
  const installationSignature = readBase64Url(value.installationSignature, 256);

  if (
    !installationId ||
    !platform ||
    !providerToken ||
    !installationPublicKey ||
    !requestNonce ||
    !issuedAt ||
    !installationSignature
  ) return null;

  return {
    schemaVersion: 1,
    installationId,
    platform,
    providerToken,
    installationPublicKey,
    requestNonce,
    issuedAt,
    installationSignature,
  };
};

export const parseInstallationRevokeRequest = (
  value: unknown,
): InstallationRevokeRequest | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "installationId",
      "requestNonce",
      "issuedAt",
      "installationSignature",
    ]) ||
    value.schemaVersion !== BROKER_SCHEMA_VERSION
  ) return null;

  const installationId = readIdentifier(value.installationId);
  const requestNonce = readIdentifier(value.requestNonce);
  const issuedAt = readTimestamp(value.issuedAt);
  const installationSignature = readBase64Url(value.installationSignature, 256);
  if (!installationId || !requestNonce || !issuedAt || !installationSignature) {
    return null;
  }
  return {
    schemaVersion: 1,
    installationId,
    requestNonce,
    issuedAt,
    installationSignature,
  };
};

export const parseBindingApprovalRequest = (
  value: unknown,
): BindingApprovalRequest | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "installationId",
      "hostId",
      "hostPublicKey",
      "sourceScope",
      "bindingNonce",
      "bindingExpiresAt",
      "installationSignature",
    ]) ||
    value.schemaVersion !== BROKER_SCHEMA_VERSION
  ) return null;

  const installationId = readIdentifier(value.installationId);
  const hostId = readIdentifier(value.hostId);
  const hostPublicKey = readBase64Url(value.hostPublicKey, 128);
  const sourceScope = normalizeSourceScope(value.sourceScope);
  const bindingNonce = readIdentifier(value.bindingNonce);
  const bindingExpiresAt = readTimestamp(value.bindingExpiresAt);
  const installationSignature = readBase64Url(value.installationSignature, 256);

  if (
    !installationId ||
    !hostId ||
    !hostPublicKey ||
    !sourceScope ||
    !bindingNonce ||
    !bindingExpiresAt ||
    !installationSignature
  ) return null;

  return {
    schemaVersion: 1,
    installationId,
    hostId,
    hostPublicKey,
    sourceScope,
    bindingNonce,
    bindingExpiresAt,
    installationSignature,
  };
};

export const parseBindingRevokeRequest = (
  value: unknown,
): BindingRevokeRequest | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "installationId",
      "hostId",
      "requestNonce",
      "issuedAt",
      "installationSignature",
    ]) ||
    value.schemaVersion !== BROKER_SCHEMA_VERSION
  ) return null;

  const installationId = readIdentifier(value.installationId);
  const hostId = readIdentifier(value.hostId);
  const requestNonce = readIdentifier(value.requestNonce);
  const issuedAt = readTimestamp(value.issuedAt);
  const installationSignature = readBase64Url(value.installationSignature, 256);
  if (
    !installationId ||
    !hostId ||
    !requestNonce ||
    !issuedAt ||
    !installationSignature
  ) return null;

  return {
    schemaVersion: 1,
    installationId,
    hostId,
    requestNonce,
    issuedAt,
    installationSignature,
  };
};

export const parseNotificationEventRequest = (
  value: unknown,
): NotificationEventRequest | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "eventType",
      "installationId",
      "eventId",
      "hostId",
      "sourceId",
      "canonicalMessageId",
      "eligibilityEvent",
      "occurredAt",
      "expiresAt",
      "hostSignature",
    ]) ||
    value.schemaVersion !== BROKER_SCHEMA_VERSION ||
    value.eventType !== EVENT_TYPE ||
    value.eligibilityEvent !== ELIGIBILITY_EVENT
  ) return null;

  const installationId = readIdentifier(value.installationId);
  const eventId = readIdentifier(value.eventId);
  const hostId = readIdentifier(value.hostId);
  const sourceId = readSourceId(value.sourceId);
  const canonicalMessageId = readIdentifier(value.canonicalMessageId);
  const occurredAt = readTimestamp(value.occurredAt);
  const expiresAt = readTimestamp(value.expiresAt);
  const hostSignature = readBase64Url(value.hostSignature, 256);

  if (
    !installationId ||
    !eventId ||
    !hostId ||
    !sourceId ||
    !canonicalMessageId ||
    !occurredAt ||
    !expiresAt ||
    !hostSignature
  ) return null;

  return {
    schemaVersion: 1,
    eventType: EVENT_TYPE,
    installationId,
    eventId,
    hostId,
    sourceId,
    canonicalMessageId,
    eligibilityEvent: ELIGIBILITY_EVENT,
    occurredAt,
    expiresAt,
    hostSignature,
  };
};

export const registrationSigningValue = (
  action: RegistrationAction,
  request: Omit<RegistrationRequest, "installationSignature">,
) =>
  canonicalJson({
    action,
    schemaVersion: request.schemaVersion,
    installationId: request.installationId,
    platform: request.platform,
    providerToken: request.providerToken,
    installationPublicKey: request.installationPublicKey,
    requestNonce: request.requestNonce,
    issuedAt: request.issuedAt,
  });

export const installationRevokeSigningValue = (
  request: Omit<InstallationRevokeRequest, "installationSignature">,
) =>
  canonicalJson({
    action: "revoke-installation",
    schemaVersion: request.schemaVersion,
    installationId: request.installationId,
    requestNonce: request.requestNonce,
    issuedAt: request.issuedAt,
  });

export const bindingApprovalSigningValue = (
  request: Omit<BindingApprovalRequest, "installationSignature">,
) =>
  canonicalJson({
    action: "approve-binding",
    schemaVersion: request.schemaVersion,
    installationId: request.installationId,
    hostId: request.hostId,
    hostPublicKey: request.hostPublicKey,
    sourceScope: [...request.sourceScope].sort(),
    bindingNonce: request.bindingNonce,
    bindingExpiresAt: request.bindingExpiresAt,
  });

export const bindingRevokeSigningValue = (
  request: Omit<BindingRevokeRequest, "installationSignature">,
) =>
  canonicalJson({
    action: "revoke-binding",
    schemaVersion: request.schemaVersion,
    installationId: request.installationId,
    hostId: request.hostId,
    requestNonce: request.requestNonce,
    issuedAt: request.issuedAt,
  });

export const eventSigningValue = (
  request: Omit<NotificationEventRequest, "hostSignature">,
) =>
  canonicalJson({
    schemaVersion: request.schemaVersion,
    eventType: request.eventType,
    installationId: request.installationId,
    eventId: request.eventId,
    hostId: request.hostId,
    sourceId: request.sourceId,
    canonicalMessageId: request.canonicalMessageId,
    eligibilityEvent: request.eligibilityEvent,
    occurredAt: request.occurredAt,
    expiresAt: request.expiresAt,
  });
