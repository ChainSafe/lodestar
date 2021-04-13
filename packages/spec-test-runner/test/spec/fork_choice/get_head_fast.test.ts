import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {createCachedBeaconState, phase0, fast} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {
  ANCHOR_STATE_FILE_NAME,
  ANCHOR_BLOCK_FILE_NAME,
  ATTESTATION_FILE_NAME,
  BLOCK_FILE_NAME,
  IForkChoiceTestCase,
  isTick,
  isAttestation,
  isBlock,
  isCheck,
} from "./type";
import {LodestarForkChoice} from "@chainsafe/lodestar/lib/chain/forkChoice/forkChoice";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {ChainEventEmitter} from "@chainsafe/lodestar/lib/chain/emitter";
import {toHexString} from "@chainsafe/ssz";

describeDirectorySpecTest<IForkChoiceTestCase, void>(
  "forkchoice get_head",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/fork_choice/get_head/pyspec_tests"),
  (testcase) => {
    const emitter = new ChainEventEmitter();
    const {steps, anchorState} = testcase;
    const currentSlot = anchorState.slot;
    const tbState = config.getTypes(currentSlot).BeaconState.createTreeBackedFromStruct(anchorState);
    let cachedState = createCachedBeaconState(config, tbState);
    const forkchoice = new LodestarForkChoice({config, emitter, currentSlot, state: cachedState});
    const {SECONDS_PER_SLOT} = cachedState.config.params;
    for (const step of steps) {
      if (isTick(step)) {
        forkchoice.updateTime(Number(step.tick) / SECONDS_PER_SLOT);
      } else if (isAttestation(step)) {
        const attestation = testcase.attestations.get(step.attestation);
        forkchoice.onAttestation(cachedState.epochCtx.getIndexedAttestation(attestation!));
      } else if (isBlock(step)) {
        const signedBlock = testcase.blocks.get(step.block)!;
        expect(signedBlock).not.to.be.undefined;
        try {
          cachedState = fast.fastStateTransition(cachedState, signedBlock, {
            verifyStateRoot: false,
            verifyProposer: false,
            verifySignatures: false,
          });
        } catch (e) {
          // some tests add old blocks, fastStateTransition should throw error but this is fine
        }

        forkchoice.onBlock(signedBlock.message, cachedState);
      } else if (isCheck(step)) {
        const {
          head: expectedHead,
          time: expectedTime,
          justifiedCheckpointRoot,
          finalizedCheckpointRoot,
          bestJustifiedCheckpoint,
        } = step.checks;
        const head = forkchoice.getHead();
        expect(head.slot).to.be.equal(Number(expectedHead.slot));
        expect(toHexString(head.blockRoot)).to.be.equal(expectedHead.root);
        // time in spec mapped to Slot in our forkchoice implementation
        if (expectedTime) expect(forkchoice.getTime() * SECONDS_PER_SLOT).to.be.equal(Number(expectedTime));
        if (justifiedCheckpointRoot)
          expect(toHexString(forkchoice.getJustifiedCheckpoint().root)).to.be.equal(justifiedCheckpointRoot);
        if (finalizedCheckpointRoot)
          expect(toHexString(forkchoice.getFinalizedCheckpoint().root)).to.be.equal(finalizedCheckpointRoot);
        if (bestJustifiedCheckpoint)
          expect(toHexString(forkchoice.getBestJustifiedCheckpoint().root)).to.be.equal(bestJustifiedCheckpoint);
      }
    }
  },
  {
    inputTypes: {
      meta: InputType.YAML,
      steps: InputType.YAML,
    },
    sszTypes: {
      [ANCHOR_STATE_FILE_NAME]: config.types.phase0.BeaconState,
      [ANCHOR_BLOCK_FILE_NAME]: config.types.phase0.BeaconBlock,
      [BLOCK_FILE_NAME]: config.types.phase0.SignedBeaconBlock,
      [ATTESTATION_FILE_NAME]: config.types.phase0.Attestation,
    },
    mapToTestCase: (t: Record<string, any>) => {
      // t has input file name as key
      const blocks = new Map<string, phase0.SignedBeaconBlock>();
      const attestations = new Map<string, phase0.Attestation>();
      for (const key in t) {
        const blockMatch = key.match(BLOCK_FILE_NAME);
        if (blockMatch) {
          blocks.set(key, t[key]);
        }
        const attMatch = key.match(ATTESTATION_FILE_NAME);
        if (attMatch) {
          attestations.set(key, t[key]);
        }
      }
      return {
        meta: t["meta"] as IForkChoiceTestCase["meta"],
        anchorState: t[ANCHOR_STATE_FILE_NAME] as IForkChoiceTestCase["anchorState"],
        anchorBlock: t[ANCHOR_BLOCK_FILE_NAME] as IForkChoiceTestCase["anchorBlock"],
        steps: t["steps"] as IForkChoiceTestCase["steps"],
        blocks,
        attestations,
      };
    },
    timeout: 10000000,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    expectFunc: () => {},
  }
);
