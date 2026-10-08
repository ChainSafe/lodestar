import {describe, expect, it, vi} from "vitest";
import {NativePeerReports} from "../../../../src/network/core/native/reports.js";
import {PeerAction} from "../../../../src/network/peers/index.js";

const reasons = [
  "BadGossipBlock",
  "BadGossipPayload",
  "BadSyncBlocks",
  "ExecutionEngineInvalid",
  "InvalidResponseSsz",
  "SyncChainInvalidBatchOther",
  "SyncChainInvalidBatchSelf",
  "SyncChainMaxExecutionEngineErrorAttempts",
  "SyncChainMaxProcessingAttempts",
];
const actions = [
  [PeerAction.Fatal, "fatal"],
  [PeerAction.LowToleranceError, "low_tolerance"],
  [PeerAction.MidToleranceError, "mid_tolerance"],
  [PeerAction.HighToleranceError, "high_tolerance"],
] as const;

function fixture() {
  const network = {reportPeer: vi.fn()};
  return {network, reports: new NativePeerReports(network)};
}

/** The counter's samples by `reason`, after checking its one family and type. */
function counts(text: string): Map<string, number> {
  expect(text.match(/^# TYPE .*$/gm)).toEqual(["# TYPE lodestar_peers_report_peer_count counter"]);
  return new Map(
    text
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const match = line.match(/^lodestar_peers_report_peer_count\{reason="([^"]*)"\} (\d+)$/);
        if (!match) throw Error(`Unexpected sample ${line}`);
        return [match[1], Number(match[2])];
      })
  );
}

describe("native peer reports", () => {
  it("counts reports by reason regardless of action, with every reason rendered from the start", () => {
    const {network, reports} = fixture();
    const expected = new Map([...reasons, "other"].map((reason) => [reason, 0]));
    expect(counts(reports.metrics())).toEqual(expected);
    for (const [index, reason] of reasons.entries()) {
      for (const [action, nativeAction] of actions) {
        for (let i = 0; i <= index; i++) reports.report("peer", action, reason);
        expect(network.reportPeer).toHaveBeenLastCalledWith("peer", nativeAction);
      }
      expected.set(reason, (index + 1) * actions.length);
    }
    expect(counts(reports.metrics())).toEqual(expected);
  });

  it("counts any other reason, such as an error message, as other", () => {
    const {network, reports} = fixture();
    const messages = ["Blocks out of order in BeaconBlocksByRange response", "badgossipblock", "", "toString"];
    for (const message of messages) reports.report("peer", PeerAction.LowToleranceError, message);
    reports.report("peer", PeerAction.Fatal, "rate_limit_rpc");
    const samples = counts(reports.metrics());
    expect(samples.get("other")).toBe(messages.length + 1);
    expect([...samples.values()].reduce((sum, count) => sum + count)).toBe(messages.length + 1);
    expect(network.reportPeer).toHaveBeenCalledTimes(messages.length + 1);
  });

  it("counts every submission, including reports native merges for the same peer and action", () => {
    const {network, reports} = fixture();
    reports.report("peer", PeerAction.LowToleranceError, "BadGossipBlock");
    reports.report("peer", PeerAction.LowToleranceError, "BadGossipBlock");
    expect(network.reportPeer.mock.calls).toEqual([
      ["peer", "low_tolerance"],
      ["peer", "low_tolerance"],
    ]);
    expect(counts(reports.metrics()).get("BadGossipBlock")).toBe(2);
  });

  it("does not count a report native refuses", () => {
    const {network, reports} = fixture();
    network.reportPeer.mockImplementationOnce(() => {
      throw Error("invalid peer");
    });
    expect(() => reports.report("not-a-peer", PeerAction.Fatal, "BadGossipBlock")).toThrow("invalid peer");
    expect(counts(reports.metrics()).get("BadGossipBlock")).toBe(0);
  });
});
