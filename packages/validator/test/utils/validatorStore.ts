import {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@chainsafe/lodestar-api";
import {chainConfig} from "@chainsafe/lodestar-config/default";
import {createIBeaconConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {Signer, SignerType, ValidatorStore} from "../../src/index.js";
import {IndicesService} from "../../src/services/indices.js";
import {testLogger} from "./logger.js";
import {SlashingProtectionMock} from "./slashingProtectionMock.js";

/**
 * Initializes an actual ValidatorStore without stubs
 */
export function initValidatorStore(
  secretKeys: SecretKey[],
  api: Api,
  customChainConfig: IChainConfig = chainConfig
): ValidatorStore {
  const logger = testLogger();
  const genesisValidatorsRoot = Buffer.alloc(32, 0xdd);
  const defaultFeeRecipient = "0x0";
  const defaultGasLimit = 10000;

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
    defaultFeeRecipient,
    defaultGasLimit
  );
}
