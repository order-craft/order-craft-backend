const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Persisted, recoverable in-app notifications for staff. Socket.IO delivers
// these in real time to a connected client, but every notification is also
// written here first so a reconnecting/refreshing client can recover
// anything it missed via GET /notifications — the socket event is a live
// push on top of this record, not the source of truth.
const notificationSchema = new Schema(
  {
    superClientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "new_order",
        "order_ready",
        "new_order_prep",
        "support_request",
        "new_order_service",
        "order_ready_service",
      ],
      required: true,
    },
    order: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      // Only order-driven notifications reference an order; a
      // support_request notification references `support` instead.
      required: function () {
        return this.type !== "support_request";
      },
    },
    support: {
      type: Schema.Types.ObjectId,
      ref: "Support",
      required: function () {
        return this.type === "support_request";
      },
    },
    table: {
      type: Schema.Types.ObjectId,
      ref: "Table",
      required: false,
    },
    tableNumber: {
      type: Number,
      required: false,
    },
    message: {
      type: String,
      required: true,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, read: 1 });

const Notification =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);

module.exports = Notification;
