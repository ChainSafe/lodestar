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

function getActiveValidatorIndices(validators, dynasty) {
    var indexSet = [];
    for(var i=0; i < validators.length; i++) {
        if((validators[i].start_dynasty <= dynasty) && (dynasty < validators[i].end_dynasty)) {
            indexSet.push(i);
        }
    }
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

function shuffle(list, seed) {
    assert(list.length <= 16777216);

    var tmp = list.slice();
    var source = seed;
    var i = 0;

    while(i < list.length) {
        source = blake(source);
        for(var pos=0; i < 30; i += 3) {
            var m = byteArrayToInt(source[pos: pos+3], "big");
            var remaining = list.length - i;
            if(remaining === 0) {
                break;
            }
            var rand_max = 16777216 - (16777216 % remaining);
            if(m < rand_max) {
                var replacement_pos = (m % remaining) + i;
                tmp[i] = tmp[replacement_pos];
                tmp[replacement_pos] = tmp[i];
                i += 1;
            }
        }
    }

    return tmp;
}

function split(list, N) {
    if(N < 2){
        return [list];
    }

    var len = list.length;
    var out = [];
    var i = 0;
    var size;

    if(len % n == 0) {
        size = Math.floor(len / n);
        while(i < len) {
            out.push(list.slice(i, i += size));
        }
    } else {
        while(i < len) {
            size = Math.ceil((len -i) / n--);
            out.push(a.slice(i, i += size));
        }
    }

    return out;
}

function getNewShuffling(seed, validators, dynasty, crosslinkStartShard) {
    var activeValidatorSet = getActiveValidatorIndices(validators, dynasty);
    if(activeValidatorSet.length >= constants['CYCLE_LENGTH'] * constants['MIN_COMMITTEE_SIZE']) {
        var committeePerSlot = Math.floor(activeValidatorSet.length / constants['CYCLE_LENGTH'] / ((constants['MIN_COMMITTEE_SIZE'] * 2) + 1));
        var slotsPerCommittee = 1;
    } else {
        var committeesPerSlot = 1;
        var slotsPerCommittee = 1;
        while(activeValidatorSet.length * slotsPerCommittee < constants['CYCLE_LENGTH'] * constants['MIN_COMMITTEE_SIZE'] && slotsPerCommittee < constants['CYCLE_LENGTH']) {
            slotsPerCommittee *= 2;
        }
    }

    var tmp = [];

    var shuffledActiveValidatorSet = shuffle(activeValidatorSet, seed);
    var splitActiveValidatorSet = split(shuffledActiveValidatorSet, constants['CYCLE_LENGTH']);

    var iterator = splitActiveValidatorSet.entries();
    for(let item in iterator){
        var i = item[0];
        var slotIndices = item[1];

        var shardIndices = split(slotIndices, committeesPerSlot);
        var shardIdStart = crosslinkingStartShard + i * Math.floor(committeesPerSlot / slotsPerCommittee);

        var iterator1 = shardIndices.entries();
        for(let item1 in iterator1) {
            var j = item1[0];
            var indices = item1[1];

            var obj = {
                "shard_id" : (shardIdStart + j) % constants["SHARD_COUNT"],
                "committee": indices
            };

            tmp.push(new ShardAndCommittee(obj));

        }
    }

    return tmp;

}

function getIndicesForSlot(crystallizedState, slot) {
    var ifhStart = crystallizedState.last_state_recalc - constants["CYCLE_LENGTH"];
    assert(ifhStart <= slot && slot < ifhStart + constants["CYCLE_LENGTH"] * 2);
    return crystallizedState.indices_for_slots[slot - ifh_start];
}

function getBlockHash(activeState, curblock, slot) {
    var sback = curblock.slot_number - constants["CYCLE_LENGTH"] * 2;
    assert(sback <= slot && slot < sback + constants["CYCLE_LENGTH"] * 2);
    return activeState.recent_block_hashes[slot - sback];
}

function getNewRecentBlockHashes(oldBlockHashes, parentSlot, currentSlot, parentHash) {
    var d = currentSlot - parentSlot;
    return oldBlockHashes.slice(d).concat([parentHash].fill(Math.min(d, oldBlockHashes.length)));
}

function getSignedParentHashes(activeState, block, attestation) {
    var cycleLength = constants["CYCLE_LENGTH"];

    var parentHashes = [];

    for(var i=0; i < (cycleLength - attestation.oblique_parent_hashes.length); i++) {
        parentHashes.push(getBlockHash(activeState, block, attestation.slot - cycleLength + i));
    }

    parentHashes = parentHashes.concat(attestation.oblique_parent_hashes);
    return parentHashes;
}

function getAttestationIndices(crystallizedState, attestation) {
    var shardId = attestation.shard_id;

    var filteredIndicesForSlot = getIndicesForSlot(
        crystallizedState, attestation.slot
    ).filter(function(x) {
        return x.shard_id === shardId
    });

    var attestationIndices = [];
    if(filteredIndicesForSlot.length > 0) {
        attestationIndices = filteredIndicesForSlot[0].committee;
    }

    return attestationIndices;
}

module.exports = {
    getActiveValidatorIndices,
    shuffle,
    split,
    getNewShuffling,
    getIndicesForSlot,
    getBlockHash,
    getNewRecentBlockHashes,
    getSignedParentHashes,
    getAttestationIndices
}
