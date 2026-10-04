const mongoose = require('mongoose');

const orderCounterSchema = new mongoose.Schema({
    // e.g. "2025-07-18"
    date: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    // the current sequence for that date
    seq: {
        type: Number,
        default: 0
    }
});

module.exports = mongoose.model('OrderCounter', orderCounterSchema);