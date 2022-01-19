/**
 * @module validator
 */

export {Validator, ValidatorOptions} from "./validator";
export {waitForGenesis} from "./genesis";
export {SignerType, Signer, SignerLocal, SignerRemote} from "./services/validatorStore";

// Remote signer client
export {remoteSignerGetKeys, remoteSignerPostSignature, remoteSignerUpCheck} from "./util/remoteSignerClient";

export * from "./slashingProtection";
export * from "./repositories";
