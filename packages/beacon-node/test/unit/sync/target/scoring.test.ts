import {describe, expect, it, vi} from "vitest";
import {PeerAction} from "../../../../src/network/peers/score/index.js";
import {ScoringGate} from "../../../../src/sync/target/scoring.js";

describe("ScoringGate", () => {
  const PEER = "12D3KooWTest";
  const REASON = "test-fault";
  const COOLDOWN_MS = 5000;

  it("calls reportPeer on first report for a fresh (peer, reason)", () => {
    const t = 1000;
    const gate = new ScoringGate({cooldownMs: COOLDOWN_MS, now: () => t});
    const reportPeer = vi.fn();
    const network = {reportPeer};

    gate.report(network, PEER, REASON, PeerAction.Fatal);

    expect(reportPeer).toHaveBeenCalledOnce();
    expect(reportPeer).toHaveBeenCalledWith(PEER, PeerAction.Fatal, REASON);
  });

  it("suppresses a second report within cooldownMs for the same (peer, reason)", () => {
    let t = 1000;
    const gate = new ScoringGate({cooldownMs: COOLDOWN_MS, now: () => t});
    const reportPeer = vi.fn();
    const network = {reportPeer};

    gate.report(network, PEER, REASON, PeerAction.Fatal);
    // Advance time but stay within cooldown.
    t += COOLDOWN_MS - 1;
    gate.report(network, PEER, REASON, PeerAction.Fatal);

    expect(reportPeer).toHaveBeenCalledOnce();
  });

  it("reports again after cooldownMs has elapsed", () => {
    let t = 1000;
    const gate = new ScoringGate({cooldownMs: COOLDOWN_MS, now: () => t});
    const reportPeer = vi.fn();
    const network = {reportPeer};

    gate.report(network, PEER, REASON, PeerAction.Fatal);
    // Advance time past cooldown.
    t += COOLDOWN_MS;
    gate.report(network, PEER, REASON, PeerAction.Fatal);

    expect(reportPeer).toHaveBeenCalledTimes(2);
  });

  it("does not suppress reports for a different reason on the same peer", () => {
    const t = 1000;
    const gate = new ScoringGate({cooldownMs: COOLDOWN_MS, now: () => t});
    const reportPeer = vi.fn();
    const network = {reportPeer};

    gate.report(network, PEER, REASON, PeerAction.Fatal);
    gate.report(network, PEER, "other-fault", PeerAction.LowToleranceError);

    expect(reportPeer).toHaveBeenCalledTimes(2);
  });

  it("does not suppress reports for a different peer with the same reason", () => {
    const t = 1000;
    const gate = new ScoringGate({cooldownMs: COOLDOWN_MS, now: () => t});
    const reportPeer = vi.fn();
    const network = {reportPeer};

    gate.report(network, PEER, REASON, PeerAction.Fatal);
    gate.report(network, "12D3KooWOtherPeer", REASON, PeerAction.Fatal);

    expect(reportPeer).toHaveBeenCalledTimes(2);
  });

  it("evicts entries past cooldown so `seen` stays bounded", () => {
    let t = 1000;
    const gate = new ScoringGate({cooldownMs: COOLDOWN_MS, now: () => t});
    const network = {reportPeer: vi.fn()};
    const seen = (gate as unknown as {seen: Map<string, number>}).seen;

    // Many distinct peers fault at the same instant.
    for (let i = 0; i < 50; i++) {
      gate.report(network, `12D3KooWPeer${i}`, REASON, PeerAction.Fatal);
    }
    expect(seen.size).toBe(50);

    // Once their cooldown elapses, the next report sweeps the 50 stale entries, leaving only the new one.
    t += COOLDOWN_MS;
    gate.report(network, "12D3KooWPeerNew", REASON, PeerAction.Fatal);
    expect(seen.size).toBe(1);
  });
});
