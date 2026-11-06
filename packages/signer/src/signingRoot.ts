import {ApiError} from "@lodestar/api/server";
import {ForkInfo, SignableMessage, SignableMessageType, requiresForkInfo} from "@lodestar/api/signer";
import {ChainForkConfig} from "@lodestar/config";
import {
  DOMAIN_AGGREGATE_AND_PROOF,
  DOMAIN_APPLICATION_BUILDER,
  DOMAIN_BEACON_ATTESTER,
  DOMAIN_BEACON_BUILDER,
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_BUILDER_REQUEST_AUTH,
  DOMAIN_CONTRIBUTION_AND_PROOF,
  DOMAIN_DEPOSIT,
  DOMAIN_INCLUSION_LIST_COMMITTEE,
  DOMAIN_PROPOSER_PREFERENCES,
  DOMAIN_PTC_ATTESTER,
  DOMAIN_RANDAO,
  DOMAIN_SELECTION_PROOF,
  DOMAIN_SYNC_COMMITTEE,
  DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF,
  DOMAIN_VOLUNTARY_EXIT,
  ForkName,
  ForkPostGloas,
  isForkPostBellatrix,
  isForkPostGloas,
} from "@lodestar/params";
import {ZERO_HASH, computeDomain, computeSigningRoot} from "@lodestar/state-transition";
import {
  BeaconBlock,
  BlindedBeaconBlock,
  DomainType,
  Epoch,
  Root,
  Slot,
  isBlindedBeaconBlock,
  ssz,
  sszTypesFor,
} from "@lodestar/types";

/** Data recorded by slashing protection before a block or attestation signature is produced */
export type SlashingProtectionData =
  | {kind: "block"; slot: Slot}
  | {kind: "attestation"; sourceEpoch: Epoch; targetEpoch: Epoch};

export type SigningRootResult = {
  signingRoot: Root;
  slashingProtection: SlashingProtectionData | null;
};

/**
 * Compute the signing root of a remote signing request from the typed message. The domain of fork dependent
 * messages is derived from the `forkInfo` supplied by the client, matching how the validator client computes it.
 */
export function getSigningRoot(
  config: ChainForkConfig,
  message: SignableMessage,
  forkInfo: ForkInfo | undefined
): SigningRootResult {
  if (requiresForkInfo[message.type] && forkInfo === undefined) {
    throw new ApiError(400, `Signing request of type ${message.type} requires fork_info`);
  }

  const forkDomain = (domainType: DomainType): Uint8Array => {
    if (forkInfo === undefined) {
      throw new ApiError(400, `Signing request of type ${message.type} requires fork_info`);
    }
    return computeDomain(domainType, forkInfo.fork.currentVersion, forkInfo.genesisValidatorsRoot);
  };

  const genesisDomain = (domainType: DomainType): Uint8Array =>
    computeDomain(domainType, config.GENESIS_FORK_VERSION, ZERO_HASH);

  switch (message.type) {
    case SignableMessageType.AGGREGATION_SLOT:
      return {
        signingRoot: computeSigningRoot(ssz.Slot, message.data.slot, forkDomain(DOMAIN_SELECTION_PROOF)),
        slashingProtection: null,
      };

    case SignableMessageType.AGGREGATE_AND_PROOF:
      return {
        signingRoot: computeSigningRoot(
          ssz.phase0.AggregateAndProof,
          message.data,
          forkDomain(DOMAIN_AGGREGATE_AND_PROOF)
        ),
        slashingProtection: null,
      };

    case SignableMessageType.AGGREGATE_AND_PROOF_V2:
      return {
        signingRoot: computeSigningRoot(
          sszTypesFor(message.version).AggregateAndProof,
          message.data,
          forkDomain(DOMAIN_AGGREGATE_AND_PROOF)
        ),
        slashingProtection: null,
      };

    case SignableMessageType.ATTESTATION:
      return {
        signingRoot: computeSigningRoot(ssz.phase0.AttestationData, message.data, forkDomain(DOMAIN_BEACON_ATTESTER)),
        slashingProtection: {
          kind: "attestation",
          sourceEpoch: message.data.source.epoch,
          targetEpoch: message.data.target.epoch,
        },
      };

    case SignableMessageType.BLOCK:
      return {
        signingRoot: computeSigningRoot(ssz.phase0.BeaconBlock, message.data, forkDomain(DOMAIN_BEACON_PROPOSER)),
        slashingProtection: {kind: "block", slot: message.data.slot},
      };

    case SignableMessageType.BLOCK_V2: {
      const {version, data} = message;
      const [blockRoot, slot] =
        "blockHeader" in data
          ? [ssz.phase0.BeaconBlockHeader.hashTreeRoot(data.blockHeader), data.blockHeader.slot]
          : [blockHashTreeRoot(version, data.block), data.block.slot];
      return {
        signingRoot: ssz.phase0.SigningData.hashTreeRoot({
          objectRoot: blockRoot,
          domain: forkDomain(DOMAIN_BEACON_PROPOSER),
        }),
        slashingProtection: {kind: "block", slot},
      };
    }

    case SignableMessageType.DEPOSIT: {
      const {pubkey, withdrawalCredentials, amount, genesisForkVersion} = message.data;
      const domain = computeDomain(DOMAIN_DEPOSIT, genesisForkVersion, ZERO_HASH);
      return {
        signingRoot: computeSigningRoot(ssz.phase0.DepositMessage, {pubkey, withdrawalCredentials, amount}, domain),
        slashingProtection: null,
      };
    }

    case SignableMessageType.RANDAO_REVEAL:
      return {
        signingRoot: computeSigningRoot(ssz.Epoch, message.data.epoch, forkDomain(DOMAIN_RANDAO)),
        slashingProtection: null,
      };

    case SignableMessageType.VOLUNTARY_EXIT:
      return {
        signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, message.data, forkDomain(DOMAIN_VOLUNTARY_EXIT)),
        slashingProtection: null,
      };

    case SignableMessageType.SYNC_COMMITTEE_MESSAGE:
      return {
        signingRoot: computeSigningRoot(ssz.Root, message.data.beaconBlockRoot, forkDomain(DOMAIN_SYNC_COMMITTEE)),
        slashingProtection: null,
      };

    case SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF:
      return {
        signingRoot: computeSigningRoot(
          ssz.altair.SyncAggregatorSelectionData,
          message.data,
          forkDomain(DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF)
        ),
        slashingProtection: null,
      };

    case SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF:
      return {
        signingRoot: computeSigningRoot(
          ssz.altair.ContributionAndProof,
          message.data,
          forkDomain(DOMAIN_CONTRIBUTION_AND_PROOF)
        ),
        slashingProtection: null,
      };

    case SignableMessageType.VALIDATOR_REGISTRATION:
      return {
        signingRoot: computeSigningRoot(
          ssz.bellatrix.ValidatorRegistrationV1,
          message.data,
          genesisDomain(DOMAIN_APPLICATION_BUILDER)
        ),
        slashingProtection: null,
      };

    case SignableMessageType.EXECUTION_PAYLOAD_BID:
      return {
        signingRoot: computeSigningRoot(
          getPostGloasForkTypes(message.version).ExecutionPayloadBid,
          message.data,
          forkDomain(DOMAIN_BEACON_BUILDER)
        ),
        slashingProtection: null,
      };

    case SignableMessageType.EXECUTION_PAYLOAD_ENVELOPE:
      return {
        signingRoot: computeSigningRoot(
          getPostGloasForkTypes(message.version).ExecutionPayloadEnvelope,
          message.data,
          forkDomain(DOMAIN_BEACON_BUILDER)
        ),
        slashingProtection: null,
      };

    case SignableMessageType.PAYLOAD_ATTESTATION_MESSAGE:
      return {
        signingRoot: computeSigningRoot(
          getPostGloasForkTypes(message.version).PayloadAttestationData,
          message.data,
          forkDomain(DOMAIN_PTC_ATTESTER)
        ),
        slashingProtection: null,
      };

    case SignableMessageType.PROPOSER_PREFERENCES:
      return {
        signingRoot: computeSigningRoot(
          getPostGloasForkTypes(message.version).ProposerPreferences,
          message.data,
          forkDomain(DOMAIN_PROPOSER_PREFERENCES)
        ),
        slashingProtection: null,
      };

    case SignableMessageType.BUILDER_REQUEST_AUTH:
      return {
        signingRoot: computeSigningRoot(
          getPostGloasForkTypes(message.version).BuilderRequestAuth,
          message.data,
          genesisDomain(DOMAIN_BUILDER_REQUEST_AUTH)
        ),
        slashingProtection: null,
      };

    case SignableMessageType.INCLUSION_LIST:
      return {
        signingRoot: computeSigningRoot(
          ssz.heze.InclusionList,
          message.data,
          forkDomain(DOMAIN_INCLUSION_LIST_COMMITTEE)
        ),
        slashingProtection: null,
      };
  }
}

function blockHashTreeRoot(version: ForkName, block: BeaconBlock | BlindedBeaconBlock): Root {
  if (isBlindedBeaconBlock(block)) {
    if (!isForkPostBellatrix(version)) {
      throw new ApiError(400, `Blinded block is not valid for version ${version}`);
    }
    return sszTypesFor(version).BlindedBeaconBlock.hashTreeRoot(block);
  }
  return sszTypesFor(version).BeaconBlock.hashTreeRoot(block);
}

function getPostGloasForkTypes(version: ForkName): ReturnType<typeof sszTypesFor<ForkPostGloas>> {
  if (!isForkPostGloas(version)) {
    throw new ApiError(400, `Version ${version} is not valid for this message type, must be gloas or later`);
  }
  return sszTypesFor(version);
}
