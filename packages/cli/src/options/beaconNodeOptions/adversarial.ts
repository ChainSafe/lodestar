import {defaultOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";

// ADVERSARIAL (devnet test only): malicious ePBS behaviors for the deathstar build, grouped by
// attack topic (adversarial.<topic>.<behavior>). Flags are hidden, default OFF via defaultChainOptions,
// and consumed into the chain options bag by chain.parseArgs. This build must never touch a real network.
export type AdversarialArgs = {
  "adversarial.reorg.buildOnEmpty"?: boolean;
  "adversarial.reorg.omitPtcAttestations"?: boolean;
};

export const options: CliCommandOptions<AdversarialArgs> = {
  "adversarial.reorg.buildOnEmpty": {
    hidden: true,
    type: "boolean",
    description:
      "ADVERSARIAL (devnet test only): always build blocks on the EMPTY parent variant, orphaning the parent execution payload regardless of PTC votes",
    defaultDescription: String(defaultOptions.chain.adversarialReorgBuildOnEmpty),
    group: "adversarial",
  },

  "adversarial.reorg.omitPtcAttestations": {
    hidden: true,
    type: "boolean",
    description:
      "ADVERSARIAL (devnet test only): when building on the EMPTY parent variant (reorging its payload), omit that slot's PTC attestations from the block, so consumers that count on-chain aggregate bits without self-expanding (e.g. Prysm) tally below PTC quorum and follow the reorg",
    defaultDescription: String(defaultOptions.chain.adversarialReorgOmitPtcAttestations),
    group: "adversarial",
  },
};
