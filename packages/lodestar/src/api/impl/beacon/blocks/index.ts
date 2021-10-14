import {routes} from "@chainsafe/lodestar-api";
// eslint-disable-next-line no-restricted-imports
import {Api as IBeaconBlocksApi} from "@chainsafe/lodestar-api/lib/routes/beacon/block";
import {computeTimeAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";
import {sleep} from "@chainsafe/lodestar-utils";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {BlockError, BlockErrorCode} from "../../../../chain/errors";
import {OpSource} from "../../../../metrics/validatorMonitor";
import {NetworkEvent} from "../../../../network";
import {ApiModules} from "../../types";
import {resolveBlockId, toBeaconHeaderResponse} from "./utils";

/**
 * Validator clock may be advanced from beacon's clock. If the validator requests a resource in a
 * future slot, wait some time instead of rejecting the request because it's in the future
 */
const MAX_API_CLOCK_DISPARITY_MS = 1000;

export function getBeaconBlockApi({
  chain,
  config,
  metrics,
  network,
  db,
}: Pick<ApiModules, "chain" | "config" | "metrics" | "network" | "db">): IBeaconBlocksApi {
  return {
    async getBlockHeaders(filters) {
      // TODO - SLOW CODE: This code seems like it could be improved

      const result: routes.beacon.BlockHeaderResponse[] = [];
      if (filters.parentRoot) {
        const parentRoot = filters.parentRoot;
        const finalizedBlock = await db.blockArchive.getByParentRoot(fromHexString(parentRoot));
        if (finalizedBlock) {
          result.push(toBeaconHeaderResponse(config, finalizedBlock, true));
        }
        const nonFinalizedBlocks = chain.forkChoice.getBlockSummariesByParentRoot(parentRoot);
        await Promise.all(
          nonFinalizedBlocks.map(async (summary) => {
            const block = await db.block.get(fromHexString(summary.blockRoot));
            if (block) {
              const cannonical = chain.forkChoice.getCanonicalBlockAtSlot(block.message.slot);
              if (cannonical) {
                result.push(toBeaconHeaderResponse(config, block, cannonical.blockRoot === summary.blockRoot));
              }
            }
          })
        );
        return {
          data: result.filter(
            (item) =>
              // skip if no slot filter
              !(filters.slot !== undefined && filters.slot !== 0) || item.header.message.slot === filters.slot
          ),
        };
      }

      const headSlot = chain.forkChoice.getHead().slot;
      if (!filters.parentRoot && filters.slot === undefined) {
        filters.slot = headSlot;
      }

      if (filters.slot !== undefined) {
        // future slot
        if (filters.slot > headSlot) {
          return {data: []};
        }

        const canonicalBlock = await chain.getCanonicalBlockAtSlot(filters.slot);
        // skip slot
        if (!canonicalBlock) {
          return {data: []};
        }
        const canonicalRoot = config
          .getForkTypes(canonicalBlock.message.slot)
          .BeaconBlock.hashTreeRoot(canonicalBlock.message);
        result.push(toBeaconHeaderResponse(config, canonicalBlock, true));

        // fork blocks
        // TODO: What is this logic?
        await Promise.all(
          chain.forkChoice.getBlockSummariesAtSlot(filters.slot).map(async (summary) => {
            if (summary.blockRoot !== toHexString(canonicalRoot)) {
              const block = await db.block.get(fromHexString(summary.blockRoot));
              if (block) {
                result.push(toBeaconHeaderResponse(config, block));
              }
            }
          })
        );
      }

      return {data: result};
    },

    async getBlockHeader(blockId) {
      const block = await resolveBlockId(chain.forkChoice, db, blockId);
      return {data: toBeaconHeaderResponse(config, block, true)};
    },

    async getBlock(blockId) {
      return {data: await resolveBlockId(chain.forkChoice, db, blockId)};
    },

    async getBlockV2(blockId) {
      const block = await resolveBlockId(chain.forkChoice, db, blockId);
      return {data: block, version: config.getForkName(block.message.slot)};
    },

    async getBlockAttestations(blockId) {
      const block = await resolveBlockId(chain.forkChoice, db, blockId);
      return {data: Array.from(block.message.body.attestations)};
    },

    async getBlockRoot(blockId) {
      // Fast path: From head state already available in memory get historical blockRoot
      const slot = typeof blockId === "string" ? parseInt(blockId) : blockId;
      if (!Number.isNaN(slot)) {
        const head = chain.forkChoice.getHead();

        if (slot === head.slot) {
          return {data: fromHexString(head.blockRoot)};
        }

        if (slot < head.slot && head.slot <= slot + SLOTS_PER_HISTORICAL_ROOT) {
          const state = chain.getHeadState();
          return {data: state.blockRoots[slot % SLOTS_PER_HISTORICAL_ROOT]};
        }
      } else if (blockId === "head") {
        const head = chain.forkChoice.getHead();
        return {data: fromHexString(head.blockRoot)};
      }

      // Slow path
      const block = await resolveBlockId(chain.forkChoice, db, blockId);
      return {data: config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)};
    },

    async publishBlock(signedBlock) {
      const seenTimestampSec = Date.now() / 1000;

      // Simple implementation of a pending block queue. Keeping the block here recycles the API logic, and keeps the
      // REST request promise without any extra infrastructure.
      const msToBlockSlot = computeTimeAtSlot(config, signedBlock.message.slot, chain.genesisTime) * 1000 - Date.now();
      if (msToBlockSlot <= MAX_API_CLOCK_DISPARITY_MS && msToBlockSlot > 0) {
        // If block is a bit early, hold it in a promise. Equivalent to a pending queue.
        await sleep(msToBlockSlot);
      }

      // TODO: Validate block

      metrics?.registerBeaconBlock(OpSource.api, seenTimestampSec, signedBlock.message);

      await Promise.all([
        // Send the block, regardless of whether or not it is valid. The API
        // specification is very clear that this is the desired behaviour.
        network.gossip.publishBeaconBlock(signedBlock),

        chain.processBlock(signedBlock).catch((e) => {
          if (e instanceof BlockError && e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
            network.events.emit(NetworkEvent.unknownBlockParent, signedBlock, network.peerId.toB58String());
          }
          throw e;
        }),
      ]);
    },
  };
}
