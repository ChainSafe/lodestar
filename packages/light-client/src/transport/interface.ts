import {allForks, SyncPeriod} from "@lodestar/types";
import {ForkName} from "@lodestar/params";

export interface LightClientTransport {
  getLightClientUpdatesByRange(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<
    {
      version: ForkName;
      data: allForks.LightClientUpdate;
    }[]
  >;
  /**
   * Returns the latest optimistic head update available. Clients should use the SSE type `light_client_optimistic_update`
   * unless to get the very first head update after syncing, or if SSE are not supported by the server.
   */
  getLightClientOptimisticUpdate(): Promise<{version: ForkName; data: allForks.LightClientOptimisticUpdate}>;
  getLightClientFinalityUpdate(): Promise<{version: ForkName; data: allForks.LightClientFinalityUpdate}>;
  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * The trusted block root should be fetched with similar means to a weak subjectivity checkpoint.
   * Only block roots for checkpoints are guaranteed to be available.
   */
  getLightClientBootstrap(blockRoot: string): Promise<{version: ForkName; data: allForks.LightClientBootstrap}>;

  // registers handler for LightClientOptimisticUpdate. This can come either via sse or p2p
  onOptimisticUpdate(handler: (optimisticUpdate: allForks.LightClientOptimisticUpdate) => void): void;
  // registers handler for LightClientFinalityUpdate. This can come either via sse or p2p
  onFinalityUpdate(handler: (finalityUpdate: allForks.LightClientFinalityUpdate) => void): void;
}
