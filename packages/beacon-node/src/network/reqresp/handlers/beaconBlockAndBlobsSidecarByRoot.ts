import {ContextBytesType, EncodedPayload, EncodedPayloadType} from "@lodestar/reqresp";
import {deneb} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getSlotFromBytes} from "../../../util/multifork.js";

export async function* onBeaconBlockAndBlobsSidecarByRoot(
  requestBody: deneb.BeaconBlockAndBlobsSidecarByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<EncodedPayload<deneb.SignedBeaconBlockAndBlobsSidecar>> {
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  for (const blockRoot of requestBody) {
    const blockRootHex = toHex(blockRoot);
    const summary = chain.forkChoice.getBlockHex(blockRootHex);

    // NOTE: Only support non-finalized blocks.
    // SPEC: Clients MUST support requesting blocks and sidecars since the latest finalized epoch.
    // https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/p2p-interface.md#beaconblockandblobssidecarbyroot-v1
    if (!summary || summary.slot <= finalizedSlot) {
      // TODO: Should accept the finalized block? Is the finalized block in the archive DB or hot DB?
      continue;
    }

    // finalized block has summary in forkchoice but it stays in blockArchive db
    const blockBytes = await db.block.getBinary(blockRoot);
    if (!blockBytes) {
      throw Error(`Inconsistent state, block known to fork-choice not in db ${blockRootHex}`);
    }

    const blobsSidecarBytes = await db.blobsSidecar.getBinary(blockRoot);
    if (!blobsSidecarBytes) {
      throw Error(`Inconsistent state, blobsSidecar known to fork-choice not in db ${blockRootHex}`);
    }

    yield {
      type: EncodedPayloadType.bytes,
      bytes: signedBeaconBlockAndBlobsSidecarFromBytes(blockBytes, blobsSidecarBytes),
      contextBytes: {
        type: ContextBytesType.ForkDigest,
        forkSlot: getSlotFromBytes(blockBytes),
      },
    };
  }
}

/**
 * Construct a valid SSZ serialized container from its properties also serialized.
 * ```
 * class SignedBeaconBlockAndBlobsSidecar(Container):
 *   beacon_block: SignedBeaconBlock
 *   blobs_sidecar: BlobsSidecar
 * ```
 */
export function signedBeaconBlockAndBlobsSidecarFromBytes(
  blockBytes: Uint8Array,
  blobsSidecarBytes: Uint8Array
): Uint8Array {
  const totalLen = 4 + 4 + blockBytes.length + blobsSidecarBytes.length;
  const arrayBuffer = new ArrayBuffer(totalLen);
  const dataView = new DataView(arrayBuffer);
  const uint8Array = new Uint8Array(arrayBuffer);

  const blockOffset = 8;
  const blobsOffset = 8 + blockBytes.length;

  // Write offsets
  dataView.setUint32(0, blockOffset, true);
  dataView.setUint32(4, blobsOffset, true);

  uint8Array.set(blockBytes, blockOffset);
  uint8Array.set(blobsSidecarBytes, blobsOffset);

  return uint8Array;
}
