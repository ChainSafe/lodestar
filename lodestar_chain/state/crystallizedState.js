var exports = module.exports = {};

var CrosslinkRecord = require('./crossLinkRecord.js');
var ValidatorRecord = require('./validatorRecord.js');
var ShardAndCommittee = require('./shardAndCommittee.js');

class CrystallizedState {

    var fields = {
      // List of validators
      'validators': [ValidatorRecord],
      // Last CrystallizedState recalculation
      'last_state_recalc': 'int64',
      // What active validators are part of the attester set
      // at what height, and in what shard. Starts at slot
      // last_state_recalc - CYCLE_LENGTH
      'indices_for_height': [[ShardAndCommittee]],
      // The last justified slot
      'last_justified_slot': 'int64',
      // Number of consecutive justified slots ending at this one
      'justified_streak': 'int16',
      // The last finalized slot
      'last_finalized_slot': 'int64',
      // The current dynasty
      'current_dynasty': 'int64',
      // The next shard that assignment for cross-linking will start from
      'crosslinking_next_shard': 'int16',
      // Records about the most recent crosslink for each shard
      'crosslink_records': [CrosslinkRecord],
      // Total balance of deposits
      'total_deposits': 'int256',
      // Used to select the committees for each shard
      'dynasty_seed': 'hash32',
      // Last epoch the crosslink seed was reset
      'dynasty_seed_last_reset': 'int64'
    };

    var defaults = {
      'active_validators': [],
      'queued_validators': [],
      'exited_validators': [],
      'current_shuffling': [],
      'current_epoch': 0,
      'last_justified_epoch': 0,
      'last_finalized_epoch': 0,
      'dynasty': 0,
      'next_shard': 0,
      'current_checkpoint': 'x00'.repeat(32),
      'crosslink_records': [],
      'total_deposits': 0
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
      return this.active_validators.length;
    }

    // Returns the number of queued validators
    const function numQueuedValidators() {
      return this.queued_validators.length;
    }

    // Returns the number of exited validators
    const function numExitedValidators() {
      return this.exited_validators.length;
    }

    // Returns the number of crosslink records
    const function numCrosslinkRecords() {
      return this.crosslink_records.length;
    }
}

exports.ActiveState = ActiveState;
