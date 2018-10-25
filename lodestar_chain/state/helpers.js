// Helper algorithms for the state transition function
const assert = require('assert');
const blake = require('../utils/blake.js');
const ShardAndCommittee = require('./shardAndCommittee.js');
const ActiveState = require('./activeState.js');
const AttestationRecord = require('./attestationRecord.js');
const CrystallizedState = require('./crystallizedState.js');
const Block = require('./block.js');
const ValidatorRecord = require('./validatorRecord.js');
const fs = require('fs');
const constants = JSON.parse(fs.readFileSync('constants.json', 'utf8'));
const ValidatorStatusCodes = JSON.parse(fs.readFileSync('validatorStatusCodes.json', 'utf8'));

function getActiveValidatorIndices(validators) {
    var indexSet = validators.filter(
        validator => validator.status === ValidatorStatusCodes['ACTIVE']
    )
    return indexSet;
}

function byteArrayToInt(array) {
    var val = 0;
    for(var i = 0; i < array.length; ++i) {
        val += array[i];
        if(i < array.length - 1) {
            val = val*(2**8);
        }
    }

    return val;
}

function shuffle(values, seed) {

    var valuesCount = values.length;

    // Entropy is consumed from the seed in 3-byte (24-bit) chunks.
    var randBytes = 3;
    // The highest possible result of the RNG
    var randMax = 2 **(randBytes * 8) - 1;

    // The range of the RNG places an upper-bound on the size of the list that
    // may be shuffled. It is a logic error to supply an oversized list.
    assert(valuesCount < randMax, "The number of values is more than the highest possible result of the RNG");

    var output = values.slice();
    var source = seed;
    var i = 0;

    while(i < valuesCount - 1) {
        // Re-hash the 'source' to obtain a new pattern of bytes
        source = blake(source);
        // Iterate through the 'source' bytes in 3-byte chunks
        for(var pos=0; i < (32 - (32 % randBytes)); i += randBytes) {
            // Determine the number of indices remaining in 'values' and exit
            // once the last index is reached.
            var remaining = valuesCount - i;
            if(remaining === 1) {
                break;
            }

            // Read 3-bytes of 'source' as a 32-bit signed int.
            // This is temporary until we can figure out how to read a 24-bit signed int.
            var sampleFromSource = Buffer.from(source[pos: pos+3]).readInt32BE(0);

            // Sample values greater than or equal to 'sampleMax' will cause
            // modulo bias when mapped into the 'remaining' range
            var sampleMax = randMax - (randMax % remaining);

            // Perform a swap if the consumed entropy will not cause modulo bias
            if(sampleFromSource < sampleMax) {
                // Select a replacement index for the current index
                var replacementPosition = (sampleFromSource % remaining) + i;
                // Swap the current index with the replacement index
                output[i] = output[replacementPosition];
                output[replacementPosition] = output[i];
                i += 1;
            } else {
                // The sample cause modulo bia. A new sample should be read

            }
        }

    }

    return output;
}

function split(list, splitCount) {
    var listLength = list.length;
    var tmp = [];
    for(var i = 0; i < splitCount; i++) {
        tmp.push(list.slice(
                Math.floor((listLength * i) / splitCount),
                Math.floor((listLength * (i+1)) / splitCount)
            )
            );
    }

    return tmp;

}

function clamp(minval, maxval, x) {
    if (x <= minval) {
        return minval;
    } else if (x >= maxval) {
        return maxval;
    } else {
        return x;
    }

}

function getNewShuffling(seed, validators, crosslinkingStartShard) {
    var activeValidators = getActiveValidators(validators);
    var activeValidatorsSize = len(activeValidators);

    var committeesPerSlot = clamp(
        1,
        Math.floor(constants["SHARD_COUNT"] / constants["CYCLE_LENGTH"]),
        Math.floor(activeValidatorsSize / constants["CYCLE_LENGTH"] / (constants["MIN_COMMITTEE_SIZE"] * 2)) + 1
    );

    var output = [];

    // Shuffle with seed
    var shuffledActiveValidatorIndices = shuffle(activeValidators, seed);

    // Split the shuffled list into cycle_length pieces
    var validatorsPerSlot = split(shuffledActiveValidatorIndices, constants["CYCLE_LENGTH"]);

    // i[0] = slot
    // i[1] = slot_indices
    for(let i of validatorsPerSlot.entries()) {
        // Split the shuffled list into committees_per_slot pieces
        var shardIndices = split(i[1], committeesPerSlot);

        var shardIdStart = crosslinkingStartShard + i[0] * committeesPerSlot;

        var shardsAndCommitteesForSlot = [];

        // j[0] = shard_position
        // j[1] = indices
        for(let j of shardIndices.entries()) {
            var shardAndCommitteeObj = new ShardAndCommittee(
                (shardIdStart + shardPosition) % constants["SHARD_COUNT"],
                j[1]
            );
            shardsAndCommitteesForSlot.push(shardAndCommitteeObj);
        }

        output.push(shardsAndCommitteesForSlot);
    }
    return output;
}

function getShardsAndCommitteesForSlot(crystallizedState, slot) {
    var earliestSlotInArray = crystallizedState.last_start_recalculation - constants["CYCLE_LENGTH"];
    if(earliestSlotInArray <= slot && slot < earliestSlotInArray + constants["CYCLE_LENGTH"] * 2) {
        throw ;
    }
    return crystallizedState.shard_and_committee_for_slots[slot - earliestSlotInArray];
}

function getBlockHash(activeState, currentBlock, slot) {
    var earliestSlotInArray = currentBlock.slot - activeState.recent_block_hashes.length;
    if(earliestSlotInArray <= slot && slot < currentBlock.slot) {
        throw ;
    }
    return activeState.recent_block_hashes[slot - earliestSlotInArray];
}

function addValidatorSetChangeRecord(crystallizedState, index, pubkey, flag) {

}

module.exports = {
    getActiveValidatorIndices,
    shuffle,
    split,
    getNewShuffling,
    getShardAndCommitteesForSlot,
    getBlockHash,
    addValidatorSetChangeRecord
}
