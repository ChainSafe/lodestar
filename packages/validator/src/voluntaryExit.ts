import {SecretKey} from "@chainsafe/bls";
import {DOMAIN_VOLUNTARY_EXIT} from "@chainsafe/lodestar-params";
import {
  computeDomain,
  computeEpochAtSlot,
  computeSigningRoot,
  getCurrentSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {IApiClient} from "./api";

/**
 * Perform a voluntary exit for the given validator by its key.
 */
export async function signAndSubmitVoluntaryExit(
  publicKey: string,
  exitEpoch: number,
  secretKey: SecretKey,
  apiClient: IApiClient,
  config: IBeaconConfig
): Promise<void> {
  const [stateValidator] = await apiClient.beacon.state.getStateValidators("head", {
    indices: [ssz.BLSPubkey.fromJson(publicKey)],
  });

  if (!stateValidator) {
    throw new Error("Validator not found in beacon chain.");
  }

  const fork = await apiClient.beacon.state.getFork("head");
  if (!fork) {
    throw new Error("VoluntaryExit: Fork not found");
  }

  const genesis = await apiClient.beacon.getGenesis();
  const genesisValidatorsRoot = genesis.genesisValidatorsRoot;
  const currentSlot = getCurrentSlot(config, Number(genesis.genesisTime));
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

  await apiClient.beacon.pool.submitVoluntaryExit(signedVoluntaryExit);
}
