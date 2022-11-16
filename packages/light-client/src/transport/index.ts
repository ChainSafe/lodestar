import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {allForks, altair, Root, SyncPeriod} from "@lodestar/types";
import {Api, routes} from "@lodestar/api";
import {JsonPath, toHexString} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";

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
  getOptimisticUpdate(): Promise<{data: altair.LightClientOptimisticUpdate}>;
  getFinalityUpdate(): Promise<{data: altair.LightClientFinalityUpdate}>;
  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * The trusted block root should be fetched with similar means to a weak subjectivity checkpoint.
   * Only block roots for checkpoints are guaranteed to be available.
   */
  getBootstrap(blockRoot: string): Promise<{data: altair.LightClientBootstrap}>;

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
