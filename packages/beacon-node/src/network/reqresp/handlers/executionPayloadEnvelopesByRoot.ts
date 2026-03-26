import {ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {ExecutionPayloadEnvelopesByRootRequest} from "../../../util/types.js";

export async function* onExecutionPayloadEnvelopesByRoot(
  requestBody: ExecutionPayloadEnvelopesByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  // Spec: [max(GLOAS_FORK_EPOCH, current_epoch - MIN_EPOCHS_FOR_BLOCK_REQUESTS), current_epoch]
  const currentEpoch = chain.clock.currentEpoch;
  const minimumRequestEpoch = Math.max(
    currentEpoch - chain.config.MIN_EPOCHS_FOR_BLOCK_REQUESTS,
    chain.config.GLOAS_FORK_EPOCH
  );

  for (const root of requestBody) {
    const rootHex = toRootHex(root);
    const block = chain.forkChoice.getBlockHexDefaultStatus(rootHex);
    // If the block is not in fork choice, it may be finalized. Attempt to find its slot in block archive
    const slot = block ? block.slot : await db.blockArchive.getSlotByRoot(root);

    if (slot === null) {
      continue;
    }

    const requestedEpoch = computeEpochAtSlot(slot);
    if (requestedEpoch < minimumRequestEpoch) {
      continue;
    }

    const envelopeBytes = await chain.getSerializedExecutionPayloadEnvelope(slot, rootHex);
    if (envelopeBytes) {
      yield {
        data: envelopeBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(requestedEpoch),
      };
    }
  }
}
