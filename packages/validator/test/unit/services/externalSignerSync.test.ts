import {SecretKey} from "@chainsafe/blst";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {toBufferBE} from "bigint-buffer";
import {MockedFunction, afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ExternalSignerOptions, pollExternalSignerPubkeys} from "../../../src/services/externalSignerSync.js";
import {SignerRemote, SignerType, ValidatorStore} from "../../../src/services/validatorStore.js";
import {externalSignerGetKeys} from "../../../src/util/externalSignerClient.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {initValidatorStore} from "../../utils/validatorStore.js";

vi.mock("../../../src/util/externalSignerClient.js");

describe("External signer sync", () => {
  const config = createChainForkConfig({});
  const api = getApiClientStub();

  const externalSignerUrl = "http://localhost";
  const opts: Required<ExternalSignerOptions> = {
    url: externalSignerUrl,
    fetch: true,
    fetchInterval: 100,
  };

  // Initialize pubkeys in beforeAll() so bls is already initialized
  let pubkeys: string[];
  let secretKeys: SecretKey[];

  let externalSignerGetKeysStub: MockedFunction<typeof externalSignerGetKeys>;

  beforeAll(() => {
    vi.useFakeTimers();
    secretKeys = Array.from({length: 3}, (_, i) => SecretKey.fromBytes(toBufferBE(BigInt(i + 1), 32)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toHex());
    externalSignerGetKeysStub = vi.mocked(externalSignerGetKeys);
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

  async function waitForFetchInterval(): Promise<void> {
    await vi.advanceTimersByTimeAsync(opts.fetchInterval);
  }
});
