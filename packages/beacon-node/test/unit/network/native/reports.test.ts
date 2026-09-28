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

/** The counter's samples by `reason/action`, after checking its one family and type. */
function counts(text: string): Map<string, number> {
  expect(text.match(/^# TYPE .*$/gm)).toEqual(["# TYPE lodestar_native_peer_reports_total counter"]);
  return new Map(
    text
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const match = line.match(/^lodestar_native_peer_reports_total\{reason="([^"]*)",action="([^"]*)"\} (\d+)$/);
        if (!match) throw Error(`Unexpected sample ${line}`);
        return [`${match[1]}/${match[2]}`, Number(match[3])];
      })
  );
}

describe("native peer reports", () => {
  it("counts each fixed reason and action in its own series, all rendered from the start", () => {
    const {network, reports} = fixture();
    const series = [...reasons, "other"].flatMap((reason) => actions.map(([, label]) => `${reason}/${label}`));
    expect(counts(reports.metrics())).toEqual(new Map(series.map((key) => [key, 0])));

    // A distinct count per series catches reports landing in another series
    const expected = new Map(series.map((key) => [key, 0]));
    let times = 0;
    for (const reason of reasons) {
      for (const [action, label] of actions) {
        times++;
        for (let i = 0; i < times; i++) reports.report("peer", action, reason);
        expected.set(`${reason}/${label}`, times);
      }
    }
    expect(counts(reports.metrics())).toEqual(expected);
    for (const [, label] of actions) {
      expect(network.reportPeer.mock.calls.filter(([, action]) => action === label)).toHaveLength(
        reasons.reduce((sum, reason) => sum + (expected.get(`${reason}/${label}`) ?? 0), 0)
      );
    }
  });

  it("counts any other reason, such as an error message, as other", () => {
    const {network, reports} = fixture();
    const messages = ["Blocks out of order in BeaconBlocksByRange response", "badgossipblock", "", "toString"];
    for (const message of messages) reports.report("peer", PeerAction.LowToleranceError, message);
    reports.report("peer", PeerAction.Fatal, "rate_limit_rpc");
    const samples = counts(reports.metrics());
    expect(samples.get("other/low_tolerance")).toBe(messages.length);
    expect(samples.get("other/fatal")).toBe(1);
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
    expect(counts(reports.metrics()).get("BadGossipBlock/low_tolerance")).toBe(2);
  });

  it("does not count a report native refuses", () => {
    const {network, reports} = fixture();
    network.reportPeer.mockImplementationOnce(() => {
      throw Error("invalid peer");
    });
    expect(() => reports.report("not-a-peer", PeerAction.Fatal, "BadGossipBlock")).toThrow("invalid peer");
    expect(counts(reports.metrics()).get("BadGossipBlock/fatal")).toBe(0);
  });
});
