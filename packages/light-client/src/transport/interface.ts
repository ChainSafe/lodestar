import {allForks, altair, SyncPeriod} from "@lodestar/types";
import {JsonPath} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";

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
  fetchBlock(blockRoot: string): Promise<{data: allForks.SignedBeaconBlock}>;

  // registers handler for LightClientOptimisticUpdate. This can come either via sse or p2p
  onOptimisticUpdate(handler: (optimisticUpdate: altair.LightClientOptimisticUpdate) => void): void;
  // registers handler for LightClientFinalityUpdate. This can come either via sse or p2p
  onFinalityUpdate(handler: (finalityUpdate: altair.LightClientFinalityUpdate) => void): void;
}
