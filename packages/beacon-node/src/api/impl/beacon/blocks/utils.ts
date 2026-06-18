import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {IForkChoice} from "@lodestar/fork-choice";
import {blockToHeader} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {IBeaconChain} from "../../../../chain/interface.js";
import {GENESIS_SLOT} from "../../../../constants/index.js";
import {rootHexRegex} from "../../../../execution/engine/utils.js";
import {ApiError, ValidationError} from "../../errors.js";

export function toBeaconHeaderResponse(
  config: ChainForkConfig,
  block: SignedBeaconBlock,
  canonical = false
): routes.beacon.BlockHeaderResponse {
  return {
    root: config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
    canonical,
    header: {
      message: blockToHeader(config, block.message),
      signature: block.signature,
    },
  };
}

export function resolveBlockId(forkChoice: IForkChoice, blockId: routes.beacon.BlockId): RootHex | Slot {
  blockId = String(blockId).toLowerCase();
  if (blockId === "head") {
    return forkChoice.getHead().blockRoot;
  }

  if (blockId === "genesis") {
    return GENESIS_SLOT;
  }

  if (blockId === "finalized") {
    return forkChoice.getFinalizedBlock().blockRoot;
  }

  if (blockId === "justified") {
    return forkChoice.getJustifiedBlock().blockRoot;
  }

  if (blockId.startsWith("0x")) {
    if (!rootHexRegex.test(blockId)) {
      throw new ValidationError(`Invalid block id '${blockId}'`, "blockId");
    }
    return blockId;
  }

  // block id must be slot
  const blockSlot = parseInt(blockId, 10);
  if (Number.isNaN(blockSlot) && Number.isNaN(blockSlot - 0)) {
    throw new ValidationError(`Invalid block id '${blockId}'`, "blockId");
  }
  return blockSlot;
}

export async function getBlockResponse(
  chain: IBeaconChain,
  blockId: routes.beacon.BlockId
): Promise<{block: SignedBeaconBlock; executionOptimistic: boolean; finalized: boolean}> {
  const rootOrSlot = resolveBlockId(chain.forkChoice, blockId);

  const res =
    typeof rootOrSlot === "string"
      ? await chain.getBlockByRoot(rootOrSlot)
      : await chain.getCanonicalBlockAtSlot(rootOrSlot);

  if (!res) {
    throw new ApiError(404, `Block not found for id '${blockId}'`);
  }

  return res;
}

/**
 * Resolves when the beacon block `blockRootHex` is imported (seen via the API or gossip) or after
 * `timeoutMs`, whichever comes first. The caller needs to re-check fork choice to tell them apart.
 */
export function waitForBlockImported(chain: IBeaconChain, blockRootHex: RootHex, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const onBlock = (data: routes.events.EventData[routes.events.EventType.block]): void => {
      if (data.block === blockRootHex) {
        finish();
      }
    };

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      chain.emitter.off(routes.events.EventType.block, onBlock);
      resolve();
    };

    timer = setTimeout(finish, timeoutMs);
    chain.emitter.on(routes.events.EventType.block, onBlock);
  });
}
