import {toHexString} from "@chainsafe/ssz";
import {ContextBytesType, EncodedPayloadBytes, EncodedPayloadType} from "@lodestar/reqresp";
import {Slot, phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../../util/sszBytes.js";

export async function* onBeaconBlocksByRoot(
  requestBody: phase0.BeaconBlocksByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<EncodedPayloadBytes> {
  for (const blockRoot of requestBody) {
    const root = blockRoot;
    const summary = chain.forkChoice.getBlock(root);
    let blockBytes: Uint8Array | null = null;

    // finalized block has summary in forkchoice but it stays in blockArchive db
    if (summary) {
      blockBytes = await db.block.getBinary(root);
    }

    let slot: Slot | undefined = undefined;
    if (!blockBytes) {
      const blockEntry = await db.blockArchive.getBinaryEntryByRoot(root);
      if (blockEntry) {
        slot = blockEntry.key;
        blockBytes = blockEntry.value;
      }
    }

    if (blockBytes) {
      if (slot === undefined) {
        const slotFromBytes = getSlotFromSignedBeaconBlockSerialized(blockBytes);
        if (slotFromBytes === null) {
          throw Error(`Invalid block bytes for block root ${toHexString(root)}`);
        }
        slot = slotFromBytes;
      }

      yield {
        type: EncodedPayloadType.bytes,
        bytes: blockBytes,
        contextBytes: {
          type: ContextBytesType.ForkDigest,
          fork: chain.config.getForkName(slot),
        },
      };
    }
  }
}
