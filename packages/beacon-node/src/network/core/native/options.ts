import {NativeTopicKind} from "@chainsafe/lodestar-z/network";

export type NativeBackendOptions = {
  nativeBudgetBytes?: number;
  bridgeBudgetBytes?: number;
  receiveBudgetBytes?: number;
  /** Shared storage for received gossip bytes. Defaults to 128 MiB. Multiple of 4096. */
  gossipReceiveBufferBytes?: number;
  /** Absolute lifetime of an incomplete large gossip frame. Defaults to 6000 ms. */
  gossipLargeFrameTimeoutMs?: number;
  /** Absolute active-frame lifetime, including stalled writes. Defaults to 6000 ms. */
  gossipActiveSendTimeoutMs?: number;
  /** Distinct large payloads per kind: 8 by default, 32 blob sidecars, 256 data columns. */
  gossipActiveSendItems?: Partial<Record<NativeTopicKind, number>>;
  hostGossipItems?: number;
  hostGossipBytes?: number;
  discovery?: {
    /** Persisted address hints, captured before CLI defaults and locality cleanup. */
    initialEnr?: string;
    /** Only explicit operator values belong here. IP also fixes the discovery port. */
    fixed?: {ip4?: string; ip6?: string; udp?: number; udp6?: number; quic?: number; quic6?: number};
  };
};
