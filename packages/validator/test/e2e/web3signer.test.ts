import fs from "node:fs";
import path from "node:path";
import tmp from "tmp";
import {expect} from "chai";
import {GenericContainer, Wait, StartedTestContainer} from "testcontainers";
import {Keystore} from "@chainsafe/bls-keystore";
import {fromHex, toHex} from "@lodestar/utils";
import {config} from "@lodestar/config/default";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {createBeaconConfig} from "@lodestar/config";
import {genesisData} from "@lodestar/config/networks";
import {getClient, routes} from "@lodestar/api";
import bls from "@chainsafe/bls";
import {ssz} from "@lodestar/types";
import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {Interchange, ISlashingProtection, Signer, SignerType, ValidatorStore} from "../../src/index.js";
import {IndicesService} from "../../src/services/indices.js";
import {testLogger} from "../utils/logger.js";

const web3signerVersion = "22.8.1";

/* eslint-disable no-console */

describe("web3signer signature test", function () {
  this.timeout("60s");

  let validatorStoreRemote: ValidatorStore;
  let validatorStoreLocal: ValidatorStore;
  let startedContainer: StartedTestContainer;

  const pubkey = "0x8837af2a7452aff5a8b6906c3e5adefce5690e1bba6d73d870b9e679fece096b97a255bae0978e3a344aa832f68c6b47";
  const pubkeyBytes = fromHex(pubkey);
  const altairSlot = 2375711;
  const epoch = 0;
  // Sample validator
  const validatorIndex = 4;
  const subcommitteeIndex = 0;

  const duty: routes.validator.AttesterDuty = {
    slot: altairSlot,
    committeeIndex: 0,
    committeeLength: 120,
    committeesAtSlot: 120,
    validatorCommitteeIndex: 0,
    validatorIndex,
    pubkey: pubkeyBytes,
  };

  after("stop container", async function () {
    await startedContainer.stop();
  });

  before("start container", async function () {
    this.timeout("300s");
    // path to store configuration
    const tmpDir = tmp.dirSync({
      unsafeCleanup: true,
      // In Github runner NodeJS process probably runs as root, so web3signer doesn't have permissions to read config dir
      mode: 755,
    });
    // Apply permissions again to hopefully make Github runner happy >.<
    fs.chmodSync(tmpDir.name, 0o755);

    const configDirPathHost = tmpDir.name;
    const configDirPathContainer = "/var/web3signer/config";

    // keystore content and file paths
    // const keystoreStr = getKeystore();
    // const password = "password";
    const passwordFilename = "password.txt";

    const keystoreStr = getKeystore();
    const password = "password";

    fs.writeFileSync(path.join(configDirPathHost, "keystore.json"), keystoreStr);
    fs.writeFileSync(path.join(configDirPathHost, passwordFilename), password);

    const secretKey = bls.SecretKey.fromBytes(await Keystore.parse(keystoreStr).decrypt(password));

    const port = 9000;

    // using the latest image to be alerted in case there is a breaking change
    startedContainer = await new GenericContainer(`consensys/web3signer:${web3signerVersion}`)
      .withHealthCheck({
        test: `curl -f http://localhost:${port}/healthcheck || exit 1`,
        interval: 1000,
        timeout: 3000,
        retries: 5,
        startPeriod: 1000,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withExposedPorts(port)
      .withBindMount(configDirPathHost, configDirPathContainer, "ro")
      .withCmd([
        "eth2",
        `--keystores-path=${configDirPathContainer}`,
        // Don't use path.join here, the container is running on unix filesystem
        `--keystores-password-file=${configDirPathContainer}/${passwordFilename}`,
        "--slashing-protection-enabled=false",
      ])
      .start();

    const web3signerUrl = `http://localhost:${startedContainer.getMappedPort(port)}`;

    // http://localhost:9000/api/v1/eth2/sign/0x8837af2a7452aff5a8b6906c3e5adefce5690e1bba6d73d870b9e679fece096b97a255bae0978e3a344aa832f68c6b47
    validatorStoreRemote = getValidatorStore({type: SignerType.Remote, url: web3signerUrl, pubkey});
    validatorStoreLocal = getValidatorStore({type: SignerType.Local, secretKey});

    const stream = await startedContainer.logs();
    stream
      .on("data", (line) => process.stdout.write(line))
      .on("err", (line) => process.stderr.write(line))
      .on("end", () => console.log("Stream closed"));
  });

  for (const fork of config.forksAscendingEpochOrder) {
    it(`signBlock ${fork.name}`, async function () {
      if (fork.epoch === FAR_FUTURE_EPOCH) {
        this.skip();
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

  it("signRandao", async function () {
    await assertSameSignature("signRandao", pubkeyBytes, epoch);
  });

  it("signAttestation", async () => {
    const attestationData = ssz.phase0.AttestationData.defaultValue();
    attestationData.slot = duty.slot;
    attestationData.index = duty.committeeIndex;
    await assertSameSignature("signAttestation", duty, attestationData, epoch);
  });

  it("signAggregateAndProof", async () => {
    const aggregateAndProof = ssz.phase0.AggregateAndProof.defaultValue();
    aggregateAndProof.aggregate.data.slot = duty.slot;
    aggregateAndProof.aggregate.data.index = duty.committeeIndex;
    await assertSameSignature(
      "signAggregateAndProof",
      duty,
      aggregateAndProof.selectionProof,
      aggregateAndProof.aggregate
    );
  });

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
  // eslint-disable-next-line mocha/no-skipped-tests
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
      createBeaconConfig(config, genesisValidatorsRoot),
      slashingProtection,
      indicesService,
      doppelgangerService,
      metrics,
      [signer],
      valProposerConfig,
      genesisValidatorsRoot
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
