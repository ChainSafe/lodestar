var exports = module.exports = {};

var CrosslinkRecord = require('./crossLinkRecord.js');
var ValidatorRecord = require('./validatorRecord.js');

class CrystallizedState {

    var fields = {
      // List of active validators
      'active_validators': [ValidatorRecord],
      // List of joined but not yet inducted validators
      'queued_validators' : [ValidatorRecord],
      // List of removed validators pending withdrawal
      'exited_validators' : [ValidatorRecord],
      // The permutation of validators used to determine who cross-links
      // what shard in this epoch
      'current_shuffling': ['int24'],
      // The current epoch
      'current_epoch' : 'int64',
      // The last justified epoch
      'last_justified_epoch': 'int64',
      // The last finalized epoch
      'last_finalized_epoch': 'int64',
      // The current dynasty
      'dynasty': 'int64',
      // The next shard that assignment for cross-linking will start from
      'next_shard': 'int16',
      // The current FFG checkpoint
      'current_checkpoint': 'bytes32',
      // Records about the most recent crosslink for each shard
      'crosslink_records': [CrosslinkRecord],
      // Total balance of deposits
      'total_deposits': 'int256'
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
