import {Keystore} from "@chainsafe/bls-keystore";
import {SecretKey} from "@chainsafe/blst";
import {
  DeleteRemoteKeyStatus,
  DeletionStatus,
  ImportStatus,
  ResponseStatus,
  KeystoreStr,
  PubkeyHex,
  SlashingProtectionData,
  SignerDefinition,
  RemoteSignerDefinition,
  ImportRemoteKeyStatus,
  FeeRecipientData,
  GraffitiData,
  GasLimitData,
  BuilderBoostFactorData,
} from "@lodestar/api/keymanager";
import {KeymanagerApiMethods as Api} from "@lodestar/api/keymanager/server";
import {Interchange, SignerType, Validator} from "@lodestar/validator";
import {ApiError} from "@lodestar/api/server";
import {Epoch} from "@lodestar/types";
import {fromHex, isValidHttpUrl} from "@lodestar/utils";
import {getPubkeyHexFromKeystore, isValidatePubkeyHex} from "../../../util/format.js";
import {parseFeeRecipient} from "../../../util/index.js";
import {DecryptKeystoresThreadPool} from "./decryptKeystores/index.js";
import {IPersistedKeysBackend} from "./interface.js";

export class KeymanagerApi implements Api {
  constructor(
    private readonly validator: Validator,
    private readonly persistedKeysBackend: IPersistedKeysBackend,
    private readonly signal: AbortSignal,
    private readonly proposerConfigWriteDisabled?: boolean
  ) {}

  private checkIfProposerWriteEnabled(): void {
    if (this.proposerConfigWriteDisabled === true) {
      throw Error("proposerSettingsFile option activated");
    }
  }

  async listFeeRecipient({pubkey}: {pubkey: PubkeyHex}): ReturnType<Api["listFeeRecipient"]> {
    return {data: {pubkey, ethaddress: this.validator.validatorStore.getFeeRecipient(pubkey)}};
  }

  async setFeeRecipient({pubkey, ethaddress}: FeeRecipientData): ReturnType<Api["setFeeRecipient"]> {
    this.checkIfProposerWriteEnabled();
    this.validator.validatorStore.setFeeRecipient(pubkey, parseFeeRecipient(ethaddress));
    this.persistedKeysBackend.writeProposerConfig(pubkey, this.validator.validatorStore.getProposerConfig(pubkey));
    return {status: 202};
  }

  async deleteFeeRecipient({pubkey}: {pubkey: PubkeyHex}): ReturnType<Api["deleteFeeRecipient"]> {
    this.checkIfProposerWriteEnabled();
    this.validator.validatorStore.deleteFeeRecipient(pubkey);
    this.persistedKeysBackend.writeProposerConfig(pubkey, this.validator.validatorStore.getProposerConfig(pubkey));
    return {status: 204};
  }

  async getGraffiti({pubkey}: {pubkey: PubkeyHex}): ReturnType<Api["getGraffiti"]> {
    const graffiti = this.validator.validatorStore.getGraffiti(pubkey);
    if (graffiti === undefined) {
      throw new ApiError(404, `No graffiti for pubkey ${pubkey}`);
    }
    return {data: {pubkey, graffiti}};
  }

  async setGraffiti({pubkey, graffiti}: GraffitiData): ReturnType<Api["setGraffiti"]> {
    this.checkIfProposerWriteEnabled();
    this.validator.validatorStore.setGraffiti(pubkey, graffiti);
    this.persistedKeysBackend.writeProposerConfig(pubkey, this.validator.validatorStore.getProposerConfig(pubkey));
    return {status: 202};
  }

  async deleteGraffiti({pubkey}: {pubkey: PubkeyHex}): ReturnType<Api["deleteGraffiti"]> {
    this.checkIfProposerWriteEnabled();
    this.validator.validatorStore.deleteGraffiti(pubkey);
    this.persistedKeysBackend.writeProposerConfig(pubkey, this.validator.validatorStore.getProposerConfig(pubkey));
    return {status: 204};
  }

  async getGasLimit({pubkey}: {pubkey: PubkeyHex}): ReturnType<Api["getGasLimit"]> {
    const gasLimit = this.validator.validatorStore.getGasLimit(pubkey);
    return {data: {pubkey, gasLimit}};
  }

  async setGasLimit({pubkey, gasLimit}: GasLimitData): ReturnType<Api["setGasLimit"]> {
    this.checkIfProposerWriteEnabled();
    this.validator.validatorStore.setGasLimit(pubkey, gasLimit);
    this.persistedKeysBackend.writeProposerConfig(pubkey, this.validator.validatorStore.getProposerConfig(pubkey));
    return {status: 202};
  }

  async deleteGasLimit({pubkey}: {pubkey: PubkeyHex}): ReturnType<Api["deleteGasLimit"]> {
    this.checkIfProposerWriteEnabled();
    this.validator.validatorStore.deleteGasLimit(pubkey);
    this.persistedKeysBackend.writeProposerConfig(pubkey, this.validator.validatorStore.getProposerConfig(pubkey));
    return {status: 204};
  }

  async listKeys(): ReturnType<Api["listKeys"]> {
    const pubkeys = this.validator.validatorStore.votingPubkeys();
    return {
      data: pubkeys.map((pubkey) => ({
        validatingPubkey: pubkey,
        derivationPath: "",
        readonly: this.validator.validatorStore.getSigner(pubkey)?.type !== SignerType.Local,
      })),
    };
  }

  async importKeystores({
    keystores,
    passwords,
    slashingProtection,
  }: {
    keystores: KeystoreStr[];
    passwords: string[];
    slashingProtection?: SlashingProtectionData;
  }): ReturnType<Api["importKeystores"]> {
    if (slashingProtection) {
      // The arguments to this function is passed in within the body of an HTTP request
      // hence fastify will parse it into an object before this function is called.
      // Even though the slashingProtection is typed as SlashingProtectionData,
      // at runtime, when the handler for the request is selected, it would see slashingProtection
      // as an object, hence trying to parse it using JSON.parse won't work. Instead, we cast straight to Interchange
      const interchange = ensureJSON<Interchange>(slashingProtection);
      await this.validator.importInterchange(interchange);
    }

    const statuses: {status: ImportStatus; message?: string}[] = [];
    const decryptKeystores = new DecryptKeystoresThreadPool(keystores.length, this.signal);

    for (let i = 0; i < keystores.length; i++) {
      try {
        const keystoreStr = keystores[i];
        const password = passwords[i];
        if (password === undefined) {
          throw new ApiError(400, `No password for keystores[${i}]`);
        }

        const keystore = Keystore.parse(keystoreStr);
        const pubkeyHex = getPubkeyHexFromKeystore(keystore);

        // Check for duplicates and skip keystore before decrypting
        if (this.validator.validatorStore.hasVotingPubkey(pubkeyHex)) {
          statuses[i] = {status: ImportStatus.duplicate};
          continue;
        }

        decryptKeystores.queue(
          {keystoreStr, password},
          async (secretKeyBytes: Uint8Array) => {
            const secretKey = SecretKey.fromBytes(secretKeyBytes);

            // Persist the key to disk for restarts, before adding to in-memory store
            // If the keystore exist and has a lock it will throw
            this.persistedKeysBackend.writeKeystore({
              keystoreStr,
              password,
              // Lock immediately since it's gonna be used
              lockBeforeWrite: true,
              // Always write, even if it's already persisted for consistency.
              // The in-memory validatorStore is the ground truth to decide duplicates
              persistIfDuplicate: true,
            });

            // Add to in-memory store to start validating immediately
            await this.validator.validatorStore.addSigner({type: SignerType.Local, secretKey});

            statuses[i] = {status: ImportStatus.imported};
          },
          (e: Error) => {
            statuses[i] = {status: ImportStatus.error, message: e.message};
          }
        );
      } catch (e) {
        statuses[i] = {status: ImportStatus.error, message: (e as Error).message};
      }
    }

    await decryptKeystores.completed();

    return {data: statuses};
  }

  async deleteKeys({pubkeys}: {pubkeys: PubkeyHex[]}): ReturnType<Api["deleteKeys"]> {
    const deletedKey: boolean[] = [];
    const statuses = new Array<{status: DeletionStatus; message?: string}>(pubkeys.length);

    for (let i = 0; i < pubkeys.length; i++) {
      try {
        const pubkeyHex = pubkeys[i];

        if (!isValidatePubkeyHex(pubkeyHex)) {
          throw new ApiError(400, `Invalid pubkey ${pubkeyHex}`);
        }

        // Skip unknown keys or remote signers
        const signer = this.validator.validatorStore.getSigner(pubkeyHex);
        if (signer && signer.type === SignerType.Local) {
          // Remove key from live local signer
          deletedKey[i] = this.validator.validatorStore.removeSigner(pubkeyHex);

          // Remove key from block duties
          // Remove from attestation duties
          // Remove from Sync committee duties
          // Remove from indices
          this.validator.removeDutiesForKey(pubkeyHex);
        }

        // Attempts to delete everything first, and returns status.
        // This unlocks the keystore, so perform after deleting from in-memory store
        const diskDeleteStatus = this.persistedKeysBackend.deleteKeystore(pubkeyHex);

        if (diskDeleteStatus) {
          // TODO: What if the diskDeleteStatus status is inconsistent?
          deletedKey[i] = true;
        }
      } catch (e) {
        statuses[i] = {status: DeletionStatus.error, message: (e as Error).message};
      }
    }

    const pubkeysBytes = pubkeys.map((pubkeyHex) => fromHex(pubkeyHex));

    const interchangeV5 = await this.validator.exportInterchange(pubkeysBytes, {
      version: "5",
    });

    // After exporting slashing protection data in bulk, render the status
    const pubkeysWithSlashingProtectionData = new Set(interchangeV5.data.map((data) => data.pubkey));
    for (let i = 0; i < pubkeys.length; i++) {
      if (statuses[i]?.status === DeletionStatus.error) {
        continue;
      }
      const status = deletedKey[i]
        ? DeletionStatus.deleted
        : pubkeysWithSlashingProtectionData.has(pubkeys[i])
          ? DeletionStatus.not_active
          : DeletionStatus.not_found;
      statuses[i] = {status};
    }

    return {
      data: {
        statuses,
        slashingProtection: JSON.stringify(interchangeV5),
      },
    };
  }

  async listRemoteKeys(): ReturnType<Api["listRemoteKeys"]> {
    const remoteKeys: SignerDefinition[] = [];

    for (const pubkeyHex of this.validator.validatorStore.votingPubkeys()) {
      const signer = this.validator.validatorStore.getSigner(pubkeyHex);
      if (signer && signer.type === SignerType.Remote) {
        remoteKeys.push({pubkey: signer.pubkey, url: signer.url, readonly: false});
      }
    }

    return {
      data: remoteKeys,
    };
  }

  async importRemoteKeys({
    remoteSigners,
  }: {
    remoteSigners: RemoteSignerDefinition[];
  }): ReturnType<Api["importRemoteKeys"]> {
    const importPromises = remoteSigners.map(async ({pubkey, url}): Promise<ResponseStatus<ImportRemoteKeyStatus>> => {
      try {
        if (!isValidatePubkeyHex(pubkey)) {
          throw new ApiError(400, `Invalid pubkey ${pubkey}`);
        }
        if (!isValidHttpUrl(url)) {
          throw new ApiError(400, `Invalid URL ${url}`);
        }

        // Check if key exists
        if (this.validator.validatorStore.hasVotingPubkey(pubkey)) {
          return {status: ImportRemoteKeyStatus.duplicate};
        }

        // Else try to add it

        await this.validator.validatorStore.addSigner({type: SignerType.Remote, pubkey, url});

        this.persistedKeysBackend.writeRemoteKey({
          pubkey,
          url,
          // Always write, even if it's already persisted for consistency.
          // The in-memory validatorStore is the ground truth to decide duplicates
          persistIfDuplicate: true,
        });

        return {status: ImportRemoteKeyStatus.imported};
      } catch (e) {
        return {status: ImportRemoteKeyStatus.error, message: (e as Error).message};
      }
    });

    return {
      data: await Promise.all(importPromises),
    };
  }

  async deleteRemoteKeys({pubkeys}: {pubkeys: PubkeyHex[]}): ReturnType<Api["deleteRemoteKeys"]> {
    const results = pubkeys.map((pubkeyHex): ResponseStatus<DeleteRemoteKeyStatus> => {
      try {
        if (!isValidatePubkeyHex(pubkeyHex)) {
          throw new ApiError(400, `Invalid pubkey ${pubkeyHex}`);
        }

        const signer = this.validator.validatorStore.getSigner(pubkeyHex);

        // Remove key from live local signer
        const deletedFromMemory =
          signer && signer.type === SignerType.Remote ? this.validator.validatorStore.removeSigner(pubkeyHex) : false;

        if (deletedFromMemory) {
          // Remove duties if key was deleted from in-memory store
          this.validator.removeDutiesForKey(pubkeyHex);
        }

        const deletedFromDisk = this.persistedKeysBackend.deleteRemoteKey(pubkeyHex);

        return {
          status:
            deletedFromMemory || deletedFromDisk ? DeleteRemoteKeyStatus.deleted : DeleteRemoteKeyStatus.not_found,
        };
      } catch (e) {
        return {status: DeleteRemoteKeyStatus.error, message: (e as Error).message};
      }
    });

    return {
      data: results,
    };
  }

  async getBuilderBoostFactor({pubkey}: {pubkey: PubkeyHex}): ReturnType<Api["getBuilderBoostFactor"]> {
    const builderBoostFactor = this.validator.validatorStore.getBuilderBoostFactor(pubkey);
    return {data: {pubkey, builderBoostFactor}};
  }

  async setBuilderBoostFactor({
    pubkey,
    builderBoostFactor,
  }: BuilderBoostFactorData): ReturnType<Api["setBuilderBoostFactor"]> {
    this.checkIfProposerWriteEnabled();
    this.validator.validatorStore.setBuilderBoostFactor(pubkey, builderBoostFactor);
    this.persistedKeysBackend.writeProposerConfig(pubkey, this.validator.validatorStore.getProposerConfig(pubkey));
    return {status: 202};
  }

  async deleteBuilderBoostFactor({pubkey}: {pubkey: PubkeyHex}): ReturnType<Api["deleteBuilderBoostFactor"]> {
    this.checkIfProposerWriteEnabled();
    this.validator.validatorStore.deleteBuilderBoostFactor(pubkey);
    this.persistedKeysBackend.writeProposerConfig(pubkey, this.validator.validatorStore.getProposerConfig(pubkey));
    return {status: 204};
  }

  async signVoluntaryExit({pubkey, epoch}: {pubkey: PubkeyHex; epoch?: Epoch}): ReturnType<Api["signVoluntaryExit"]> {
    if (!isValidatePubkeyHex(pubkey)) {
      throw new ApiError(400, `Invalid pubkey ${pubkey}`);
    }
    return {data: await this.validator.signVoluntaryExit(pubkey, epoch)};
  }
}

/**
 * Given a variable with JSON that maybe stringified or not, return parsed JSON
 */
function ensureJSON<T>(strOrJson: string | T): T {
  if (typeof strOrJson === "string") {
    return JSON.parse(strOrJson) as T;
  } else {
    return strOrJson;
  }
}
