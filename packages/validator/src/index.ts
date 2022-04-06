/**
 * @module validator
 */

export {Validator, ValidatorOptions} from "./validator.js";
export {ValidatorStore, SignerType, Signer, SignerLocal, SignerRemote} from "./services/validatorStore.js";
export {waitForGenesis} from "./genesis.js";

// Remote signer client
export {
  externalSignerGetKeys,
  externalSignerPostSignature,
  externalSignerUpCheck,
} from "./util/externalSignerClient.js";

export * from "./slashingProtection/index.js";
export * from "./repositories/index.js";
