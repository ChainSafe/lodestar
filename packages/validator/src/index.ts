/**
 * @module validator
 */

export {Validator, ValidatorOptions, defaultDefaultFeeRecipient} from "./validator.js";
export {ValidatorStore, SignerType, Signer, SignerLocal, SignerRemote} from "./services/validatorStore.js";
export {waitForGenesis} from "./genesis.js";
export {getMetrics, Metrics, MetricsRegister} from "./metrics.js";

// Remote signer client
export {
  externalSignerGetKeys,
  externalSignerPostSignature,
  externalSignerUpCheck,
} from "./util/externalSignerClient.js";

export * from "./slashingProtection/index.js";
export * from "./repositories/index.js";
