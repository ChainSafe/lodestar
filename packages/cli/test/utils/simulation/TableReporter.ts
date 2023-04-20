/* eslint-disable no-console */
import {Slot} from "@lodestar/types";
import {HeadSummary} from "./assertions/defaults/headAssertion.js";
import {defaultAssertions} from "./assertions/defaults/index.js";
import {SimulationReporter} from "./interfaces.js";
import {TableRenderer} from "./TableRenderer.js";
import {arrayGroupBy, avg, arrayIsUnique} from "./utils/index.js";

export class TableReporter extends SimulationReporter<typeof defaultAssertions> {
  private lastPrintedSlot = -1;

  private table = new TableRenderer({
    fork: 10,
    eph: 5,
    slot: 4,
    head: 8,
    finzed: 6,
    peers: 6,
    attCount: 8,
    incDelay: 8,
    errors: 10,
  });

  bootstrap(): void {
    this.table.printHeader();
  }

  progress(slot: Slot): void {
    // Print slots once, may be called twice for missed block timer
    if (slot <= this.lastPrintedSlot) {
      return;
    } else {
      this.lastPrintedSlot = slot;
    }

    if (slot <= 0) {
      return;
    }

    const {clock, forkConfig, nodes, stores, errors} = this.options;

    const epoch = clock.getEpochForSlot(slot);
    const forkName = forkConfig.getForkName(slot);
    const epochStr = `${epoch}/${clock.getSlotIndexInEpoch(slot)}`;

    if (clock.isFirstSlotOfEpoch(slot)) {
      // We are printing this info for last epoch
      if (epoch - 1 < forkConfig.ALTAIR_FORK_EPOCH) {
        this.table.addEmptyRow("Att Participation: N/A - SC Participation: N/A");
      } else {
        // As it's printed on the first slot of epoch we need to get the previous epoch
        const startSlot = clock.getFirstSlotOfEpoch(epoch - 1);
        const endSlot = clock.getLastSlotOfEpoch(epoch - 1);
        const nodesSyncParticipationAvg: number[] = [];
        const participation: {head: number; source: number; target: number}[] = [];

        for (const node of nodes) {
          participation.push(stores["attestationParticipation"][node.cl.id][slot] ?? 0);
          const syncCommitteeParticipation: number[] = [];
          for (let slot = startSlot; slot <= endSlot; slot++) {
            syncCommitteeParticipation.push(stores["syncCommitteeParticipation"][node.cl.id][slot]);
          }
          nodesSyncParticipationAvg.push(avg(syncCommitteeParticipation));
        }

        // attestationParticipation is calculated at first slot of an epoch
        const head = avg(participation.map((p) => p.head)).toFixed(2);
        const source = avg(participation.map((p) => p.source)).toFixed(2);
        const target = avg(participation.map((p) => p.target)).toFixed(2);
        const syncParticipation = avg(nodesSyncParticipationAvg).toFixed(2);

        this.table.addEmptyRow(
          `Att Participation: H: ${head}, S: ${source}, T: ${target} - SC Participation: ${syncParticipation}`
        );
      }
    }

    const finalizedSlots: number[] = [];
    const inclusionDelay: number[] = [];
    const attestationCount: number[] = [];
    const heads: HeadSummary[] = [];
    const peerCount: number[] = [];

    for (const node of nodes) {
      finalizedSlots.push(stores["finalized"][node.cl.id][slot] ?? "-");
      inclusionDelay.push(stores["inclusionDelay"][node.cl.id][slot] ?? "-");
      attestationCount.push(stores["attestationsCount"][node.cl.id][slot] ?? "-");
      heads.push(stores["head"][node.cl.id][slot] ?? "-");
      peerCount.push(stores["connectedPeerCount"][node.cl.id][slot] ?? "-");
    }

    const head0 = heads.length > 0 ? heads[0] : null;
    const nodesHaveSameHead = heads.every(
      (head) =>
        head0 && head0.blockRoot !== null && head0.blockRoot !== undefined && head?.blockRoot === head0.blockRoot
    );
    const errorCount = errors.filter((e) => e.slot === slot).length;

    this.table.addRow({
      fork: forkName,
      eph: epochStr,
      slot: head0 ? head0.slot : "-",
      head: head0 ? (nodesHaveSameHead ? `${head0?.blockRoot.slice(0, 6)}..` : "different") : "-",
      finzed:
        !arrayIsUnique(finalizedSlots) && finalizedSlots[0] !== undefined
          ? finalizedSlots[0]
          : finalizedSlots.join(","),
      peers: !arrayIsUnique(peerCount) && peerCount[0] !== undefined ? peerCount[0] : peerCount.join(","),
      attCount: !arrayIsUnique(attestationCount) && attestationCount[0] !== undefined ? attestationCount[0] : "---",
      incDelay:
        !arrayIsUnique(inclusionDelay) && inclusionDelay[0] !== undefined ? inclusionDelay[0].toFixed(2) : "---",
      errors: errorCount,
    });
  }

  summary(): void {
    const {errors} = this.options;

    console.log(`├${"─".repeat(10)} Errors (${errors.length}) ${"─".repeat(10)}┤`);

    const groupBySlot = arrayGroupBy(errors, (e) => String(e.slot as number));

    for (const [slot, slotErrors] of Object.entries(groupBySlot)) {
      if (slotErrors.length > 0) console.log(`├─ Slot: ${slot}`);
      const groupByAssertion = arrayGroupBy(slotErrors, (e) => e.assertionId);

      for (const [assertionId, assertionErrors] of Object.entries(groupByAssertion)) {
        if (assertionErrors.length > 0) console.log(`├── Assertion: ${assertionId}`);

        for (const error of assertionErrors) {
          console.error(`├──── ${error.message}`);
        }
      }
    }
  }
}
