import {BLSPubkey} from "@chainsafe/lodestar-types";
import {isEqualNonZeroRoot} from "../utils.js";
import {InvalidBlockError, InvalidBlockErrorCode} from "./errors.js";
import {BlockBySlotRepository} from "./blockBySlotRepository.js";
import {SlashingProtectionBlock} from "../types.js";
export {BlockBySlotRepository, InvalidBlockError, InvalidBlockErrorCode};

enum SafeStatus {
  SAME_DATA = "SAFE_STATUS_SAME_DATA",
  OK = "SAFE_STATUS_OK",
}

export class SlashingProtectionBlockService {
  private blockBySlot: BlockBySlotRepository;

  constructor(blockBySlot: BlockBySlotRepository) {
    this.blockBySlot = blockBySlot;
  }

  /**
   * Check a block proposal for slash safety, and if it is safe, record it in the database.
   * This is the safe, externally-callable interface for checking block proposals.
   */
  async checkAndInsertBlockProposal(pubkey: BLSPubkey, block: SlashingProtectionBlock): Promise<void> {
    const safeStatus = await this.checkBlockProposal(pubkey, block);

    if (safeStatus != SafeStatus.SAME_DATA) {
      await this.insertBlockProposal(pubkey, block);
    }

    // TODO: Implement safe clean-up of stored blocks
  }

  /**
   * Check a block proposal from `pubKey` for slash safety.
   */
  async checkBlockProposal(pubkey: BLSPubkey, block: SlashingProtectionBlock): Promise<SafeStatus> {
    // Double proposal
    const sameSlotBlock = await this.blockBySlot.get(pubkey, block.slot);
    if (sameSlotBlock && block.slot === sameSlotBlock.slot) {
      // Interchange format allows for blocks without signing_root, then assume root is equal
      if (isEqualNonZeroRoot(sameSlotBlock.signingRoot, block.signingRoot)) {
        return SafeStatus.SAME_DATA;
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
    const minBlock = await this.blockBySlot.getFirst(pubkey);
    if (minBlock && block.slot <= minBlock.slot) {
      throw new InvalidBlockError({
        code: InvalidBlockErrorCode.SLOT_LESS_THAN_LOWER_BOUND,
        slot: block.slot,
        minSlot: minBlock.slot,
      });
    }

    return SafeStatus.OK;
  }

  /**
   * Insert a block proposal into the slashing database
   * This should *only* be called in the same (exclusive) transaction as `checkBlockProposal`
   * so that the check isn't invalidated by a concurrent mutation
   */
  async insertBlockProposal(pubkey: BLSPubkey, block: SlashingProtectionBlock): Promise<void> {
    await this.blockBySlot.set(pubkey, [block]);
  }

  /**
   * Interchange import / export functionality
   */
  async importBlocks(pubkey: BLSPubkey, blocks: SlashingProtectionBlock[]): Promise<void> {
    await this.blockBySlot.set(pubkey, blocks);
  }

  /**
   * Interchange import / export functionality
   */
  async exportBlocks(pubkey: BLSPubkey): Promise<SlashingProtectionBlock[]> {
    return this.blockBySlot.getAll(pubkey);
  }

  async listPubkeys(): Promise<BLSPubkey[]> {
    return await this.blockBySlot.listPubkeys();
  }
}
