import {NativeNetwork, NativePeerAction} from "@chainsafe/lodestar-z/network";
import {PeerAction} from "../../peers/index.js";

const actions: Record<PeerAction, NativePeerAction> = {
  [PeerAction.Fatal]: "fatal",
  [PeerAction.LowToleranceError]: "low_tolerance",
  [PeerAction.MidToleranceError]: "mid_tolerance",
  [PeerAction.HighToleranceError]: "high_tolerance",
};

/** The fixed reasons Lodestar's callers pass. Any other reason, such as a sync download error's message, is `other`. */
const reasons = new Set([
  "BadGossipBlock",
  "BadGossipPayload",
  "BadSyncBlocks",
  "ExecutionEngineInvalid",
  "InvalidResponseSsz",
  "SyncChainInvalidBatchOther",
  "SyncChainInvalidBatchSelf",
  "SyncChainMaxExecutionEngineErrorAttempts",
  "SyncChainMaxProcessingAttempts",
  "other",
]);

const NAME = "lodestar_peers_report_peer_count";

/** Submits the host's peer reports to native and counts each one by bounded reason. */
export class NativePeerReports {
  private readonly counts = new Map(Array.from(reasons, (reason) => [reason, 0]));
  constructor(private readonly network: Pick<NativeNetwork, "reportPeer">) {}

  /** Counts each call that returns normally, including one native merges into a pending report for the same peer. */
  report(peer: string, action: PeerAction, actionName: string): void {
    const nativeAction = actions[action];
    this.network.reportPeer(peer, nativeAction);
    const key = reasons.has(actionName) ? actionName : "other";
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** The report counter in exposition format. */
  metrics(): string {
    return [
      `# HELP ${NAME} Peer misbehaviour reports by reason, before native coalescing; unrecognized reasons count as other`,
      `# TYPE ${NAME} counter`,
      ...Array.from(this.counts, ([reason, count]) => `${NAME}{reason="${reason}"} ${count}`),
      "",
    ].join("\n");
  }
}
