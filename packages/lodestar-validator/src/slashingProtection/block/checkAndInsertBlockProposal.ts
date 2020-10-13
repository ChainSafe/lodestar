import {BLSPubkey, SlashingProtectionBlock} from "@chainsafe/lodestar-types";
import {SlashingProtectionBlockRepository} from "./dbRepository";
import {isEqualRoot, isZeroRoot} from "../utils";
import {InvalidBlockError, InvalidBlockErrorCode} from "./errors";

/**
 * Check a block proposal for slash safety, and if it is safe, record it in the database
 */
export async function checkAndInsertBlockProposal(
  pubkey: BLSPubkey,
  block: SlashingProtectionBlock,
  signedBlockDb: SlashingProtectionBlockRepository
): Promise<void> {
  // Double proposal
  const sameSlotBlock = await signedBlockDb.getByPubkeyAndSlot(pubkey, block.slot);
  if (sameSlotBlock && block.slot === sameSlotBlock.slot) {
    // Interchange format allows for blocks without signing_root, then assume root is equal
    if (!isZeroRoot(sameSlotBlock.signingRoot) && isEqualRoot(block.signingRoot, sameSlotBlock.signingRoot)) {
      return; // Ok, same data
    } else {
      throw new InvalidBlockError({
        code: InvalidBlockErrorCode.DOUBLE_BLOCK_PROPOSAL,
        block,
        block2: sameSlotBlock,
      });
    }
  }

  // Refuse to sign any block with slot <= min(b.slot for b in data.signed_blocks if b.pubkey == proposer_pubkey),
  // except if it is a repeat signing as determined by the signing_root.
  // (spec v4, Slashing Protection Database Interchange Format)
  const minBlock = await signedBlockDb.getFirstByPubkey(pubkey);
  if (minBlock && block.slot <= minBlock.slot) {
    throw new InvalidBlockError({
      code: InvalidBlockErrorCode.SLOT_LESS_THAN_LOWER_BOUND,
      slot: block.slot,
      minSlot: minBlock.slot,
    });
  }

  // Attestation is safe, add to DB
  await signedBlockDb.setByPubkey(pubkey, [block]);

  // TODO: Implement safe clean-up of stored blocks
}
