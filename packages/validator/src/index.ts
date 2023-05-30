export {Validator, ValidatorOptions} from "./validator.js";
export {
  ValidatorStore,
  SignerType,
  Signer,
  SignerLocal,
  SignerRemote,
  ValidatorProposerConfig,
  defaultOptions,
  ProposerConfig,
  BuilderSelection,
} from "./services/validator_store.js";
export {waitForGenesis} from "./genesis.js";
export {getMetrics, Metrics, MetricsRegister} from "./metrics.js";
// For CLI to read genesisValidatorsRoot
export {MetaDataRepository} from "./repositories/index.js";

// Remote signer client
export {
  externalSignerGetKeys,
  externalSignerPostSignature,
  externalSignerUpCheck,
} from "./util/external_signer_client.js";

// Types
export {ProcessShutdownCallback} from "./types.js";

export * from "./slashing_protection/index.js";
export * from "./repositories/index.js";
