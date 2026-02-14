const mongoose = require('mongoose');
const GameRound = require('./models/GameRound');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function checkStatus() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const activeRound = await GameRound.findOne({ status: 'active' });
        console.log('Active Round:', activeRound);

        const specificRound = await GameRound.findOne({ roundId: '1770911638830' });
        console.log('Specific Round (1770911638830):', specificRound);

        const recentCompleted = await GameRound.find({ status: 'completed' }).sort({ endTime: -1 }).limit(3);
        console.log('Last 3 Completed Rounds:', recentCompleted);

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

checkStatus();
