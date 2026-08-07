import { describe, expect, it } from "vitest";
import { AgentWebSocketClient } from "../src/websocket/WebSocketClient";

describe("reconnect logic", () => {
  it("uses exponential backoff capped at 30s", () => {
    const client = new AgentWebSocketClient({ baseMs: 1000, maxMs: 30_000 });
    expect(client.nextDelayMs(1)).toBe(1000);
    expect(client.nextDelayMs(2)).toBe(2000);
    expect(client.nextDelayMs(3)).toBe(4000);
    expect(client.nextDelayMs(4)).toBe(8000);
    expect(client.nextDelayMs(5)).toBe(16_000);
    expect(client.nextDelayMs(6)).toBe(30_000);
    expect(client.nextDelayMs(10)).toBe(30_000);
  });

  it("respects custom max", () => {
    const client = new AgentWebSocketClient({ baseMs: 1000, maxMs: 5000 });
    expect(client.nextDelayMs(10)).toBe(5000);
  });
});
