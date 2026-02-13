require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('MongoDB Connected');
        const email = 'smetchappy@gmail.com';

        try {
            const user = await User.findOne({ email: email });
            if (user) {
                user.isAdmin = true;
                await user.save();
                console.log(`Success: User ${email} is now an Admin.`);
            } else {
                console.log(`Error: User ${email} not found.`);
            }
        } catch (err) {
            console.error(err);
        } finally {
            mongoose.disconnect();
            process.exit();
        }
    })
    .catch(err => {
        console.log(err);
        process.exit(1);
    });
