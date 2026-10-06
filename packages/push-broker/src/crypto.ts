const encoder = new TextEncoder();

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const base64UrlToBytes = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

export const exportBytesAsBase64Url = (value: ArrayBuffer | Uint8Array) =>
  bytesToBase64Url(
    value instanceof Uint8Array ? value : new Uint8Array(value),
  );

export const randomToken = (byteLength = 32) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

export const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

export const verifyEd25519 = async (
  publicKeyBase64Url: string,
  signatureBase64Url: string,
  payload: string,
) => {
  try {
    const publicKeyBytes = base64UrlToBytes(publicKeyBase64Url);
    const signatureBytes = base64UrlToBytes(signatureBase64Url);
    if (publicKeyBytes.byteLength !== 32 || signatureBytes.byteLength !== 64) {
      return false;
    }
    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes,
      encoder.encode(payload),
    );
  } catch {
    return false;
  }
};

const importStorageKey = async (base64Url: string) => {
  const raw = base64UrlToBytes(base64Url);
  if (raw.byteLength !== 32) {
    throw new Error("BROKER_STORAGE_KEY must be a 32-byte base64url secret");
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
};

export const sealSecret = async (
  plaintext: string,
  storageKeyBase64Url: string,
  context: string,
) => {
  const key = await importStorageKey(storageKeyBase64Url);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(context),
    },
    key,
    encoder.encode(plaintext),
  );
  return \`v1.\${bytesToBase64Url(iv)}.\${bytesToBase64Url(
    new Uint8Array(ciphertext),
  )}\`;
};

export const openSecret = async (
  sealed: string,
  storageKeyBase64Url: string,
  context: string,
) => {
  const [version, ivValue, ciphertextValue, extra] = sealed.split(".");
  if (
    version !== "v1" ||
    !ivValue ||
    !ciphertextValue ||
    extra !== undefined
  ) {
    throw new Error("Unsupported sealed secret");
  }
  const key = await importStorageKey(storageKeyBase64Url);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(ivValue),
      additionalData: encoder.encode(context),
    },
    key,
    base64UrlToBytes(ciphertextValue),
  );
  return new TextDecoder().decode(plaintext);
};
