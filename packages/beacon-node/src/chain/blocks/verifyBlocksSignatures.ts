import {CachedBeaconStateAllForks, getBlockSignatureSets} from "@lodestar/state-transition";
import {allForks} from "@lodestar/types";
import {Logger, sleep} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {IBlsVerifier} from "../bls/index.js";
import {BlockError, BlockErrorCode} from "../errors/blockError.js";
import {ImportBlockOpts} from "./types.js";

/**
 * Verifies 1 or more block's signatures from a group of blocks in the same epoch.
 * getBlockSignatureSets() guarantees to return the correct signingRoots as long as all blocks belong in the same
 * epoch as `preState0`. Otherwise the shufflings won't be correct.
 *
 * Since all data is known in advance all signatures are verified at once in parallel.
 */
export async function verifyBlocksSignatures(
  bls: IBlsVerifier,
  logger: Logger,
  metrics: Metrics | null,
  preState0: CachedBeaconStateAllForks,
  blocks: allForks.SignedBeaconBlock[],
  opts: ImportBlockOpts
): Promise<void> {
  const isValidPromises: Promise<boolean>[] = [];

  // Verifies signatures after running state transition, so all SyncCommittee signed roots are known at this point.
  // We must ensure block.slot <= state.slot before running getAllBlockSignatureSets().
  // NOTE: If in the future multiple blocks signatures are verified at once, all blocks must be in the same epoch
  // so the attester and proposer shufflings are correct.
  for (const [i, block] of blocks.entries()) {
    // Use [i] to make clear that the index has to be correct to blame the right block below on BlockError()
    isValidPromises[i] = opts.validSignatures
      ? // Skip all signature verification
        Promise.resolve(true)
      : //
        // Verify signatures per block to track which block is invalid
        bls.verifySignatureSets(
          getBlockSignatureSets(preState0, block, {skipProposerSignature: opts.validProposerSignature})
        );

    // getBlockSignatureSets() takes 45ms in benchmarks for 2022Q2 mainnet blocks (100 sigs). When syncing a 32 blocks
    // segments it will block the event loop for 1400 ms, which is too much. This sleep will allow the event loop to
    // yield, which will cause one block's state transition to run. However, the tradeoff is okay and doesn't slow sync
    if ((i + 1) % 8 === 0) {
      await sleep(0);
    }
  }

  if (blocks.length === 1 && opts.seenTimestampSec !== undefined) {
    const recvToSigVer = Date.now() / 1000 - opts.seenTimestampSec;
    metrics?.gossipBlock.receivedToSignaturesVerification.observe(recvToSigVer);
    logger.verbose("Verified block signatures", {slot: blocks[0].message.slot, recvToSigVer});
  }

  // `rejectFirstInvalidResolveAllValid()` returns on isValid result with its index
  const res = await rejectFirstInvalidResolveAllValid(isValidPromises);
  if (!res.allValid) {
    throw new BlockError(blocks[res.index], {code: BlockErrorCode.INVALID_SIGNATURE, state: preState0});
  }
}

type AllValidRes = {allValid: true} | {allValid: false; index: number};

/**
 * From an array of promises that resolve a boolean isValid
 * - if all valid, await all and return
 * - if one invalid, abort immediately and return index of invalid
 */
export function rejectFirstInvalidResolveAllValid(isValidPromises: Promise<boolean>[]): Promise<AllValidRes> {
  return new Promise<AllValidRes>((resolve, reject) => {
    let validCount = 0;

    for (let i = 0; i < isValidPromises.length; i++) {
      isValidPromises[i]
        .then((isValid) => {
          if (isValid) {
            if (++validCount >= isValidPromises.length) {
              resolve({allValid: true});
            }
          } else {
            resolve({allValid: false, index: i});
          }
        })
        .catch((e) => {
          reject(e);
        });
    }
  });
}
