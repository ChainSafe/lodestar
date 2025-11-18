import {routes} from "@lodestar/api";
import {Epoch} from "@lodestar/types";

const PROPOSER_PRESERVE_EPOCHS = 2;

export type ProposerPreparationData = routes.validator.ProposerPreparationData;

export class BeaconProposerCache {
  private readonly feeRecipientByValidatorIndex: Map<number, {epoch: Epoch; feeRecipient: string}>;
  constructor(readonly opts: {suggestedFeeRecipient: string}) {
    this.feeRecipientByValidatorIndex = new Map();
  }

  add(epoch: Epoch, {validatorIndex, feeRecipient}: ProposerPreparationData): void {
    this.feeRecipientByValidatorIndex.set(validatorIndex, {epoch, feeRecipient});
  }

  prune(epoch: Epoch): void {
    // This is not so optimized function, but could maintain a 2d array may be?
    for (const [validatorIndex, feeRecipientEntry] of this.feeRecipientByValidatorIndex.entries()) {
      // We only retain an entry for PROPOSER_PRESERVE_EPOCHS epochs
      if (feeRecipientEntry.epoch + PROPOSER_PRESERVE_EPOCHS < epoch) {
        this.feeRecipientByValidatorIndex.delete(validatorIndex);
      }
    }
  }

  getOrDefault(proposerIndex: number): string {
    return this.feeRecipientByValidatorIndex.get(proposerIndex)?.feeRecipient ?? this.opts.suggestedFeeRecipient;
  }

  get(proposerIndex: number): string | undefined {
    return this.feeRecipientByValidatorIndex.get(proposerIndex)?.feeRecipient;
  }

  getValidatorIndices(): number[] {
    return Array.from(this.feeRecipientByValidatorIndex.keys());
  }
}
