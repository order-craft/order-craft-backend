const { type } = require("express/lib/response");
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const userSchema = new Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  img: { type: String },
  verified: { type: Boolean, default: false },
  role: {
    type: String,
    enum: ["client", "superClient"],
    required: true,
    default: "client",
  },
  superClient: {
    // Only for client users to link them to a superClient
    type: Schema.Types.ObjectId,
    ref: "User",
    required: function () {
      return this.role === "client";
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Staff-only fields (role === "client")
  // ─────────────────────────────────────────────────────────────
  staffRole: {
    type: String,
    enum: ["preparer", "deliverer", "both"],
    default: "both",
  },
  assignedPlanIds: {
    type: [{ type: Schema.Types.ObjectId, ref: "Plan" }],
    default: [],
  },
  assignedTableIds: {
    type: [{ type: Schema.Types.ObjectId, ref: "Table" }],
    default: [],
  },
  notifications: {
    newOrder: { type: Boolean, default: true },
    support: { type: Boolean, default: true },
    orderReady: { type: Boolean, default: true },
    orderDelivered: { type: Boolean, default: true },
  },

  // ─────────────────────────────────────────────────────────────
  // Business owner fields (role === "superClient")
  // ─────────────────────────────────────────────────────────────

  // Order flow: replaces statusFlowEnabled as the source of truth.
  // If missing (legacy documents), it is derived from statusFlowEnabled on read.
  orderFlow: {
    type: String,
    enum: ["two-step", "three-step", "four-step", "delivery-only"],
    default: "three-step",
    required: false,
  },

  // How long a customer may edit / cancel an order.
  customerEditWindow: {
    enabled: { type: Boolean, default: true },
    minutes: { type: Number, default: 3, min: 0 },
    from: {
      type: String,
      enum: ["placed", "preparing"],
      default: "placed",
    },
  },

  // Role-based permissions configurable by the superClient.
  rolePermissions: {
    canDelivererEditOrders: { type: Boolean, default: false },
  },

  // Owner notification preferences
  notificationPreferences: {
    muteOrderNotifications: { type: Boolean, default: false },
    muteSupportNotifications: { type: Boolean, default: false },
    muteStaffNotifications: { type: Boolean, default: false },
  },

  // Deprecated — kept for backward compatibility. Read orderFlow instead.
  statusFlowEnabled: {
    type: Boolean,
    default: true,
  },

  // ─────────────────────────────────────────────────────────────
  // Other superClient fields (unchanged)
  // ─────────────────────────────────────────────────────────────
  phoneNumber: {
    type: String,
    required: function () {
      return this.role === "superClient";
    },
  },
  contractNumber: {
    type: String,
    required: function () {
      return this.role === "superClient";
    },
  },
  percentage: {
    type: Number,
    required: function () {
      return this.role === "superClient";
    },
    min: 0,
    max: 100,
  },
  placeName: {
    type: String,
    required: function () {
      return this.role === "superClient";
    },
  },
  placeLocation: {
    type: {
      long: {
        type: String,
        required: function () {
          return this.role === "superClient";
        },
      },
      lat: {
        type: String,
        required: function () {
          return this.role === "superClient";
        },
      },
    },
    required: function () {
      return this.role === "superClient";
    },
  },
  distance: {
    type: Number,
    default: 300,
    required: function () {
      return this.role === "superClient";
    },
  },
  changePwdCode: {
    type: Number,
    default: 0,
    required: function () {
      return this.role === "superClient";
    },
  },
  changePDCode: {
    type: Number,
    default: 0,
    required: function () {
      return this.role === "superClient";
    },
  },
  newEmail: {
    type: String,
    default: "saadliwissem88@gmail.com",
    required: function () {
      return this.role === "superClient";
    },
  },
  NewpersonalPhoneNumber: {
    type: Number,
    default: 300,
    required: function () {
      return this.role === "superClient";
    },
  },
  personalPhoneNumber: {
    type: String,
    default: 300,
    required: function () {
      return this.role === "superClient";
    },
  },
  placeLogo: {
    type: String,
    default:
      "https://th.bing.com/th/id/OIP.0rerq8e1limpB-aKYj18bAHaHa?w=151&h=180&c=7&r=0&o=5&dpr=1.3&pid=1.7",
    required: function () {
      return this.role === "superClient";
    },
  },
  placePicture: {
    type: String,
    default:
      "https://th.bing.com/th/id/OIP.0rerq8e1limpB-aKYj18bAHaHa?w=151&h=180&c=7&r=0&o=5&dpr=1.3&pid=1.7",
    required: function () {
      return this.role === "superClient";
    },
  },
  profilePicture: {
    type: String,
    default:
      "https://th.bing.com/th/id/OIP.0rerq8e1limpB-aKYj18bAHaHa?w=151&h=180&c=7&r=0&o=5&dpr=1.3&pid=1.7",
    required: function () {
      return this.role === "superClient";
    },
  },
  PlaceAddress: {
    type: String,
    default: "Tunis, Tunisie",
    required: function () {
      return this.role === "superClient";
    },
  },
  defaultIP: {
    type: String,
    required: function () {
      return this.role === "superClient";
    },
  },
  proxyUrl: {
    type: String,
    required: function () {
      return this.role === "superClient";
    },
  },
  pricingPlan: {
    type: String,
    enum: ["percentage", "year", "month"],
    required: function () {
      return this.role === "superClient";
    },
  },
  brandColor: {
    type: String,
    default: "#8B5A2B",
    match: /^#([0-9A-Fa-f]{6})$/,
  },
});

// ─────────────────────────────────────────────────────────────
// Derived helpers
// ─────────────────────────────────────────────────────────────

// Legacy alias: whenever `orderFlow` was never persisted, derive it from
// `statusFlowEnabled`. This keeps old tenants working without touching their data.
userSchema.methods.getOrderFlow = function () {
  if (this.orderFlow) return this.orderFlow;
  return this.statusFlowEnabled === false ? "two-step" : "three-step";
};

const User = mongoose.model("User", userSchema);

module.exports = User;
