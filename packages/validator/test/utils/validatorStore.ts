import {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@lodestar/api";
import {chainConfig} from "@lodestar/config/default";
import {createIBeaconConfig, IChainConfig} from "@lodestar/config";
import {Signer, SignerType, ValidatorStore} from "../../src/index.js";
import {IndicesService} from "../../src/services/indices.js";
import {ValidatorProposerConfig} from "../../src/services/validatorStore.js";
import {testLogger} from "./logger.js";
import {SlashingProtectionMock} from "./slashingProtectionMock.js";

/**
 * Initializes an actual ValidatorStore without stubs
 */
export function initValidatorStore(
  secretKeys: SecretKey[],
  api: Api,
  customChainConfig: IChainConfig = chainConfig,
  valProposerConfig: ValidatorProposerConfig = {defaultConfig: {builder: {}}, proposerConfig: {}}
): ValidatorStore {
  const logger = testLogger();
  const genesisValidatorsRoot = Buffer.alloc(32, 0xdd);

  const signers: Signer[] = secretKeys.map((sk) => ({
    type: SignerType.Local,
    secretKey: sk,
  }));

  const metrics = null;
  const indicesService = new IndicesService(logger, api, metrics);
  return new ValidatorStore(
    createIBeaconConfig(customChainConfig, genesisValidatorsRoot),
    new SlashingProtectionMock(),
    indicesService,
    null,
    metrics,
    signers,
    valProposerConfig,
    genesisValidatorsRoot
  );
}
