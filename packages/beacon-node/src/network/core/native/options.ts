import {NativeTopicKind} from "@chainsafe/lodestar-z/network";

export type NativeBackendOptions = {
  profile?: "small" | "beaconNode";
  nativeBudgetBytes?: number;
  bridgeBudgetBytes?: number;
  receiveBudgetBytes?: number;
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
