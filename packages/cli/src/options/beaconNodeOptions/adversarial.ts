import {defaultOptions} from "@lodestar/beacon-node";
import {BASIS_POINTS} from "@lodestar/params";
import {CliCommandOptions} from "@lodestar/utils";
import {YargsError} from "../../util/index.js";

const DEFAULT_LAST_SLOT_PROPOSAL_DELAY_BPS = 4_000;

type AdversarialChainDefaults = {
  adversarialReorgDelayLastSlotProposal?: boolean;
  adversarialReorgLastSlotProposalDelayBps?: number;
  adversarialReorgBuildOnParentInLastSlot?: boolean;
};

const chainDefaults = defaultOptions.chain as typeof defaultOptions.chain & AdversarialChainDefaults;

// ADVERSARIAL (devnet test only): malicious ePBS behaviors for the deathstar build, grouped by
// attack topic (adversarial.<topic>.<behavior>). Flags are hidden, default OFF via defaultChainOptions,
// and consumed into the chain options bag by chain.parseArgs. This build must never touch a real network.
export type AdversarialArgs = {
  "adversarial.reorg.buildOnEmpty"?: boolean;
  "adversarial.reorg.omitPtcAttestations"?: boolean;
  "adversarial.reorg.delayLastSlotProposal"?: boolean;
  "adversarial.reorg.lastSlotProposalDelayBps"?: number;
  "adversarial.reorg.buildOnParentInLastSlot"?: boolean;
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

  "adversarial.reorg.delayLastSlotProposal": {
    hidden: true,
    type: "boolean",
    description:
      "ADVERSARIAL (devnet test only): delay the final-slot block proposal until late in the slot so the next proposer can orphan it across the epoch boundary",
    defaultDescription: String(chainDefaults.adversarialReorgDelayLastSlotProposal ?? false),
    group: "adversarial",
  },

  "adversarial.reorg.lastSlotProposalDelayBps": {
    hidden: true,
    type: "number",
    description:
      "ADVERSARIAL (devnet test only): target time within the final slot for a delayed proposal, in basis points of the slot duration",
    defaultDescription: String(
      chainDefaults.adversarialReorgLastSlotProposalDelayBps ?? DEFAULT_LAST_SLOT_PROPOSAL_DELAY_BPS
    ),
    coerce: (value: number): number => {
      if (!Number.isInteger(value) || value < 0 || value >= BASIS_POINTS) {
        throw new YargsError(
          `adversarial.reorg.lastSlotProposalDelayBps must be an integer from 0 to ${BASIS_POINTS - 1}`
        );
      }
      return value;
    },
    group: "adversarial",
  },

  "adversarial.reorg.buildOnParentInLastSlot": {
    hidden: true,
    type: "boolean",
    description:
      "ADVERSARIAL (devnet test only): when proposing the epoch's final slot, build on the current head's parent even when the head is strong",
    defaultDescription: String(chainDefaults.adversarialReorgBuildOnParentInLastSlot ?? false),
    group: "adversarial",
  },
};
