export const gossipDependencyDecision: Readonly<{ready: 0; awaitBlock: 1; awaitPayload: 2; fatalPeer: 3}>;
export type GossipDependencyDecision = (typeof gossipDependencyDecision)[keyof typeof gossipDependencyDecision];

export interface DependencyCheck {
  token: bigint;
  kind: string;
  slot: number;
  root: Uint8Array;
  payloadPresent: boolean;
  parentBlockHash: Uint8Array | null;
  peerId: string;
}
export interface GossipDelivery {
  token: bigint;
  context: string;
  slot: number | null;
  group: Uint8Array | null;
  data: Uint8Array;
  queueSeconds: number;
}
export interface GossipWaitStats {
  current: number;
  entered: number;
  resolved: number;
  limited: number;
  expired: number;
  resolveSeconds: number;
  expireSeconds: number;
}
export const gossipQueues: {
  /** The creating JS environment owns this queue. Other environments may only offer messages. */
  create(validators: number, maxConcurrency: number): number;
  close(id: number): void;
  /** True when the owner needs a wake. A false result requires no transport action. */
  offer(
    id: number,
    kind: string,
    fork: number,
    digest: number,
    peer: string,
    context: string,
    data: Uint8Array,
    currentSlot: number,
    latestSlot: number
  ): boolean;
  stats(id: number): {
    topics: Record<
      string,
      {
        queued: number;
        executing: number;
        keys: number;
        drops: Record<string, number>;
        block: GossipWaitStats;
        payload: GossipWaitStats;
      }
    >;
    keyAgeMs: Uint32Array;
  };
  dump(id: number, kind: string): {context: string; data: Uint8Array}[];
  checks(id: number, slot: number): DependencyCheck[];
  /** Apply one decision per claimed token and select the jobs eligible in this turn. */
  drain(
    id: number,
    ready: boolean,
    tokens: BigUint64Array,
    decisions: Uint8Array
  ): {
    jobs: GossipDelivery[][];
    delay: number;
    blocked: boolean;
  };
  complete(id: number, token: bigint, skipped?: boolean): boolean;
  notify(id: number, root: Uint8Array): void;
  dropQueued(id: number): void;
  setPeerFatal(id: number, peer: string, fatal: boolean): void;
};
