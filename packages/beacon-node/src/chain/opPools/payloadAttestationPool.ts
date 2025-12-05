import { aggregateSignatures, Signature } from "@chainsafe/blst";
import { ChainForkConfig } from "@lodestar/config";
import { RootHex, Slot, gloas } from "@lodestar/types";
import { MapDef, toRootHex } from "@lodestar/utils";
import { IClock } from "../../util/clock.ts";
import { MAX_COMMITTEES_PER_SLOT, PTC_SIZE } from "@lodestar/params";
import { InsertOutcome, OpPoolError, OpPoolErrorCode } from "./types.ts";
import { pruneBySlot, signatureFromBytesNoCheck } from "./utils.ts";
import { BitArray } from "@chainsafe/ssz";
import { Metrics } from "../../metrics/metrics.ts";

/**
 * The number of slots that will be stored in the pool
 */
const SLOTS_RETAINED = 2;

/**
 * The maximum number of distinct `PayloadAttestationData` that will be stored in each slot.
 *
 * This is a DoS protection measure.
 */
// TODO GLOAS: Revisit this value. Educated guess would be MAX_ATTESTATIONS_PER_SLOT in AttestationPool divided by MAX_COMMITTEES_PER_SLOT
const MAX_PAYLOAD_ATTESTATIONS_PER_SLOT = 16_384 / MAX_COMMITTEES_PER_SLOT;

type PayloadAttestation = gloas.PayloadAttestation;
type PayloadAttestationData = gloas.PayloadAttestationData;
type PayloadAttestationMessage = gloas.PayloadAttestationMessage;
type DataRootHex = string;
type BlockRootHex = string;

type AggregateFast = {
  aggregationBits: BitArray,
  data: PayloadAttestationData,
  signature: Signature,
}

export class PayloadAttestationPool {
  private readonly aggregateByDataRootByBlockRootBySlot = new MapDef<
    Slot,
    Map<BlockRootHex, Map<DataRootHex, AggregateFast>>
    >(() => new Map<BlockRootHex, Map<DataRootHex, AggregateFast>>());
  private lowestPermissibleSlot = 0;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly clock: IClock,
    private readonly metrics: Metrics | null = null
  ) {}

  add(message: PayloadAttestationMessage, payloadAttDataRootHex: RootHex, validatorCommitteeIndex: number): InsertOutcome {
    const slot = message.data.slot;
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    if (slot < this.clock.slotWithPastTolerance(this.config.MAXIMUM_GOSSIP_CLOCK_DISPARITY / 1000)) {
      return InsertOutcome.Late;
    }

    const aggregateByDataRootByBlockRoot = this.aggregateByDataRootByBlockRootBySlot.getOrDefault(slot);
    let aggregateByDataRoot = aggregateByDataRootByBlockRoot.get(toRootHex(message.data.beaconBlockRoot));

    if (aggregateByDataRoot === undefined) {
      aggregateByDataRoot = new Map<DataRootHex, AggregateFast>();
      aggregateByDataRootByBlockRoot.set(toRootHex(message.data.beaconBlockRoot), aggregateByDataRoot);
    }

    if (aggregateByDataRoot.size >= MAX_PAYLOAD_ATTESTATIONS_PER_SLOT) {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    }

    let aggregate = aggregateByDataRoot.get(payloadAttDataRootHex);
    if (aggregate) {
      // Aggregate msg into aggregate
      return aggregateMessageInto(message, validatorCommitteeIndex, aggregate);
    }
    // Create a new aggregate with data
    aggregateByDataRoot.set(payloadAttDataRootHex, messageToAggregate(message, validatorCommitteeIndex));

    return InsertOutcome.NewData;
  }

  /**
   * Get payload attestations to be included in a block.
   * Pick the top `maxAttestation` number of attestations with the most votes
   * 
   */
  getPayloadAttesttationsForBlock(
    beaconBlockRoot: BlockRootHex,
    slot: Slot,
    maxAttestation: number
  ): PayloadAttestation[] {

    const aggregateByDataRootByBlockRoot = this.aggregateByDataRootByBlockRootBySlot.get(slot);

    if (!aggregateByDataRootByBlockRoot) {
      this.metrics?.opPool.payloadAttestationPool.getPayloadAttestationsCacheMisses.inc();
      return [];
    }

    const aggregateByDataRoot = aggregateByDataRootByBlockRoot.get(beaconBlockRoot);

    if (!aggregateByDataRoot) {
      this.metrics?.opPool.payloadAttestationPool.getPayloadAttestationsCacheMisses.inc();
      return [];
    }

    return Array.from(aggregateByDataRoot.values())
      .slice()
      .sort((a, b) => b.aggregationBits.getTrueBitIndexes().length - a.aggregationBits.getTrueBitIndexes().length)
      .slice(maxAttestation)
      .map(fastToPayloadAttestation);
  }

  prune(clockSlot: Slot): void {
    pruneBySlot(this.aggregateByDataRootByBlockRootBySlot, clockSlot, SLOTS_RETAINED);
    this.lowestPermissibleSlot = clockSlot;
  }

}

function messageToAggregate(message: PayloadAttestationMessage, validatorCommitteeIndex: number): AggregateFast {
  return {
    aggregationBits: BitArray.fromSingleBit(PTC_SIZE, validatorCommitteeIndex),
    data: message.data,
    signature: signatureFromBytesNoCheck(message.signature),
  }
}

function aggregateMessageInto(
  message: PayloadAttestationMessage,
  validatorCommitteeIndex: number,
  aggregate: AggregateFast,
): InsertOutcome {

  if (aggregate.aggregationBits.get(validatorCommitteeIndex) === true) {
    return InsertOutcome.AlreadyKnown;
  }

  aggregate.aggregationBits.set(validatorCommitteeIndex, true);
  aggregate.signature = aggregateSignatures([aggregate.signature, signatureFromBytesNoCheck(message.signature)]);
  
  return InsertOutcome.Aggregated;
}

function fastToPayloadAttestation(aggFast: AggregateFast): PayloadAttestation {
  return {...aggFast, signature: aggFast.signature.toBytes()};
}