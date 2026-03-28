import {PublicKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD} from "@lodestar/params";
import {
  IBeaconStateView,
  createSingleSignatureSetFromComponents,
  getBlockSignatureSets,
  getExecutionPayloadEnvelopeSigningRoot,
} from "@lodestar/state-transition";
import {IndexedAttestation, SignedBeaconBlock, Slot, gloas, isGloasBeaconBlock} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {nextEventLoop} from "../../util/eventLoop.js";
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
  config: BeaconConfig,
  bls: IBlsVerifier,
  logger: Logger,
  metrics: Metrics | null,
  preState0: IBeaconStateView,
  blocks: SignedBeaconBlock[],
  envelopes: Map<Slot, gloas.SignedExecutionPayloadEnvelope> | null,
  indexedAttestationsByBlock: IndexedAttestation[][],
  opts: ImportBlockOpts
): Promise<{verifySignaturesTime: number}> {
  const isValidPromises: Promise<boolean>[] = [];
  const recvToValLatency = Date.now() / 1000 - (opts.seenTimestampSec ?? Date.now() / 1000);
  const currentSyncCommitteeIndexed = preState0.currentSyncCommitteeIndexed;

  // Verifies signatures after running state transition, so all SyncCommittee signed roots are known at this point.
  // We must ensure block.slot <= state.slot before running getAllBlockSignatureSets().
  // NOTE: If in the future multiple blocks signatures are verified at once, all blocks must be in the same epoch
  // so the attester and proposer shufflings are correct.
  for (const [i, block] of blocks.entries()) {
    const blockSignaturesPromise = opts.validSignatures
      ? // Skip all signature verification
        Promise.resolve(true)
      : //
        // Verify signatures per block to track which block is invalid
        bls.verifySignatureSets(
          getBlockSignatureSets(config, currentSyncCommitteeIndexed, preState0, block, indexedAttestationsByBlock[i], {
            skipProposerSignature: opts.validProposerSignature,
          })
        );

    const signedEnvelope = envelopes?.get(block.message.slot) ?? null;
    const envelopeSignaturePromise =
      signedEnvelope && isGloasBeaconBlock(block.message)
        ? verifyExecutionPayloadEnvelopeSignature(config, bls, preState0, block, signedEnvelope)
        : Promise.resolve(true);

    // getBlockSignatureSets() takes 45ms in benchmarks for 2022Q2 mainnet blocks (100 sigs). When syncing a 32 blocks
    // segments it will block the event loop for 1400 ms, which is too much. This call will allow the event loop to
    // yield, which will cause one block's state transition to run. However, the tradeoff is okay and doesn't slow sync
    isValidPromises[i] = Promise.all([blockSignaturesPromise, envelopeSignaturePromise]).then(
      ([blockSigsValid, envelopeSigValid]) => blockSigsValid && envelopeSigValid
    );

    if ((i + 1) % 8 === 0) {
      await nextEventLoop();
    }
  }

  // `rejectFirstInvalidResolveAllValid()` returns on isValid result with its index
  const res = await rejectFirstInvalidResolveAllValid(isValidPromises);
  if (!res.allValid) {
    throw new BlockError(blocks[res.index], {code: BlockErrorCode.INVALID_SIGNATURE, state: preState0});
  }

  const verifySignaturesTime = Date.now();
  if (blocks.length === 1 && opts.seenTimestampSec !== undefined) {
    const recvToValidation = verifySignaturesTime / 1000 - opts.seenTimestampSec;
    const validationTime = recvToValidation - recvToValLatency;

    metrics?.gossipBlock.signatureVerification.recvToValidation.observe(recvToValidation);
    metrics?.gossipBlock.signatureVerification.validationTime.observe(validationTime);

    logger.debug("Verified block signatures", {
      slot: blocks[0].message.slot,
      recvToValLatency,
      recvToValidation,
      validationTime,
    });
  }

  return {verifySignaturesTime};
}

async function verifyExecutionPayloadEnvelopeSignature(
  config: BeaconConfig,
  bls: IBlsVerifier,
  state: IBeaconStateView,
  block: SignedBeaconBlock,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope
): Promise<boolean> {
  const envelope = signedEnvelope.message;
  const pubkey =
    envelope.builderIndex === BUILDER_INDEX_SELF_BUILD
      ? PublicKey.fromBytes(state.getValidator(block.message.proposerIndex).pubkey)
      : PublicKey.fromBytes(state.getBuilder(envelope.builderIndex).pubkey);
  const signatureSet = createSingleSignatureSetFromComponents(
    pubkey,
    getExecutionPayloadEnvelopeSigningRoot(config, envelope),
    signedEnvelope.signature
  );

  return bls.verifySignatureSets([signatureSet]);
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
