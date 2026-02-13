const mongoose = require('mongoose');

const GameRoundSchema = new mongoose.Schema({
    roundId: {
        type: String,
        required: true,
        unique: true
    },
    startTime: {
        type: Date,
        default: Date.now
    },
    endTime: {
        type: Date
    },
    // Map of number (1-36) to total amount bet on it
    bets: {
        type: Map,
        of: Number,
        default: {}
    },
    status: {
        type: String,
        enum: ['active', 'closed', 'completed'],
        default: 'active'
    },
    winningNumber: {
        type: Number
    },
    winningLedgerSequence: {
        type: Number
    },
    winningLedgerHash: {
        type: String
    }
});

module.exports = mongoose.model('GameRound', GameRoundSchema);
