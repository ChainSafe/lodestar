import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {UintNum64, ValidatorIndex} from "../sszTypes.js";
import {ArrayOf} from "./array.js";

export const BlockRewardsType = new ContainerType(
  {
    /** Proposer of the block, the proposer index who receives these rewards */
    proposerIndex: ValidatorIndex,
    /** Total block reward, equal to attestations + sync_aggregate + proposer_slashings + attester_slashings */
    total: UintNum64,
    /** Block reward component due to included attestations */
    attestations: UintNum64,
    /** Block reward component due to included sync_aggregate */
    syncAggregate: UintNum64,
    /** Block reward component due to included proposer_slashings */
    proposerSlashings: UintNum64,
    /** Block reward component due to included attester_slashings */
    attesterSlashings: UintNum64,
  },
  {jsonCase: "eth2"}
);

export const AttestationsRewardType = new ContainerType(
  {
    /** Reward for head vote. Could be negative to indicate penalty */
    head: UintNum64,
    /** Reward for target vote. Could be negative to indicate penalty */
    target: UintNum64,
    /** Reward for source vote. Could be negative to indicate penalty */
    source: UintNum64,
    /** Inclusion delay reward (phase0 only) */
    inclusionDelay: UintNum64,
    /** Inactivity penalty. Should be a negative number to indicate penalty */
    inactivity: UintNum64,
  },
  {jsonCase: "eth2"}
);

export const IdealAttestationsRewardsType = new ContainerType(
  {
    ...AttestationsRewardType.fields,
    effectiveBalance: UintNum64,
  },
  {jsonCase: "eth2"}
);

export const TotalAttestationsRewardsType = new ContainerType(
  {
    ...AttestationsRewardType.fields,
    validatorIndex: ValidatorIndex,
  },
  {jsonCase: "eth2"}
);

export const AttestationsRewardsType = new ContainerType(
  {
    idealRewards: ArrayOf(IdealAttestationsRewardsType),
    totalRewards: ArrayOf(TotalAttestationsRewardsType),
  },
  {jsonCase: "eth2"}
);

export const SyncCommitteeRewardsType = ArrayOf(
  new ContainerType(
    {
      validatorIndex: ValidatorIndex,
      reward: UintNum64,
    },
    {jsonCase: "eth2"}
  )
);

/**
 * Rewards info for a single block. Every reward value is in Gwei.
 */
export type BlockRewards = ValueOf<typeof BlockRewardsType>;

/**
 * Rewards for a single set of (ideal or actual depending on usage) attestations. Reward value is in Gwei
 */
export type AttestationsReward = ValueOf<typeof AttestationsRewardType>;

/**
 * Rewards info for ideal attestations ie. Maximum rewards could be earned by making timely head, target and source vote.
 * `effectiveBalance` is in Gwei
 */
export type IdealAttestationsReward = ValueOf<typeof IdealAttestationsRewardsType>;

/**
 * Rewards info for actual attestations
 */
export type TotalAttestationsReward = ValueOf<typeof TotalAttestationsRewardsType>;

export type AttestationsRewards = ValueOf<typeof AttestationsRewardsType>;

/**
 * Rewards info for sync committee participation. Every reward value is in Gwei.
 * Note: In the case that block proposer is present in `SyncCommitteeRewards`, the reward value only reflects rewards for
 * participating in sync committee. Please refer to `BlockRewards.syncAggregate` for rewards of proposer including sync committee
 * outputs into their block
 */
export type SyncCommitteeRewards = ValueOf<typeof SyncCommitteeRewardsType>;
