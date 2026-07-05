import {ForkPostGloas} from "@lodestar/params";
import {SignedBeaconBlock} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {prettyPrintPeerIdStr} from "../../network/util.js";
import {WarnResult} from "../../util/wrapError.js";
import {DownloadByRootError, DownloadByRootErrorCode, FetchByRootCoreProps} from "../utils/downloadByRoot.js";
import {AdmitEnvelopeDeps, EnvelopeAdmissionResult, admitEnvelopeByRoot} from "./envelopeAdmission.js";

// "PEER_MISS" is a fetcher-level sentinel meaning the remote peer returned no envelope.
// It is intentionally distinct from the admission-level "DEFERRED_NO_BUILDER" result so
// that consumers can tell "peer served nothing" apart from
// "peer served an envelope whose external builder is absent".
export type EnvelopeFetchResult = EnvelopeAdmissionResult | "PEER_MISS";

export type FetchByRootAndValidateEnvelopeProps = Omit<FetchByRootCoreProps, "peerMeta"> & {
  peerIdStr: string;
  blockRoot: Uint8Array;
  blockRootHex: string;
  block: SignedBeaconBlock<ForkPostGloas>;
  seenTimestampSec: number;
};

/**
 * Fetch a gloas execution-payload envelope by root and self-verifiably admit it. Lives in
 * `sync/target` (not the shared `sync/utils/downloadByRoot`) because it is the sole consumer of
 * the TargetSync-owned `admitEnvelopeByRoot`; keeping it here keeps the shared by-root utility free
 * of any `sync/target` dependency. Reuses the shared `DownloadByRootError` for warning parity.
 */
export async function fetchAndValidateExecutionPayloadEnvelopeByRoot({
  chain,
  network,
  peerIdStr,
  blockRoot,
  blockRootHex,
  block,
  seenTimestampSec,
}: FetchByRootAndValidateEnvelopeProps): Promise<WarnResult<EnvelopeFetchResult, DownloadByRootError>> {
  const envelopes = await network.sendExecutionPayloadEnvelopesByRoot(peerIdStr, [blockRoot]);

  if (envelopes.length === 0) {
    return {
      result: "PEER_MISS",
      warnings: [
        new DownloadByRootError({
          code: DownloadByRootErrorCode.MISSING_ENVELOPE_RESPONSE,
          peer: prettyPrintPeerIdStr(peerIdStr),
          blockRoot: blockRootHex,
        }),
      ],
    };
  }

  // The envelope's builder signature commits to its beaconBlockRoot, so a relaying peer cannot
  // forge it; a mismatch means the peer served an envelope for a different block (a builder
  // equivocation). Reject + score rather than admit it against the wrong block's input. Mirrors
  // the canonical `BlockInputSync.fetchExecutionPayloadEnvelope` root check.
  if (toRootHex(envelopes[0].message.beaconBlockRoot) !== blockRootHex) {
    return {
      result: "REJECTED",
      warnings: [
        new DownloadByRootError({
          code: DownloadByRootErrorCode.ENVELOPE_REJECTED,
          peer: prettyPrintPeerIdStr(peerIdStr),
          blockRoot: blockRootHex,
        }),
      ],
    };
  }

  if (!chain) {
    // chain null is only for testing; in production chain is always present
    return {result: "DEFERRED_NO_BUILDER", warnings: null};
  }

  // `add` is get-or-create — it returns the existing entry if present, else creates one.
  const payloadInput = chain.seenPayloadEnvelopeInputCache.add({
    blockRootHex,
    block,
    forkName: chain.config.getForkName(block.message.slot),
    sampledColumns: chain.custodyConfig.sampledColumns,
    custodyColumns: chain.custodyConfig.custodyColumns,
    timeCreatedSec: seenTimestampSec,
  });

  const deps: AdmitEnvelopeDeps = {
    config: chain.config,
    pubkeyCache: chain.pubkeyCache,
    headState: chain.getHeadState(),
    bls: chain.bls,
  };

  const result = await admitEnvelopeByRoot(
    deps,
    payloadInput,
    block.message.proposerIndex,
    envelopes[0],
    seenTimestampSec
  );

  if (result === "REJECTED") {
    return {
      result,
      warnings: [
        new DownloadByRootError({
          code: DownloadByRootErrorCode.ENVELOPE_REJECTED,
          peer: prettyPrintPeerIdStr(peerIdStr),
          blockRoot: blockRootHex,
        }),
      ],
    };
  }

  return {result, warnings: null};
}
