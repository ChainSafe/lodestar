import assert from "assert";

const ETH1_FOLLOW_DISTANCE = 2**10; //1024 blocks ~4 hours 

// The validator constructs their withdrawal_credentials via the following:

// Set withdrawal_credentials[:1] == BLS_WITHDRAWAL_PREFIX_BYTE.
// Set withdrawal_credentials[1:] == hash(withdrawal_pubkey)[1:].

class Validator {
  constructor(publicKey, withdrawalKey) {
    this.publicKey = publicKey;
    this.withdrawalKey = withdrawalKey;
  }

  function start(): void {
    
  }

  function 

}

function getCommitteeAssignment(state: BeaconState, epoch: Epoch, validatorIndex: ValidatorIndex, registryChange: Boolean = false) {
  const previousEpoch = getPreviousEpoch(state);
  const nextEpoch = getCurrentEpoch(state) + 1;
  const assert(previousEpoch <= epoch && epoch <= nextEpoch);

  const epochStartSlot: number = getEpochStartSlot(epoch);
  const loopEnd: number = epochStartSlot + SLOTS_PER_EPOCH;
  for (let i: number = epochStartSlot; i < loopEnd; i++) {
    const crosslinkCommittees = getCrosslinkCommitteesAtSlot(state, slot, registryChange);
    const selectedCommittees = crosslinkCommittees.map((x: committee) => {
      if (committee[0].contains(validatorIndex)) {
        return committee;
      }
    }  
  }
  if (selectedCommittees.length > 0) {
    const validators = selectedCommittees[0][0];
    const shard = selectedCommittees[0][1];
    const isPropose = validatorIndex === getBeaconProposerIndex(state, slot, registryChange);
    return {validators, shard, slot, isProposer}
  }
}
