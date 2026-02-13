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

app.get('/how-to-play', ensureAuthenticated, (req, res) => {
    res.render('how-to-play');
});

const GameRound = require('./models/GameRound');

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
        const baseOdds = 28;

        for (let i = 1; i <= 36; i++) {
            const totalBetOnNumber = round.bets.get(i.toString()) || 0;
            // DYNAMIC ODDS LOGIC:
            // Base Odds = 28
            // Decrease factor = 1 + (TotalBet / 1000)
            // Example: R0 bet = 28 / 1 = 28x
            // Example: R1000 bet = 28 / 2 = 14x
            // Example: R5000 bet = 28 / 6 = 4.6x
            let calculatedOdds = baseOdds / (1 + (totalBetOnNumber / 1000));
            // Minimum odds clamp
            if (calculatedOdds < 1.5) calculatedOdds = 1.5;

            odds[i] = parseFloat(calculatedOdds.toFixed(2));
        }

        res.json({
            roundId: round.roundId,
            odds: odds,
            startTime: round.startTime
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// API to place bet
app.post('/bet', ensureAuthenticated, async (req, res) => {
    console.log("Processing bet request..."); // Debug log to ensure reload
    const { number, amount } = req.body;

    if (!number || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid bet' });
    }

    try {
        const user = await User.findById(req.session.user._id);
        if (user.walletBalance < amount) {
            return res.status(400).json({ error: 'Insufficient funds' });
        }

        // Deduct from wallet
        user.walletBalance -= amount;
        user.totalBets = (user.totalBets || 0) + 1;
        await user.save();
        req.session.user = user; // Update session

        // Update Game Round
        const round = await getActiveRound();
        const currentBet = round.bets.get(number.toString()) || 0;
        round.bets.set(number.toString(), currentBet + amount);
        await round.save();

        // Record Transaction
        const transaction = new Transaction({
            userId: user._id,
            type: 'bet',
            amount: amount,
            description: `Bet on #${number}`,
            status: 'completed'
        });
        await transaction.save();

        // Calculate current odds for this number
        const totalBetOnNumber = round.bets.get(number.toString());
        const newOdds = (28 / (1 + (totalBetOnNumber / 1000))).toFixed(2);

        res.json({
            success: true,
            newBalance: user.walletBalance,
            newOdds: newOdds,
            message: `Bet placed on #${number}!`
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
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
