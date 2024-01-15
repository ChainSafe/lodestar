export {Validator, type ValidatorOptions} from "./validator.js";
export {ValidatorStore, SignerType, defaultOptions, MAX_BUILDER_BOOST_FACTOR} from "./services/validatorStore.js";
export type {
  Signer,
  SignerLocal,
  SignerRemote,
  ValidatorProposerConfig,
  ProposerConfig,
} from "./services/validatorStore.js";
export {waitForGenesis} from "./genesis.js";
export {getMetrics, type Metrics} from "./metrics.js";

// Remote signer client
export {
  externalSignerGetKeys,
  externalSignerPostSignature,
  externalSignerUpCheck,
  SignableMessageType,
} from "./util/externalSignerClient.js";

// Types
export type {ProcessShutdownCallback} from "./types.js";

export * from "./slashingProtection/index.js";
export * from "./repositories/index.js";
