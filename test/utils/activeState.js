class ActiveState {
    static get fields(){
        return {
            'pendingAttestations': [AttestationRecord],
            'recentBlockHashes': ['hash32']
        };
    }

    constructor(){
        this.pendingAttestations = [];
        this.recentBlockHashes = [];
    }
}

class AttestationRecord {
    static get fields(){
        return {
            'slotId': 'int32',
            'shardId': 'int32',
            'attesterBitfield': 'bytes'
        }
    }

    constructor(slotId, shardId, attesterBitfield) {
        this.slotId = slotId || 0;
        this.shardId = shardId || 0;
        this.attesterBitfield = attesterBitfield || Buffer.from([]);
    }
}

exports.ActiveState = ActiveState;
exports.AttestationRecord = AttestationRecord;
