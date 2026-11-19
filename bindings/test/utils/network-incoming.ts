import {setTimeout as delay} from "node:timers/promises";
import type {NativeApplicationConfig} from "../../src/network.js";
import type {NativeIncomingRequest} from "../../src/network-types.js";
import {applicationConfig, localIntent, nextIncoming, startRuntime} from "./network.js";
import {type PeerRuntime, startPeer} from "./network-peer.js";
import type {NetworkTestRuntime} from "./network-runtime.js";

export const BLOCKS = "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy";

export async function incomingPair(
  serverBudget?: number,
  onServerWorkAvailable: () => void = () => undefined,
  configure?: (left: NativeApplicationConfig, right: NativeApplicationConfig) => void
) {
  const leftConfig = applicationConfig();
  const rightConfig = applicationConfig();
  leftConfig.resources.bridgeBudgetBytes = 512 * 1024 * 1024;
  rightConfig.resources.bridgeBudgetBytes = serverBudget ?? 512 * 1024 * 1024;
  rightConfig.identitySecretKey[31] = 2;
  configure?.(leftConfig, rightConfig);
  let left: PeerRuntime | undefined;
  let right: NetworkTestRuntime | undefined;
  try {
    left = await startPeer(leftConfig);
    right = startRuntime(rightConfig, onServerWorkAvailable);
    const [identity, remote] = await Promise.all([left.identity, right.identity]);
    await Promise.all([left.applyIntent(localIntent(leftConfig)), right.applyIntent(localIntent(rightConfig))]);
    await left.connect(remote.peerId, [remote.localEndpoint], 5000n);
    return {identity, left, leftConfig, remote, right, rightConfig};
  } catch (error) {
    await Promise.allSettled([left?.stop(), right?.close()]);
    throw error;
  }
}

export async function takeIncoming(runtime: NetworkTestRuntime | PeerRuntime): Promise<NativeIncomingRequest> {
  for (let i = 0; i < 1000; i++) {
    const incoming = "takeIncomingRequest" in runtime ? await runtime.takeIncomingRequest() : nextIncoming(runtime);
    if (incoming) return incoming;
    await delay(5);
  }
  throw Error("Incoming request deadline");
}
