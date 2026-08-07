import { describe, expect, it } from "vitest";
import { rootLogger } from "../src/utils/logger";

describe("logging redaction", () => {
  it("redacts sensitive fields in context", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (msg?: unknown) => {
      lines.push(String(msg));
    };
    try {
      rootLogger.info("auth attempt", {
        deviceId: "dev_1",
        token: "super-secret",
        imageBase64: "AAAA",
      });
    } finally {
      console.log = original;
    }

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]) as { context: Record<string, string> };
    expect(parsed.context.token).toBe("[REDACTED]");
    expect(parsed.context.imageBase64).toBe("[REDACTED]");
    expect(parsed.context.deviceId).toBe("dev_1");
  });
});
