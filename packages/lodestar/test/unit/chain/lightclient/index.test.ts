import {SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {Proof, ProofType} from "@chainsafe/persistent-merkle-tree";
import {toHexString} from "@chainsafe/ssz";

describe("chain / lightclient", () => {
  const stateProofPaths = [
    // required to initialize a slot clock
    ["genesisTime"],
    // required to verify signatures
    ["genesisValidatorsRoot"],
    // initial sync committee list
    ["currentSyncCommittee"],
    ["nextSyncCommittee"],
  ];

  it("Build partial proofs", () => {
    const state = ssz.altair.BeaconState.defaultTreeBacked();
    state.genesisTime = 0xffffffff;
    state.genesisValidatorsRoot = Buffer.alloc(32, 1);

    const genesisProof = state.createProof([["genesisTime"], ["genesisValidatorsRoot"]]);
    console.log(renderProof(genesisProof));

    for (const stateProofPath of stateProofPaths) {
      console.log(stateProofPath, ssz.altair.BeaconState.getPathGindex(stateProofPath) - BigInt(32));
    }

    const currentSyncCommitteeProof = state.createProof([["currentSyncCommittee"]]);
    console.log(renderProof(currentSyncCommitteeProof));

    // 24 keys in BeaconState, 32 next_pow_of_two, depth 5

    // | field                 | gindex | index |
    // | --------------------- | ------ | ----- |
    // | genesisTime           | 32     | 0     |
    // | genesisValidatorsRoot | 33     | 1     |
    // | currentSyncCommittee  | 54     | 22    |
    // | nextSyncCommittee     | 55     | 23    |

    // 1584
    console.log(SYNC_COMMITTEE_SIZE, ssz.altair.SyncCommittee.minSize());
  });
});

function renderProof(proof: Proof): void {
  if (proof.type === ProofType.treeOffset) {
    console.log(proof.offsets, proof.leaves.map(toHexString));
  }
}
