import {PeerId} from "@libp2p/interface";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {EnvelopeReconstructionError} from "../../../chain/errors/index.js";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {MAX_BODIES_PER_REQUEST} from "../../../util/execution.js";
import {ExecutionPayloadEnvelopesByRootRequest} from "../../../util/types.js";
import {prettyPrintPeerId} from "../../util.js";

export async function* onExecutionPayloadEnvelopesByRoot(
  requestBody: ExecutionPayloadEnvelopesByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  // The gloas req/resp spec uses MIN_EPOCHS_FOR_BLOCK_REQUESTS to define the minimum range peers MUST serve.
  // Archival nodes may still serve older retained payloads to allow genesis sync.

  // Resolve slots first so archived envelopes can be reconstructed in EL batches.
  // Duplicate roots are served once, since each archived envelope costs an EL fetch and a rebuild.
  const requests: {blockSlot: Slot; blockRootHex: RootHex}[] = [];
  const seenRoots = new Set<RootHex>();
  for (const root of requestBody) {
    const rootHex = toRootHex(root);
    if (seenRoots.has(rootHex)) continue;
    seenRoots.add(rootHex);

    const block = chain.forkChoice.getBlockHexDefaultStatus(rootHex);
    // If the block is not in fork choice, it may be finalized. Attempt to find its slot in block archive
    const slot = block ? block.slot : await db.blockArchive.getSlotByRoot(root);

    if (slot === null) {
      chain.logger.debug(
        "Cannot serve ExecutionPayloadEnvelopesByRoot: block root not in fork choice or block archive",
        {
          root: rootHex,
          peer: prettyPrintPeerId(peerId),
          client: peerClient,
        }
      );
      continue;
    }
    requests.push({blockSlot: slot, blockRootHex: rootHex});
  }

  // Yield between EL batches so the first response does not wait for the entire request.
  let yielded = 0;
  for (let i = 0; i < requests.length; i += MAX_BODIES_PER_REQUEST) {
    const batch = requests.slice(i, i + MAX_BODIES_PER_REQUEST);
    let envelopesBytes: (Uint8Array | null)[];
    try {
      // By-root allows omission, so a mismatched envelope is left out rather than failing the response.
      envelopesBytes = await chain.getSerializedExecutionPayloadEnvelopes(batch, "omit");
    } catch (e) {
      if (e instanceof EnvelopeReconstructionError) {
        // By-root permits partial responses, so an EL failure can end the response here.
        if (yielded > 0) return;
        throw new ResponseError(
          RespStatus.RESOURCE_UNAVAILABLE,
          `Failed to reconstruct archived envelopes: ${e.message}`
        );
      }
      throw e;
    }

    for (let j = 0; j < batch.length; j++) {
      const {blockSlot, blockRootHex} = batch[j];
      const envelopeBytes = envelopesBytes[j];
      if (envelopeBytes) {
        yielded++;
        yield {
          data: envelopeBytes,
          boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(blockSlot)),
        };
      } else {
        chain.logger.debug("Cannot serve ExecutionPayloadEnvelopesByRoot: envelope not found", {
          slot: blockSlot,
          root: blockRootHex,
          peer: prettyPrintPeerId(peerId),
          client: peerClient,
        });
      }
    }
  }
}
