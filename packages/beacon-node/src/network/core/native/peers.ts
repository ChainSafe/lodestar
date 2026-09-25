import {
  NativeNetworkApplicationRuntime,
  NativePeerObservation,
  NativePeerState,
  NetworkStatus,
} from "@chainsafe/lodestar-z/network";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {Status} from "@lodestar/types";
import {computeColumnsForCustodyGroup} from "../../../util/dataColumns.js";
import {NetworkEvent, NetworkEventBus} from "../../events.js";
import {ClientKind, getKnownClientFromAgentVersion} from "../../peers/client.js";
import {nativeMultiaddr} from "./addresses.js";
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

export function formatNativePeer(peer: NativePeerState): routes.lodestar.LodestarNodePeer {
  const peerId = peer.identity;
  const status = peer.status;
  const metadata = peer.metadata;
  return {
    peerId,
    enr: null,
    lastSeenP2pAddress: `${nativeMultiaddr(peer.endpoint)}/p2p/${peerId}`,
    state: peer.connection === null ? "disconnected" : peer.disconnectReason === null ? "connected" : "disconnecting",
    direction: peer.connection === null ? null : peer.direction,
    agentVersion: peer.identify?.agent ?? "NA",
    agentClient: String(getKnownClientFromAgentVersion(peer.identify?.agent ?? "") ?? "Unknown"),
    status: status
      ? {
          fork_digest: toHexString(status.forkDigest),
          finalized_root: toHexString(status.finalizedRoot),
          finalized_epoch: status.finalizedEpoch.toString(),
          head_root: toHexString(status.headRoot),
          head_slot: status.headSlot.toString(),
          ...(status.earliestAvailableSlot === null
            ? {}
            : {earliest_available_slot: status.earliestAvailableSlot.toString()}),
        }
      : null,
    metadata: metadata
      ? {
          seq_number: metadata.sequenceNumber.toString(),
          attnets: toHexString(metadata.attnets),
          syncnets: toHexString(Uint8Array.of(metadata.syncnets)),
          ...(metadata.custodyGroupCount === null ? {} : {custody_group_count: metadata.custodyGroupCount.toString()}),
        }
      : null,
    // Native snapshots use monotonic time; zero denotes an unavailable wall-clock timestamp.
    lastReceivedMsgUnixTsMs: 0,
    lastStatusUnixTsMs: 0,
    connectedUnixTsMs: 0,
  };
}

function sameConnection(
  left: Pick<NativePeerState, "connection">,
  right: Pick<NativePeerState, "connection">
): boolean {
  return (
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
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "disconnect">,
    private readonly config: BeaconConfig,
    private readonly events: NetworkEventBus,
    private readonly capacity: number
  ) {
    nativeInteger(capacity, "peer projection capacity", 4096, 1);
  }
  deliver(events: readonly NativePeerObservation[]): void {
    if (this.closed) return;
    for (const event of events) this.observe(event);
  }
  private observe(event: NativePeerObservation): void {
    if (event.type === "closed") {
      const peer = event.identity;
      const previous = this.peers.get(peer);
      if (!previous || previous.sequence >= event.ownerSequence || !sameConnection(previous.state, event)) return;
      this.peers.delete(peer);
      if (previous.state.relevant) this.events.emit(NetworkEvent.peerDisconnected, {peer});
      return;
    }
    const {state} = event;
    const peer = state.identity;
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
        clientAgent: getKnownClientFromAgentVersion(state.identify?.agent ?? "") ?? ClientKind.Unknown,
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
