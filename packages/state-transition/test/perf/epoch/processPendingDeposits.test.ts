import {bench, describe} from "@chainsafe/benchmark";
import {ContainerNodeStructType, ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {PENDING_DEPOSITS_LIMIT} from "@lodestar/params";
import {ssz} from "@lodestar/types";

// PERF: Cost is O(pendingDeposits.length). In the worst case (large deposit queue after a big network event),
// this can be 50_000 items. Each item requires reading all 5 fields.
//
// Benchmarks ContainerType (current) vs ContainerNodeStructType (proposed) for field access performance.
// ContainerNodeStructType stores items as plain JS objects, avoiding tree traversal on every field read.

const NUM_DEPOSITS = 50_000;
const CHUNK = 100;

// Reuse the same field types as the existing PendingDeposit SSZ type
const fields = ssz.electra.PendingDeposit.fields;

const PendingDepositContainer = new ContainerType(fields, {typeName: "PendingDeposit", jsonCase: "eth2"});
const PendingDepositNodeStruct = new ContainerNodeStructType(fields, {typeName: "PendingDeposit", jsonCase: "eth2"});

const ListContainer = new ListCompositeType(PendingDepositContainer, PENDING_DEPOSITS_LIMIT);
const ListNodeStruct = new ListCompositeType(PendingDepositNodeStruct, PENDING_DEPOSITS_LIMIT);

function buildList(listType: typeof ListContainer): ReturnType<typeof ListContainer.defaultViewDU>;
function buildList(listType: typeof ListNodeStruct): ReturnType<typeof ListNodeStruct.defaultViewDU>;
function buildList(listType: typeof ListContainer | typeof ListNodeStruct) {
  const view = listType.defaultViewDU();
  const defaultDeposit = ssz.electra.PendingDeposit.defaultValue();
  for (let i = 0; i < NUM_DEPOSITS; i++) {
    if (listType === ListContainer) {
      view.push(PendingDepositContainer.toViewDU(defaultDeposit));
    } else {
      view.push(PendingDepositNodeStruct.toViewDU(defaultDeposit));
    }
  }
  view.commit();
  return view;
}

describe.skip(`processPendingDeposits - iterate ${NUM_DEPOSITS} deposits, access all fields`, () => {
  const containerListView = buildList(ListContainer);
  const nodeStructListView = buildList(ListNodeStruct);

  bench({
    id: `ContainerType - getReadonlyByRange chunk=${CHUNK}`,
    yieldEventLoopAfterEach: true,
    fn: () => {
      let sum = 0;
      for (let i = 0; i < NUM_DEPOSITS; i += CHUNK) {
        const deposits = containerListView.getReadonlyByRange(i, CHUNK);
        for (const deposit of deposits) {
          sum += deposit.amount + deposit.slot;
          void deposit.pubkey;
          void deposit.withdrawalCredentials;
          void deposit.signature;
        }
      }
      if (sum === Number.MIN_SAFE_INTEGER) {
        throw new Error("unreachable");
      }
    },
  });

  bench({
    id: `ContainerNodeStructType - getReadonlyByRange chunk=${CHUNK}`,
    yieldEventLoopAfterEach: true,
    fn: () => {
      let sum = 0;
      for (let i = 0; i < NUM_DEPOSITS; i += CHUNK) {
        const deposits = nodeStructListView.getReadonlyByRange(i, CHUNK);
        for (const deposit of deposits) {
          sum += deposit.amount + deposit.slot;
          void deposit.pubkey;
          void deposit.withdrawalCredentials;
          void deposit.signature;
        }
      }
      if (sum === Number.MIN_SAFE_INTEGER) {
        throw new Error("unreachable");
      }
    },
  });
});
