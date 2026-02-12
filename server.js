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

app.listen(PORT, '0.0.0.0', () => console.log(`Server started on port ${PORT}`));
