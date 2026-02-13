require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 3001;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log(err));

// EJS
app.set('view engine', 'ejs');
app.use('/static', express.static('static'));

// Bodyparser
const session = require('express-session');
const User = require('./models/User');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session Middleware
app.use(session({
    secret: 'secret', // Change this to a secure random string in production
    resave: true,
    saveUninitialized: true
}));

// Authentication Middleware
const ensureAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    res.redirect('/login');
};

// Routes
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

app.get('/game', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);
        res.render('game', { user });
    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.render('login', { user: req.session.user });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.redirect('/login?error=User not found');
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.redirect('/login?error=Invalid credentials');
        }

        req.session.user = user;
        res.redirect('/game');
    } catch (err) {
        console.error(err);
        res.redirect('/login?error=Server error');
    }
});

app.get('/signup', (req, res) => {
    res.render('signup', { user: req.session.user });
});

app.post('/signup', async (req, res) => {
    const { firstName, lastName, email, password } = req.body;
    try {
        let user = await User.findOne({ email });
        if (user) {
            return res.redirect('/signup?error=User already exists');
        }

        user = new User({
            firstName,
            lastName,
            email,
            password
        });

        await user.save();
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.redirect('/signup?error=Server error');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

const axios = require('axios'); // Import axios

// Yoco Payment Route
app.post('/api/deposit/yoco', ensureAuthenticated, async (req, res) => {
    const { amount } = req.body;
    const amountInCents = Math.round(parseFloat(amount) * 100);

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    try {
        // Create Pending Transaction
        const newTransaction = new Transaction({
            userId: req.session.user._id,
            type: 'deposit',
            amount: parseFloat(amount),
            description: 'Yoco Deposit (Pending)',
            status: 'pending'
        });
        await newTransaction.save();

        // Correct implementation based on PHP example:
        // Endpoint: https://payments.yoco.com/api/checkouts
        const response = await axios.post('https://payments.yoco.com/api/checkouts', {
            amount: amountInCents,
            currency: 'ZAR',
            successUrl: `https://${req.get('host')}/deposit/success?txnId=${newTransaction._id}`,
            cancelUrl: `https://${req.get('host')}/deposit?status=cancelled`,
            metadata: {
                userId: req.session.user._id,
                email: req.session.user.email,
                description: 'Wallet Deposit',
                txnId: newTransaction._id.toString()
            }
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.YOCO_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        // Update transaction with Yoco ID if available (response.data.id)
        if (response.data.id) {
            newTransaction.yocoId = response.data.id;
            await newTransaction.save();
        }

        // The response should contain redirectUrl
        const checkoutUrl = response.data.redirectUrl;

        if (checkoutUrl) {
            res.json({ checkoutUrl });
        } else {
            console.error('Yoco Response:', response.data);
            res.status(500).json({ error: 'Could not retrieve checkout URL from Yoco' });
        }

    } catch (err) {
        console.error('Yoco API Error:', err.response ? err.response.data : err.message);
        res.status(500).json({ error: 'Failed to initiate payment: ' + (err.response?.data?.message || err.message) });
    }
});

const multer = require('multer');
const path = require('path');

// Multer Storage
const storage = multer.diskStorage({
    destination: './static/uploads/',
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5000000 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    }
});

// Check File Type
function checkFileType(file, cb) {
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb('Error: Images Only!');
    }
}

app.get('/profile', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);
        res.render('profile', { user });
    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

app.get('/edit-profile', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);
        res.render('edit-profile', { user });
    } catch (err) {
        console.error(err);
        res.redirect('/profile');
    }
});

const Transaction = require('./models/Transaction');

app.post('/edit-profile', ensureAuthenticated, upload.single('profilePicture'), async (req, res) => {
    try {
        const { firstName, lastName, phone } = req.body;
        const updateData = { firstName, lastName, phone };

        if (req.file) {
            updateData.profilePicture = `/static/uploads/${req.file.filename}`;
        }

        await User.findByIdAndUpdate(req.session.user._id, updateData);
        // Update session user to reflect changes immediately
        const updatedUser = await User.findById(req.session.user._id);
        req.session.user = updatedUser;

        res.redirect('/profile');
    } catch (err) {
        console.error(err);
        res.redirect('/edit-profile?error=Could not update profile');
    }
});

app.get('/bank-accounts', ensureAuthenticated, async (req, res) => {
    try {
        const transactions = await Transaction.find({ userId: req.session.user._id }).sort({ date: -1 });
        res.render('bank-accounts', { transactions });
    } catch (err) {
        console.error(err);
        res.redirect('/profile');
    }
});

app.get('/wallet', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);
        const transactions = await Transaction.find({ userId: req.session.user._id }).sort({ date: -1 }).limit(3);

        // Count active bets
        // Logic: Count 'bet' transactions that happened after the current round started
        const round = await getActiveRound();
        const activeBetsCount = await Transaction.countDocuments({
            userId: req.session.user._id,
            type: 'bet',
            date: { $gte: round.startTime }
        });

        res.render('wallet', { user, recentTransactions: transactions, activeBetsCount });
    } catch (err) {
        console.error(err);
        res.redirect('/profile');
    }
});

// Yoco Success Route (Landing page after payment)
app.get('/deposit/success', ensureAuthenticated, async (req, res) => {
    // Ideally we would verify the transaction here using a query param like ?checkoutId=...
    // accepting the user's word that they paid is insecure for production,
    // but for this MVP/Test we will just thank them and redirect.
    // Real implementation: call Yoco API with checkoutId to verify status.

    // For now, let's just assume if they come here, they might have paid.
    // But we CANNOT credit their account blindly without verification.
    // So we will just show a success message or redirect to wallet.
    // Use Webhooks for actual balance updates in production.

    // However, the user asked for "Ajax to handle smooth connection".
    // If the user wants the balance to update *instantly* for testing:
    // We could add a query param like ?amount=... and credit it (VERY INSECURE).
    // Let's NOT do that. 
    // Let's just redirect to wallet with a success message.

    res.redirect('/wallet?message=Payment Successful');
});

app.get('/deposit', ensureAuthenticated, (req, res) => {
    res.render('deposit');
});

// Mock Deposit Handler
app.post('/deposit', ensureAuthenticated, async (req, res) => {
    try {
        const amount = parseFloat(req.body.amount);
        if (!amount || amount <= 0) return res.redirect('/deposit');

        // Update User Balance
        await User.findByIdAndUpdate(req.session.user._id, {
            $inc: { walletBalance: amount }
        });

        // Create Transaction Record
        const newTransaction = new Transaction({
            userId: req.session.user._id,
            type: 'deposit',
            amount: amount,
            description: 'Instant EFT Deposit',
            status: 'completed'
        });
        await newTransaction.save();

        res.redirect('/wallet');
    } catch (err) {
        console.error(err);
        res.redirect('/deposit');
    }
});

app.get('/withdraw', ensureAuthenticated, (req, res) => {
    res.render('withdraw', { user: req.session.user });
});

app.post('/withdraw', ensureAuthenticated, async (req, res) => {
    try {
        const { amount, method, bankName, accountHolder, accountNumber, cryptoAddress, network } = req.body;
        const withdrawAmount = parseFloat(amount);

        // Validation
        if (!withdrawAmount || withdrawAmount < 50) {
            return res.redirect('/withdraw?error=Minimum withdrawal is R50');
        }

        const user = await User.findById(req.session.user._id);
        if (user.walletBalance < withdrawAmount) {
            return res.redirect('/withdraw?error=Insufficient funds');
        }

        // Deduct Balance
        user.walletBalance -= withdrawAmount;
        await user.save();
        req.session.user = user; // Update session

        // Create Transaction
        const transaction = new Transaction({
            userId: user._id,
            type: 'withdrawal',
            amount: withdrawAmount,
            status: 'pending',
            description: method === 'bank'
                ? `Withdrawal to ${bankName.toUpperCase()} (${accountNumber})`
                : `Withdrawal to Crypto (${cryptoAddress.substring(0, 6)}...)`,
            withdrawalDetails: {
                method,
                bankName: method === 'bank' ? bankName : undefined,
                accountNumber: method === 'bank' ? accountNumber : undefined,
                accountHolder: method === 'bank' ? accountHolder : undefined,
                cryptoAddress: method === 'crypto' ? cryptoAddress : undefined,
                network: method === 'crypto' ? network : undefined
            }
        });
        await transaction.save();

        res.redirect('/wallet?message=Withdrawal Request Submitted');

    } catch (err) {
        console.error("Withdrawal Error:", err);
        res.redirect('/withdraw?error=Server Error');
    }
});

const GameRound = require('./models/GameRound');
const NumberStats = require('./models/NumberStats');

// ESI Risk Management Logic
async function ensureNumberStats() {
    const count = await NumberStats.countDocuments();
    if (count < 52) {
        console.log("Initializing ESI Stats for 52 numbers...");
        for (let i = 1; i <= 52; i++) {
            await NumberStats.updateOne(
                { number: i },
                { $setOnInsert: { number: i, esi: 1.0, currentPayoutMultiplier: 28.0 } },
                { upsert: true }
            );
        }
    }
}
ensureNumberStats(); // Run on startup

async function updateESI(winningNumber) {
    const GAMMA = 0.8;
    const P_INF = 28.0;

    // 1. Fetch all number stats
    const stats = await NumberStats.find();

    for (let stat of stats) {
        // Core ESI Algorithm
        // P_{t+1} = P_t + gamma * (1 - 1/ESI) * (P_inf - P_t) + epsilon
        // Simplified: Volatility Adjustment

        if (stat.number === winningNumber) {
            // Winner: ESI Increases (Resistance builds)
            // If it wins, it becomes "Hot", ESI goes UP.
            stat.esi = Math.min(stat.esi + 1.5, 15); // Cap at 15
            stat.lastWinDate = new Date();
        } else {
            // Loser: ESI Decays slowly back to 1
            stat.esi = Math.max(stat.esi - 0.1, 1.0);
        }

        // Calculate New Payout Limit (P_{t+1})
        // If ESI is HIGH, term (1 - 1/ESI) -> 0.9. P moves towards P_inf FAST?
        // Wait, user says: "High ESI ... resistance to limit increases".
        // Let's interpret: Payout Limit drops if it's hot?
        // Actually, let's strictly follow the formula given:
        // P_next = P_curr + 0.8 * (1 - 1/ESI) * (28 - P_curr)
        // If ESI=1 (Low Risk), (1-1) = 0. P stays at P_curr.
        // If ESI=10 (High Risk), (1-0.1) = 0.9. P moves 72% of the way to 28?
        // This formula implies P_t converges to 28.
        // We need an event to knock P_t AWAY from 28.

        // Let's add the "Shock" logic:
        // If a number wins, we drop its Payout Multiplier to protect house (e.g. to 20x).
        // Then ESI helps it recover back to 28x.

        if (stat.number === winningNumber) {
            // Shock: Drop payout immediately on win
            stat.currentPayoutMultiplier = Math.max(stat.currentPayoutMultiplier - 5.0, 10.0);
        }

        // Recovery (The Formula) is applied every round
        const stabilizationFactor = 1 - (1 / stat.esi);
        const delta = GAMMA * stabilizationFactor * (P_INF - stat.currentPayoutMultiplier);

        // Add minimal noise epsilon (-0.1 to 0.1)
        const epsilon = (Math.random() * 0.2) - 0.1;

        stat.currentPayoutMultiplier += delta + epsilon;

        // Clamp result
        stat.currentPayoutMultiplier = Math.min(Math.max(stat.currentPayoutMultiplier, 10), 35);

        await stat.save();
    }
    console.log(`Updated ESI stats. Winner #${winningNumber} ESI: ${stats.find(s => s.number === winningNumber).esi.toFixed(2)}`);
}

// Helper to get or create active round
async function getActiveRound() {
    let round = await GameRound.findOne({ status: 'active' });
    if (!round) {
        round = new GameRound({
            roundId: Date.now().toString(),
            startTime: new Date(),
            endDate: new Date(Date.now() + 1000 * 60 * 30), // 30 mins
            status: 'active',
            bets: {}
        });
        await round.save();
    }
    return round;
}

// API to get current odds
app.get('/api/odds', async (req, res) => {
    try {
        const round = await getActiveRound();
        const odds = {};

        // Fetch Dynamic ESI Stats
        const stats = await NumberStats.find();

        // Map stats to odds object
        // If stats are missing for some reason, default to 28.0
        for (let i = 1; i <= 52; i++) {
            const stat = stats.find(s => s.number === i);
            let multiplier = stat ? stat.currentPayoutMultiplier : 28.0;

            // Optional: Adjust slightly based on CURRENT round bets too?
            // "The user says: odds are fair somehow they will be the same and different"
            // Let's stick to the ESI multiplier as the primary source.

            odds[i] = parseFloat(multiplier.toFixed(2));
        }

        res.json({
            roundId: round.roundId,
            odds: odds,
            startTime: round.startTime,
            endTime: round.endTime
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Stellar Helper
const StellarSdk = require('stellar-sdk');
const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');

async function getNextLedgerHash() {
    try {
        // Get latest ledger
        const latest = await server.ledgers().order('desc').limit(1).call();
        const latestSequence = latest.records[0].sequence;
        const targetSequence = latestSequence + 1;

        console.log(`Waiting for Stellar Ledger #${targetSequence}...`);

        // Poll for the next ledger (Simple polling)
        // In production, use Streaming: server.ledgers().cursor('now').stream(...)
        let hash = null;
        let attempts = 0;
        while (!hash && attempts < 20) { // Max 20 * 1s = 20s
            try {
                const ledger = await server.ledgers().ledger(targetSequence).call();
                hash = ledger.hash;
            } catch (e) {
                // Ledger not closed yet, wait 1s
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }
        }

        if (!hash) throw new Error("Timeout waiting for Stellar ledger");
        return { sequence: targetSequence, hash };
    } catch (err) {
        console.error("Stellar Error:", err);
        throw err;
    }
}

// API to place bet (DAILY DRAW MODE)
app.post('/bet', ensureAuthenticated, async (req, res) => {
    console.log("Processing bet request (Daily Draw)...");
    const { number, amount } = req.body;

    if (!number || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid bet' });
    }

    try {
        const user = await User.findById(req.session.user._id);
        if (user.walletBalance < amount) {
            return res.status(400).json({ error: 'Insufficient funds' });
        }

        // 1. Deduct from wallet upfront
        user.walletBalance -= amount;
        user.totalBets = (user.totalBets || 0) + 1;
        await user.save();
        req.session.user = user;

        // 2. Add to Active Round
        const round = await getActiveRound();

        // Prevent betting if round is "processing" (past 17:00 but not resolved)
        // Simple check: if status != active
        if (round.status !== 'active') {
            return res.status(400).json({ success: false, error: "Round is currently resolving. Please wait a moment." });
        }

        const currentBet = round.bets.get(number.toString()) || 0;
        round.bets.set(number.toString(), currentBet + amount);
        await round.save();

        // 3. Dynamic Odds Adjustment (Supply/Demand)
        // Decrease multiplier slightly based on bet volume
        const stat = await NumberStats.findOne({ number: number });
        if (stat) {
            // Decrease factor: 0.05x drop for every R100 bet? 
            // = 0.0005 per rand.
            const drop = amount * 0.0005;
            stat.currentPayoutMultiplier = Math.max(stat.currentPayoutMultiplier - drop, 1.5);
            await stat.save();
        }

        // 4. Record Transaction
        const transaction = new Transaction({
            userId: user._id,
            type: 'bet',
            amount: amount,
            description: `Bet on #${number}`,
            status: 'completed'
        });
        await transaction.save();

        res.json({
            success: true,
            newBalance: user.walletBalance,
            message: `Bet placed on #${number} for the 17:00 Daily Draw.\nOdds adjusted to ${stat ? stat.currentPayoutMultiplier.toFixed(2) : '28.00'}x`
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Scheduler (Daily Draw Resolution)
setInterval(async () => {
    // Check if it's 17:00 or current round has expired
    const round = await GameRound.findOne({ status: 'active' });
    // Check if round exists and end time passed
    if (round && round.endTime && new Date() > round.endTime) {
        resolveDailyDraw(round);
    }
}, 60 * 1000); // Check every minute

let processingDraw = false;

async function resolveDailyDraw(round) {
    if (processingDraw) return;
    processingDraw = true;

    try {
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
            date: { $gte: round.startTime, $lte: new Date() },
            description: { $regex: winPattern }
        }).populate('userId');

        // Odds: Fetch dynamic odds
        const stat = await NumberStats.findOne({ number: winningNumber });
        const odds = stat ? stat.currentPayoutMultiplier : 28.0; // Default 28 used if no stats

        console.log(`Winners: ${winningBets.length}. Payout Multiplier: ${odds.toFixed(2)}x`);

        for (const betTx of winningBets) {
            const user = betTx.userId;
            if (!user) continue;

            const winAmount = betTx.amount * odds;

            // Create Win Transaction
            const winTx = new Transaction({
                userId: user._id,
                type: 'win',
                amount: winAmount,
                description: `Win on #${winningNumber} (Draw ${round.roundId})`,
                status: 'completed',
                yocoId: hash
            });
            await winTx.save();

            // Update Wallet
            await User.findByIdAndUpdate(user._id, {
                $inc: {
                    walletBalance: winAmount,
                    totalWins: 1,
                    totalWonAmount: winAmount
                }
            });
        }

        // 5. Update ESI Stats
        await updateESI(winningNumber);

        // 6. Create NEXT Round
        const now = new Date();
        let targetEnd = new Date();
        targetEnd.setHours(17, 0, 0, 0);
        // If it's already past 17:00 today (which it is if we are resolving), target is tomorrow
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
        console.error("Daily Draw Error:", e);
    } finally {
        processingDraw = false;
    }
}

// Replaced duplicate Multer block with nothing.

// Verification Routes
app.get('/verify', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);
        res.render('verify', { user });
    } catch (err) {
        console.error(err);
        res.redirect('/profile');
    }
});

app.post('/verify', ensureAuthenticated, upload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'proofOfAddress', maxCount: 1 }
]), async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);

        // Save file paths relative to root (or just filename if serving static)
        if (req.files.idFront) user.documents.idFront = req.files.idFront[0].path;
        if (req.files.idBack) user.documents.idBack = req.files.idBack[0].path;
        if (req.files.proofOfAddress) user.documents.proofOfAddress = req.files.proofOfAddress[0].path;

        user.verificationStatus = 'pending';
        user.rejectionReason = undefined; // Clear previous rejection

        await user.save();
        req.session.user = user; // Update session

        res.redirect('/verify?success=true');
    } catch (err) {
        console.error("Verification Upload Error:", err);
        res.redirect('/verify?error=Upload failed');
    }
});


app.get('/results', ensureAuthenticated, async (req, res) => {
    try {
        const rounds = await GameRound.find({ status: 'completed' }).sort({ endTime: -1 }).limit(50);
        res.render('results', { rounds });
    } catch (err) {
        console.error(err);
        res.redirect('/game');
    }
});
const ensureAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.isAdmin) {
        return next();
    }
    // For testing: Uncomment below to auto-grant admin if needed, 
    // OR manually set isAdmin=true in DB.
    // if (req.session.user) return next(); 

    res.redirect('/login?error=Unauthorized');
};

// Admin Dashboard
app.get('/admin', ensureAdmin, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Stats: Money Played (Total Bets Today)
        const betsToday = await Transaction.find({
            type: 'bet',
            date: { $gte: today }
        });
        const moneyPlayed = betsToday.reduce((acc, tx) => acc + tx.amount, 0);

        // Stats: Money Made (Total Lost by users) - Simple Approx: Bets - Wins
        // Accurate way: Sum of bets - Sum of 'win' transactions
        const winsToday = await Transaction.find({
            type: 'win',
            date: { $gte: today }
        });
        const totalPayouts = winsToday.reduce((acc, tx) => acc + tx.amount, 0);
        const moneyMade = moneyPlayed - totalPayouts;

        // Fetch Users
        const users = await User.find().sort({ createdAt: -1 });

        // Fetch Recent Bets
        const recentBets = await Transaction.find({ type: 'bet' })
            .sort({ date: -1 })
            .limit(50)
            .populate('userId', 'firstName lastName email');

        // Fetch Pending Deposits
        const pendingDeposits = await Transaction.find({
            type: 'deposit',
            status: 'pending'
        }).populate('userId', 'firstName lastName email');

        res.render('admin', {
            user: req.session.user,
            stats: { moneyPlayed, moneyMade },
            users,
            recentBets,
            pendingDeposits
        });
    } catch (err) {
        console.error(err);
        res.redirect('/game');
    }
});

// Admin: Cancel Bet
app.post('/admin/bet/cancel', ensureAdmin, async (req, res) => {
    const { transactionId } = req.body;
    try {
        const tx = await Transaction.findById(transactionId);
        if (!tx || tx.type !== 'bet' || tx.status === 'cancelled') {
            return res.redirect('/admin?error=Invalid transaction');
        }

        // Refund User
        await User.findByIdAndUpdate(tx.userId, {
            $inc: { walletBalance: tx.amount }
        });

        // Update Transaction
        tx.status = 'cancelled';
        tx.description += ' (Cancelled by Admin)';
        await tx.save();

        // Update Game Round (Decrease bet amount on number)
        // This is complex if round is over. Assuming active round for now.
        // For simplicity, we just refund user. Analytics might be slightly off for that round.

        res.redirect('/admin?message=Bet cancelled and refunded');
    } catch (err) {
        console.error(err);
        res.redirect('/admin?error=Error cancelling bet');
    }
});

// Admin: Approve Deposit
app.post('/admin/deposit/approve', ensureAdmin, async (req, res) => {
    const { transactionId } = req.body;
    try {
        const tx = await Transaction.findById(transactionId);
        if (!tx || tx.type !== 'deposit' || tx.status !== 'pending') {
            return res.redirect('/admin?error=Invalid transaction');
        }

        // Credit User
        await User.findByIdAndUpdate(tx.userId, {
            $inc: { walletBalance: tx.amount }
        });

        // Update Transaction
        tx.status = 'completed';
        tx.description += ' (Approved by Admin)';
        await tx.save();

        res.redirect('/admin?message=Deposit approved');
    } catch (err) {
        console.error(err);
        res.redirect('/admin?error=Error approving deposit');
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server started on port ${PORT}`));
