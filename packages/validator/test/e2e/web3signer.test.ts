import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";
import {expect} from "chai";
import {GenericContainer, Wait, StartedTestContainer} from "testcontainers";
import {Keystore} from "@chainsafe/bls-keystore";
import {fromHex, toHex} from "@lodestar/utils";
import {config} from "@lodestar/config/default";
import {createIBeaconConfig} from "@lodestar/config";
import {genesisData} from "@lodestar/config/networks";
import {getClient, routes} from "@lodestar/api";
import bls from "@chainsafe/bls";
import {ssz} from "@lodestar/types";
import {Interchange, ISlashingProtection, Signer, SignerType, ValidatorStore} from "../../src/index.js";
import {IndicesService} from "../../src/services/indices.js";
import {testLogger} from "../utils/logger.js";

/* eslint-disable no-console */

describe("web3signer signature test", function () {
  this.timeout("60s");

  let validatorStoreRemote: ValidatorStore;
  let validatorStoreLocal: ValidatorStore;
  let startedContainer: StartedTestContainer;

  const pubkey = "0x8837af2a7452aff5a8b6906c3e5adefce5690e1bba6d73d870b9e679fece096b97a255bae0978e3a344aa832f68c6b47";
  const pubkeyBytes = fromHex(pubkey);
  const slot = 1;
  const postAltairSlot = 2375711;
  const epoch = 0;
  // Sample validator
  const validatorIndex = 4;
  const subcommitteeIndex = 1;

  const duty: routes.validator.AttesterDuty = {
    slot: slot,
    committeeIndex: 1,
    committeeLength: 120,
    committeesAtSlot: 120,
    validatorCommitteeIndex: 1,
    validatorIndex,
    pubkey: pubkeyBytes,
  };

  after("stop container", async function () {
    await startedContainer.stop();
  });

  before("start container", async function () {
    this.timeout("300s");
    // path to store configuration
    const tmpDir = tmp.dirSync({unsafeCleanup: true});
    const configDirPath = tmpDir.name;

    // keystore content and file paths
    // const keystoreStr = getKeystore();
    // const password = "password";
    const keystoreFile = path.join(configDirPath, "keystore.json");
    const passwordFile = path.join(configDirPath, "password.txt");
    const keyconfigFile = path.join(configDirPath, "keyconfig.yaml");

    const keystoreStr = getKeystore();
    const password = "password";

    fs.writeFileSync(keystoreFile, keystoreStr);
    fs.writeFileSync(passwordFile, password);
    fs.writeFileSync(keyconfigFile, getConfig(keystoreFile, passwordFile));

    const secretKey = bls.SecretKey.fromBytes(await Keystore.parse(keystoreStr).decrypt(password));

    const port = 9000;
    let web3signerUrl = `http://localhost:${port}`;

    // using the latest image to be alerted in case there is a breaking change
    const containerConfigPath = "/var/web3signer/config";
    startedContainer = await new GenericContainer("consensys/web3signer:latest")
      .withHealthCheck({
        test: `curl -f ${web3signerUrl}/healthcheck || exit 1`,
        interval: 1000,
        timeout: 3000,
        retries: 5,
        startPeriod: 1000,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withExposedPorts(9000)
      .withBindMount(`${configDirPath}`, containerConfigPath, "ro")
      .withBindMount(`${configDirPath}`, `${configDirPath}`, "ro")
      .withCmd([
        "--swagger-ui-enabled",
        `--key-store-path=${containerConfigPath}`,
        "eth2",
        `--keystores-passwords-path=${containerConfigPath}`,
        "--slashing-protection-enabled=false",
        "--key-manager-api-enabled=true",
      ])
      .start();

    web3signerUrl = `http://localhost:${startedContainer.getMappedPort(port)}`;

    // http://localhost:9000/api/v1/eth2/sign/0x8837af2a7452aff5a8b6906c3e5adefce5690e1bba6d73d870b9e679fece096b97a255bae0978e3a344aa832f68c6b47
    validatorStoreRemote = getValidatorStore({type: SignerType.Remote, url: web3signerUrl, pubkey});
    validatorStoreLocal = getValidatorStore({type: SignerType.Local, secretKey});

    const stream = await startedContainer.logs();
    stream
      .on("data", (line) => console.log(line))
      .on("err", (line) => console.error(line))
      .on("end", () => console.log("Stream closed"));
  });

  async function assertSameSignature<T extends keyof ValidatorStore>(
    method: T,
    ...args: Parameters<ValidatorStore[T]>
  ): Promise<void> {
    const signatureRemote = await (validatorStoreRemote[method] as () => Promise<Buffer>)(...(args as []));
    const signatureLocal = await (validatorStoreLocal[method] as () => Promise<Buffer>)(...(args as []));
    expect(toHex(signatureRemote)).equals(toHex(signatureLocal), `Wrong signature for ${method}`);
  }

  // it("signBlock", async () => {
  //   await assertSameSignature("signBlock", pubkeyBytes);
  // });

  it("signRandao", async function () {
    this.timeout(30_000);
    await assertSameSignature("signRandao", pubkeyBytes, epoch);
  });

  it("signAttestation", async () => {
    this.timeout(30_000);
    const attestationData = ssz.phase0.AttestationData.defaultValue();
    attestationData.slot = duty.slot;
    attestationData.index = duty.committeeIndex;
    const signatureLocal = (await validatorStoreLocal.signAttestation(duty, attestationData, epoch)).signature;
    const signatureRemote = (await validatorStoreRemote.signAttestation(duty, attestationData, epoch)).signature;
    expect(toHex(signatureRemote)).equals(toHex(signatureLocal), "Wrong signature for signAttestation");
  });

  //
  // it("signAggregateAndProof", async () => {
  //   await assertSameSignature("signAggregateAndProof", pubkeyBytes);
  // });
  //
  // it("signSyncCommitteeSignature", async () => {
  //   await assertSameSignature("signSyncCommitteeSignature", pubkeyBytes);
  // });
  //
  // it("signContributionAndProof", async () => {
  //   await assertSameSignature("signContributionAndProof", pubkeyBytes);
  // });
  //
  // it("signAttestationSelectionProof", async () => {
  //   await assertSameSignature("signAttestationSelectionProof", pubkeyBytes);
  // });
  //
  it("signSyncCommitteeSelectionProof", async () => {
    await assertSameSignature("signSyncCommitteeSelectionProof", pubkeyBytes, postAltairSlot, subcommitteeIndex);
  });
  //
  it("signVoluntaryExit", async () => {
    const signatureLocal = (await validatorStoreLocal.signVoluntaryExit(pubkeyBytes, validatorIndex, epoch)).signature;
    const signatureRemote = (await validatorStoreRemote.signVoluntaryExit(pubkeyBytes, validatorIndex, epoch))
      .signature;
    expect(toHex(signatureRemote)).equals(toHex(signatureLocal), "Wrong signature for signVoluntaryExit");
  });
  //
  // it("signValidatorRegistration", async () => {
  //   await assertSameSignature("signValidatorRegistration", pubkeyBytes);
  // });
});

function getValidatorStore(signer: Signer): ValidatorStore {
  const logger = testLogger();
  const api = getClient({baseUrl: "http://localhost:9596"}, {config});
  const genesisValidatorsRoot = fromHex(genesisData.mainnet.genesisValidatorsRoot);
  const metrics = null;
  const doppelgangerService = null;
  const valProposerConfig = undefined;
  const indicesService = new IndicesService(logger, api, metrics);
  const slashingProtection = new SlashingProtectionDisabled();
  return new ValidatorStore(
    createIBeaconConfig(config, genesisValidatorsRoot),
    slashingProtection,
    indicesService,
    doppelgangerService,
    metrics,
    [signer],
    valProposerConfig,
    genesisValidatorsRoot
  );
}

class SlashingProtectionDisabled implements ISlashingProtection {
  async checkAndInsertBlockProposal(): Promise<void> {
    //
  }

  async checkAndInsertAttestation(): Promise<void> {
    //
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

function getConfig(keystoreFile: string, passwordFile: string): string {
  return `
type: "file-keystore"
keyType: "bls"
keystoreFile: ${keystoreFile}
keystorePasswordFile: ${passwordFile}`;
}
