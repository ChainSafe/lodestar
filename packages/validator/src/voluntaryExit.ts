import {SecretKey} from "@chainsafe/bls";
import {
  computeDomain,
  computeEpochAtSlot,
  computeSigningRoot,
  getCurrentSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {Api} from "@chainsafe/lodestar-api";

/**
 * Perform a voluntary exit for the given validator by its key.
 */
export async function signAndSubmitVoluntaryExit(
  publicKey: string,
  exitEpoch: number,
  secretKey: SecretKey,
  api: Api,
  config: IBeaconConfig
): Promise<void> {
  const stateValidatorRes = await api.beacon.getStateValidators("head", {indices: [publicKey]});
  const stateValidator = stateValidatorRes.data[0];

  if (!stateValidator) {
    throw new Error("Validator not found in beacon chain.");
  }

  const {data: fork} = await api.beacon.getStateFork("head");
  if (!fork) {
    throw new Error("VoluntaryExit: Fork not found");
  }

  const genesisRes = await api.beacon.getGenesis();
  const {genesisValidatorsRoot, genesisTime} = genesisRes.data;
  const currentSlot = getCurrentSlot(config, Number(genesisTime));
  const currentEpoch = computeEpochAtSlot(config, currentSlot);

  const voluntaryExit = {
    epoch: exitEpoch || currentEpoch,
    validatorIndex: stateValidator.index,
  };

  const domain = computeDomain(config, config.params.DOMAIN_VOLUNTARY_EXIT, fork.currentVersion, genesisValidatorsRoot);
  const signingRoot = computeSigningRoot(config, config.types.phase0.VoluntaryExit, voluntaryExit, domain);

  const signedVoluntaryExit: phase0.SignedVoluntaryExit = {
    message: voluntaryExit,
    signature: secretKey.sign(signingRoot).toBytes(),
  };

  await api.beacon.submitPoolVoluntaryExit(signedVoluntaryExit);
}
