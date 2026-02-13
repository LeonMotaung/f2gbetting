
const mongoose = require('mongoose');

const NumberStatsSchema = new mongoose.Schema({
    number: {
        type: Number,
        required: true,
        unique: true,
        min: 1,
        max: 52
    },
    esi: {
        type: Number,
        default: 1.0,
        min: 1.0
    },
    currentPayoutMultiplier: {
        type: Number,
        default: 28.0
    },
    targetPayoutMultiplier: {
        type: Number,
        default: 28.0
    },
    lastWinDate: {
        type: Date
    }
});

module.exports = mongoose.model('NumberStats', NumberStatsSchema);
