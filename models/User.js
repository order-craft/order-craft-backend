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
  // Fields specific to superClient
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
  statusFlowEnabled: {
    type: Boolean,
    default: true,
  },
  // Preparation responsibility — only meaningful for role "client" (staff).
  // Table-service responsibility is derived from Table.user assignments
  // (see models/Table.js) rather than stored here, so a staff member's
  // full set of responsibilities is always read from one place per concern.
  canPrepare: {
    type: Boolean,
    default: false,
  },
  // Only meaningful for role "superClient" (admin). When true, the admin
  // opts into being treated like staff for live notifications: support
  // ("need something") requests and new-order/order-ready pushes for
  // tables assigned to them. Accept/complete/deliver permissions for the
  // admin are already unconditional (see OrderController) and don't
  // depend on this flag.
  participatesInService: {
    type: Boolean,
    default: false,
  },
  // Tenant-level order workflow mode, meaningful only on the superClient's
  // own doc (same placement/precedent as statusFlowEnabled). "existing"
  // preserves today's table-assignment-driven delivery flow unchanged;
  // "shared_delivery" lets any service-enabled staffer claim a ready order
  // regardless of table assignment (see Order.deliveryClaimedBy).
  orderWorkflowMode: {
    type: String,
    enum: ["existing", "shared_delivery"],
    default: "existing",
  },
  // Independent of statusFlowEnabled (whether status is tracked/shown at
  // all) and orderWorkflowMode (who delivers): controls whether a new order
  // needs an explicit prep "ready" action before it's eligible for service,
  // or becomes eligible immediately on creation ("direct_service").
  preparationMode: {
    type: String,
    enum: ["required", "direct_service"],
    default: "required",
  },
  // "Service-enabled": only meaningful for role "client". Unlike
  // canPrepare/table-service (table-service responsibility is derived from
  // Table.user assignments), this is an explicit flag because
  // "shared_delivery" mode's delivery-notification/claim eligibility is
  // deliberately independent of table assignment. Inert in "existing" mode.
  canDeliver: {
    type: Boolean,
    default: false,
  },
});

const User = mongoose.model("User", userSchema);

module.exports = User;
