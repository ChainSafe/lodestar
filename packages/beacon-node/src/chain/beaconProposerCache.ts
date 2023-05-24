import {Epoch} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {MapDef} from "@lodestar/utils";
import {Metrics} from "../metrics/index.js";

const PROPOSER_PRESERVE_EPOCHS = 2;

export type ProposerPreparationData = routes.validator.ProposerPreparationData;

/** Cache to track the validators registored with beacon node. Could eventually be promoted as a
 * full monitor
 */
export class BeaconProposerCache {
  /** Flag to switch on/off validator stats default set to true */
  readonly validatorMonitor: boolean;
  private readonly feeRecipientByValidatorIndex: MapDef<
    string,
    {epoch: Epoch; feeRecipient: string; sinceEpoch: Epoch}
  >;
  constructor(
    opts: {suggestedFeeRecipient: string; validatorMonitor?: boolean},
    private readonly metrics?: Metrics | null
  ) {
    this.feeRecipientByValidatorIndex = new MapDef<string, {epoch: Epoch; feeRecipient: string; sinceEpoch: Epoch}>(
      () => ({
        epoch: 0,
        feeRecipient: opts.suggestedFeeRecipient,
        sinceEpoch: 0,
      })
    );
    this.validatorMonitor = opts.validatorMonitor ?? true;
  }

  add(epoch: Epoch, {validatorIndex, feeRecipient}: ProposerPreparationData): void {
    const sinceEpoch = this.feeRecipientByValidatorIndex.get(validatorIndex)?.sinceEpoch ?? epoch;
    this.feeRecipientByValidatorIndex.set(validatorIndex, {epoch, feeRecipient, sinceEpoch});
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

  getProposersSinceEpoch(epoch: Epoch): ProposerPreparationData["validatorIndex"][] {
    const proposers = [];
    for (const [validatorIndex, feeRecipientEntry] of this.feeRecipientByValidatorIndex.entries()) {
      if (feeRecipientEntry.sinceEpoch <= epoch) {
        proposers.push(validatorIndex);
      }
    }
    return proposers;
  }
}
