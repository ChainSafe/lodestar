import {BeaconConfig} from "@lodestar/config";
import {BUILDER_INDEX_SELF_BUILD} from "@lodestar/params";
import {IBeaconStateView, PubkeyCache, getExecutionPayloadEnvelopeSignatureSet} from "@lodestar/state-transition";
import {ValidatorIndex, gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../chain/blocks/payloadEnvelopeInput/types.js";
import {IBlsVerifier} from "../../chain/bls/index.js";

/**
 * Outcome of admitting a by-root execution payload envelope to its `PayloadEnvelopeInput`.
 *
 * - `ADMITTED`: the envelope passed bid-binding + builder-signature checks and was written to the
 *   first-writer-wins container (or another valid source already won the race).
 * - `REJECTED`: the envelope failed a self-verifiable check (bid mismatch or bad signature). The
 *   caller should score the serving peer `Low` — it served a provably-bad envelope.
 * - `DEFERRED_NO_BUILDER`: the envelope references an external builder index that is absent from the
 *   head-state builder registry, so it cannot be verified here. Left for the import path.
 */
export type EnvelopeAdmissionResult = "ADMITTED" | "REJECTED" | "DEFERRED_NO_BUILDER";

export type AdmitEnvelopeDeps = {
  config: BeaconConfig;
  pubkeyCache: PubkeyCache;
  /** Head state, for resolving the external builder registry pubkey. */
  headState: IBeaconStateView;
  bls: Pick<IBlsVerifier, "verifySignatureSets">;
};

/**
 * Self-verifiably admit a by-root execution payload envelope to its first-writer-wins
 * `PayloadEnvelopeInput`, closing the cache-poisoning hole: an envelope is only written after it is
 * proven to bind to the slot's accepted bid AND to carry a valid builder signature, so a bogus
 * envelope from a peer cannot claim the slot.
 *
 * Checks, in order (cheapest first):
 *  1. Bid-binding — the envelope's builderIndex, payload blockHash and executionRequests root must
 *     match the bid recorded in the `PayloadEnvelopeInput`. Any mismatch → `REJECTED` (no BLS work).
 *  2. Builder signature — for external builders, if the index is absent from the head-state registry
 *     the envelope cannot be verified here → `DEFERRED_NO_BUILDER`. Otherwise the builder (external)
 *     or proposer (self-build) pubkey is used to verify the signature; an invalid signature →
 *     `REJECTED`.
 *  3. Admit — write to the container with `source: byRoot`. A benign first-writer race (another
 *     source already set the payload) is treated as `ADMITTED`.
 */
export async function admitEnvelopeByRoot(
  deps: AdmitEnvelopeDeps,
  payloadInput: PayloadEnvelopeInput,
  proposerIndex: ValidatorIndex,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
  seenTimestampSec: number
): Promise<EnvelopeAdmissionResult> {
  const {config, pubkeyCache, headState, bls} = deps;
  const envelope = signedEnvelope.message;

  // 1. Bid-binding: the envelope must bind to the accepted bid for this slot.
  const builderIndexMatches = envelope.builderIndex === payloadInput.getBuilderIndex();
  const blockHashMatches = toRootHex(envelope.payload.blockHash) === payloadInput.getBlockHashHex();
  const executionRequestsRootMatches = ssz.Root.equals(
    ssz.electra.ExecutionRequests.hashTreeRoot(envelope.executionRequests),
    payloadInput.getBid().executionRequestsRoot
  );
  if (!builderIndexMatches || !blockHashMatches || !executionRequestsRootMatches) {
    return "REJECTED";
  }

  // 2. Builder signature. Self-build resolves the proposer pubkey from the pubkeyCache (no state);
  // external resolves the builder pubkey from the head-state registry. If that index is absent the
  // registry access throws — the envelope is not provably bad, so defer it for the import path
  // rather than rejecting (and never reach BLS verification).
  const isExternalBuilder = envelope.builderIndex !== BUILDER_INDEX_SELF_BUILD;
  let signatureSet: ReturnType<typeof getExecutionPayloadEnvelopeSignatureSet>;
  try {
    signatureSet = getExecutionPayloadEnvelopeSignatureSet(
      config,
      pubkeyCache,
      headState,
      signedEnvelope,
      proposerIndex
    );
  } catch (e) {
    if (isExternalBuilder) {
      // NOTE: IBeaconStateView exposes no builder-count accessor, so an out-of-range external
      // builderIndex (provably-wrong, peer should be scored) is indistinguishable here from a
      // genuinely-absent builder (a benign race vs import) — both DEFER. This is SAFE for the
      // first-writer-wins container (DEFER never admits) but costs a peer score on the wrong-index
      // case. Narrowing to REJECT out-of-range needs an upstream builder-count/typed-error.
      return "DEFERRED_NO_BUILDER";
    }
    throw e;
  }

  const isValidSignature = await bls.verifySignatureSets([signatureSet], {verifyOnMainThread: true});
  if (!isValidSignature) {
    // For an external builder the pubkey was resolved from head state, which need not match a
    // historical block's builder registry (a reused builder slot), so a signature mismatch is not
    // provably bad — defer to the authoritative import-time re-verification against the block's own
    // state rather than scoring the serving peer. A self-build mismatch uses the state-independent
    // proposer pubkey, so it IS provably bad.
    return isExternalBuilder ? "DEFERRED_NO_BUILDER" : "REJECTED";
  }

  // 3. Admit to the first-writer-wins container. If another source already set the payload (a
  // benign race — it too passed self-verifiable checks), the slot is already filled by a valid
  // envelope, so skip the add. No await between the check and the add (no TOCTOU); and this runs
  // after BLS verification, so a bad-signature envelope was already REJECTED above. Guarding on
  // hasPayloadEnvelope() rather than catching the add's "already set" message keeps control flow
  // off the exact wording of an error string.
  if (!payloadInput.hasPayloadEnvelope()) {
    payloadInput.addPayloadEnvelope({
      envelope: signedEnvelope,
      source: PayloadEnvelopeInputSource.byRoot,
      seenTimestampSec,
      peerIdStr: undefined,
    });
  }

  return "ADMITTED";
}
