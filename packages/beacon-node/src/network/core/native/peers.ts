import {
  NativeNetworkApplicationRuntime,
  NativePeerObservation,
  NativePeerState,
  NetworkStatus,
} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {Status} from "@lodestar/types";
import {computeColumnsForCustodyGroup} from "../../../util/dataColumns.js";
import {NetworkEvent, NetworkEventBus} from "../../events.js";
import {getKnownClientFromAgentVersion} from "../../peers/client.js";
import {hostPeerId} from "./addresses.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

function hostInteger(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "peer status integer"});
  return Number(value);
}

export function hostStatus(status: NetworkStatus): Status {
  const common = {
    forkDigest: status.forkDigest,
    finalizedRoot: status.finalizedRoot,
    finalizedEpoch: hostInteger(status.finalizedEpoch),
    headRoot: status.headRoot,
    headSlot: hostInteger(status.headSlot),
  };
  return status.earliestAvailableSlot === null
    ? common
    : {...common, earliestAvailableSlot: hostInteger(status.earliestAvailableSlot)};
}

function sameConnection(
  left: Pick<NativePeerState, "session" | "peer" | "connection">,
  right: Pick<NativePeerState, "session" | "peer" | "connection">
): boolean {
  return (
    left.session === right.session &&
    left.peer.index === right.peer.index &&
    left.peer.generation === right.peer.generation &&
    left.connection !== null &&
    right.connection !== null &&
    left.connection.index === right.connection.index &&
    left.connection.generation === right.connection.generation
  );
}

export class NativePeers {
  statusRefusals = 0n;
  private readonly peers = new Map<string, {state: NativePeerState; sequence: bigint; rejected?: true}>();
  private closed = false;
  constructor(
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "drainPeers" | "disconnect">,
    private readonly config: BeaconConfig,
    private readonly events: NetworkEventBus,
    private readonly capacity: number
  ) {
    nativeInteger(capacity, "peer projection capacity", 4096, 1);
  }
  drain(max: number): boolean {
    nativeInteger(max, "peer drain", 256, 1);
    if (this.closed) return false;
    const batch = this.runtime.drainPeers(max);
    for (const event of batch.events) this.observe(event);
    return batch.more;
  }
  private observe(event: NativePeerObservation): void {
    if (event.type === "closed") {
      const peer = hostPeerId(event.identity);
      const previous = this.peers.get(peer);
      if (!previous || previous.sequence >= event.ownerSequence || !sameConnection(previous.state, event)) return;
      this.peers.delete(peer);
      if (previous.state.relevant) this.events.emit(NetworkEvent.peerDisconnected, {peer});
      return;
    }
    const {state} = event;
    const peer = hostPeerId(state.identity);
    const previous = this.peers.get(peer);
    if (previous && previous.sequence >= event.ownerSequence) return;
    if (!state.connection) {
      this.peers.delete(peer);
      if (previous?.state.relevant) this.events.emit(NetworkEvent.peerDisconnected, {peer});
      return;
    }
    if (previous?.rejected && sameConnection(previous.state, state)) return;
    if (!previous && this.peers.size >= this.capacity)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CAPACITY, resource: "peer projection"});
    let status: Status | undefined;
    if (state.relevant && state.status) {
      try {
        status = hostStatus(state.status);
      } catch (error) {
        if (!(error instanceof NativeNetworkError)) throw error;
        if (this.statusRefusals < 0xffff_ffff_ffff_ffffn) this.statusRefusals++;
        this.peers.set(peer, {state: {...state, relevant: false}, sequence: event.ownerSequence, rejected: true});
        if (previous?.state.relevant) this.events.emit(NetworkEvent.peerDisconnected, {peer});
        try {
          void this.runtime.disconnect(state.identity).catch(() => {});
        } catch {}
        return;
      }
    }
    this.peers.set(peer, {state, sequence: event.ownerSequence});
    if (status) {
      const custodyColumns = (state.custodyGroups ?? []).flatMap((group) =>
        computeColumnsForCustodyGroup(this.config, group)
      );
      this.events.emit(NetworkEvent.peerConnected, {
        peer,
        status,
        custodyColumns,
        clientAgent: getKnownClientFromAgentVersion(state.identify?.agent ?? "") ?? state.identify?.agent ?? "unknown",
      });
    } else if (previous?.state.relevant) {
      this.events.emit(NetworkEvent.peerDisconnected, {peer});
    }
  }
  close(): void {
    this.closed = true;
    this.peers.clear();
  }
}
