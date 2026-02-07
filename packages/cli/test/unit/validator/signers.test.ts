import {beforeEach, describe, expect, it, vi} from "vitest";
import {interopSecretKey} from "@lodestar/state-transition";
import * as validator from "@lodestar/validator";
import {SignerType} from "@lodestar/validator";
import type {IValidatorCliArgs} from "../../../src/cmds/validator/options.js";
import {getSignersFromArgs} from "../../../src/cmds/validator/signers/index.js";
import type {GlobalArgs} from "../../../src/options/index.js";

vi.mock("@lodestar/validator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lodestar/validator")>();
  return {
    ...actual,
    externalSignerGetKeys: vi.fn(),
  };
});

const externalSignerGetKeysMock = vi.mocked(validator.externalSignerGetKeys);

function pubkeyHex(index: number): string {
  return interopSecretKey(index).toPublicKey().toHex();
}

describe("getSignersFromArgs / external signer fetch", () => {
  const network = "sepolia";
  const signal = new AbortController().signal;
  const logger = {warn: vi.fn(), info: vi.fn(), debug: vi.fn()};

  const baseArgs = {
    network,
    "externalSigner.url": ["http://signer1:9000", "http://signer2:9000"],
    "externalSigner.fetch": true,
  } as IValidatorCliArgs & GlobalArgs;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns signers from all URLs when each returns pubkeys", async () => {
    const pk1 = pubkeyHex(0);
    const pk2 = pubkeyHex(1);
    externalSignerGetKeysMock.mockResolvedValueOnce([pk1]).mockResolvedValueOnce([pk2]);

    const signers = await getSignersFromArgs(baseArgs, network, {logger, signal});

    expect(signers).toHaveLength(2);
    expect(signers[0]).toEqual({type: SignerType.Remote, url: "http://signer1:9000", pubkey: pk1});
    expect(signers[1]).toEqual({type: SignerType.Remote, url: "http://signer2:9000", pubkey: pk2});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("continues with available signers when one returns empty array", async () => {
    const pk1 = pubkeyHex(0);
    externalSignerGetKeysMock.mockResolvedValueOnce([]).mockResolvedValueOnce([pk1]);

    const signers = await getSignersFromArgs(baseArgs, network, {logger, signal});

    expect(signers).toHaveLength(1);
    expect(signers[0]).toEqual({type: SignerType.Remote, url: "http://signer2:9000", pubkey: pk1});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns and uses first occurrence when same pubkey appears on multiple signers", async () => {
    const pk = pubkeyHex(0);
    externalSignerGetKeysMock.mockResolvedValueOnce([pk]).mockResolvedValueOnce([pk]);

    const signers = await getSignersFromArgs(baseArgs, network, {logger, signal});

    expect(signers).toHaveLength(1);
    expect(signers[0]).toEqual({type: SignerType.Remote, url: "http://signer1:9000", pubkey: pk});
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const warnMsg = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(warnMsg).toContain("Pubkey");
    expect(warnMsg).toContain("multiple signers");
  });
});
