import { afterEach, describe, expect, it } from "vitest";

import { getConfiguredPushBrokerBaseUrl } from "./host-notification-config.js";

const originalBrokerUrl = process.env.MIRA_PUSH_BROKER_URL;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalBrokerUrl === undefined) {
    delete process.env.MIRA_PUSH_BROKER_URL;
  } else {
    process.env.MIRA_PUSH_BROKER_URL = originalBrokerUrl;
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe("Host Push Broker authority", () => {
  it("normalizes the current HTTPS Host configuration", () => {
    process.env.NODE_ENV = "production";
    process.env.MIRA_PUSH_BROKER_URL =
      "https://push.example.test/base/?debug=1#fragment";

    expect(getConfiguredPushBrokerBaseUrl()).toBe(
      "https://push.example.test/base",
    );
  });

  it("allows loopback HTTP only outside production", () => {
    process.env.NODE_ENV = "development";
    process.env.MIRA_PUSH_BROKER_URL = "http://127.0.0.1:8788/";
    expect(getConfiguredPushBrokerBaseUrl()).toBe(
      "http://127.0.0.1:8788",
    );

    process.env.NODE_ENV = "production";
    expect(() => getConfiguredPushBrokerBaseUrl()).toThrow(
      /must use HTTPS/,
    );
  });

  it("rejects missing, invalid, and non-loopback HTTP configuration", () => {
    process.env.NODE_ENV = "development";

    delete process.env.MIRA_PUSH_BROKER_URL;
    expect(() => getConfiguredPushBrokerBaseUrl()).toThrow(/not configured/);

    process.env.MIRA_PUSH_BROKER_URL = "not-a-url";
    expect(() => getConfiguredPushBrokerBaseUrl()).toThrow(/invalid/);

    process.env.MIRA_PUSH_BROKER_URL = "http://push.example.test";
    expect(() => getConfiguredPushBrokerBaseUrl()).toThrow(/must use HTTPS/);
  });
});
