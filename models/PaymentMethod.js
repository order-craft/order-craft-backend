const mongoose = require("mongoose");
const { Schema } = mongoose;

const paymentMethodSchema = new Schema({
  name: {
    type: String,
    required: true, // Example: "Bank Card", "Cash", "PayPal"
    trim: true,
  },
  description: {
    type: String, // Example: "Visa ending in 1234", "Wallet cash", etc.
    trim: true,
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true, // Ensures each payment method belongs to a specific user
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("PaymentMethod", paymentMethodSchema);
