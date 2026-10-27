import {expect, it, vi} from "vitest";
import {NativePeerReports} from "../../../../src/network/core/native/reports.js";
import {PeerAction} from "../../../../src/network/peers/index.js";

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

it.each(actions)("maps peer action %s to native %s", (action, nativeAction) => {
  const {network, reports} = fixture();
  reports.report("peer", action, "BadGossipBlock");
  expect(network.reportPeer).toHaveBeenCalledExactlyOnceWith("peer", nativeAction);
});

it("counts accepted submissions, including repeats, using bounded reason labels", () => {
  const {network, reports} = fixture();
  reports.report("peer", PeerAction.LowToleranceError, "BadGossipBlock");
  reports.report("peer", PeerAction.LowToleranceError, "BadGossipBlock");
  reports.report("peer", PeerAction.Fatal, "unrecognized reason");
  const metrics = reports.metrics();
  expect(metrics).toContain("# TYPE lodestar_peers_report_peer_count counter\n");
  expect(metrics).toContain('lodestar_peers_report_peer_count{reason="BadGossipBlock"} 2\n');
  expect(metrics).toContain('lodestar_peers_report_peer_count{reason="other"} 1\n');
  expect(metrics).not.toContain('reason="unrecognized reason"');
  network.reportPeer.mockImplementationOnce(() => {
    throw Error("invalid peer");
  });
  expect(() => reports.report("not-a-peer", PeerAction.Fatal, "BadGossipBlock")).toThrow("invalid peer");
  expect(reports.metrics()).toBe(metrics);
});

it("keeps gossip reports attached to their original endpoint after reconnect and deferred import", async () => {
  const {network, reports} = fixture();
  const source = {
    peerId: "peer",
    connection: {index: 1, generation: 4},
    endpoint: {family: 4 as const, address: Uint8Array.of(192, 0, 2, 1), port: 9000},
  };
  const original = structuredClone(source);
  const report = reports.forGossip(source);
  source.connection.generation++;
  source.endpoint.address[3] = 2;
  await Promise.resolve();
  report(PeerAction.Fatal, "INVALID_SIGNATURE");
  expect(network.reportPeer).toHaveBeenLastCalledWith("peer", "fatal", {
    origin: {connection: original.connection, endpoint: original.endpoint},
    reason: "gossip_validation",
  });
  report(PeerAction.LowToleranceError, "BadGossipBlock");
  expect(network.reportPeer).toHaveBeenLastCalledWith("peer", "low_tolerance", {
    origin: {connection: original.connection, endpoint: original.endpoint},
    reason: "gossip_import",
  });
  reports.forGossip({...source, endpoint: null})(PeerAction.Fatal, "INVALID_SIGNATURE");
  expect(network.reportPeer).toHaveBeenLastCalledWith("peer", "fatal", {
    origin: {connection: source.connection, endpoint: null},
    reason: "gossip_validation",
  });
  reports.report("peer", PeerAction.Fatal, "BadSyncBlocks");
  expect(network.reportPeer).toHaveBeenLastCalledWith("peer", "fatal");
});
