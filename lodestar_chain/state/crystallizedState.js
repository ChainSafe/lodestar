var exports = module.exports = {};

var CrosslinkRecord = require('./crossLinkRecord.js');
var ValidatorRecord = require('./validatorRecord.js');
var ShardAndCommittee = require('./shardAndCommittee.js');

class CrystallizedState {

    var fields = {
      // Slot of last validator set change
      'validator_set_change_slot': 'uint64',
      // List of validators
      'validators': [ValidatorRecord],
      // Most recent crosslink for each shard
      'crosslinks': [CrosslinkRecord],
      // Last CrystallizedState recalculation
      'last_state_recalculation_slot': 'int64',
      // The last finalized slot
      'last_finalized_slot': 'int64',
      // The last justified slot
      'last_justified_slot': 'int64',
      // Number of consecutive justified slots ending at this one
      'justified_streak': 'int64',
      // Committee members and their assigned shard, per slot
      'shard_and_committee_for_slots': [[ShardAndCommittee]],
      // Total deposits penalized in the given withdrawal period
      'deposits_penalized_in_period': ['uint32'],
      // Hash chain of validator set changes (for light clients to easily track deltas)
      'validator_set_delta_hash_chain': 'hash32',
      // Parameters relevant to hard forks / versioning.
      // Should be updated only by hard forks
      'pre_fork_version': 'uint32',
      'post_fork_version': 'uint32',
      'fork_slot_number': 'uint64'
    };

    var defaults = {
      'validator_set_change_slot': 0
      'validators': [],
      'crosslinks': [],
      'last_state_recalculation': 0,
      'last_finalized_slot': 0,
      'last_justified_slot': 0,
      'justified_streak': 0,
      'shard_and_committee_for_slots': [],
      'deposits_penalized_in_period': [],
      'validator_set_delta_hash_chain': new Buffer(32),
      'pre_fork_version': 0,
      'post_fork_version': 0,
      'fork_slot_number': 0

    };

    /*
    * Takes in an object with the fields that need to be initialized.
    * If a field is not initialized, it will use the default as in this.defaults
    */
    constructor(var toSet) {
      for (var key in fields) {
        if(fields.hasOwnProperty(key)) {
          if(toSet.hasOwnProperty(key)) {
            this.key = toSet.key;
          } else {
            this.key = defaults.key;
          }
        }
      }
    }

    // Returns the number of active validators
    const function numActivateValidators() {
      return this.validators.length;
    }

    // Returns the number of crosslink records
    const function numCrosslinks() {
      return this.crosslinks.length;
    }
}

exports.CrystallizedState = CrystallizedState;
