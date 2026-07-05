import {Mock, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {createBeaconConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {AdmitEnvelopeDeps, admitEnvelopeByRoot} from "../../../../src/sync/target/envelopeAdmission.js";
import {config as chainForkConfig} from "../../../utils/blocksAndData.js";

// A cached BeaconConfig (with `getDomain`) — the signature-set builder computes the signing-root
// domain, which the bare ChainForkConfig does not provide.
const config = createBeaconConfig(chainForkConfig, new Uint8Array(32));

// A real 48-byte BLS pubkey: PublicKey.fromBytes (called inside the signature-set builder for
// external builders) validates the point and throws on garbage, so the external-builder stub must
// return a genuine pubkey.
const REAL_BUILDER_PUBKEY = SecretKey.fromKeygen(Buffer.alloc(32, 7)).toPublicKey().toBytes();

const SELF_BUILD_INDEX = BUILDER_INDEX_SELF_BUILD;
const EXTERNAL_BUILDER_INDEX = 7;
const ABSENT_BUILDER_INDEX = 99;
const PROPOSER_INDEX = 3;
const SEEN_TIMESTAMP_SEC = 1234;

const BLOCK_HASH = new Uint8Array(32).fill(0xaa);
const BEACON_BLOCK_ROOT = new Uint8Array(32).fill(0xbb);

type FakePayloadInput = {
  getBuilderIndex: Mock;
  getBlockHashHex: Mock;
  getBid: Mock;
  hasPayloadEnvelope: Mock;
  addPayloadEnvelope: Mock;
};

function buildSignedEnvelope(overrides: {builderIndex: number}): gloas.SignedExecutionPayloadEnvelope {
  const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  signedEnvelope.message.builderIndex = overrides.builderIndex;
  signedEnvelope.message.payload.blockHash = BLOCK_HASH;
  // Keep payload.slotNumber at 0 (pre-gloas domain lookup is fine for a fake config in tests
  // since the sig-set construction only hashes; bls math is stubbed).
  signedEnvelope.message.beaconBlockRoot = BEACON_BLOCK_ROOT;
  return signedEnvelope;
}

/** The bid the payloadInput exposes; its executionRequestsRoot must match the envelope's. */
function bidMatching(signedEnvelope: gloas.SignedExecutionPayloadEnvelope): gloas.ExecutionPayloadBid {
  const bid = ssz.gloas.ExecutionPayloadBid.defaultValue();
  bid.executionRequestsRoot = ssz.electra.ExecutionRequests.hashTreeRoot(signedEnvelope.message.executionRequests);
  return bid;
}

function makePayloadInput(props: {
  builderIndex: number;
  blockHash: Uint8Array;
  bid: gloas.ExecutionPayloadBid;
}): FakePayloadInput {
  return {
    getBuilderIndex: vi.fn().mockReturnValue(props.builderIndex),
    getBlockHashHex: vi.fn().mockReturnValue(toRootHex(props.blockHash)),
    getBid: vi.fn().mockReturnValue(props.bid),
    hasPayloadEnvelope: vi.fn().mockReturnValue(false),
    addPayloadEnvelope: vi.fn(),
  };
}

describe("admitEnvelopeByRoot", () => {
  let getBuilder: Mock;
  let getOrThrow: Mock;
  let verifySignatureSets: Mock;
  let deps: AdmitEnvelopeDeps;

  beforeEach(() => {
    getBuilder = vi.fn();
    getOrThrow = vi.fn();
    verifySignatureSets = vi.fn().mockResolvedValue(true);

    deps = {
      config,
      pubkeyCache: {getOrThrow} as unknown as AdmitEnvelopeDeps["pubkeyCache"],
      // post-gloas head state with a `getBuilder` accessor; only `forkName`/`getBuilder` are read.
      headState: {forkName: "gloas", getBuilder} as unknown as AdmitEnvelopeDeps["headState"],
      bls: {verifySignatureSets} as unknown as AdmitEnvelopeDeps["bls"],
    };
  });

  it("self-build: ADMITTED without touching the builder registry", async () => {
    // self-build path uses the proposer pubkey from the pubkeyCache; never reads the state registry
    getOrThrow.mockReturnValue(SecretKey.fromKeygen(Buffer.alloc(32, 1)).toPublicKey());

    const signedEnvelope = buildSignedEnvelope({builderIndex: SELF_BUILD_INDEX});
    const bid = bidMatching(signedEnvelope);
    const payloadInput = makePayloadInput({
      builderIndex: SELF_BUILD_INDEX,
      blockHash: BLOCK_HASH,
      bid,
    });

    const result = await admitEnvelopeByRoot(
      deps,
      payloadInput as never,
      PROPOSER_INDEX,
      signedEnvelope,
      SEEN_TIMESTAMP_SEC
    );

    expect(result).toBe("ADMITTED");
    expect(getBuilder).not.toHaveBeenCalled();
    expect(verifySignatureSets).toHaveBeenCalledOnce();
    expect(payloadInput.addPayloadEnvelope).toHaveBeenCalledOnce();
    expect(payloadInput.addPayloadEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: signedEnvelope,
        source: PayloadEnvelopeInputSource.byRoot,
        seenTimestampSec: SEEN_TIMESTAMP_SEC,
      })
    );
  });

  it("external builder: ADMITTED, reads the builder registry at the index", async () => {
    getBuilder.mockReturnValue({pubkey: REAL_BUILDER_PUBKEY});

    const signedEnvelope = buildSignedEnvelope({builderIndex: EXTERNAL_BUILDER_INDEX});
    const bid = bidMatching(signedEnvelope);
    const payloadInput = makePayloadInput({
      builderIndex: EXTERNAL_BUILDER_INDEX,
      blockHash: BLOCK_HASH,
      bid,
    });

    const result = await admitEnvelopeByRoot(
      deps,
      payloadInput as never,
      PROPOSER_INDEX,
      signedEnvelope,
      SEEN_TIMESTAMP_SEC
    );

    expect(result).toBe("ADMITTED");
    expect(getBuilder).toHaveBeenCalledWith(EXTERNAL_BUILDER_INDEX);
    expect(getOrThrow).not.toHaveBeenCalled();
    expect(payloadInput.addPayloadEnvelope).toHaveBeenCalledOnce();
  });

  it("REJECTED on bid mismatch before any bls / registry work", async () => {
    const signedEnvelope = buildSignedEnvelope({builderIndex: EXTERNAL_BUILDER_INDEX});
    const bid = bidMatching(signedEnvelope);
    // payloadInput's builderIndex disagrees with the envelope → bid mismatch
    const payloadInput = makePayloadInput({
      builderIndex: EXTERNAL_BUILDER_INDEX + 1,
      blockHash: BLOCK_HASH,
      bid,
    });

    const result = await admitEnvelopeByRoot(
      deps,
      payloadInput as never,
      PROPOSER_INDEX,
      signedEnvelope,
      SEEN_TIMESTAMP_SEC
    );

    expect(result).toBe("REJECTED");
    expect(verifySignatureSets).not.toHaveBeenCalled();
    expect(getBuilder).not.toHaveBeenCalled();
    expect(payloadInput.addPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("DEFERRED_NO_BUILDER on bad signature for an external builder (head-state pubkey may be wrong)", async () => {
    // The external builder pubkey is resolved from head state, which need not match a historical
    // block's builder registry — a mismatch is not provably bad, so defer to import-time re-verify.
    verifySignatureSets.mockResolvedValue(false);
    getBuilder.mockReturnValue({pubkey: REAL_BUILDER_PUBKEY});

    const signedEnvelope = buildSignedEnvelope({builderIndex: EXTERNAL_BUILDER_INDEX});
    const bid = bidMatching(signedEnvelope);
    const payloadInput = makePayloadInput({
      builderIndex: EXTERNAL_BUILDER_INDEX,
      blockHash: BLOCK_HASH,
      bid,
    });

    const result = await admitEnvelopeByRoot(
      deps,
      payloadInput as never,
      PROPOSER_INDEX,
      signedEnvelope,
      SEEN_TIMESTAMP_SEC
    );

    expect(result).toBe("DEFERRED_NO_BUILDER");
    expect(verifySignatureSets).toHaveBeenCalledOnce();
    expect(payloadInput.addPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("REJECTED on bad signature for self-build (state-independent proposer pubkey)", async () => {
    // Self-build resolves the proposer pubkey from the pubkeyCache (state-independent), so a bad
    // signature IS provably bad regardless of which historical block this is.
    verifySignatureSets.mockResolvedValue(false);

    const signedEnvelope = buildSignedEnvelope({builderIndex: SELF_BUILD_INDEX});
    const bid = bidMatching(signedEnvelope);
    const payloadInput = makePayloadInput({builderIndex: SELF_BUILD_INDEX, blockHash: BLOCK_HASH, bid});

    const result = await admitEnvelopeByRoot(
      deps,
      payloadInput as never,
      PROPOSER_INDEX,
      signedEnvelope,
      SEEN_TIMESTAMP_SEC
    );

    expect(result).toBe("REJECTED");
    expect(verifySignatureSets).toHaveBeenCalledOnce();
    expect(payloadInput.addPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("DEFERRED_NO_BUILDER when the external builder index is absent from the head state", async () => {
    getBuilder.mockImplementation(() => {
      throw new Error("Index out of bounds");
    });

    const signedEnvelope = buildSignedEnvelope({builderIndex: ABSENT_BUILDER_INDEX});
    const bid = bidMatching(signedEnvelope);
    const payloadInput = makePayloadInput({
      builderIndex: ABSENT_BUILDER_INDEX,
      blockHash: BLOCK_HASH,
      bid,
    });

    const result = await admitEnvelopeByRoot(
      deps,
      payloadInput as never,
      PROPOSER_INDEX,
      signedEnvelope,
      SEEN_TIMESTAMP_SEC
    );

    expect(result).toBe("DEFERRED_NO_BUILDER");
    expect(verifySignatureSets).not.toHaveBeenCalled();
    expect(payloadInput.addPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("ADMITTED without re-adding when the envelope is already present (benign first-writer race)", async () => {
    // Valid path: bid-binding matches, signature verifies — but a concurrent source already filled
    // the slot. The race is benign (the winner also passed self-verifiable checks), so we skip the
    // add and return ADMITTED.
    getBuilder.mockReturnValue({pubkey: REAL_BUILDER_PUBKEY});

    const signedEnvelope = buildSignedEnvelope({builderIndex: EXTERNAL_BUILDER_INDEX});
    const bid = bidMatching(signedEnvelope);
    const payloadInput = makePayloadInput({
      builderIndex: EXTERNAL_BUILDER_INDEX,
      blockHash: BLOCK_HASH,
      bid,
    });
    payloadInput.hasPayloadEnvelope.mockReturnValue(true);

    const result = await admitEnvelopeByRoot(
      deps,
      payloadInput as never,
      PROPOSER_INDEX,
      signedEnvelope,
      SEEN_TIMESTAMP_SEC
    );

    expect(result).toBe("ADMITTED");
    expect(verifySignatureSets).toHaveBeenCalledOnce();
    expect(payloadInput.addPayloadEnvelope).not.toHaveBeenCalled();
  });

  it("rethrows when addPayloadEnvelope throws a beacon_block_root mismatch (not swallowed as ADMITTED)", async () => {
    // A mismatch error is NOT the benign race case — it must propagate so the caller can handle it.
    getBuilder.mockReturnValue({pubkey: REAL_BUILDER_PUBKEY});

    const signedEnvelope = buildSignedEnvelope({builderIndex: EXTERNAL_BUILDER_INDEX});
    const bid = bidMatching(signedEnvelope);
    const payloadInput = makePayloadInput({
      builderIndex: EXTERNAL_BUILDER_INDEX,
      blockHash: BLOCK_HASH,
      bid,
    });
    payloadInput.addPayloadEnvelope.mockImplementation(() => {
      throw new Error("Payload envelope beacon_block_root mismatch");
    });

    await expect(
      admitEnvelopeByRoot(deps, payloadInput as never, PROPOSER_INDEX, signedEnvelope, SEEN_TIMESTAMP_SEC)
    ).rejects.toThrow(/beacon_block_root mismatch/);
  });

  it("self-build sig-set throw rethrows (not DEFERRED)", async () => {
    // For self-build, a throw during sig-set construction must NOT be caught as DEFERRED_NO_BUILDER —
    // that path is external-builder-only. The error must propagate.
    getOrThrow.mockImplementation(() => {
      throw new Error("pubkey not found");
    });

    const signedEnvelope = buildSignedEnvelope({builderIndex: SELF_BUILD_INDEX});
    const bid = bidMatching(signedEnvelope);
    const payloadInput = makePayloadInput({
      builderIndex: SELF_BUILD_INDEX,
      blockHash: BLOCK_HASH,
      bid,
    });

    await expect(
      admitEnvelopeByRoot(deps, payloadInput as never, PROPOSER_INDEX, signedEnvelope, SEEN_TIMESTAMP_SEC)
    ).rejects.toThrow(/pubkey not found/);

    expect(verifySignatureSets).not.toHaveBeenCalled();
    expect(payloadInput.addPayloadEnvelope).not.toHaveBeenCalled();
  });
});
