import {BLSPubkey, Epoch, bellatrix} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";

const REGISTRATION_PRESERVE_EPOCHS = 2;

export type ValidatorRegistration = {
  epoch: Epoch;
  /** Preferred gas limit of validator */
  gasLimit: number;
};

export class ValidatorRegistrationCache {
  /**
   * Map to track registrations by validator pubkey which is used here instead of
   * validator index as `bellatrix.ValidatorRegistrationV1` does not contain the index
   * and builder flow in general prefers to use pubkey over index.
   */
  private readonly registrationByValidatorPubkey: Map<string, ValidatorRegistration>;
  constructor() {
    this.registrationByValidatorPubkey = new Map();
  }

  add(epoch: Epoch, {pubkey, gasLimit}: bellatrix.ValidatorRegistrationV1): void {
    this.registrationByValidatorPubkey.set(toPubkeyHex(pubkey), {epoch, gasLimit});
  }

  prune(epoch: Epoch): void {
    for (const [pubkeyHex, registration] of this.registrationByValidatorPubkey.entries()) {
      // We only retain an registrations for REGISTRATION_PRESERVE_EPOCHS epochs
      if (registration.epoch + REGISTRATION_PRESERVE_EPOCHS < epoch) {
        this.registrationByValidatorPubkey.delete(pubkeyHex);
      }
    }
  }

  get(pubkey: BLSPubkey): ValidatorRegistration | undefined {
    return this.registrationByValidatorPubkey.get(toPubkeyHex(pubkey));
  }
}
