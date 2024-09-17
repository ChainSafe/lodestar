import crypto from "node:crypto";
import {
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
  getRandaoMix,
} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {getDefaultGraffiti} from "../../src/util/graffiti.js";
import {getLodestarClientVersion} from "../../src/util/metadata.js";
import {getDepositsWithProofs} from "../../src/eth1/utils/deposits.js";
import {generateKey, generateSignature, signContainer} from "./utils.js";

export function generateAttestationData(
  state: CachedBeaconStateAllForks,
  committeeIndex: number
): phase0.AttestationData {
  const slot = state.slot;
  const epoch = computeEpochAtSlot(slot);
  return {
    slot,
    index: committeeIndex,
    beaconBlockRoot: getBlockRootAtSlot(state, slot),
    source: {
      epoch: state.currentJustifiedCheckpoint.epoch,
      root: state.currentJustifiedCheckpoint.root,
    },
    target: {
      epoch: epoch,
      root: getBlockRootAtSlot(state, computeStartSlotAtEpoch(epoch)),
    },
  };
}

export function generateAttestation<T extends boolean>(
  state: CachedBeaconStateAllForks,
  committeeIndex: number,
  indexed: T
): T extends true ? phase0.IndexedAttestation : phase0.Attestation {
  const slot = state.slot;
  const attestation = {
    data: generateAttestationData(state, committeeIndex),
    signature: generateSignature(),
  } as unknown as T extends true ? phase0.IndexedAttestation : phase0.Attestation;

  if (indexed) {
    (attestation as phase0.IndexedAttestation).attestingIndices = Array.from(
      state.epochCtx.getBeaconCommittee(slot, committeeIndex)
    );
  } else {
    // TODO: (@matthewkeil) add some mock data here so its not all zeros
    (attestation as phase0.Attestation).aggregationBits = ssz.phase0.CommitteeBits.defaultValue();
  }

  return attestation;
}

export function generateAttestations(state: CachedBeaconStateAllForks): phase0.Attestation[] {
  const epoch = computeEpochAtSlot(state.slot);
  const committeeCount = state.epochCtx.getCommitteeCountPerSlot(epoch);
  const attestations: phase0.Attestation[] = [];
  for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
    attestations.push(
      ...Array.from({length: state.epochCtx.getBeaconCommittee(state.slot, committeeIndex).length}, () =>
        generateAttestation(state, committeeIndex, false)
      )
    );
  }
  return attestations;
}

export function generateIndexedAttestations(
  state: CachedBeaconStateAllForks,
  count: number
): phase0.IndexedAttestation[] {
  const result: phase0.IndexedAttestation[] = [];

  for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
    const slot = state.slot - 1 - epochSlot;
    const epoch = computeEpochAtSlot(slot);
    const committeeCount = state.epochCtx.getCommitteeCountPerSlot(epoch);

    for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
      result.push(generateAttestation(state, committeeIndex, true));
      if (result.length >= count) return result;
    }
  }

  return result;
}

export function generateBeaconBlockHeaders(
  state: CachedBeaconStateAllForks,
  count: number
): phase0.BeaconBlockHeader[] {
  const headers: phase0.BeaconBlockHeader[] = [];

  for (let i = 1; i <= count; i++) {
    const slot = state.slot - i;
    const epoch = computeEpochAtSlot(slot);
    const epochStartSlot = computeStartSlotAtEpoch(epoch);
    const parentRoot = getBlockRootAtSlot(state, slot - 1);
    const stateRoot = getBlockRootAtSlot(state, epochStartSlot);
    const bodyRoot = getBlockRootAtSlot(state, epochStartSlot + 1);
    const header: phase0.BeaconBlockHeader = {
      slot,
      proposerIndex: state.epochCtx.proposers[slot % SLOTS_PER_EPOCH],
      parentRoot,
      stateRoot,
      bodyRoot,
    };

    headers.push(header);
  }
  return headers;
}

export function generateSignedBeaconBlockHeaders(
  state: CachedBeaconStateAllForks,
  count: number
): phase0.SignedBeaconBlockHeader[] {
  return generateBeaconBlockHeaders(state, count).map(signContainer);
}

export function generateVoluntaryExits(
  state: CachedBeaconStateAllForks,
  count: number = MAX_VOLUNTARY_EXITS
): phase0.SignedVoluntaryExit[] {
  const result: phase0.SignedVoluntaryExit[] = [];

  if (count > MAX_VOLUNTARY_EXITS) count = MAX_VOLUNTARY_EXITS;

  for (const validatorIndex of state.epochCtx.proposers) {
    result.push({
      message: {
        epoch: state.currentJustifiedCheckpoint.epoch,
        validatorIndex,
      },
      signature: generateSignature(),
    });

    if (result.length >= count) return result;
  }

  return result;
}

export function generateAttesterSlashings(attestations: phase0.IndexedAttestation[]): phase0.AttesterSlashing[] {
  const slashings: phase0.AttesterSlashing[] = [];
  for (const attestation of attestations) {
    slashings.push({
      attestation1: ssz.phase0.IndexedAttestationBigint.fromJson(ssz.phase0.IndexedAttestation.toJson(attestation)),
      attestation2: ssz.phase0.IndexedAttestationBigint.fromJson(ssz.phase0.IndexedAttestation.toJson(attestation)),
    });

    if (slashings.length >= MAX_ATTESTER_SLASHINGS) {
      return slashings;
    }
  }
  return slashings;
}

export function generateProposerSlashings(blockHeaders: phase0.SignedBeaconBlockHeader[]): phase0.ProposerSlashing[] {
  const slashings: phase0.ProposerSlashing[] = [];
  for (const blockHeader of blockHeaders) {
    const signedHeader2 = ssz.phase0.SignedBeaconBlockHeaderBigint.fromJson(
      ssz.phase0.SignedBeaconBlockHeader.toJson(blockHeader)
    );
    signedHeader2.message.bodyRoot = crypto.randomBytes(32);

    slashings.push({
      signedHeader1: ssz.phase0.SignedBeaconBlockHeaderBigint.fromJson(
        ssz.phase0.SignedBeaconBlockHeader.toJson(blockHeader)
      ),
      signedHeader2,
    });

    if (slashings.length >= MAX_PROPOSER_SLASHINGS) {
      return slashings;
    }
  }
  return slashings;
}

export function generateDepositEvents(count: number = MAX_DEPOSITS): phase0.DepositEvent[] {
  const deposits: phase0.DepositEvent[] = [];
  if (count > MAX_DEPOSITS) count = MAX_DEPOSITS;
  for (let i = 0; i < count; i++) {
    deposits.push({
      blockNumber: 1,
      index: 1,
      depositData: {
        pubkey: generateKey(),
        amount: 32 * 10 ** 9,
        withdrawalCredentials: Buffer.alloc(32, 0x77),
        signature: generateSignature(),
      },
    });
  }
  return deposits;
}

export function generateDeposits(state: CachedBeaconStateAllForks, count: number = MAX_DEPOSITS): phase0.Deposit[] {
  const depositEvents = generateDepositEvents(count);
  // TODO: (@matthewkeil) how do you set the deposit root as root node?
  const depositRootTree = ssz.phase0.DepositDataRootList.toViewDU([state.eth1Data.depositRoot]);
  return getDepositsWithProofs(depositEvents, depositRootTree, state.eth1Data);
}

export interface BlockGenerationOptionsPhase0 {
  numAttesterSlashings?: number;
  numProposerSlashings?: number;
  numVoluntaryExits?: number;
  numDeposits?: number;
}

export function generatePhase0BeaconBlocks(
  state: CachedBeaconStateAllForks,
  count: number,
  opts?: BlockGenerationOptionsPhase0
): phase0.BeaconBlock[] {
  const headers = generateBeaconBlockHeaders(state, count);
  const attesterSlashings: phase0.AttesterSlashing[] = [];
  const proposerSlashings: phase0.ProposerSlashing[] = [];

  if (opts?.numProposerSlashings !== undefined) {
    if (opts.numProposerSlashings > headers.length) {
      opts.numProposerSlashings = headers.length;
    }
    proposerSlashings.push(
      ...generateProposerSlashings(headers.slice(0, opts.numProposerSlashings).map(signContainer))
    );
  }

  if (opts?.numAttesterSlashings !== undefined) {
    const indexedAttestations = generateIndexedAttestations(state, opts.numAttesterSlashings);
    attesterSlashings.push(...generateAttesterSlashings(indexedAttestations));
  }

  const blocks: phase0.BeaconBlock[] = [];
  for (const header of headers) {
    // @ts-expect-error can delete
    delete header.bodyRoot;
    const block: phase0.BeaconBlock = {
      ...header,
      body: {
        eth1Data: {
          blockHash: state.eth1Data.blockHash,
          depositCount: state.eth1Data.depositCount,
          depositRoot: state.eth1Data.depositRoot,
        },
        graffiti: Uint8Array.from(Buffer.from(getDefaultGraffiti(getLodestarClientVersion(), null, {}), "utf8")),
        randaoReveal: getRandaoMix(state, state.epochCtx.epoch),
        attestations: generateAttestations(state),
        attesterSlashings,
        deposits: generateDeposits(state, opts?.numDeposits),
        proposerSlashings,
        voluntaryExits: generateVoluntaryExits(state, opts?.numVoluntaryExits),
      },
    };
    blocks.push(block);
  }
  return blocks;
}
