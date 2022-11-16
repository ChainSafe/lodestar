import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {allForks, altair, Root, ssz, SyncPeriod} from "@lodestar/types";
import {Api, routes} from "@lodestar/api";
import {fromHexString, JsonPath, toHexString} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {GossipType, INetwork} from "@lodestar/beacon-node/network";
import {PeerSet} from "@lodestar/beacon-node/util/peerMap";
import {GossipsubEvents} from "@chainsafe/libp2p-gossipsub";
import {ForkName} from "@lodestar/params";
import {DEFAULT_ENCODING} from "@lodestar/beacon-node/network/gossip/constants";
import {IBeaconConfig} from "@lodestar/config";

export enum EventType {
  /**
   * The node has finished processing, resulting in a new head. previous_duty_dependent_root is
   * `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch - 1) - 1)` and
   * current_duty_dependent_root is `get_block_root_at_slot(state, compute_start_slot_at_epoch(epoch) - 1)`.
   * Both dependent roots use the genesis block root in the case of underflow.
   */
  head = "head",
  /** The node has received a valid block (from P2P or API) */
  block = "block",
  /** The node has received a valid attestation (from P2P or API) */
  attestation = "attestation",
  /** The node has received a valid voluntary exit (from P2P or API) */
  voluntaryExit = "voluntary_exit",
  /** Finalized checkpoint has been updated */
  finalizedCheckpoint = "finalized_checkpoint",
  /** The node has reorganized its chain */
  chainReorg = "chain_reorg",
  /** The node has received a valid sync committee SignedContributionAndProof (from P2P or API) */
  contributionAndProof = "contribution_and_proof",
  /** New or better optimistic header update available */
  lightClientOptimisticUpdate = "light_client_optimistic_update",
  /** New or better finality update available */
  lightClientFinalityUpdate = "light_client_finality_update",
  /** New or better light client update available */
  lightClientUpdate = "light_client_update",
}

export interface LightClientTransport {
  getStateProof(stateId: string, jsonPaths: JsonPath[]): Promise<{data: Proof}>;
  getUpdates(startPeriod: SyncPeriod, count: number): Promise<{data: altair.LightClientUpdate[]}>;
  /**
   * Returns the latest optimistic head update available. Clients should use the SSE type `light_client_optimistic_update`
   * unless to get the very first head update after syncing, or if SSE are not supported by the server.
   */
  getOptimisticUpdate(): Promise<{data: altair.LightClientOptimisticUpdate | undefined}>;
  getFinalityUpdate(): Promise<{data: altair.LightClientFinalityUpdate | undefined}>;
  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * The trusted block root should be fetched with similar means to a weak subjectivity checkpoint.
   * Only block roots for checkpoints are guaranteed to be available.
   */
  getBootstrap(blockRoot: string): Promise<{data: altair.LightClientBootstrap | undefined}>;

  /**
   * For fetching the block when updating the EL
   *
   */
  fetchBlock(blockRoot: string): Promise<{data: allForks.SignedBeaconBlock | undefined}>;

  // registers handler for LightClientOptimisticUpdate. This can come either via sse or p2p
  onOptimisticUpdate(handler: (optimisticUpdate: altair.LightClientOptimisticUpdate) => void): void;
  // registers handler for LightClientFinalityUpdate. This can come either via sse or p2p
  onFinalityUpdate(handler: (finalityUpdate: altair.LightClientFinalityUpdate) => void): void;
}

export type LightClientRestEvents = {
  [EventType.lightClientUpdate]: altair.LightClientUpdate;
  [EventType.lightClientOptimisticUpdate]: altair.LightClientOptimisticUpdate;
};

// export class ChainEventEmitter extends (EventEmitter as {new (): StrictEventEmitter<EventEmitter, IChainEvents>}) {}

type RestEvents = StrictEventEmitter<EventEmitter, LightClientRestEvents>;
type StateGetterFn = (stateId: string, jsonPaths: JsonPath[]) => Promise<{data: Proof}>;
export class LightClientRestTransport extends (EventEmitter as {new (): RestEvents}) implements LightClientTransport {
  private api: Api;
  private stateGetterFn: StateGetterFn;
  private controller: AbortController;

  constructor(api: Api, stateGetterFn: StateGetterFn) {
    super();
    this.api = api;
    this.stateGetterFn = stateGetterFn;
    this.controller = new AbortController();
  }
  getStateProof(stateId: string, jsonPaths: JsonPath[]): Promise<{data: Proof}> {
    return this.stateGetterFn(stateId, jsonPaths);
  }
  getUpdates(startPeriod: SyncPeriod, count: number): Promise<{data: altair.LightClientUpdate[]}> {
    return this.api.lightclient.getUpdates(startPeriod, count);
  }

  getOptimisticUpdate(): Promise<{data: altair.LightClientOptimisticUpdate}> {
    return this.api.lightclient.getOptimisticUpdate();
  }

  getFinalityUpdate(): Promise<{data: altair.LightClientFinalityUpdate}> {
    return this.api.lightclient.getFinalityUpdate();
  }

  getBootstrap(blockRoot: string): Promise<{data: altair.LightClientBootstrap}> {
    return this.api.lightclient.getBootstrap(blockRoot);
  }

  fetchBlock(blockRootAsString: string): Promise<{data: allForks.SignedBeaconBlock}> {
    return this.api.beacon.getBlock(blockRootAsString);
  }

  onOptimisticUpdate(handler: (optimisticUpdate: altair.LightClientOptimisticUpdate) => void): void {
    const optimisticHandler = (event: routes.events.BeaconEvent): void => {
      handler(event.message as altair.LightClientOptimisticUpdate);
    };
    this.api.events.eventstream(
      [routes.events.EventType.lightClientOptimisticUpdate],
      this.controller.signal,
      optimisticHandler
    );
  }

  onFinalityUpdate(handler: (finalityUpdate: altair.LightClientFinalityUpdate) => void): void {
    const finalityHandler = (event: routes.events.BeaconEvent): void => {
      handler(event.message as altair.LightClientFinalityUpdate);
    };
    this.api.events.eventstream(
      [routes.events.EventType.lightClientFinalityUpdate],
      this.controller.signal,
      finalityHandler
    );
  }
}

export class LightClientGossipTransport implements LightClientTransport {
  private stateGetterFn: StateGetterFn;
  private readonly network: INetwork;
  private peers = new PeerSet();
  private readonly config: IBeaconConfig;

  constructor(network: INetwork, config: IBeaconConfig, stateGetterFn: StateGetterFn) {
    this.network = network;
    this.config = config;
    this.stateGetterFn = stateGetterFn;
  }

  async fetchBlock(blockRoot: string): Promise<{data: allForks.SignedBeaconBlock | undefined}> {
    let data: allForks.SignedBeaconBlock | undefined;
    for (const peer of this.peers.values()) {
      try {
        [data] = await this.network.reqResp.beaconBlocksByRoot(peer, [fromHexString(blockRoot)]);
      } catch (e) {
        // log
      }
      // we have the data, stop attempting to fetch
      if (data !== undefined) {
        break;
      }
    }
    return {data};
  }

  async getBootstrap(blockRoot: string): Promise<{data: altair.LightClientBootstrap | undefined}> {
    let data: altair.LightClientBootstrap | undefined;
    for (const peer of this.peers.values()) {
      try {
        data = await this.network.reqResp.lightClientBootstrap(peer, fromHexString(blockRoot));
      } catch (e) {
        // log error
      }
      // we have the requested data, stop attempting to fetch
      if (data !== undefined) {
        break;
      }
    }

    return {data};
  }

  async getFinalityUpdate(): Promise<{data: altair.LightClientFinalityUpdate | undefined}> {
    let data: altair.LightClientFinalityUpdate | undefined;
    for (const peer of this.peers.values()) {
      try {
        data = await this.network.reqResp.lightClientFinalityUpdate(peer);
      } catch (e) {
        // log error
      }
      // we have the data, stop attempting to fetch
      if (data !== undefined) {
        break;
      }
    }
    return {data};
  }

  async getOptimisticUpdate(): Promise<{data: altair.LightClientOptimisticUpdate | undefined}> {
    let data: altair.LightClientOptimisticUpdate | undefined;
    for (const peer of this.peers.values()) {
      try {
        data = await this.network.reqResp.lightClientOptimisticUpdate(peer);
      } catch (e) {
        // log error
      }
      // we have the data, stop attempting to fetch
      if (data !== undefined) {
        break;
      }
    }
    return {data};
  }

  getStateProof(stateId: string, jsonPaths: JsonPath[]): Promise<{data: Proof}> {
    return this.stateGetterFn(stateId, jsonPaths);
  }

  async getUpdates(startPeriod: SyncPeriod, count: number): Promise<{data: altair.LightClientUpdate[]}> {
    let data: altair.LightClientUpdate[] = [];
    for (const peer of this.peers.values()) {
      try {
        data = await this.network.reqResp.lightClientUpdate(peer, {startPeriod, count});
      } catch (e) {
        // log errr
      }
      // we have the data, stop attempting to fetch
      if (data.length !== 0) {
        break;
      }
    }
    return {data};
  }

  onFinalityUpdate(handler: (finalityUpdate: altair.LightClientFinalityUpdate) => void): void {
    const updateHandler = (event: GossipsubEvents["gossipsub:message"]): void => {
      const {msg} = event.detail;
      const forkDigestHex = this.config.forkName2ForkDigestHex(ForkName.bellatrix);
      const finalityUpdateTopic = `/eth2/${forkDigestHex}/${GossipType.light_client_finality_update}/${DEFAULT_ENCODING}`;
      if (msg.type === finalityUpdateTopic) {
        const finalityUpdate = ssz.altair.LightClientFinalityUpdate.deserialize(msg.data);
        handler(finalityUpdate);
      }
    };
    this.network.gossip.addEventListener("gossipsub:message", updateHandler);
  }

  onOptimisticUpdate(handler: (optimisticUpdate: altair.LightClientOptimisticUpdate) => void): void {
    const updateHandler = (event: GossipsubEvents["gossipsub:message"]): void => {
      const {msg} = event.detail;
      const forkDigestHex = this.config.forkName2ForkDigestHex(ForkName.bellatrix);
      const optimisiticUpdateTopic = `/eth2/${forkDigestHex}/${GossipType.light_client_optimistic_update}/${DEFAULT_ENCODING}`;
      if (msg.type === optimisiticUpdateTopic) {
        const optimisticUpdate = ssz.altair.LightClientOptimisticUpdate.deserialize(msg.data);
        handler(optimisticUpdate);
      }
    };
    this.network.gossip.addEventListener("gossipsub:message", updateHandler);
  }
}
