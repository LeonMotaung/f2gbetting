const mongoose = require('mongoose');
const GameRound = require('./models/GameRound');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function fixRound() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const activeRound = await GameRound.findOne({ status: 'active' });
        if (activeRound) {
            console.log('Found active round:', activeRound._id);

            // Set endTime to today at 17:00
            const now = new Date();
            const targetEnd = new Date(now);
            targetEnd.setHours(17, 0, 0, 0); // Today 17:00

            // If now is BEFORE 17:00 (unlikely given the time), set it to yesterday 17:00?
            // User says "At 17:00 i didn't see...". It is now 18:50.
            // So 17:00 today has passed.
            // But we want to trigger resolution for THIS round.

            // Let's just set it to 17:00 today.
            activeRound.endTime = targetEnd;
            await activeRound.save();
            console.log('Updated active round endTime to:', targetEnd);
        } else {
            console.log('No active round found.');
        }

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

fixRound();
