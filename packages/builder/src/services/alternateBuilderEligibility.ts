import {routes} from "@lodestar/api";
import {PAYLOAD_BUILDER_VERSION, isForkPostGloas} from "@lodestar/params";
import type {BLSPubkey, BuilderIndex, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";

export type AlternatePayloadAttributesEvent = routes.events.AlternatePayloadAttributesEvent;

type AlternateBuilderContext = {
  slot: Slot;
  parentBlockRoot: RootHex;
  parentBlockHash: RootHex;
  dependentRoot: RootHex;
  proposerIndex: ValidatorIndex;
  builderIndex: BuilderIndex;
  builderPubkey: BLSPubkey;
  unsettledGwei: number;
};

/** Branch metadata already reserves consensus pending payments. Local unsettled
 * liabilities are additionally reserved because newer selections may be absent. */
export function getAlternateBuilderBidLimit(
  event: AlternatePayloadAttributesEvent,
  expected: AlternateBuilderContext
): number | null {
  if (event.context?.role !== "alternate") return null;
  const {data} = event;
  const {dependentRoot, builders} = event.context;
  if (
    !isForkPostGloas(event.version) ||
    !dependentRoot ||
    !Array.isArray(builders) ||
    data.proposalSlot !== expected.slot ||
    data.proposerIndex !== expected.proposerIndex ||
    data.parentBlockRoot.length !== 32 ||
    data.parentBlockHash.length !== 32 ||
    dependentRoot.length !== 32 ||
    data.payloadAttributes.parentBeaconBlockRoot.length !== 32 ||
    toRootHex(data.parentBlockRoot) !== expected.parentBlockRoot ||
    toRootHex(data.parentBlockHash) !== expected.parentBlockHash ||
    toRootHex(dependentRoot) !== expected.dependentRoot ||
    !byteArrayEquals(data.parentBlockRoot, data.payloadAttributes.parentBeaconBlockRoot) ||
    !Number.isSafeInteger(expected.unsettledGwei) ||
    expected.unsettledGwei < 0 ||
    expected.builderPubkey.length !== 48 ||
    builders.length === 0 ||
    builders.length > routes.events.MAX_PAYLOAD_ATTRIBUTES_ALTERNATE_BUILDERS
  )
    return null;

  const indices = new Set<BuilderIndex>();
  let availableGwei: number | null = null;
  for (const builder of builders) {
    if (
      !Number.isSafeInteger(builder.index) ||
      builder.index < 0 ||
      indices.has(builder.index) ||
      !Number.isSafeInteger(builder.availableGwei) ||
      builder.availableGwei < 0 ||
      builder.pubkey.length !== 48
    )
      return null;
    indices.add(builder.index);
    if (builder.index === expected.builderIndex) {
      if (
        builder.active !== true ||
        builder.version !== PAYLOAD_BUILDER_VERSION ||
        !byteArrayEquals(builder.pubkey, expected.builderPubkey)
      )
        return null;
      availableGwei = builder.availableGwei;
    }
  }
  return availableGwei === null || availableGwei <= expected.unsettledGwei
    ? null
    : availableGwei - expected.unsettledGwei;
}
