import {toBufferBE} from "@vekexasia/bigint-buffer2";
import {MockInstance, afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ExternalSignerOptions, pollExternalSignerPubkeys} from "../../../src/services/externalSignerSync.js";
import {SignerRemote, SignerType, ValidatorStore} from "../../../src/services/validatorStore.js";
import * as externalSignerClient from "../../../src/util/externalSignerClient.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {initValidatorStore} from "../../utils/validatorStore.js";

vi.mock("../../../src/util/externalSignerClient.js");

describe("External signer sync", () => {
  const config = createChainForkConfig({});
  const api = getApiClientStub();

  const externalSignerUrl = "http://localhost";
  const opts: Required<ExternalSignerOptions> = {
    urls: [externalSignerUrl],
    fetch: true,
    fetchInterval: 100,
  };

  // Initialize pubkeys in beforeAll() so bls is already initialized
  let pubkeys: string[];
  let secretKeys: SecretKey[];

  let externalSignerGetKeysStub: MockInstance<typeof externalSignerClient.externalSignerGetKeys>;

  beforeAll(() => {
    vi.useFakeTimers();
    secretKeys = Array.from({length: 3}, (_, i) => SecretKey.fromBytes(toBufferBE(BigInt(i + 1), 32)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toHex());
    // vi.mock does not automock all objects in Bun runtime, so we have to explicitly spy on needed methods
    externalSignerGetKeysStub = vi.spyOn(externalSignerClient, "externalSignerGetKeys");
  });

  let validatorStore: ValidatorStore;
  // To stop fetch interval
  let controller: AbortController;

  beforeEach(async () => {
    // Initialize validator store without signers
    validatorStore = await initValidatorStore([], api, chainConfig);
    controller = new AbortController();
  });

  afterEach(() => controller.abort());

  afterAll(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should add remote signer for newly discovered public key from external signer", async () => {
    const pubkey = pubkeys[0];
    externalSignerGetKeysStub.mockResolvedValueOnce([pubkey]);

    pollExternalSignerPubkeys(config, loggerVc, controller.signal, validatorStore, opts);

    await waitForFetchInterval();

    expect(validatorStore.hasSomeValidators()).toBe(true);
    expect(validatorStore.getSigner(pubkey)).toEqual<SignerRemote>({
      type: SignerType.Remote,
      pubkey: pubkey,
      url: externalSignerUrl,
    });
  });

  it("should remove remote signer for no longer present public key on external signer", async () => {
    const pubkey = pubkeys[0];
    await validatorStore.addSigner({type: SignerType.Remote, pubkey: pubkey, url: externalSignerUrl});
    expect(validatorStore.hasSomeValidators()).toBe(true);

    externalSignerGetKeysStub.mockResolvedValueOnce([]);

    pollExternalSignerPubkeys(config, loggerVc, controller.signal, validatorStore, opts);

    await waitForFetchInterval();

    expect(validatorStore.hasSomeValidators()).toBe(false);
    expect(validatorStore.getSigner(pubkey)).toBeUndefined();
  });

  it("should add / remove remote signers to match public keys on external signer", async () => {
    const existingPubkeys = pubkeys.slice(0, 2);
    for (const pubkey of existingPubkeys) {
      await validatorStore.addSigner({type: SignerType.Remote, pubkey, url: externalSignerUrl});
    }
    expect(validatorStore.hasSomeValidators()).toBe(true);
    expect(validatorStore.votingPubkeys()).toEqual(existingPubkeys);

    const removedPubkey = existingPubkeys[0];
    const addedPubkeys = pubkeys.slice(existingPubkeys.length, pubkeys.length);
    const externalPubkeys = [...existingPubkeys.slice(1), ...addedPubkeys];

    externalSignerGetKeysStub.mockResolvedValueOnce(externalPubkeys);

    pollExternalSignerPubkeys(config, loggerVc, controller.signal, validatorStore, opts);

    await waitForFetchInterval();

    expect(validatorStore.hasSomeValidators()).toBe(true);
    expect(validatorStore.hasVotingPubkey(removedPubkey)).toBe(false);
    expect(validatorStore.votingPubkeys()).toEqual(externalPubkeys);
  });

  it("should not modify signers if public keys did not change on external signer", async () => {
    for (const pubkey of pubkeys) {
      await validatorStore.addSigner({type: SignerType.Remote, pubkey, url: externalSignerUrl});
    }
    expect(validatorStore.hasSomeValidators()).toBe(true);
    expect(validatorStore.votingPubkeys()).toEqual(pubkeys);

    externalSignerGetKeysStub.mockResolvedValueOnce(pubkeys);

    pollExternalSignerPubkeys(config, loggerVc, controller.signal, validatorStore, opts);

    await waitForFetchInterval();

    expect(validatorStore.hasSomeValidators()).toBe(true);
    expect(validatorStore.votingPubkeys()).toEqual(pubkeys);
  });

  it("should not remove local signer if public key is not present on external signer", async () => {
    const localPubkey = pubkeys[0];
    await validatorStore.addSigner({type: SignerType.Local, secretKey: secretKeys[0]});
    expect(validatorStore.hasVotingPubkey(localPubkey)).toBe(true);

    externalSignerGetKeysStub.mockResolvedValueOnce(pubkeys.slice(1));

    pollExternalSignerPubkeys(config, loggerVc, controller.signal, validatorStore, opts);

    await waitForFetchInterval();

    expect(validatorStore.hasVotingPubkey(localPubkey)).toBe(true);
  });

  it("should not remove remote signer with a different url as configured external signer", async () => {
    const diffUrlPubkey = pubkeys[0];
    await validatorStore.addSigner({type: SignerType.Remote, pubkey: diffUrlPubkey, url: "http://differentSigner"});
    expect(validatorStore.hasVotingPubkey(diffUrlPubkey)).toBe(true);

    externalSignerGetKeysStub.mockResolvedValueOnce(pubkeys.slice(1));

    pollExternalSignerPubkeys(config, loggerVc, controller.signal, validatorStore, opts);

    await waitForFetchInterval();

    expect(validatorStore.hasVotingPubkey(diffUrlPubkey)).toBe(true);
  });

  it("should not add remote signer if public key fetched from external signer is invalid", async () => {
    const invalidPubkey = "0x1234";
    externalSignerGetKeysStub.mockResolvedValueOnce([invalidPubkey]);

    pollExternalSignerPubkeys(config, loggerVc, controller.signal, validatorStore, opts);

    await waitForFetchInterval();

    expect(validatorStore.hasSomeValidators()).toBe(false);
  });

  it("should not add remote signers if fetching public keys from external signer is disabled", async () => {
    externalSignerGetKeysStub.mockResolvedValueOnce(pubkeys);

    pollExternalSignerPubkeys(config, loggerVc, controller.signal, validatorStore, {...opts, fetch: false});

    await waitForFetchInterval();

    expect(validatorStore.hasSomeValidators()).toBe(false);
    expect(validatorStore.votingPubkeys()).toEqual([]);
  });

  describe("Multiple external signer URLs", () => {
    const externalSignerUrl1 = "http://signer1:9000";
    const externalSignerUrl2 = "http://signer2:9000";
    const optsMultiple: ExternalSignerOptions = {
      urls: [externalSignerUrl1, externalSignerUrl2],
      fetch: true,
      fetchInterval: 100,
    };

    let testValidatorStore: ValidatorStore;
    let testController: AbortController;

    beforeEach(async () => {
      // Create a fresh validator store for each test
      testValidatorStore = await initValidatorStore([], api, chainConfig);
      testController = new AbortController();
      externalSignerGetKeysStub.mockReset();
    });

    afterEach(() => testController.abort());

    it("should fetch keys from multiple external signers and associate them with correct URLs", async () => {
      const signer1Pubkeys = [pubkeys[0]];
      const signer2Pubkeys = [pubkeys[1]];

      // Use mockImplementation to ensure correct URL mapping
      externalSignerGetKeysStub.mockImplementation((url: string) => {
        if (url === externalSignerUrl1) return Promise.resolve(signer1Pubkeys);
        if (url === externalSignerUrl2) return Promise.resolve(signer2Pubkeys);
        return Promise.resolve([]);
      });

      pollExternalSignerPubkeys(config, loggerVc, testController.signal, testValidatorStore, optsMultiple);

      await waitForFetchInterval();

      expect(testValidatorStore.hasSomeValidators()).toBe(true);
      expect(testValidatorStore.votingPubkeys()).toHaveLength(2);

      // Verify keys are associated with correct URLs
      const signer1 = testValidatorStore.getSigner(pubkeys[0]);
      expect(signer1).toEqual<SignerRemote>({
        type: SignerType.Remote,
        pubkey: pubkeys[0],
        url: externalSignerUrl1,
      });

      const signer2 = testValidatorStore.getSigner(pubkeys[1]);
      expect(signer2).toEqual<SignerRemote>({
        type: SignerType.Remote,
        pubkey: pubkeys[1],
        url: externalSignerUrl2,
      });

      // Verify getRemoteSignerPubkeys returns correct keys for each URL
      expect(testValidatorStore.getRemoteSignerPubkeys(externalSignerUrl1)).toEqual(signer1Pubkeys);
      expect(testValidatorStore.getRemoteSignerPubkeys(externalSignerUrl2)).toEqual(signer2Pubkeys);
    });

    it("should handle keys being added/removed from different signers independently", async () => {
      // Initially add keys from both signers
      externalSignerGetKeysStub.mockImplementation((url: string) => {
        if (url === externalSignerUrl1) return Promise.resolve([pubkeys[0]]);
        if (url === externalSignerUrl2) return Promise.resolve([pubkeys[1]]);
        return Promise.resolve([]);
      });

      pollExternalSignerPubkeys(config, loggerVc, testController.signal, testValidatorStore, optsMultiple);
      await waitForFetchInterval();

      expect(testValidatorStore.votingPubkeys()).toHaveLength(2);

      // Now signer1 removes its key, but signer2 keeps its key
      externalSignerGetKeysStub.mockImplementation((url: string) => {
        if (url === externalSignerUrl1) return Promise.resolve([]); // signer1 has no keys
        if (url === externalSignerUrl2) return Promise.resolve([pubkeys[1]]); // signer2 still has its key
        return Promise.resolve([]);
      });

      await waitForFetchInterval();

      expect(testValidatorStore.votingPubkeys()).toEqual([pubkeys[1]]);
      expect(testValidatorStore.getRemoteSignerPubkeys(externalSignerUrl1)).toEqual([]);
      expect(testValidatorStore.getRemoteSignerPubkeys(externalSignerUrl2)).toEqual([pubkeys[1]]);
    });

    it("should handle single URL as string (backward compatibility)", async () => {
      const optsSingle: ExternalSignerOptions = {
        urls: [externalSignerUrl1], // Single URL = urls.length === 1
        fetch: true,
        fetchInterval: 100,
      };

      externalSignerGetKeysStub.mockResolvedValueOnce([pubkeys[0]]);

      pollExternalSignerPubkeys(config, loggerVc, testController.signal, testValidatorStore, optsSingle);

      await waitForFetchInterval();

      expect(testValidatorStore.hasSomeValidators()).toBe(true);
      expect(testValidatorStore.getSigner(pubkeys[0])).toEqual<SignerRemote>({
        type: SignerType.Remote,
        pubkey: pubkeys[0],
        url: externalSignerUrl1,
      });
    });

    it("should handle errors from one signer without affecting others", async () => {
      const signer2Pubkey = pubkeys[2]; // Use a different pubkey to avoid conflicts
      const signer2Pubkeys = [signer2Pubkey];

      externalSignerGetKeysStub.mockImplementation((url: string) => {
        if (url === externalSignerUrl1) return Promise.reject(new Error("Connection failed"));
        if (url === externalSignerUrl2) return Promise.resolve(signer2Pubkeys);
        return Promise.resolve([]);
      });

      pollExternalSignerPubkeys(config, loggerVc, testController.signal, testValidatorStore, optsMultiple);

      await waitForFetchInterval();

      // Should still have keys from signer2 despite signer1 failing
      expect(testValidatorStore.hasSomeValidators()).toBe(true);
      expect(testValidatorStore.votingPubkeys()).toContain(signer2Pubkey);
      expect(testValidatorStore.getRemoteSignerPubkeys(externalSignerUrl2)).toEqual(signer2Pubkeys);
      // signer1 should have no keys due to error
      expect(testValidatorStore.getRemoteSignerPubkeys(externalSignerUrl1)).toEqual([]);
    });
  });

  async function waitForFetchInterval(): Promise<void> {
    await vi.advanceTimersByTimeAsync(opts.fetchInterval);
  }
});
