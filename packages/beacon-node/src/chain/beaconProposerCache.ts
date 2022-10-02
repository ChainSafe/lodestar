import {Epoch} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {MapDef} from "@lodestar/utils";
import {IMetrics} from "../metrics/index.js";

const PROPOSER_PRESERVE_EPOCHS = 2;

export type ProposerPreparationData = routes.validator.ProposerPreparationData;

export class BeaconProposerCache {
  private readonly feeRecipientByValidatorIndex: MapDef<string, {epoch: Epoch; feeRecipient: string}>;
  constructor(opts: {suggestedFeeRecipient: string}, private readonly metrics?: IMetrics | null) {
    this.feeRecipientByValidatorIndex = new MapDef<string, {epoch: Epoch; feeRecipient: string}>(() => ({
      epoch: 0,
      feeRecipient: opts.suggestedFeeRecipient,
    }));
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

  getOrDefault(proposerIndex: number | string): string {
    return this.feeRecipientByValidatorIndex.getOrDefault(`${proposerIndex}`).feeRecipient;
  }

  get(proposerIndex: number | string): string | undefined {
    return this.feeRecipientByValidatorIndex.get(`${proposerIndex}`)?.feeRecipient;
  }
}
