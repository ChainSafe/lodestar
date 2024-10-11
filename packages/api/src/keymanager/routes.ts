import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {Epoch, phase0, ssz, stringType} from "@lodestar/types";
import {Schema, Endpoint, RouteDefinitions} from "../utils/index.js";
import {WireFormat} from "../utils/wireFormat.js";
import {
  EmptyArgs,
  EmptyRequestCodec,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  EmptyResponseCodec,
  EmptyResponseData,
  JsonOnlyReq,
  JsonOnlyResponseCodec,
} from "../utils/codecs.js";

export enum ImportStatus {
  /** Keystore successfully decrypted and imported to keymanager permanent storage */
  imported = "imported",
  /** Keystore's pubkey is already known to the keymanager */
  duplicate = "duplicate",
  /** Any other status different to the above: decrypting error, I/O errors, etc. */
  error = "error",
}

export enum DeletionStatus {
  /** key was active and removed */
  deleted = "deleted",
  /** slashing protection data returned but key was not active */
  not_active = "not_active",
  /** key was not found to be removed, and no slashing data can be returned */
  not_found = "not_found",
  /** unexpected condition meant the key could not be removed (the key was actually found, but we couldn't stop using it) - this would be a sign that making it active elsewhere would almost certainly cause you headaches / slashing conditions etc. */
  error = "error",
}

export enum ImportRemoteKeyStatus {
  /** Remote key successfully imported to validator client permanent storage */
  imported = "imported",
  /** Remote key's pubkey is already known to the validator client */
  duplicate = "duplicate",
  /** Any other status different to the above: I/O errors, etc. */
  error = "error",
}

export enum DeleteRemoteKeyStatus {
  /** key was active and removed */
  deleted = "deleted",
  /** key was not found to be removed */
  not_found = "not_found",
  /**
   * unexpected condition meant the key could not be removed (the key was actually found,
   * but we couldn't stop using it) - this would be a sign that making it active elsewhere would
   * almost certainly cause you headaches / slashing conditions etc.
   */
  error = "error",
}

export type ResponseStatus<Status> = {
  status: Status;
  message?: string;
};

export const FeeRecipientDataType = new ContainerType(
  {
    pubkey: stringType,
    ethaddress: stringType,
  },
  {jsonCase: "eth2"}
);
export const GraffitiDataType = new ContainerType(
  {
    pubkey: stringType,
    graffiti: stringType,
  },
  {jsonCase: "eth2"}
);
export const GasLimitDataType = new ContainerType(
  {
    pubkey: stringType,
    gasLimit: ssz.UintNum64,
  },
  {jsonCase: "eth2"}
);
export const BuilderBoostFactorDataType = new ContainerType(
  {
    pubkey: stringType,
    builderBoostFactor: ssz.UintBn64,
  },
  {jsonCase: "eth2"}
);

export type FeeRecipientData = ValueOf<typeof FeeRecipientDataType>;
export type GraffitiData = ValueOf<typeof GraffitiDataType>;
export type GasLimitData = ValueOf<typeof GasLimitDataType>;
export type BuilderBoostFactorData = ValueOf<typeof BuilderBoostFactorDataType>;

export type SignerDefinition = {
  pubkey: PubkeyHex;
  /**
   * URL to API implementing EIP-3030: BLS Remote Signer HTTP API
   * `"https://remote.signer"`
   */
  url: string;
  /** The signer associated with this pubkey cannot be deleted from the API */
  readonly: boolean;
};

export type RemoteSignerDefinition = Pick<SignerDefinition, "pubkey" | "url">;

/**
 * JSON serialized representation of a single keystore in EIP-2335: BLS12-381 Keystore format.
 * ```
 * '{"version":4,"uuid":"9f75a3fa-1e5a-49f9-be3d-f5a19779c6fa","path":"m/12381/3600/0/0/0","pubkey":"0x93247f2209abcacf57b75a51dafae777f9dd38bc7053d1af526f220a7489a6d3a2753e5f3e8b1cfe39b56f43611df74a","crypto":{"kdf":{"function":"pbkdf2","params":{"dklen":32,"c":262144,"prf":"hmac-sha256","salt":"8ff8f22ef522a40f99c6ce07fdcfc1db489d54dfbc6ec35613edf5d836fa1407"},"message":""},"checksum":{"function":"sha256","params":{},"message":"9678a69833d2576e3461dd5fa80f6ac73935ae30d69d07659a709b3cd3eddbe3"},"cipher":{"function":"aes-128-ctr","params":{"iv":"31b69f0ac97261e44141b26aa0da693f"},"message":"e8228bafec4fcbaca3b827e586daad381d53339155b034e5eaae676b715ab05e"}}}'
 * ```
 */
export type KeystoreStr = string;

/**
 * JSON serialized representation of the slash protection data in format defined in EIP-3076: Slashing Protection Interchange Format.
 * ```
 * '{"metadata":{"interchange_format_version":"5","genesis_validators_root":"0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2"},"data":[{"pubkey":"0x93247f2209abcacf57b75a51dafae777f9dd38bc7053d1af526f220a7489a6d3a2753e5f3e8b1cfe39b56f43611df74a","signed_blocks":[],"signed_attestations":[]}]}'
 * ```
 */
export type SlashingProtectionData = string;

/**
 * The validator's BLS public key, uniquely identifying them. _48-bytes, hex encoded with 0x prefix, case insensitive._
 * ```
 * "0x93247f2209abcacf57b75a51dafae777f9dd38bc7053d1af526f220a7489a6d3a2753e5f3e8b1cfe39b56f43611df74a"
 * ```
 */
export type PubkeyHex = string;

/**
 * An address on the execution (Ethereum 1) network.
 * ```
 * "0xAbcF8e0d4e9587369b2301D0790347320302cc09"
 * ```
 */
export type EthAddress = string;

/**
 * Arbitrary data to set in the graffiti field of BeaconBlockBody
 * ```
 * "plain text value"
 * ```
 */
export type Graffiti = string;

export type Endpoints = {
  /**
   * List all validating pubkeys known to and decrypted by this keymanager binary
   *
   * https://github.com/ethereum/keymanager-APIs/blob/0c975dae2ac6053c8245ebdb6a9f27c2f114f407/keymanager-oapi.yaml
   */
  listKeys: Endpoint<
    "GET",
    EmptyArgs,
    EmptyRequest,
    {
      validatingPubkey: PubkeyHex;
      /** The derivation path (if present in the imported keystore) */
      derivationPath?: string;
      /** The key associated with this pubkey cannot be deleted from the API */
      readonly?: boolean;
    }[],
    EmptyMeta
  >;

  /**
   * Import keystores generated by the Eth2.0 deposit CLI tooling. `passwords[i]` must unlock `keystores[i]`.
   *
   * Users SHOULD send slashing_protection data associated with the imported pubkeys. MUST follow the format defined in
   * EIP-3076: Slashing Protection Interchange Format.
   *
   * Returns status result of each `request.keystores` with same length and order of `request.keystores`
   *
   * https://github.com/ethereum/keymanager-APIs/blob/0c975dae2ac6053c8245ebdb6a9f27c2f114f407/keymanager-oapi.yaml
   */
  importKeystores: Endpoint<
    "POST",
    {
      /** JSON-encoded keystore files generated with the Launchpad */
      keystores: KeystoreStr[];
      /** Passwords to unlock imported keystore files. `passwords[i]` must unlock `keystores[i]` */
      passwords: string[];
      /** Slashing protection data for some of the keys of `keystores` */
      slashingProtection?: SlashingProtectionData;
    },
    {body: {keystores: KeystoreStr[]; passwords: string[]; slashing_protection?: SlashingProtectionData}},
    ResponseStatus<ImportStatus>[],
    EmptyMeta
  >;

  /**
   * DELETE must delete all keys from `request.pubkeys` that are known to the keymanager and exist in its
   * persistent storage. Additionally, DELETE must fetch the slashing protection data for the requested keys from
   * persistent storage, which must be retained (and not deleted) after the response has been sent. Therefore in the
   * case of two identical delete requests being made, both will have access to slashing protection data.
   *
   * In a single atomic sequential operation the keymanager must:
   * 1. Guarantee that key(s) can not produce any more signature; only then
   * 2. Delete key(s) and serialize its associated slashing protection data
   *
   * DELETE should never return a 404 response, even if all pubkeys from request.pubkeys have no extant keystores
   * nor slashing protection data.
   *
   * Slashing protection data must only be returned for keys from `request.pubkeys` for which a
   * `deleted` or `not_active` status is returned.
   *
   * Returns deletion status of all keys in `request.pubkeys` in the same order.
   *
   * https://github.com/ethereum/keymanager-APIs/blob/0c975dae2ac6053c8245ebdb6a9f27c2f114f407/keymanager-oapi.yaml
   */
  deleteKeys: Endpoint<
    "DELETE",
    {
      /** List of public keys to delete */
      pubkeys: PubkeyHex[];
    },
    {body: {pubkeys: string[]}},
    {statuses: ResponseStatus<DeletionStatus>[]; slashingProtection: SlashingProtectionData},
    EmptyMeta
  >;

  /**
   * List all remote validating pubkeys known to this validator client binary
   */
  listRemoteKeys: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    SignerDefinition[],
    EmptyMeta
  >;

  /**
   * Import remote keys for the validator client to request duties for
   */
  importRemoteKeys: Endpoint<
    "POST",
    {remoteSigners: RemoteSignerDefinition[]},
    {body: {remote_keys: RemoteSignerDefinition[]}},
    ResponseStatus<ImportRemoteKeyStatus>[],
    EmptyMeta
  >;

  /**
   * DELETE must delete all keys from `request.pubkeys` that are known to the validator client and exist in its
   * persistent storage.
   *
   * DELETE should never return a 404 response, even if all pubkeys from `request.pubkeys` have no existing keystores.
   */
  deleteRemoteKeys: Endpoint<
    "DELETE",
    {pubkeys: PubkeyHex[]},
    {body: {pubkeys: string[]}},
    ResponseStatus<DeleteRemoteKeyStatus>[],
    EmptyMeta
  >;

  listFeeRecipient: Endpoint<
    // ⏎
    "GET",
    {pubkey: PubkeyHex},
    {params: {pubkey: string}},
    FeeRecipientData,
    EmptyMeta
  >;
  setFeeRecipient: Endpoint<
    "POST",
    {pubkey: PubkeyHex; ethaddress: EthAddress},
    {params: {pubkey: string}; body: {ethaddress: string}},
    EmptyResponseData,
    EmptyMeta
  >;
  deleteFeeRecipient: Endpoint<
    // ⏎
    "DELETE",
    {pubkey: PubkeyHex},
    {params: {pubkey: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  getGraffiti: Endpoint<
    // ⏎
    "GET",
    {pubkey: PubkeyHex},
    {params: {pubkey: string}},
    GraffitiData,
    EmptyMeta
  >;
  setGraffiti: Endpoint<
    "POST",
    {pubkey: PubkeyHex; graffiti: Graffiti},
    {params: {pubkey: string}; body: {graffiti: string}},
    EmptyResponseData,
    EmptyMeta
  >;
  deleteGraffiti: Endpoint<
    // ⏎
    "DELETE",
    {pubkey: PubkeyHex},
    {params: {pubkey: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  getGasLimit: Endpoint<
    // ⏎
    "GET",
    {pubkey: PubkeyHex},
    {params: {pubkey: string}},
    GasLimitData,
    EmptyMeta
  >;
  setGasLimit: Endpoint<
    "POST",
    {pubkey: PubkeyHex; gasLimit: number},
    {params: {pubkey: string}; body: {gas_limit: string}},
    EmptyResponseData,
    EmptyMeta
  >;
  deleteGasLimit: Endpoint<
    // ⏎
    "DELETE",
    {pubkey: PubkeyHex},
    {params: {pubkey: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  getBuilderBoostFactor: Endpoint<
    "GET",
    {pubkey: PubkeyHex},
    {params: {pubkey: string}},
    BuilderBoostFactorData,
    EmptyMeta
  >;
  setBuilderBoostFactor: Endpoint<
    "POST",
    {pubkey: PubkeyHex; builderBoostFactor: bigint},
    {params: {pubkey: string}; body: {builder_boost_factor: string}},
    EmptyResponseData,
    EmptyMeta
  >;
  deleteBuilderBoostFactor: Endpoint<
    "DELETE",
    {pubkey: PubkeyHex},
    {params: {pubkey: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Create a signed voluntary exit message for an active validator, identified by a public key known to the validator
   * client. This endpoint returns a `SignedVoluntaryExit` object, which can be used to initiate voluntary exit via the
   * beacon node's [submitPoolVoluntaryExit](https://ethereum.github.io/beacon-APIs/#/Beacon/submitPoolVoluntaryExit) endpoint.
   *
   * Returns the signed voluntary exit message
   *
   * https://github.com/ethereum/keymanager-APIs/blob/7105e749e11dd78032ea275cc09bf62ecd548fca/keymanager-oapi.yaml
   */
  signVoluntaryExit: Endpoint<
    "POST",
    {
      /** Public key of an active validator known to the validator client */
      pubkey: PubkeyHex;
      /** Minimum epoch for processing exit. Defaults to the current epoch if not set */
      epoch?: Epoch;
    },
    {params: {pubkey: string}; query: {epoch?: number}},
    phase0.SignedVoluntaryExit,
    EmptyMeta
  >;
};

export function getDefinitions(_config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    listKeys: {
      url: "/eth/v1/keystores",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    importKeystores: {
      url: "/eth/v1/keystores",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({keystores, passwords, slashingProtection}) => ({
          body: {keystores, passwords, slashing_protection: slashingProtection},
        }),
        parseReqJson: ({body: {keystores, passwords, slashing_protection}}) => ({
          keystores,
          passwords,
          slashingProtection: slashing_protection,
        }),
        schema: {body: Schema.Object},
      }),
      resp: JsonOnlyResponseCodec,
    },
    deleteKeys: {
      url: "/eth/v1/keystores",
      method: "DELETE",
      req: JsonOnlyReq({
        writeReqJson: ({pubkeys}) => ({body: {pubkeys}}),
        parseReqJson: ({body: {pubkeys}}) => ({pubkeys}),
        schema: {body: Schema.Object},
      }),
      resp: {
        onlySupport: WireFormat.json,
        data: JsonOnlyResponseCodec.data,
        meta: EmptyMetaCodec,
        transform: {
          toResponse: (data) => {
            const {statuses, slashing_protection} = data as {
              statuses: ResponseStatus<DeletionStatus>[];
              slashing_protection: SlashingProtectionData;
            };
            return {data: statuses, slashing_protection};
          },
          fromResponse: (resp) => {
            const {data, slashing_protection} = resp as {
              data: ResponseStatus<DeletionStatus>[];
              slashing_protection: SlashingProtectionData;
            };
            return {data: {statuses: data, slashingProtection: slashing_protection}};
          },
        },
      },
    },

    listRemoteKeys: {
      url: "/eth/v1/remotekeys",
      method: "GET",
      req: EmptyRequestCodec,
      resp: JsonOnlyResponseCodec,
    },
    importRemoteKeys: {
      url: "/eth/v1/remotekeys",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({remoteSigners}) => ({body: {remote_keys: remoteSigners}}),
        parseReqJson: ({body: {remote_keys}}) => ({remoteSigners: remote_keys}),
        schema: {body: Schema.Object},
      }),
      resp: JsonOnlyResponseCodec,
    },
    deleteRemoteKeys: {
      url: "/eth/v1/remotekeys",
      method: "DELETE",
      req: JsonOnlyReq({
        writeReqJson: ({pubkeys}) => ({body: {pubkeys}}),
        parseReqJson: ({body: {pubkeys}}) => ({pubkeys}),
        schema: {body: Schema.Object},
      }),
      resp: JsonOnlyResponseCodec,
    },

    listFeeRecipient: {
      url: "/eth/v1/validator/{pubkey}/feerecipient",
      method: "GET",
      req: {
        writeReq: ({pubkey}) => ({params: {pubkey}}),
        parseReq: ({params: {pubkey}}) => ({pubkey}),
        schema: {
          params: {pubkey: Schema.StringRequired},
        },
      },
      resp: {
        onlySupport: WireFormat.json,
        data: FeeRecipientDataType,
        meta: EmptyMetaCodec,
      },
    },
    setFeeRecipient: {
      url: "/eth/v1/validator/{pubkey}/feerecipient",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({pubkey, ethaddress}) => ({params: {pubkey}, body: {ethaddress}}),
        parseReqJson: ({params: {pubkey}, body: {ethaddress}}) => ({pubkey, ethaddress}),
        schema: {
          params: {pubkey: Schema.StringRequired},
          body: Schema.Object,
        },
      }),
      resp: EmptyResponseCodec,
    },
    deleteFeeRecipient: {
      url: "/eth/v1/validator/{pubkey}/feerecipient",
      method: "DELETE",
      req: {
        writeReq: ({pubkey}) => ({params: {pubkey}}),
        parseReq: ({params: {pubkey}}) => ({pubkey}),
        schema: {
          params: {pubkey: Schema.StringRequired},
        },
      },
      resp: EmptyResponseCodec,
    },

    getGraffiti: {
      url: "/eth/v1/validator/{pubkey}/graffiti",
      method: "GET",
      req: {
        writeReq: ({pubkey}) => ({params: {pubkey}}),
        parseReq: ({params: {pubkey}}) => ({pubkey}),
        schema: {
          params: {pubkey: Schema.StringRequired},
        },
      },
      resp: {
        onlySupport: WireFormat.json,
        data: GraffitiDataType,
        meta: EmptyMetaCodec,
      },
    },
    setGraffiti: {
      url: "/eth/v1/validator/{pubkey}/graffiti",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({pubkey, graffiti}) => ({params: {pubkey}, body: {graffiti}}),
        parseReqJson: ({params: {pubkey}, body: {graffiti}}) => ({pubkey, graffiti}),
        schema: {
          params: {pubkey: Schema.StringRequired},
          body: Schema.Object,
        },
      }),
      resp: EmptyResponseCodec,
    },
    deleteGraffiti: {
      url: "/eth/v1/validator/{pubkey}/graffiti",
      method: "DELETE",
      req: {
        writeReq: ({pubkey}) => ({params: {pubkey}}),
        parseReq: ({params: {pubkey}}) => ({pubkey}),
        schema: {
          params: {pubkey: Schema.StringRequired},
        },
      },
      resp: EmptyResponseCodec,
    },

    getGasLimit: {
      url: "/eth/v1/validator/{pubkey}/gas_limit",
      method: "GET",
      req: {
        writeReq: ({pubkey}) => ({params: {pubkey}}),
        parseReq: ({params: {pubkey}}) => ({pubkey}),
        schema: {
          params: {pubkey: Schema.StringRequired},
        },
      },
      resp: {
        onlySupport: WireFormat.json,
        data: GasLimitDataType,
        meta: EmptyMetaCodec,
      },
    },
    setGasLimit: {
      url: "/eth/v1/validator/{pubkey}/gas_limit",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({pubkey, gasLimit}) => ({params: {pubkey}, body: {gas_limit: gasLimit.toString(10)}}),
        parseReqJson: ({params: {pubkey}, body: {gas_limit}}) => ({pubkey, gasLimit: parseGasLimit(gas_limit)}),
        schema: {
          params: {pubkey: Schema.StringRequired},
          body: Schema.Object,
        },
      }),
      resp: EmptyResponseCodec,
    },
    deleteGasLimit: {
      url: "/eth/v1/validator/{pubkey}/gas_limit",
      method: "DELETE",
      req: {
        writeReq: ({pubkey}) => ({params: {pubkey}}),
        parseReq: ({params: {pubkey}}) => ({pubkey}),
        schema: {
          params: {pubkey: Schema.StringRequired},
        },
      },
      resp: EmptyResponseCodec,
    },

    getBuilderBoostFactor: {
      url: "/eth/v1/validator/{pubkey}/builder_boost_factor",
      method: "GET",
      req: {
        writeReq: ({pubkey}) => ({params: {pubkey}}),
        parseReq: ({params: {pubkey}}) => ({pubkey}),
        schema: {
          params: {pubkey: Schema.StringRequired},
        },
      },
      resp: {
        onlySupport: WireFormat.json,
        data: BuilderBoostFactorDataType,
        meta: EmptyMetaCodec,
      },
    },
    setBuilderBoostFactor: {
      url: "/eth/v1/validator/{pubkey}/builder_boost_factor",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({pubkey, builderBoostFactor}) => ({
          params: {pubkey},
          body: {builder_boost_factor: builderBoostFactor.toString(10)},
        }),
        parseReqJson: ({params: {pubkey}, body: {builder_boost_factor}}) => ({
          pubkey,
          builderBoostFactor: BigInt(builder_boost_factor),
        }),
        schema: {
          params: {pubkey: Schema.StringRequired},
          body: Schema.Object,
        },
      }),
      resp: EmptyResponseCodec,
    },
    deleteBuilderBoostFactor: {
      url: "/eth/v1/validator/{pubkey}/builder_boost_factor",
      method: "DELETE",
      req: {
        writeReq: ({pubkey}) => ({params: {pubkey}}),
        parseReq: ({params: {pubkey}}) => ({pubkey}),
        schema: {
          params: {pubkey: Schema.StringRequired},
        },
      },
      resp: EmptyResponseCodec,
    },

    signVoluntaryExit: {
      url: "/eth/v1/validator/{pubkey}/voluntary_exit",
      method: "POST",
      req: {
        writeReq: ({pubkey, epoch}) => ({params: {pubkey}, query: {epoch}}),
        parseReq: ({params: {pubkey}, query: {epoch}}) => ({pubkey, epoch}),
        schema: {
          params: {pubkey: Schema.StringRequired},
          query: {epoch: Schema.Uint},
        },
      },
      resp: {
        data: ssz.phase0.SignedVoluntaryExit,
        meta: EmptyMetaCodec,
      },
    },
  };
}

function parseGasLimit(gasLimitInput: string | number): number {
  if ((typeof gasLimitInput !== "string" && typeof gasLimitInput !== "number") || `${gasLimitInput}`.trim() === "") {
    throw Error("Not valid Gas Limit");
  }
  const gasLimit = Number(gasLimitInput);
  if (Number.isNaN(gasLimit) || gasLimit === 0) {
    throw Error(`Gas Limit is not valid gasLimit=${gasLimit}`);
  }
  return gasLimit;
}
