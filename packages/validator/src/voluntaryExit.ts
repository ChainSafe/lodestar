import {SecretKey} from "@chainsafe/bls";
import {DOMAIN_VOLUNTARY_EXIT} from "@chainsafe/lodestar-params";
import {
  computeDomain,
  computeEpochAtSlot,
  computeSigningRoot,
  getCurrentSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {Api} from "@chainsafe/lodestar-api";

/**
 * Perform a voluntary exit for the given validator by its key.
 */
export async function signAndSubmitVoluntaryExit(
  publicKey: string,
  exitEpoch: number,
  secretKey: SecretKey,
  api: Api,
  config: IChainForkConfig
): Promise<void> {
  const stateValidatorRes = await api.beacon.getStateValidators("head", {indices: [publicKey]});
  const stateValidator = stateValidatorRes.data[0];

  if (stateValidator === undefined) {
    throw new Error("Validator not found in beacon chain.");
  }

  const {data: fork} = await api.beacon.getStateFork("head");
  if (fork === undefined) {
    throw new Error("VoluntaryExit: Fork not found");
  }

  const genesisRes = await api.beacon.getGenesis();
  const {genesisValidatorsRoot, genesisTime} = genesisRes.data;
  const currentSlot = getCurrentSlot(config, Number(genesisTime));
  const currentEpoch = computeEpochAtSlot(currentSlot);

  const voluntaryExit = {
    epoch: exitEpoch || currentEpoch,
    validatorIndex: stateValidator.index,
  };

  const domain = computeDomain(DOMAIN_VOLUNTARY_EXIT, fork.currentVersion, genesisValidatorsRoot);
  const signingRoot = computeSigningRoot(ssz.phase0.VoluntaryExit, voluntaryExit, domain);

  const signedVoluntaryExit: phase0.SignedVoluntaryExit = {
    message: voluntaryExit,
    signature: secretKey.sign(signingRoot).toBytes(),
  };

  await api.beacon.submitPoolVoluntaryExit(signedVoluntaryExit);
}
