import {IBaseCase} from "@chainsafe/lodestar-spec-test-util";

export interface IBeaconStateComparisonCase extends IBaseCase {
  pre: any;
  post: any;
}

export interface IOperationsCase extends IBeaconStateComparisonCase {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  bls_setting?: bigint;
}

export interface IAttestationCase extends IOperationsCase {
  attestation: any;
}

export interface IAttesterSlashingCase extends IOperationsCase {
  attesterSlashing: any;
}

export interface IBlockHeaderCase extends IOperationsCase {
  block: any;
}

export interface IDepositCase extends IOperationsCase {
  deposit: any;
}

export interface IProposerSlashingCase extends IOperationsCase {
  proposerSlashing: any;
}

export interface ITransferCase extends IOperationsCase {
  transfer: any;
}

export interface IVoluntaryExitCase extends IOperationsCase {
  voluntaryExit: any;
}

export interface IBlockSanityCase extends IOperationsCase {
  blocks: any[];
}

export interface ISlotSanityCase extends IOperationsCase {
  slots: bigint;
}
