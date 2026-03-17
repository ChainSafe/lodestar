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

    if (!block) {
      continue;
    }

    const requestedEpoch = computeEpochAtSlot(block.slot);
    if (requestedEpoch < minimumRequestEpoch) {
      continue;
    }

    // TODO GLOAS: Use chain.getSerializedExecutionPayloadEnvelope() to check in-memory caches before hitting the db when the method is available
    const envelopeBytes = await db.executionPayloadEnvelope.getBinary(root);
    if (envelopeBytes) {
      yield {
        data: envelopeBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(requestedEpoch),
      };
    }
  }
}
