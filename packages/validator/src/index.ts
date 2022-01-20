/**
 * @module validator
 */

export {Validator, ValidatorOptions} from "./validator";
export {waitForGenesis} from "./genesis";
export {SignerType, Signer, SignerLocal, SignerRemote} from "./services/validatorStore";

// Remote signer client
export {externalSignerGetKeys, externalSignerPostSignature, externalSignerUpCheck} from "./util/externalSignerClient";

export * from "./slashingProtection";
export * from "./repositories";
