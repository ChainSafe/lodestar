var exports = module.exports = {};

class ShardAndCommittee {

    var fields = {
        // The shard ID
        'shard': 'int16',
        // Validator indices
        'committee': ['int24']
    }

    var defaults = {
        'shard': 0,
        'committee': []
    }

    constructor(var toSet) {
      for(var key in fields) {
        if(fields.hasOwnProperty(key)){
          if(toSet.hasOwnProperty(key)) {
            this.key = toSet.key;
          } else {
            this.key = defaults.key;
          }
        }
      }
    }
}

exports.ShardAndCommittee = ShardAndCommittee;
