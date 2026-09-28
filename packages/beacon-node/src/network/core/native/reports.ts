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

const NAME = "lodestar_native_peer_reports_total";

function series(reason: string, action: NativePeerAction): string {
  return `${NAME}{reason="${reason}",action="${action}"}`;
}

/** Submits the host's peer reports to native and counts each one by bounded reason and action. */
export class NativePeerReports {
  /** Submissions by series, every reason and action rendered from the start. */
  private readonly counts = new Map<string, number>(
    Array.from(reasons).flatMap((reason) =>
      Object.values(actions).map((action) => [series(reason, action), 0] as const)
    )
  );
  constructor(private readonly network: Pick<NativeNetwork, "reportPeer">) {}

  /** Counts each submission native accepts, including one native merges into a pending report for the same peer. */
  report(peer: string, action: PeerAction, actionName: string): void {
    const nativeAction = actions[action];
    this.network.reportPeer(peer, nativeAction);
    const key = series(reasons.has(actionName) ? actionName : "other", nativeAction);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** The report counter in exposition format. */
  metrics(): string {
    return [
      `# HELP ${NAME} Peer misbehaviour reports Lodestar submitted to native, by reason and action, each submission counted before native merges a peer's pending reports. A reason other than Lodestar's fixed report names, such as a sync download error's message, counts as other`,
      `# TYPE ${NAME} counter`,
      ...Array.from(this.counts, ([key, count]) => `${key} ${count}`),
      "",
    ].join("\n");
  }
}
