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
  stats(id: number): Record<string, {queued: number; executing: number; keys: number; dropped: number}>;
  dump(id: number, kind: string): {context: string; data: Uint8Array}[];
  drain(id: number, slot: number, ready: boolean): {checks: DependencyCheck[]; jobs: GossipDelivery[][]; delay: number};
  classify(id: number, token: bigint, available: boolean): void;
  complete(id: number, token: bigint): boolean;
  notify(id: number, root: Uint8Array): void;
  dropQueued(id: number): void;
  dropPeer(id: number, peer: string): void;
};
