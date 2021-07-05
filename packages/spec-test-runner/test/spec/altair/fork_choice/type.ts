import {phase0, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {IBaseSpecTest} from "../../type";

export const ANCHOR_STATE_FILE_NAME = "anchor_state";
export const ANCHOR_BLOCK_FILE_NAME = "anchor_block";
export const BLOCK_FILE_NAME = "^(block)_([0-9a-zA-Z]+)$";
export const ATTESTATION_FILE_NAME = "^(attestation)_([0-9a-zA-Z])+$";

export interface IForkChoiceTestCase extends IBaseSpecTest {
  meta?: {
    description?: string;
    blsSetting: BigInt;
  };
  anchorState: altair.BeaconState;
  anchorBlock: altair.BeaconBlock;
  steps: Step[];
  blocks: Map<string, altair.SignedBeaconBlock>;
  attestations: Map<string, phase0.Attestation>;
}

export function isTick(step: Step): step is IOnTick {
  return (step as IOnTick).tick > 0;
}

export function isAttestation(step: Step): step is IOnAttestation {
  return typeof (step as IOnAttestation).attestation === "string";
}

export function isBlock(step: Step): step is IOnBlock {
  return typeof (step as IOnBlock).block === "string";
}

export function isCheck(step: Step): step is IChecks {
  return typeof (step as IChecks).checks === "object";
}

type Step = IOnTick | IOnAttestation | IOnBlock | IChecks;

interface IOnTick {
  tick: number;
}

interface IOnAttestation {
  attestation: string;
}

interface IOnBlock {
  block: string;
}

interface IChecks {
  checks: {
    head: {slot: number; root: string};
    time?: number;
    justifiedCheckpointRoot?: string;
    finalizedCheckpointRoot?: string;
    bestJustifiedCheckpoint?: string;
  };
}
