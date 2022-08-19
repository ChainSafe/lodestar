import {bellatrix} from "@lodestar/types";
import {PubkeyHex} from "../types.js";
import {pruneSetToMax} from "./map.js";

/** Maximum number of validators that can connect to a single validator process */
const MAX_REGISTRATION_IDS = 1_00_000;
type RegistrationKeyAttributes = {
  pubKey: PubkeyHex;
  feeRecipient: string;
  gasLimit: number;
};

export class ValidatorRegistrationCache {
  private readonly validatorRegistrationMap = new Map<
    string,
    {validatorRegistration: bellatrix.SignedValidatorRegistrationV1; fullKey: string}
  >();

  getKey({pubKey}: Pick<RegistrationKeyAttributes, "pubKey">): string {
    return pubKey;
  }

  getFullKey({pubKey, feeRecipient, gasLimit}: RegistrationKeyAttributes): string {
    return `${pubKey}-${feeRecipient}-${gasLimit}`;
  }

  add(regAttributes: RegistrationKeyAttributes, validatorRegistration: bellatrix.SignedValidatorRegistrationV1): void {
    const key = this.getKey(regAttributes);
    const fullKey = this.getFullKey(regAttributes);
    this.validatorRegistrationMap.set(key, {validatorRegistration, fullKey});
  }

  prune(): void {
    // This is not so optimized function, but could maintain a 2d array may be?
    pruneSetToMax(this.validatorRegistrationMap, MAX_REGISTRATION_IDS);
  }

  get(regAttributes: RegistrationKeyAttributes): bellatrix.SignedValidatorRegistrationV1 | undefined {
    const key = this.getKey(regAttributes);
    const fullKey = this.getFullKey(regAttributes);
    const regData = this.validatorRegistrationMap.get(key);
    return regData?.fullKey === fullKey ? regData.validatorRegistration : undefined;
  }

  has(pubKey: PubkeyHex): boolean {
    const key = this.getKey({pubKey});
    return this.validatorRegistrationMap.get(key) !== undefined;
  }
}
