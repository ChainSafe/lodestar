import {Signature, aggregateSignatures} from "@chainsafe/blst";
import {BitArray} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {MAX_COMMITTEES_PER_SLOT, PTC_SIZE} from "@lodestar/params";
import {RootHex, Slot, gloas} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {IClock} from "../../util/clock.js";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "./types.js";
import {pruneBySlot, signatureFromBytesNoCheck} from "./utils.js";

/**
 * TODO GLOAS: Revisit this value and add rational for choosing it
 */
const SLOTS_RETAINED = 2;

/**
 * The maximum number of distinct `PayloadAttestationData` that will be stored in each slot.
 *
 * This is a DoS protection measure.
 */
// TODO GLOAS: Revisit this value. Educated guess would be MAX_ATTESTATIONS_PER_SLOT in AttestationPool divided by MAX_COMMITTEES_PER_SLOT
const MAX_PAYLOAD_ATTESTATIONS_PER_SLOT = 16_384 / MAX_COMMITTEES_PER_SLOT;

type DataRootHex = string;
type BlockRootHex = string;

type AggregateFast = {
  aggregationBits: BitArray;
  data: gloas.PayloadAttestationData;
  signature: Signature;
};

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

  get size(): number {
    let count = 0;
    for (const aggregateByDataRootByBlockRoot of this.aggregateByDataRootByBlockRootBySlot.values()) {
      for (const aggregateByDataRoot of aggregateByDataRootByBlockRoot.values()) {
        count += aggregateByDataRoot.size;
      }
    }
    return count;
  }

  add(
    message: gloas.PayloadAttestationMessage,
    payloadAttDataRootHex: RootHex,
    validatorCommitteeIndex: number
  ): InsertOutcome {
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

    if (!aggregateByDataRoot) {
      aggregateByDataRoot = new Map<DataRootHex, AggregateFast>();
      aggregateByDataRootByBlockRoot.set(toRootHex(message.data.beaconBlockRoot), aggregateByDataRoot);
    }

    if (aggregateByDataRoot.size >= MAX_PAYLOAD_ATTESTATIONS_PER_SLOT) {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    }

    const aggregate = aggregateByDataRoot.get(payloadAttDataRootHex);
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
   */
  getPayloadAttestationsForBlock(
    beaconBlockRoot: BlockRootHex,
    slot: Slot,
    maxAttestation: number
  ): gloas.PayloadAttestation[] {
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
      .slice(0, maxAttestation)
      .map(fastToPayloadAttestation);
  }

  prune(clockSlot: Slot): void {
    pruneBySlot(this.aggregateByDataRootByBlockRootBySlot, clockSlot, SLOTS_RETAINED);
    this.lowestPermissibleSlot = clockSlot;
  }
}

function messageToAggregate(message: gloas.PayloadAttestationMessage, validatorCommitteeIndex: number): AggregateFast {
  return {
    aggregationBits: BitArray.fromSingleBit(PTC_SIZE, validatorCommitteeIndex),
    data: message.data,
    signature: signatureFromBytesNoCheck(message.signature),
  };
}

function aggregateMessageInto(
  message: gloas.PayloadAttestationMessage,
  validatorCommitteeIndex: number,
  aggregate: AggregateFast
): InsertOutcome {
  if (aggregate.aggregationBits.get(validatorCommitteeIndex) === true) {
    return InsertOutcome.AlreadyKnown;
  }

  aggregate.aggregationBits.set(validatorCommitteeIndex, true);
  aggregate.signature = aggregateSignatures([aggregate.signature, signatureFromBytesNoCheck(message.signature)]);

  return InsertOutcome.Aggregated;
}

function fastToPayloadAttestation(aggFast: AggregateFast): gloas.PayloadAttestation {
  return {...aggFast, signature: aggFast.signature.toBytes()};
}
