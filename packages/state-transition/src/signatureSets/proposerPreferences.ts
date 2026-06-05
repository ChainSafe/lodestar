import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_PROPOSER_PREFERENCES} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.js";

export function getProposerPreferencesSigningRoot(
  config: BeaconConfig,
  preferences: gloas.ProposerPreferences
): Uint8Array {
  const domain = config.getDomain(preferences.proposalSlot, DOMAIN_PROPOSER_PREFERENCES);
  return computeSigningRoot(ssz.gloas.ProposerPreferences, preferences, domain);
}
