import {SLOTS_PER_EPOCH} from "@lodestar/params";
import type {NetworkOptions} from "../../options.js";
import {parseNativePeerAddress} from "./addresses.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

export type NativeBackendOptions = {
  /** Emit bounded block and sampled column lifecycle logs. */
  traceGossip?: boolean;
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

const fixedOptions = {
  tcp: false,
  quic: true,
  mdns: false,
  connectToDiscv5Bootnodes: false,
  gossipsubAwaitHandler: false,
  disablePeerScoring: false,
  rateLimitMultiplier: 1,
  protocolPrefix: "/eth2/beacon_chain/req",
  gossipsubD: 8,
  gossipsubDLow: 6,
  gossipsubDHigh: 12,
} as const satisfies Partial<NetworkOptions>;

export function validateNativeOptions(opts: NetworkOptions): void {
  for (const name of Object.keys(fixedOptions) as (keyof typeof fixedOptions)[]) {
    const value = opts[name];
    if ((value !== undefined || name === "tcp") && value !== fixedOptions[name]) {
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: `native backend requires ${name}=${JSON.stringify(fixedOptions[name])}; received ${JSON.stringify(value)}`,
      });
    }
  }
  for (const name of ["discv5FirstQueryDelayMs", "dialTimeoutMs", "requestTimeoutMs", "respTimeoutMs"] as const) {
    if (opts[name] !== undefined) {
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: `native backend does not support ${name}=${opts[name]}; omit ${name} to use native scheduling`,
      });
    }
  }
  optionInteger("maxPeers", opts.maxPeers, 2, 256);
  optionInteger("targetPeers", opts.targetPeers, 1, opts.maxPeers - 1);
  optionInteger("targetGroupPeers", opts.targetGroupPeers, 1, opts.maxPeers);
  optionInteger(
    "slotsToSubscribeBeforeAggregatorDuty",
    opts.slotsToSubscribeBeforeAggregatorDuty,
    0,
    2 * SLOTS_PER_EPOCH
  );
  optionInteger(
    "direct peer identities",
    new Set(opts.directPeers?.map((address) => parseNativePeerAddress(address).peerId)).size,
    0,
    opts.targetPeers - Math.max(1, Math.floor(opts.targetPeers / 4))
  );
}

function optionInteger(name: string, value: number, min: number, max: number): void {
  nativeInteger(
    value,
    `native backend requires ${name} to be an integer between ${min} and ${max}; received ${name}=${value}`,
    max,
    min
  );
}
