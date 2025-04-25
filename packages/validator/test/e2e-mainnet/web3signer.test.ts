import {getClient, routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {genesisData} from "@lodestar/config/networks";
import {ForkSeq} from "@lodestar/params";
import {computeStartSlotAtEpoch, interopSecretKey, interopSecretKeys} from "@lodestar/state-transition";
import {StartedExternalSigner, getKeystoresStr, startExternalSigner} from "@lodestar/test-utils";
import {ssz, sszTypesFor} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {ISlashingProtection, Interchange, Signer, SignerType, ValidatorStore} from "../../src/index.js";
import {IndicesService} from "../../src/services/indices.js";
import {testLogger} from "../utils/logger.js";
import {externalSignerGetKeys} from "../../src/util/externalSignerClient.js";

describe("web3signer signature test", () => {
  vi.setConfig({testTimeout: 180_000, hookTimeout: 180_000});

  const altairSlot = 2375711;
  const epoch = 0;
  // Sample validator
  const validatorIndex = 4;
  const subcommitteeIndex = 0;

  const secretKey = interopSecretKey(0);
  const pubkeyBytes = secretKey.toPublicKey().toBytes();

  let validatorStoreRemote: ValidatorStore;
  let validatorStoreLocal: ValidatorStore;

  let externalSigner1: StartedExternalSigner;
  let externalSigner2: StartedExternalSigner;

  const duty: routes.validator.AttesterDuty = {
    slot: altairSlot,
    committeeIndex: 0,
    committeeLength: 120,
    committeesAtSlot: 120,
    validatorCommitteeIndex: 0,
    validatorIndex,
    pubkey: pubkeyBytes,
  };

  beforeAll(async () => {
    try {
      validatorStoreLocal = await getValidatorStore({type: SignerType.Local, secretKey: secretKey});

      const password = "password";
      // Start first external signer
      externalSigner1 = await startExternalSigner({
        keystoreStrings: await getKeystoresStr(
          password,
          interopSecretKeys(2).map((k) => k.toHex())
        ),
        password: password,
      });

      // Wait a bit to ensure first signer is fully started
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Start second external signer
      externalSigner2 = await startExternalSigner({
        keystoreStrings: await getKeystoresStr(
          password,
          interopSecretKeys(2).map((k) => k.toHex())
        ),
        password: password,
      });

      // Wait a bit to ensure second signer is fully started
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Create validator store with both external signers
      const signers: Signer[] = [
        {
          type: SignerType.Remote,
          url: externalSigner1.url,
          pubkey: secretKey.toPublicKey().toHex(),
        },
        {
          type: SignerType.Remote,
          url: externalSigner2.url,
          pubkey: secretKey.toPublicKey().toHex(),
        },
      ];

      validatorStoreRemote = await getValidatorStore(signers[0]); // Initialize with first signer
      // Add second signer
      await validatorStoreRemote.addSigner(signers[1]);
    } catch (error) {
      console.error("Failed to initialize test:", error);
      throw error;
    }
  });

  afterAll(async () => {
    try {
      if (externalSigner1?.container) {
        await externalSigner1.container.stop();
      }
      if (externalSigner2?.container) {
        await externalSigner2.container.stop();
      }
    } catch (error) {
      console.error("Failed to cleanup test:", error);
    }
  });

  for (const fork of config.forksAscendingEpochOrder) {
    it(`signBlock ${fork.name}`, async ({skip}) => {
      // Only test till the fork the signer version supports
      if (
        ForkSeq[fork.name] > externalSigner1.supportedForkSeq ||
        ForkSeq[fork.name] > externalSigner2.supportedForkSeq
      ) {
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

  it("signAttestation", async () => {
    const attestationData = ssz.phase0.AttestationData.defaultValue();
    attestationData.slot = duty.slot;
    attestationData.index = duty.committeeIndex;
    await assertSameSignature("signAttestation", duty, attestationData, epoch);
  });

  for (const fork of config.forksAscendingEpochOrder) {
    it(`signAggregateAndProof ${fork.name}`, async ({skip}) => {
      // Only test till the fork the signer version supports
      if (
        ForkSeq[fork.name] > externalSigner1.supportedForkSeq ||
        ForkSeq[fork.name] > externalSigner2.supportedForkSeq
      ) {
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

  it("should handle multiple external signers", async () => {
    // Test that we can get pubkeys from both signers
    const pubkeys1 = await externalSignerGetKeys(externalSigner1.url);
    const pubkeys2 = await externalSignerGetKeys(externalSigner2.url);
    expect(pubkeys1.length).toBeGreaterThan(0);
    expect(pubkeys2.length).toBeGreaterThan(0);

    // Test that we can sign with keys from both signers
    const pubkey1 = fromHex(pubkeys1[0]);
    const pubkey2 = fromHex(pubkeys2[0]);

    const block = ssz.phase0.BeaconBlock.defaultValue();
    block.slot = altairSlot;

    const signature1 = await validatorStoreRemote.signBlock(pubkey1, block, block.slot);
    const signature2 = await validatorStoreRemote.signBlock(pubkey2, block, block.slot);

    expect(signature1).toBeDefined();
    expect(signature2).toBeDefined();
    expect(signature1).not.toEqual(signature2);

    // Verify that both signers are registered
    const remotePubkeys = validatorStoreRemote.getAllRemoteSignerPubkeys();
    expect(remotePubkeys).toContain(pubkeys1[0]);
    expect(remotePubkeys).toContain(pubkeys2[0]);
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
    // No-op
  }

  async checkAndInsertAttestation(): Promise<void> {
    // No-op
  }

  async hasAttestedInEpoch(): Promise<boolean> {
    return false;
  }

  async importInterchange(): Promise<void> {
    // No-op
  }

  exportInterchange(): Promise<Interchange> {
    return Promise.resolve({metadata: {interchange_format_version: "5", genesis_validators_root: "0x"}, data: []});
  }
}
