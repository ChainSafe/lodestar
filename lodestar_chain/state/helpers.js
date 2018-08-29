// Helper algorithms for the state transition function
const assert = require('assert');
const blake = require('../utils/blake.js');
const ShardAndCommittee = require('./shardAndCommittee.js');
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

function byteArrayToInt(array, endianness) {

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
        size = MAth.floor(len / n);
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
    var ifhStart = crystallizedState.last_state_recalc - CYCLE_LENGTH;
    assert(ifhStart <= slot && slot < ifhStart + CYCLE_LENGTH * 2);
    return crystallizedState.indices_for_slots[slot - ifh_start];
}

function getBlockHash(activeState, curblock, slot) {
    var sback = curblock.slot_number - CYCLE_LENGTH * 2;
    assert(sback <= slot && slot < sback + CYCLE_LENGTH * 2);
    return activeState.recent_block_hashes[slot - sback];
}

function getNewRecentBlockHashes(oldBlockHashes, parentSlot, currentSlot, parentHash) {
    var d = currentSlot - parentSlot;
    return oldBlockHashes.slice(d).concat([parentHash].fill(Math.min(d, oldBlockHashes.length)));
}
