const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    isPro: {
        type: Boolean,
        default: false
    },
    isAdmin: {
        type: Boolean,
        default: false
    },
    isFicaVerified: {
        type: Boolean,
        default: false
    },
    totalBets: {
        type: Number,
        default: 0
    },
    totalWins: {
        type: Number,
        default: 0
    },
    profilePicture: {
        type: String,
        default: '/static/default-avatar.png'
    },
    phone: {
        type: String,
        default: ''
    },
    walletBalance: {
        type: Number,
        default: 0
    },
    totalWonAmount: {
        type: Number,
        default: 0
    }
});

// Hash password before saving
// Hash password before saving
UserSchema.pre('save', async function () {
    if (!this.isModified('password')) {
        return;
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});


// Compare password method
UserSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
