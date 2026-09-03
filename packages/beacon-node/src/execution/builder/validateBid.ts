import {routes} from "@lodestar/api";
import {ProtoBlock} from "@lodestar/fork-choice";
import {MAX_EXECUTION_PAYMENT, PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {
  computeEpochAtSlot,
  createSingleSignatureSetFromComponents,
  getExecutionPayloadBidSigningRoot,
  isActiveBuilder,
  isGasLimitTargetCompatible,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {RootHex, Slot, gloas} from "@lodestar/types";
import {bigIntMin, byteArrayEquals, prettyGweiToEth, toHex, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/index.js";
import {RegenCaller} from "../../chain/regen/index.js";
import {getShufflingDependentRoot} from "../../util/dependentRoot.js";

/** Return the counted bid payment in Gwei, saturated at uint64 max. */
export function getBuilderBidTotalGwei(bid: gloas.ExecutionPayloadBid, maxExecutionPayment: bigint): bigint {
  return bigIntMin(MAX_EXECUTION_PAYMENT, BigInt(bid.value) + bigIntMin(bid.executionPayment, maxExecutionPayment));
}

/**
 * Validate a bid received from a builder over the builder API in response to a bid request
 * made during block production. Unlike gossip validation, the bid must match the requested
 * slot and parent exactly, may carry a non-zero `executionPayment` which is counted at most at
 * the entry's `maxExecutionPayment`, and is not subject to gossip anti-spam rules.
 *
 * Throws with a description of the failure, the caller drops the bid.
 */
export async function validateBuilderApiExecutionPayloadBid(
  chain: IBeaconChain,
  signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid,
  request: {
    slot: Slot;
    parentBlock: ProtoBlock;
    parentBlockHash: RootHex;
    parentBlockRoot: RootHex;
    entry: routes.validator.BuilderEntry;
    getParentExecutionRequests: () => Promise<gloas.ExecutionRequests>;
  }
): Promise<void> {
  const bid = signedExecutionPayloadBid.message;
  const {slot, parentBlock, parentBlockHash, parentBlockRoot, entry, getParentExecutionRequests} = request;

  if (bid.slot !== slot) {
    throw Error(`Bid slot=${bid.slot} does not match requested slot=${slot}`);
  }

  const bidParentBlockHash = toRootHex(bid.parentBlockHash);
  const bidParentBlockRoot = toRootHex(bid.parentBlockRoot);
  if (bidParentBlockHash !== parentBlockHash || bidParentBlockRoot !== parentBlockRoot) {
    throw Error(
      `Bid parent parentBlockHash=${bidParentBlockHash} parentBlockRoot=${bidParentBlockRoot} does not match ` +
        `requested parentBlockHash=${parentBlockHash} parentBlockRoot=${parentBlockRoot}`
    );
  }

  const blobKzgCommitmentsLen = bid.blobKzgCommitments.length;
  const maxBlobsPerBlock = chain.config.getMaxBlobsPerBlock(computeEpochAtSlot(bid.slot));
  if (blobKzgCommitmentsLen > maxBlobsPerBlock) {
    throw Error(`Bid has too many KZG commitments len=${blobKzgCommitmentsLen} limit=${maxBlobsPerBlock}`);
  }

  const totalPayment = getBuilderBidTotalGwei(bid, entry.maxExecutionPayment);
  if (totalPayment < entry.minBid) {
    throw Error(
      `Bid total payment=${prettyGweiToEth(totalPayment)} ` +
        `(value=${prettyGweiToEth(bid.value)} ` +
        `executionPayment=${prettyGweiToEth(bid.executionPayment)}) ` +
        `is below minBid=${prettyGweiToEth(entry.minBid)}`
    );
  }

  const state = await chain.regen
    .getBlockSlotState(parentBlock, slot, {dontTransferCache: true}, RegenCaller.validateGossipExecutionPayloadBid)
    .catch((e: Error) => {
      throw Error(`Unable to regenerate state to validate bid: ${e.message}`);
    });

  if (!isStatePostGloas(state)) {
    throw Error(`Expected gloas+ state for execution payload bid validation, got fork=${state.forkName}`);
  }

  if (bid.builderIndex >= state.getBuildersLength()) {
    throw Error(`Bid builderIndex=${bid.builderIndex} is out of bounds`);
  }

  const builder = state.getBuilder(bid.builderIndex);
  if (!isActiveBuilder(builder, state.finalizedCheckpoint.epoch)) {
    throw Error(`Bid builderIndex=${bid.builderIndex} is not an active builder`);
  }

  if (builder.version !== PAYLOAD_BUILDER_VERSION) {
    throw Error(`Invalid builder version=${builder.version} expected=${PAYLOAD_BUILDER_VERSION}`);
  }

  // A bid not signed by one of the builder pubkeys the entry accepts bids from must not be accepted
  if (
    entry.builderPubkeys.length > 0 &&
    !entry.builderPubkeys.some((pubkey) => byteArrayEquals(pubkey, builder.pubkey))
  ) {
    throw Error(
      `Bid builder pubkey=${toHex(builder.pubkey)} is not in the entry's ` +
        `builderPubkeys=${entry.builderPubkeys.map(toHex).join(",")}`
    );
  }

  // The coverage check only applies to the staked collateral payment, a pure execution
  // layer payment bid has nothing to cover on-chain
  if (bid.value > 0 && !state.canBuilderCoverBid(bid.builderIndex, bid.value)) {
    throw Error(
      `Builder cannot cover bid value=${prettyGweiToEth(bid.value)} ` + `balance=${prettyGweiToEth(builder.balance)}`
    );
  }

  const randaoMix = state.getRandaoMix(computeEpochAtSlot(state.slot));
  if (!byteArrayEquals(bid.prevRandao, randaoMix)) {
    throw Error(`Invalid bid prevRandao=${toHex(bid.prevRandao)} expected=${toHex(randaoMix)}`);
  }

  // The parent's payload does not try to exit the builder
  if (byteArrayEquals(bid.parentBlockHash, state.latestExecutionPayloadBid.blockHash)) {
    const requests = await getParentExecutionRequests();
    if (
      requests.builderExits.some(
        (request) =>
          byteArrayEquals(request.pubkey, builder.pubkey) &&
          byteArrayEquals(request.sourceAddress, builder.executionAddress)
      )
    ) {
      throw Error(`Bid builderIndex=${bid.builderIndex} may exit in the parent payload`);
    }
  }

  // The builder must honor the proposer preferences it learned over gossip
  const bidEpoch = computeEpochAtSlot(bid.slot);
  const dependentRootHex = (() => {
    try {
      return getShufflingDependentRoot(chain.forkChoice, bidEpoch, computeEpochAtSlot(parentBlock.slot), parentBlock);
    } catch {
      return null;
    }
  })();
  if (dependentRootHex === null) {
    throw Error(`Unable to resolve proposer preferences dependent root for bid slot=${bid.slot}`);
  }
  const proposerPreferences = chain.proposerPreferencesPool.get(bid.slot, dependentRootHex);
  if (proposerPreferences === null) {
    throw Error(`No proposer preferences found for bid slot=${bid.slot} dependentRoot=${dependentRootHex}`);
  }
  if (!byteArrayEquals(bid.feeRecipient, proposerPreferences.message.feeRecipient)) {
    throw Error(
      `Bid feeRecipient=${toHex(bid.feeRecipient)} does not match ` +
        `proposer preferences feeRecipient=${toHex(proposerPreferences.message.feeRecipient)}`
    );
  }

  const parentPayloadVariant = chain.forkChoice.getBlockHexAndBlockHash(bidParentBlockRoot, bidParentBlockHash);
  if (parentPayloadVariant === null || parentPayloadVariant.executionPayloadBlockHash === null) {
    throw Error(`Unable to resolve parent payload gas limit for bid parentBlockHash=${bidParentBlockHash}`);
  }
  const parentGasLimit = BigInt(parentPayloadVariant.executionPayloadGasLimit);
  const targetGasLimit = proposerPreferences.message.targetGasLimit;
  if (!isGasLimitTargetCompatible(parentGasLimit, bid.gasLimit, targetGasLimit)) {
    throw Error(
      `Bid gasLimit=${bid.gasLimit} is not compatible with ` +
        `parentGasLimit=${parentGasLimit} targetGasLimit=${targetGasLimit}`
    );
  }

  const signatureSet = createSingleSignatureSetFromComponents(
    builder.pubkey,
    getExecutionPayloadBidSigningRoot(chain.config, bid),
    signedExecutionPayloadBid.signature
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw Error(`Invalid bid signature builderIndex=${bid.builderIndex}`);
  }
}
