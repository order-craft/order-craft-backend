const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Simplified Request Type Schema
const requestTypeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
    },
    icon: {
      type: String,
      default: "❓",
    },
    superClientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Simplified Support Request Schema
const supportSchema = new Schema(
  {
    requestType: {
      type: Schema.Types.ObjectId,
      ref: "RequestType",
      required: true,
    },
    superClientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    table: {
      type: Schema.Types.ObjectId,
      ref: "Table",
      required: true,
    },
    answered: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Indexes for better performance
requestTypeSchema.index({ superClientId: 1, isActive: 1 });
supportSchema.index({ superClientId: 1, answered: 1 });
supportSchema.index({ table: 1, createdAt: -1 });

const RequestType = mongoose.model("RequestType", requestTypeSchema);
const Support = mongoose.model("Support", supportSchema);

module.exports = { RequestType, Support };
