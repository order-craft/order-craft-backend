const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Define the Reservation schema first
const reservationSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
});

// Define the Plan schema
const planSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      required: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Then define the Table schema
const tableSchema = new Schema(
  {
    number: {
      type: Number,
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    superClient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    plan: {
      type: Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },
    orders: [
      {
        type: Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    qrCode: {
      type: String,
      required: false,
    },
    reservations: [reservationSchema],
  },
  { timestamps: true }
);

// Create indexes
tableSchema.index({ number: 1, superClient: 1 }, { unique: true });
tableSchema.index({ plan: 1 });

// Export models in a single statement at the end
module.exports = {
  Plan: mongoose.models.Plan || mongoose.model("Plan", planSchema),
  Table: mongoose.models.Table || mongoose.model("Table", tableSchema),
};
