export type NativeBackendOptions = {
  profile?: "small" | "beaconNode";
  nativeBudgetBytes?: number;
  bridgeBudgetBytes?: number;
  receiveBudgetBytes?: number;
  hostGossipItems?: number;
  hostGossipBytes?: number;
  discovery?: {
    /** Persisted address hints, captured before CLI defaults and locality cleanup. */
    initialEnr?: string;
    /** Only explicit operator values belong here. IP also fixes the discovery port. */
    fixed?: {ip4?: string; ip6?: string; udp?: number; udp6?: number; quic?: number; quic6?: number};
  };
};
