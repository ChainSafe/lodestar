import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {ForkName, ForkPreBellatrix, isForkPostBellatrix} from "@lodestar/params";
import {
  AggregateAndProof,
  BLSSignature,
  BeaconBlock,
  BlindedBeaconBlock,
  Epoch,
  ExecutionPayloadBid,
  Root,
  Slot,
  altair,
  bellatrix,
  gloas,
  heze,
  isBlindedBeaconBlock,
  phase0,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {
  EmptyArgs,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  EmptyRequestCodec,
  JsonOnlyReq,
  JsonOnlyResp,
} from "../utils/codecs.js";
import {getPostBellatrixForkTypes, getPostGloasForkTypes, toForkName} from "../utils/fork.js";
import {Endpoint, RouteDefinitions, Schema} from "../utils/index.js";

/**
 * Remote signing API as implemented by Web3Signer and other remote signers
 *
 * https://github.com/ethereum/remote-signing-api
 */

/** BLS public key, 48 bytes hex encoded with 0x prefix */
export type PubkeyHex = string;

export enum SignableMessageType {
  AGGREGATION_SLOT = "AGGREGATION_SLOT",
  AGGREGATE_AND_PROOF = "AGGREGATE_AND_PROOF",
  AGGREGATE_AND_PROOF_V2 = "AGGREGATE_AND_PROOF_V2",
  ATTESTATION = "ATTESTATION",
  /** @deprecated Use `BLOCK_V2`, only phase0 blocks can be signed with this type */
  BLOCK = "BLOCK",
  BLOCK_V2 = "BLOCK_V2",
  DEPOSIT = "DEPOSIT",
  RANDAO_REVEAL = "RANDAO_REVEAL",
  VOLUNTARY_EXIT = "VOLUNTARY_EXIT",
  SYNC_COMMITTEE_MESSAGE = "SYNC_COMMITTEE_MESSAGE",
  SYNC_COMMITTEE_SELECTION_PROOF = "SYNC_COMMITTEE_SELECTION_PROOF",
  SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF = "SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF",
  VALIDATOR_REGISTRATION = "VALIDATOR_REGISTRATION",
  EXECUTION_PAYLOAD_BID = "EXECUTION_PAYLOAD_BID",
  EXECUTION_PAYLOAD_ENVELOPE = "EXECUTION_PAYLOAD_ENVELOPE",
  PAYLOAD_ATTESTATION_MESSAGE = "PAYLOAD_ATTESTATION_MESSAGE",
  PROPOSER_PREFERENCES = "PROPOSER_PREFERENCES",
  BUILDER_REQUEST_AUTH = "BUILDER_REQUEST_AUTH",
  INCLUSION_LIST = "INCLUSION_LIST",
}

export const AggregationSlotType = new ContainerType({slot: ssz.Slot}, {jsonCase: "eth2"});

export const DepositType = new ContainerType(
  {
    pubkey: ssz.BLSPubkey,
    withdrawalCredentials: ssz.Bytes32,
    amount: ssz.UintNum64,
    genesisForkVersion: ssz.Bytes4,
  },
  {jsonCase: "eth2"}
);

export const RandaoRevealType = new ContainerType({epoch: ssz.Epoch}, {jsonCase: "eth2"});

export const SyncCommitteeMessageType = new ContainerType(
  {
    beaconBlockRoot: ssz.Root,
    slot: ssz.Slot,
  },
  {jsonCase: "eth2"}
);

export type Deposit = ValueOf<typeof DepositType>;
export type SyncCommitteeMessage = ValueOf<typeof SyncCommitteeMessageType>;

/**
 * Pre-bellatrix blocks are sent in full, later forks only send the header as the signing root only depends on it.
 * A post-bellatrix `block` is converted to its header when serializing the request.
 */
export type BlockV2Data = {block: BeaconBlock | BlindedBeaconBlock} | {blockHeader: phase0.BeaconBlockHeader};

export type SignableMessage =
  | {type: SignableMessageType.AGGREGATION_SLOT; data: {slot: Slot}}
  | {type: SignableMessageType.AGGREGATE_AND_PROOF; data: phase0.AggregateAndProof}
  | {type: SignableMessageType.AGGREGATE_AND_PROOF_V2; version: ForkName; data: AggregateAndProof}
  | {type: SignableMessageType.ATTESTATION; data: phase0.AttestationData}
  | {type: SignableMessageType.BLOCK; data: phase0.BeaconBlock}
  | {type: SignableMessageType.BLOCK_V2; version: ForkName; data: BlockV2Data}
  | {type: SignableMessageType.DEPOSIT; data: Deposit}
  | {type: SignableMessageType.RANDAO_REVEAL; data: {epoch: Epoch}}
  | {type: SignableMessageType.VOLUNTARY_EXIT; data: phase0.VoluntaryExit}
  | {type: SignableMessageType.SYNC_COMMITTEE_MESSAGE; data: SyncCommitteeMessage}
  | {type: SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF; data: altair.SyncAggregatorSelectionData}
  | {type: SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF; data: altair.ContributionAndProof}
  | {type: SignableMessageType.VALIDATOR_REGISTRATION; data: bellatrix.ValidatorRegistrationV1}
  | {type: SignableMessageType.EXECUTION_PAYLOAD_BID; version: ForkName; data: ExecutionPayloadBid}
  | {type: SignableMessageType.EXECUTION_PAYLOAD_ENVELOPE; version: ForkName; data: gloas.ExecutionPayloadEnvelope}
  | {type: SignableMessageType.PAYLOAD_ATTESTATION_MESSAGE; version: ForkName; data: gloas.PayloadAttestationData}
  | {type: SignableMessageType.PROPOSER_PREFERENCES; version: ForkName; data: gloas.ProposerPreferences}
  | {type: SignableMessageType.BUILDER_REQUEST_AUTH; version: ForkName; data: gloas.BuilderRequestAuth}
  | {type: SignableMessageType.INCLUSION_LIST; data: heze.InclusionList};

/**
 * Message types whose signing domain depends on the fork at the signing slot. Requests of these types must include
 * `forkInfo`, the remaining types are signed with a domain derived from the genesis fork version only.
 */
export const requiresForkInfo: Record<SignableMessageType, boolean> = {
  [SignableMessageType.AGGREGATION_SLOT]: true,
  [SignableMessageType.AGGREGATE_AND_PROOF]: true,
  [SignableMessageType.AGGREGATE_AND_PROOF_V2]: true,
  [SignableMessageType.ATTESTATION]: true,
  [SignableMessageType.BLOCK]: true,
  [SignableMessageType.BLOCK_V2]: true,
  [SignableMessageType.DEPOSIT]: false,
  [SignableMessageType.RANDAO_REVEAL]: true,
  [SignableMessageType.VOLUNTARY_EXIT]: true,
  [SignableMessageType.SYNC_COMMITTEE_MESSAGE]: true,
  [SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF]: true,
  [SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF]: true,
  [SignableMessageType.VALIDATOR_REGISTRATION]: false,
  [SignableMessageType.EXECUTION_PAYLOAD_BID]: true,
  [SignableMessageType.EXECUTION_PAYLOAD_ENVELOPE]: true,
  [SignableMessageType.PAYLOAD_ATTESTATION_MESSAGE]: true,
  [SignableMessageType.PROPOSER_PREFERENCES]: true,
  [SignableMessageType.BUILDER_REQUEST_AUTH]: false,
  [SignableMessageType.INCLUSION_LIST]: true,
};

export type ForkInfo = {
  fork: phase0.Fork;
  genesisValidatorsRoot: Root;
};

export type SignRequest = {
  pubkey: PubkeyHex;
  /** Signing root computed by the client. If present, the signer must verify it matches the root computed from `message` */
  signingRoot?: Root;
  /** Required for message types with `requiresForkInfo[type] === true` */
  forkInfo?: ForkInfo;
  message: SignableMessage;
};

export type Endpoints = {
  /**
   * Returns `{status: "OK"}` once the signer is ready to serve requests
   */
  upcheck: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    {status: string},
    EmptyMeta
  >;

  /**
   * List the public keys of all secret keys loaded into the signer
   */
  listPublicKeys: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    PubkeyHex[],
    EmptyMeta
  >;

  /**
   * Sign a message with the secret key corresponding to the public key `identifier`
   *
   * Returns 404 if the public key is not known, 412 if the request violates slashing protection rules
   */
  sign: Endpoint<
    "POST",
    SignRequest,
    {params: {identifier: string}; body: unknown},
    {signature: BLSSignature},
    EmptyMeta
  >;
};

export function getDefinitions(): RouteDefinitions<Endpoints> {
  return {
    upcheck: {
      url: "/upcheck",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResp({
        data: {
          toJson: (data) => data,
          fromJson: (data) => {
            const {status} = data as {status?: unknown};
            if (typeof status !== "string") throw Error("status must be a string");
            return {status};
          },
        },
        meta: EmptyMetaCodec,
        transform: {
          toResponse: (data) => data,
          fromResponse: (resp) => ({data: resp as {status: string}}),
        },
      }),
    },
    listPublicKeys: {
      url: "/api/v1/eth2/publicKeys",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResp({
        data: {
          toJson: (data) => data,
          fromJson: (data) => {
            if (!Array.isArray(data) || data.some((pubkey) => typeof pubkey !== "string")) {
              throw Error("public keys must be an array of strings");
            }
            return data as PubkeyHex[];
          },
        },
        meta: EmptyMetaCodec,
        transform: {
          toResponse: (data) => data,
          fromResponse: (resp) => ({data: resp as PubkeyHex[]}),
        },
      }),
    },
    sign: {
      url: "/api/v1/eth2/sign/{identifier}",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({pubkey, signingRoot, forkInfo, message}) => ({
          params: {identifier: pubkey},
          body: {
            type: message.type,
            ...(signingRoot !== undefined && {signingRoot: toRootHex(signingRoot)}),
            ...(forkInfo !== undefined && {fork_info: forkInfoToJson(forkInfo)}),
            ...signableMessageToJson(message),
          },
        }),
        parseReqJson: ({params, body}) => {
          const {signingRoot, fork_info} = body as {signingRoot?: unknown; fork_info?: unknown};
          return {
            pubkey: params.identifier,
            signingRoot: signingRoot !== undefined ? ssz.Root.fromJson(signingRoot) : undefined,
            forkInfo: fork_info !== undefined ? forkInfoFromJson(fork_info) : undefined,
            message: signableMessageFromJson(body),
          };
        },
        schema: {params: {identifier: Schema.StringRequired}, body: Schema.Object},
      }),
      resp: JsonOnlyResp({
        data: {
          toJson: ({signature}) => ({signature: toHex(signature)}),
          fromJson: (data) => ({signature: ssz.BLSSignature.fromJson((data as {signature?: unknown}).signature)}),
        },
        meta: EmptyMetaCodec,
        transform: {
          toResponse: (data) => data,
          fromResponse: (resp) => ({data: resp as {signature: BLSSignature}}),
        },
      }),
    },
  };
}

function forkInfoToJson(forkInfo: ForkInfo): Record<string, unknown> {
  return {
    fork: ssz.phase0.Fork.toJson(forkInfo.fork),
    genesis_validators_root: toRootHex(forkInfo.genesisValidatorsRoot),
  };
}

function forkInfoFromJson(json: unknown): ForkInfo {
  const {fork, genesis_validators_root} = json as {fork?: unknown; genesis_validators_root?: unknown};
  return {
    fork: ssz.phase0.Fork.fromJson(fork),
    genesisValidatorsRoot: ssz.Root.fromJson(genesis_validators_root),
  };
}

/** Remote signers expect fork names capitalized, e.g. `BELLATRIX` */
function toVersionJson(version: ForkName): string {
  return version.toUpperCase();
}

export function signableMessageToJson(message: SignableMessage): Record<string, unknown> {
  switch (message.type) {
    case SignableMessageType.AGGREGATION_SLOT:
      return {aggregation_slot: AggregationSlotType.toJson(message.data)};

    case SignableMessageType.AGGREGATE_AND_PROOF:
      return {aggregate_and_proof: ssz.phase0.AggregateAndProof.toJson(message.data)};

    case SignableMessageType.AGGREGATE_AND_PROOF_V2:
      return {
        aggregate_and_proof: {
          version: toVersionJson(message.version),
          data: sszTypesFor(message.version).AggregateAndProof.toJson(message.data),
        },
      };

    case SignableMessageType.ATTESTATION:
      return {attestation: ssz.phase0.AttestationData.toJson(message.data)};

    case SignableMessageType.BLOCK:
      return {block: ssz.phase0.BeaconBlock.toJson(message.data)};

    case SignableMessageType.BLOCK_V2: {
      const {version, data} = message;
      const beaconBlock =
        "blockHeader" in data
          ? {block_header: ssz.phase0.BeaconBlockHeader.toJson(data.blockHeader)}
          : isForkPostBellatrix(version)
            ? {block_header: ssz.phase0.BeaconBlockHeader.toJson(blockToHeader(version, data.block))}
            : {block: sszTypesFor(version).BeaconBlock.toJson(data.block as BeaconBlock<ForkPreBellatrix>)};
      return {beacon_block: {version: toVersionJson(version), ...beaconBlock}};
    }

    case SignableMessageType.DEPOSIT:
      return {deposit: DepositType.toJson(message.data)};

    case SignableMessageType.RANDAO_REVEAL:
      return {randao_reveal: RandaoRevealType.toJson(message.data)};

    case SignableMessageType.VOLUNTARY_EXIT:
      return {voluntary_exit: ssz.phase0.VoluntaryExit.toJson(message.data)};

    case SignableMessageType.SYNC_COMMITTEE_MESSAGE:
      return {sync_committee_message: SyncCommitteeMessageType.toJson(message.data)};

    case SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF:
      return {sync_aggregator_selection_data: ssz.altair.SyncAggregatorSelectionData.toJson(message.data)};

    case SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF:
      return {contribution_and_proof: ssz.altair.ContributionAndProof.toJson(message.data)};

    case SignableMessageType.VALIDATOR_REGISTRATION:
      return {validator_registration: ssz.bellatrix.ValidatorRegistrationV1.toJson(message.data)};

    case SignableMessageType.EXECUTION_PAYLOAD_BID:
      return {
        execution_payload_bid: {
          version: toVersionJson(message.version),
          data: getPostGloasForkTypes(message.version).ExecutionPayloadBid.toJson(message.data),
        },
      };

    case SignableMessageType.EXECUTION_PAYLOAD_ENVELOPE:
      return {
        execution_payload_envelope: {
          version: toVersionJson(message.version),
          data: getPostGloasForkTypes(message.version).ExecutionPayloadEnvelope.toJson(message.data),
        },
      };

    case SignableMessageType.PAYLOAD_ATTESTATION_MESSAGE:
      return {
        payload_attestation_message: {
          version: toVersionJson(message.version),
          data: getPostGloasForkTypes(message.version).PayloadAttestationData.toJson(message.data),
        },
      };

    case SignableMessageType.PROPOSER_PREFERENCES:
      return {
        proposer_preferences: {
          version: toVersionJson(message.version),
          data: getPostGloasForkTypes(message.version).ProposerPreferences.toJson(message.data),
        },
      };

    case SignableMessageType.BUILDER_REQUEST_AUTH:
      return {
        builder_request_auth: {
          version: toVersionJson(message.version),
          data: getPostGloasForkTypes(message.version).BuilderRequestAuth.toJson(message.data),
        },
      };

    case SignableMessageType.INCLUSION_LIST:
      return {inclusion_list: ssz.heze.InclusionList.toJson(message.data)};
  }
}

export function signableMessageFromJson(json: unknown): SignableMessage {
  const body = json as Record<string, unknown>;
  const type = body.type as SignableMessageType;

  switch (type) {
    case SignableMessageType.AGGREGATION_SLOT:
      return {type, data: AggregationSlotType.fromJson(requireField(body, "aggregation_slot"))};

    case SignableMessageType.AGGREGATE_AND_PROOF:
      return {type, data: ssz.phase0.AggregateAndProof.fromJson(requireField(body, "aggregate_and_proof"))};

    case SignableMessageType.AGGREGATE_AND_PROOF_V2: {
      const {version, data} = versionedFromJson(requireField(body, "aggregate_and_proof"));
      return {type, version, data: sszTypesFor(version).AggregateAndProof.fromJson(data)};
    }

    case SignableMessageType.ATTESTATION:
      return {type, data: ssz.phase0.AttestationData.fromJson(requireField(body, "attestation"))};

    case SignableMessageType.BLOCK:
      return {type, data: ssz.phase0.BeaconBlock.fromJson(requireField(body, "block"))};

    case SignableMessageType.BLOCK_V2: {
      const beaconBlock = requireField(body, "beacon_block") as {
        version?: unknown;
        block?: unknown;
        block_header?: unknown;
      };
      const version = toForkName(String(beaconBlock.version));
      if (beaconBlock.block_header !== undefined) {
        return {type, version, data: {blockHeader: ssz.phase0.BeaconBlockHeader.fromJson(beaconBlock.block_header)}};
      }
      return {
        type,
        version,
        data: {block: sszTypesFor(version).BeaconBlock.fromJson(requireField(beaconBlock, "block"))},
      };
    }

    case SignableMessageType.DEPOSIT:
      return {type, data: DepositType.fromJson(requireField(body, "deposit"))};

    case SignableMessageType.RANDAO_REVEAL:
      return {type, data: RandaoRevealType.fromJson(requireField(body, "randao_reveal"))};

    case SignableMessageType.VOLUNTARY_EXIT:
      return {type, data: ssz.phase0.VoluntaryExit.fromJson(requireField(body, "voluntary_exit"))};

    case SignableMessageType.SYNC_COMMITTEE_MESSAGE:
      return {type, data: SyncCommitteeMessageType.fromJson(requireField(body, "sync_committee_message"))};

    case SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF:
      return {
        type,
        data: ssz.altair.SyncAggregatorSelectionData.fromJson(requireField(body, "sync_aggregator_selection_data")),
      };

    case SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF:
      return {type, data: ssz.altair.ContributionAndProof.fromJson(requireField(body, "contribution_and_proof"))};

    case SignableMessageType.VALIDATOR_REGISTRATION:
      return {
        type,
        data: ssz.bellatrix.ValidatorRegistrationV1.fromJson(requireField(body, "validator_registration")),
      };

    case SignableMessageType.EXECUTION_PAYLOAD_BID: {
      const {version, data} = versionedFromJson(requireField(body, "execution_payload_bid"));
      return {type, version, data: getPostGloasForkTypes(version).ExecutionPayloadBid.fromJson(data)};
    }

    case SignableMessageType.EXECUTION_PAYLOAD_ENVELOPE: {
      const {version, data} = versionedFromJson(requireField(body, "execution_payload_envelope"));
      return {type, version, data: getPostGloasForkTypes(version).ExecutionPayloadEnvelope.fromJson(data)};
    }

    case SignableMessageType.PAYLOAD_ATTESTATION_MESSAGE: {
      const {version, data} = versionedFromJson(requireField(body, "payload_attestation_message"));
      return {type, version, data: getPostGloasForkTypes(version).PayloadAttestationData.fromJson(data)};
    }

    case SignableMessageType.PROPOSER_PREFERENCES: {
      const {version, data} = versionedFromJson(requireField(body, "proposer_preferences"));
      return {type, version, data: getPostGloasForkTypes(version).ProposerPreferences.fromJson(data)};
    }

    case SignableMessageType.BUILDER_REQUEST_AUTH: {
      const {version, data} = versionedFromJson(requireField(body, "builder_request_auth"));
      return {type, version, data: getPostGloasForkTypes(version).BuilderRequestAuth.fromJson(data)};
    }

    case SignableMessageType.INCLUSION_LIST:
      return {type, data: ssz.heze.InclusionList.fromJson(requireField(body, "inclusion_list"))};

    default:
      throw Error(`Unsupported signing request type ${String(type)}`);
  }
}

function blockToHeader(version: ForkName, block: BeaconBlock | BlindedBeaconBlock): phase0.BeaconBlockHeader {
  const bodyRoot = isBlindedBeaconBlock(block)
    ? getPostBellatrixForkTypes(version).BlindedBeaconBlockBody.hashTreeRoot(block.body)
    : sszTypesFor(version).BeaconBlockBody.hashTreeRoot(block.body);

  return {
    slot: block.slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    stateRoot: block.stateRoot,
    bodyRoot,
  };
}

function requireField(obj: object, field: string): unknown {
  const value = (obj as Record<string, unknown>)[field];
  if (value === undefined || value === null) {
    throw Error(`Missing field ${field} in signing request`);
  }
  return value;
}

function versionedFromJson(json: unknown): {version: ForkName; data: unknown} {
  const {version, data} = json as {version?: unknown; data?: unknown};
  return {version: toForkName(String(version)), data: requireField({data}, "data")};
}
