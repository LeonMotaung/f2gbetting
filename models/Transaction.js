const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['deposit', 'withdrawal', 'bet', 'win'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'completed'
    },
    description: {
        type: String
    },
    date: {
        type: Date,
        default: Date.now
    },
    yocoId: {
        type: String
    },
    withdrawalDetails: {
        method: { type: String, enum: ['bank', 'crypto'] },
        bankName: String,
        accountNumber: String,
        accountHolder: String,
        cryptoAddress: String,
        network: String
    }
});

module.exports = mongoose.model('Transaction', TransactionSchema);
