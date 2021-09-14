import {routes} from "@chainsafe/lodestar-api";
// eslint-disable-next-line no-restricted-imports
import {Api as IBeaconBlocksApi} from "@chainsafe/lodestar-api/lib/routes/beacon/block";
import {SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {OpSource} from "../../../../metrics/validatorMonitor";
import {ApiModules} from "../../types";
import {resolveBlockId, toBeaconHeaderResponse} from "./utils";

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
              !(filters.slot && filters.slot !== 0) || item.header.message.slot === filters.slot
          ),
        };
      }

      const headSlot = chain.forkChoice.getHead().slot;
      if (!filters.parentRoot && !filters.slot && filters.slot !== 0) {
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
      }

      // Slow path
      const block = await resolveBlockId(chain.forkChoice, db, blockId);
      return {data: config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)};
    },

    async publishBlock(signedBlock) {
      const seenTimestampSec = Date.now() / 1000;

      // TODO: Validate block

      metrics?.registerBeaconBlock(OpSource.api, seenTimestampSec, signedBlock.message);

      await Promise.all([chain.receiveBlock(signedBlock), network.gossip.publishBeaconBlock(signedBlock)]);
    },
  };
}
