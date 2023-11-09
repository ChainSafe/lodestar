export {Validator, type ValidatorOptions} from "./validator.js";
export {ValidatorStore, SignerType, defaultOptions} from "./services/validatorStore.js";
export type {
  Signer,
  SignerLocal,
  SignerRemote,
  ValidatorProposerConfig,
  ProposerConfig,
} from "./services/validatorStore.js";
export {waitForGenesis} from "./genesis.js";
export {getMetrics, type Metrics, type MetricsRegister} from "./metrics.js";

// Remote signer client
export {
  externalSignerGetKeys,
  externalSignerPostSignature,
  externalSignerUpCheck,
} from "./util/externalSignerClient.js";

// Types
export type {ProcessShutdownCallback} from "./types.js";

export * from "./slashingProtection/index.js";
export * from "./repositories/index.js";
