const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const billSchema = new Schema({
  client: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true, // Ensures each user can have only one bill
  },
  totalAmount: {
    type: Number,
    required: true,
    default: 0, // Total amount owed by the client
  },
  amountPaid: {
    type: Number,
    required: true,
    default: 0, // Total amount already paid by the client
  },
  balance: {
    type: Number,
    required: true,
    default: 0, // Remaining amount owed (calculated as totalAmount - amountPaid)
  },
  transactions: [
    {
      date: {
        type: Date,
        required: true,
        default: Date.now, // Date of the transaction
      },
      amount: {
        type: Number,
        required: true, // Amount involved in the transaction
      },
      description: {
        type: String, // Optional description for the transaction
      },
    },
  ],
  lastUpdated: {
    type: Date,
    required: true,
    default: Date.now, // Tracks the last update time for the bill
  },
});

billSchema.pre("save", function (next) {
  // Automatically calculate the balance before saving
  this.balance = this.totalAmount - this.amountPaid;
  this.lastUpdated = new Date();
  next();
});

const Bill = mongoose.model("Bill", billSchema);
module.exports = Bill;
