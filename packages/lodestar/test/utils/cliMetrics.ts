import {BeaconNode} from "../../src/node";
import {getTotalActiveBalance, getCurrentEpoch, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {
  getAttestingBalance, 
  getMatchingTargetAttestations
} from "@chainsafe/lodestar-beacon-state-transition/lib/epoch/util";
import {assembleAttesterDuty} from "../../src/chain/factory/duties";
import {BitList} from "@chainsafe/ssz";

// eslint-disable no-console

/**
 * Prints relevant metrics to console on start, every epoch and slot.
 * Returns a stop() function to clear its interval
 * @param node 
 */
export function printBeaconCliMetrics(node: BeaconNode): () => void {
  let firstTime = true;
  let lastEpoch = -1;
  const slotInterval = setInterval(async () => {
    const {state, epochCtx} = await node.chain.getHeadStateContext();
    const config = node.config;
    const currentEpoch = getCurrentEpoch(config, state);
    const currentSlot = getCurrentSlot(config, state.genesisTime);
    const currentSlotIndex = currentSlot % config.params.SLOTS_PER_EPOCH;
    const totalActiveBalance = getTotalActiveBalance(config, state);
    const currentEpochTargetBalance =
      getAttestingBalance(config, state, getMatchingTargetAttestations(config, state, currentEpoch));
    const totalActiveBalanceEth = parseFloat((totalActiveBalance / BigInt(1e9)).toString(10));
    const currentEpochTargetBalanceEth = parseFloat((currentEpochTargetBalance / BigInt(1e9)).toString(10));
    
    // Print summary
    console.log({
      totalActiveBalanceEth,
      currentEpochTargetBalanceEth,
      fraction: currentEpochTargetBalanceEth / totalActiveBalanceEth,
      currentJustifiedEpoch: state.currentJustifiedCheckpoint.epoch,
      finalizedEpoch: state.finalizedCheckpoint.epoch,
    });

    const attestations: {
      proposer: number;
      committee?: number;
      slot: number;
      bitlist: string;
      block: string;
      source: string;
      target: string;
      dupl: number[];
    }[] = [];
    for (const attestation of [...state.currentEpochAttestations, ...state.previousEpochAttestations]) {
      attestations.push({
        proposer: attestation.proposerIndex,
        committee: attestation.data.index,
        slot: attestation.data.slot - currentEpoch * config.params.SLOTS_PER_EPOCH,
        bitlist: bitlistToString(attestation.aggregationBits),
        block: toShortHex(attestation.data.beaconBlockRoot),
        source: `${attestation.data.source.epoch} ${toShortHex(attestation.data.source.root)}`,
        target: `${attestation.data.target.epoch} ${toShortHex(attestation.data.target.root)}`,
        dupl: []
      });
    }
    // Don't print committee if it's all the same
    if (attestations.every(att => att.committee === 0)) attestations.forEach(att => {
      delete att.committee;
    });
    console.log(`Attestations on epoch ${currentEpoch} slot ${currentSlotIndex}`);
    console.table(attestations.sort((a, b) => a.slot - b.slot));
    
    if (firstTime) {
      // How many validators are there?
      const validatorsInfo: any[] = [];
      state.validators.forEach((validator, index) => {
        validatorsInfo.push({
          index,
          balance: gweiToFloat(validator.effectiveBalance)
        });
      });
      console.table(validatorsInfo);
      firstTime = false;
    }

    // Every epoch print
    // - Who is attesting on each slot
    // - Who is proposing on each slot
    if (lastEpoch !== currentEpoch) {
      lastEpoch = currentEpoch;

      const epochDuties: {attesters: number[]; proposer: number}[] = [];
      // Add proposer indexes
      epochCtx.proposers.forEach((proposer, slotIndex) => {
        epochDuties[slotIndex] = {proposer, attesters: []};
      });
      
      // Check attestester duties
      state.validators.forEach((validator, index) => {
        const duties = assembleAttesterDuty(
          config,
          {publicKey: validator.pubkey, index},
          epochCtx,
          currentEpoch
        );
        const slotIndex = duties.attestationSlot % config.params.SLOTS_PER_EPOCH;
        if (!epochDuties[slotIndex]) {
          epochDuties[slotIndex] = {proposer: -1, attesters: []};
        }
        epochDuties[slotIndex].attesters.push(index);          
      });
      console.log(`Duties for epoch ${currentEpoch}`);
      console.table(epochDuties);
    }

  }, node.config.params.SECONDS_PER_SLOT * 1000);

  return function stop() {
    clearInterval(slotInterval);
  };
}

function gweiToFloat(b: bigint): number {
  return parseFloat((b / BigInt(1e9)).toString(10));
}

function toShortHex(arrayBuffer: any): string {
  return Buffer.from(arrayBuffer).toString("hex").slice(0,10);
}

function bitlistToString(bitlist: BitList): string {
  let bits = "";
  bitlist.forEach(bit => {
    bits += bit ? "1" : "0";
  });
  return bits;
}