const mongoose = require('mongoose');
const GameRound = require('./models/GameRound');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
const NumberStats = require('./models/NumberStats');
const StellarSdk = require('stellar-sdk');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');

async function getNextLedgerHash() {
    try {
        const latest = await server.ledgers().order('desc').limit(1).call();
        const latestSequence = latest.records[0].sequence;
        const targetSequence = latestSequence + 1; // Just use next ledger

        console.log(`Waiting for Stellar Ledger #${targetSequence}...`);

        let hash = null;
        let attempts = 0;
        while (!hash && attempts < 20) {
            try {
                const ledger = await server.ledgers().ledger(targetSequence).call();
                hash = ledger.hash;
            } catch (e) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }
        }
        if (!hash) throw new Error("Timeout waiting for Stellar ledger");
        return { sequence: targetSequence, hash };
    } catch (err) {
        throw err;
    }
}

async function updateESI(winningNumber) {
    const GAMMA = 0.8;
    const P_INF = 28.0;
    const stats = await NumberStats.find();

    for (let stat of stats) {
        if (stat.number === winningNumber) {
            stat.esi = Math.min(stat.esi + 1.5, 15);
            stat.lastWinDate = new Date();
            stat.currentPayoutMultiplier = Math.max(stat.currentPayoutMultiplier - 5.0, 10.0);
        } else {
            stat.esi = Math.max(stat.esi - 0.1, 1.0);
        }

        const stabilizationFactor = 1 - (1 / stat.esi);
        const delta = GAMMA * stabilizationFactor * (P_INF - stat.currentPayoutMultiplier);
        const epsilon = (Math.random() * 0.2) - 0.1;

        stat.currentPayoutMultiplier += delta + epsilon;
        stat.currentPayoutMultiplier = Math.min(Math.max(stat.currentPayoutMultiplier, 10), 35);

        await stat.save();
    }
    console.log(`Updated ESI stats. Winner #${winningNumber} ESI: ${stats.find(s => s.number === winningNumber).esi.toFixed(2)}`);
}

async function resolveDailyDraw() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const round = await GameRound.findOne({ status: 'active' });
        if (!round) {
            console.log('No active round found.');
            return;
        }

        console.log(`Resolving Round ${round.roundId}...`);

        // 1. Get Stellar Ledger Hash
        const { sequence, hash } = await getNextLedgerHash();

        // 2. Determine Winning Number
        const hex = hash.slice(-8);
        const decimal = parseInt(hex, 16);
        const winningNumber = (decimal % 52) + 1;

        console.log(`Winning Number: ${winningNumber} (Ledger #${sequence})`);

        // 3. Update Round
        round.winningNumber = winningNumber;
        round.winningLedgerSequence = sequence;
        round.winningLedgerHash = hash;
        round.status = 'completed';
        await round.save();

        // 4. Payout Winners
        const winPattern = new RegExp(`Bet on #${winningNumber}$`);
        const winningBets = await Transaction.find({
            type: 'bet',
            date: { $gte: round.startTime, $lte: new Date() }, // Simple date check
            description: { $regex: winPattern }
        }).populate('userId');

        const stat = await NumberStats.findOne({ number: winningNumber });
        const odds = stat ? stat.currentPayoutMultiplier : 28.0;
        console.log(`Winners: ${winningBets.length}. Payout Multiplier: ${odds.toFixed(2)}x`);

        for (const betTx of winningBets) {
            const user = betTx.userId;
            if (!user) continue;

            const winAmount = betTx.amount * odds;

            const winTx = new Transaction({
                userId: user._id,
                type: 'win',
                amount: winAmount,
                description: `Win on #${winningNumber} (Draw ${round.roundId})`,
                status: 'completed',
                yocoId: hash
            });
            await winTx.save();

            await User.findByIdAndUpdate(user._id, {
                $inc: {
                    walletBalance: winAmount,
                    totalWins: 1,
                    totalWonAmount: winAmount
                }
            });
            console.log(`Paid out ${winAmount} to User ${user._id}`);
        }

        // 5. Update ESI Stats
        await updateESI(winningNumber);

        // 6. Create NEXT Round
        const now = new Date();
        let targetEnd = new Date();
        targetEnd.setHours(17, 0, 0, 0);
        if (now >= targetEnd) {
            targetEnd.setDate(targetEnd.getDate() + 1);
        }

        const newRound = new GameRound({
            roundId: Date.now().toString(),
            startTime: new Date(),
            endTime: targetEnd,
            status: 'active',
            bets: {}
        });
        await newRound.save();
        console.log(`New Round Started. Ends: ${targetEnd}`);

    } catch (e) {
        console.error("Resolution Error:", e);
    } finally {
        await mongoose.disconnect();
    }
}

resolveDailyDraw();
