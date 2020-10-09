import {toJson} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {BeaconChain} from "..";
import {AttestationError, AttestationErrorCode, BlockError, BlockErrorCode} from "../errors";

export async function handleErrorAttestation(this: BeaconChain, err: AttestationError): Promise<void> {
  if (!(err instanceof AttestationError)) {
    this.logger.error("Non AttestationError received:", err);
    return;
  }
  this.logger.debug("Attestation error", toJson(err));
  const attestationRoot = this.config.types.Attestation.hashTreeRoot(err.job.attestation);
  switch (err.type.code) {
    case AttestationErrorCode.ERR_FUTURE_SLOT:
      this.logger.debug("Add attestation to pool", {
        reason: err.type.code,
        attestationRoot: toHexString(attestationRoot),
      });
      this.pendingAttestations.putBySlot(err.type.attestationSlot, err.job);
      break;
    case AttestationErrorCode.ERR_UNKNOWN_TARGET_ROOT:
      this.logger.debug("Add attestation to pool", {
        reason: err.type.code,
        attestationRoot: toHexString(attestationRoot),
      });
      this.pendingAttestations.putByBlock(err.type.root, err.job);
      break;
    case AttestationErrorCode.ERR_UNKNOWN_HEAD_BLOCK:
      this.pendingAttestations.putByBlock(err.type.beaconBlockRoot, err.job);
      break;
    default:
      await this.db.attestation.remove(err.job.attestation);
  }
}

export async function handleErrorBlock(this: BeaconChain, err: BlockError): Promise<void> {
  if (!(err instanceof BlockError)) {
    this.logger.error("Non BlockError received:", err);
    return;
  }
  this.logger.debug("Block error", toJson(err));
  const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(err.job.signedBlock.message);
  switch (err.type.code) {
    case BlockErrorCode.ERR_FUTURE_SLOT:
      this.logger.debug("Add block to pool", {
        reason: err.type.code,
        blockRoot: toHexString(blockRoot),
      });
      this.pendingBlocks.addBySlot(err.job);
      break;
    case BlockErrorCode.ERR_PARENT_UNKNOWN:
      this.logger.debug("Add block to pool", {
        reason: err.type.code,
        blockRoot: toHexString(blockRoot),
      });
      this.pendingBlocks.addByParent(err.job);
      break;
    case BlockErrorCode.ERR_INCORRECT_PROPOSER:
    case BlockErrorCode.ERR_REPEAT_PROPOSAL:
    case BlockErrorCode.ERR_STATE_ROOT_MISMATCH:
    case BlockErrorCode.ERR_PER_BLOCK_PROCESSING_ERROR:
    case BlockErrorCode.ERR_BLOCK_IS_NOT_LATER_THAN_PARENT:
    case BlockErrorCode.ERR_UNKNOWN_PROPOSER:
      await this.db.badBlock.put(blockRoot);
      this.logger.warn("Found bad block", {
        blockRoot: toHexString(blockRoot),
        error: toJson(err),
      });
      break;
  }
}
