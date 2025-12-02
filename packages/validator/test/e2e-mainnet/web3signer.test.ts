import {fetch} from "cross-fetch";
import tmp from "tmp";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import bls from "@chainsafe/bls";
import {getClient, routes} from "@lodestar/api";
import {ImportStatus, getClient as getKeymanagerClient} from "@lodestar/api/keymanager";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {genesisData} from "@lodestar/config/networks";
import {ACTIVE_PRESET, FAR_FUTURE_EPOCH, ForkSeq, PresetName} from "@lodestar/params";
import {computeStartSlotAtEpoch, interopSecretKey} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {fromHex, retry, toHex, withTimeout} from "@lodestar/utils";
import {ISlashingProtection, Interchange, Signer, SignerType, ValidatorStore} from "../../src/index.js";
import {IndicesService} from "../../src/services/indices.js";
import {runDockerContainer} from "../utils/dockercontainer.js";
import {generateContributionAndProof, generateEmptyAggregateAndProof} from "../utils/eth2Objects.js";
import {testLogger} from "../utils/logger.js";

const web3signerVersion = "22.8.1";
const web3signerImage = `consensys/web3signer:${web3signerVersion}`;

describe("web3signer signature test", () => {
  vi.setConfig({testTimeout: 60_000, hookTimeout: 60_000});

  if (ACTIVE_PRESET !== PresetName.mainnet) {
    throw Error(`ACTIVE_PRESET '${ACTIVE_PRESET}' must be mainnet`);
  }

  const altairSlot = 2375711;
  const epoch = 0;
  // Sample validator
  const validatorIndex = 4;
  const subcommitteeIndex = 0;

  const secretKey = interopSecretKey(0);
  const secKey = toHex(secretKey.toBytes());
  const pubkeyBytes = secretKey.toPublicKey().toBytes();
  const pubkey = toHex(pubkeyBytes);

  let validatorStoreRemote: ValidatorStore;
  let validatorStoreLocal: ValidatorStore;

  // path to store configuration
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  const configDirPathHost = tmpDir.name;
  const configDirPathContainer = "/var/web3signer/config";
  const port = 9000;
  const web3signerUrl = `http://127.0.0.1:${port}`;

  // Key data
  const keystoreStr = getKeystore();
  const password = "password"; // Hardcoded from pre-generated keystore, do not change

  // Note: for MacOS compatibility do not use `--network=host`
  runDockerContainer(
    web3signerImage,
    [
      // |
      "--rm",
      `--publish=${port}:9000`,
      `--volume=${configDirPathHost}:${configDirPathContainer}`,
    ],
    [
      "--http-listen-host=0.0.0.0",
      `--http-listen-port=${port}`,
      "eth2",
      "--slashing-protection-enabled=false",
      "--key-manager-api-enabled=true",
    ],
    {pipeToProcess: true}
  );

  beforeAll(async () => {
    // Start container
    const secretKey = bls.SecretKey.fromBytes(fromHex(secKey));

    // http://localhost:9000/api/v1/eth2/sign/0x8837af2a7452aff5a8b6906c3e5adefce5690e1bba6d73d870b9e679fece096b97a255bae0978e3a344aa832f68c6b47
    validatorStoreRemote = await getValidatorStore({type: SignerType.Remote, url: web3signerUrl, pubkey});
    validatorStoreLocal = await getValidatorStore({type: SignerType.Local, secretKey});

    await retry(
      () =>
        withTimeout(async (signal) => {
          const res = await fetch(`${web3signerUrl}/healthcheck`, {signal});
          if (res.status !== 200) throw Error(`status ${res.status}`);
        }, 1000),
      {retries: 60, retryDelay: 1000}
    );

    // import keystores via API
    const keymanagerApi = getKeymanagerClient({baseUrl: web3signerUrl}, {config});

    const resp = await keymanagerApi.importKeystores({keystores: [keystoreStr], passwords: [password]});
    const data = resp.value();
    if (data[0].status !== ImportStatus.imported) {
      throw Error(`Error importing keystore ${data[0].status}: ${data[0].message}`);
    }
  });

  for (const fork of config.forksAscendingEpochOrder) {
    it(`signBlock ${fork.name}`, async ({skip}) => {
      // Only test till the fork the signer version supports
      if (ForkSeq[fork.name] > externalSigner.supportedForkSeq) {
        skip();
        return;
      }

      const block = ssz[fork.name].BeaconBlock.defaultValue();
      block.slot = computeStartSlotAtEpoch(fork.epoch);

      // Sanity check, in case two forks have the same epoch
      const blockSlotFork = config.getForkName(block.slot);
      if (blockSlotFork !== fork.name) {
        throw Error(`block fork is ${blockSlotFork}`);
      }

      await assertSameSignature("signBlock", pubkeyBytes, block, block.slot);
    });
  }

  it("signRandao", async () => {
    await assertSameSignature("signRandao", pubkeyBytes, epoch);
  });

  const committeeIndex = 1;
  const duty: routes.validator.AttesterDuty = {
    slot: 0,
    committeeIndex,
    committeeLength: 120,
    committeesAtSlot: 120,
    validatorCommitteeIndex: 1,
    validatorIndex,
    pubkey: pubkeyBytes,
  };

  it("signAttestation", async () => {
    const attestationData = ssz.phase0.AttestationData.defaultValue();
    attestationData.slot = duty.slot;
    attestationData.index = duty.committeeIndex;
    await assertSameSignature("signAttestation", duty, attestationData, epoch);
  });

  for (const fork of config.forksAscendingEpochOrder) {
    it(`signAggregateAndProof ${fork.name}`, async ({skip}) => {
      // Only test till the fork the signer version supports
      if (ForkSeq[fork.name] > externalSigner.supportedForkSeq) {
        skip();
        return;
      }

      const aggregateAndProof = sszTypesFor(fork.name).AggregateAndProof.defaultValue();
      const slot = computeStartSlotAtEpoch(fork.epoch);
      aggregateAndProof.aggregate.data.slot = slot;
      aggregateAndProof.aggregate.data.index = duty.committeeIndex;

      await assertSameSignature(
        "signAggregateAndProof",
        {...duty, slot},
        aggregateAndProof.selectionProof,
        aggregateAndProof.aggregate
      );
    });
  }

  it("signSyncCommitteeSignature", async () => {
    const beaconBlockRoot = ssz.phase0.BeaconBlockHeader.defaultValue().bodyRoot;
    await assertSameSignature("signSyncCommitteeSignature", pubkeyBytes, validatorIndex, altairSlot, beaconBlockRoot);
  });

  it("signContributionAndProof", async () => {
    const contributionAndProof = ssz.altair.ContributionAndProof.defaultValue();
    contributionAndProof.contribution.slot = duty.slot;
    contributionAndProof.contribution.subcommitteeIndex = duty.committeeIndex;

    await assertSameSignature(
      "signContributionAndProof",
      duty,
      contributionAndProof.selectionProof,
      contributionAndProof.contribution
    );
  });

  it("signAttestationSelectionProof", async () => {
    await assertSameSignature("signAttestationSelectionProof", pubkeyBytes, altairSlot);
  });

  it("signSyncCommitteeSelectionProof", async () => {
    await assertSameSignature("signSyncCommitteeSelectionProof", pubkeyBytes, altairSlot, subcommitteeIndex);
  });

  it("signVoluntaryExit", async () => {
    await assertSameSignature("signVoluntaryExit", pubkeyBytes, validatorIndex, epoch);
  });

  // ValidatorRegistration includes a timestamp so it's possible that web3signer instance and local instance
  // sign different messages and this test fails. Disabling unless it can be proven deterministic
  it.skip("signValidatorRegistration", async () => {
    const regAttributes = {
      feeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      gasLimit: 1,
    };
    await assertSameSignature("signValidatorRegistration", pubkeyBytes, regAttributes, epoch);
  });

  async function assertSameSignature<T extends keyof ValidatorStore>(
    method: T,
    ...args: Parameters<ValidatorStore[T]>
  ): Promise<void> {
    type HasSignature = {signature: Buffer};
    type ReturnType = Buffer | HasSignature;
    const signatureRemote = await (validatorStoreRemote[method] as () => Promise<ReturnType>)(...(args as []));
    const signatureLocal = await (validatorStoreLocal[method] as () => Promise<ReturnType>)(...(args as []));
    if ("fill" in signatureRemote && "fill" in signatureLocal) {
      expect(toHex(signatureRemote)).equals(toHex(signatureLocal), `Wrong signature for ${method}`);
    } else {
      expect(toHex((signatureRemote as HasSignature).signature)).equals(
        toHex((signatureLocal as HasSignature).signature),
        `Wrong signature for ${method}`
      );
    }
  }

  async function getValidatorStore(signer: Signer): Promise<ValidatorStore> {
    const logger = testLogger();
    const api = getClient({baseUrl: "http://localhost:9596"}, {config});
    const genesisValidatorsRoot = fromHex(genesisData.mainnet.genesisValidatorsRoot);
    const metrics = null;
    const doppelgangerService = null;
    const valProposerConfig = undefined;
    const indicesService = new IndicesService(logger, api, metrics);
    const slashingProtection = new SlashingProtectionDisabled();
    return ValidatorStore.init(
      {
        config: createBeaconConfig(config, genesisValidatorsRoot),
        slashingProtection,
        indicesService,
        doppelgangerService,
        metrics,
      },
      [signer],
      valProposerConfig
    );
  }
});

class SlashingProtectionDisabled implements ISlashingProtection {
  async checkAndInsertBlockProposal(): Promise<void> {
    //
  }

  async checkAndInsertAttestation(): Promise<void> {
    //
  }

  async hasAttestedInEpoch(): Promise<boolean> {
    return false;
  }

  async importInterchange(): Promise<void> {
    //
  }

  exportInterchange(): Promise<Interchange> {
    throw Error("not implemented");
  }
}

function getKeystore(): string {
  return `{
    "version": 4,
    "uuid": "f31f3377-694d-4943-8686-5b20356b2597",
    "path": "m/12381/3600/0/0/0",
    "pubkey": "8837af2a7452aff5a8b6906c3e5adefce5690e1bba6d73d870b9e679fece096b97a255bae0978e3a344aa832f68c6b47",
    "crypto": {
      "kdf": {
        "function": "pbkdf2",
        "params": {
          "dklen": 32,
          "c": 262144,
          "prf": "hmac-sha256",
          "salt": "ab2c11fe1a288a8344972e5e03a746f42867f5a9e749bf286f8e26cf16702c93"
        },
        "message": ""
      },
      "checksum": {
        "function": "sha256",
        "params": {},
        "message": "1f0eda362360b51b85591e99fee6c5d030cc48f36af28eb055b19a2bf55b38a6"
      },
      "cipher": {
        "function": "aes-128-ctr",
        "params": {
          "iv": "acf3173c5d0b074e1646bb6058dc0f2a"
        },
        "message": "402d1cecaa378e4f079c96437bd1d4771e09a85df2073d014b43980b623b9978"
      }
    }
  }`;
}
