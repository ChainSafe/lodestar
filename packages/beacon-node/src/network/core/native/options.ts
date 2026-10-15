export type NativeBackendOptions = {
  /** Emit bounded block and sampled column lifecycle logs. */
  traceGossip?: boolean;
  traceTurns?: boolean;
  receiveBudgetBytes?: number;
  initialCongestionWindowPackets?: number;
  receiveDatagramsPerTurn?: number;
  discovery?: {
    /** Persisted address hints, captured before CLI defaults and locality cleanup. */
    initialEnr?: string;
    /** Only explicit operator values belong here. IP also fixes the discovery port. */
    fixed?: {ip4?: string; ip6?: string; udp?: number; udp6?: number; quic?: number; quic6?: number};
  };
};
