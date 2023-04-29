import {toHexString} from "@chainsafe/ssz";
import {
  PayloadType,
  ContextBytesType,
  ProtocolDescriptor,
  IncomingPayload,
  OutgoingPayloadBytes,
} from "@lodestar/reqresp";
import {allForks, phase0, Slot} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../../util/sszBytes.js";

export async function* onBeaconBlocksByRoot(
  protocol: ProtocolDescriptor<phase0.BeaconBlocksByRootRequest, allForks.SignedBeaconBlock>,
  request: IncomingPayload<phase0.BeaconBlocksByRootRequest>,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<OutgoingPayloadBytes> {
  const requestBody =
    request.type === PayloadType.ssz
      ? request.data
      : protocol.requestEncoder(chain.config.getForkName(chain.clock.currentSlot))?.deserialize(request.bytes);

  if (!requestBody) {
    throw new Error(`Invalid request for method=${protocol.method}, version=${protocol.version}`);
  }

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
        type: PayloadType.bytes,
        bytes: blockBytes,
        contextBytes: {
          type: ContextBytesType.ForkDigest,
          fork: chain.config.getForkName(slot),
        },
      };
    }
  }
}
