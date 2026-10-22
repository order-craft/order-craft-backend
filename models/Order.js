const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const orderSchema = new Schema({
  orderType: {
    type: String,
    enum: ["dine-in", "to-go", "delivery"],
    default: "dine-in",
  },
  orderNumber: {
    type: Number,
    required: function () {
      return this.orderType === "to-go" || this.orderType === "delivery";
    },
  },
  orderDate: {
    type: Date,
    default: () => new Date(),
  },
  products: {
    type: [
      {
        product: {
          type: Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        productDetails: {
          _id: {
            type: Schema.Types.ObjectId,
            ref: "Product",
            required: false,
          },
          name: { type: String },
          price: { type: Number },
        },
        quantity: {
          type: Number,
          required: true,
          default: 1,
        },
        payedQuantity: {
          type: Number,
          default: 0,
        },
        paymentMethod: {
          type: Schema.Types.ObjectId,
          ref: "PaymentMethod",
          required: false,
        },
        paymentSplits: [
          {
            quantity: { type: Number, required: true },
            paymentMethod: {
              type: Schema.Types.ObjectId,
              ref: "PaymentMethod",
              required: true,
            },
            paidAt: { type: Date, default: Date.now },
          },
        ],
        unitCost: {
          type: Number,
          required: false,
          default: null,
        },
        costBreakdown: [
          {
            rawMaterialId: { type: Schema.Types.ObjectId, ref: "RawMaterial" },
            rawMaterialName: { type: String },
            unit: { type: String },
            quantityPerUnit: { type: Number },
            costPerUnit: { type: Number },
            lineCost: { type: Number },
          },
        ],
        costSnapshotAt: {
          type: Date,
          required: false,
          default: null,
        },
      },
    ],
    required: [true, "An order must have at least one product"],
    validate: {
      validator: function (arr) {
        return Array.isArray(arr) && arr.length > 0;
      },
      message: "An order must contain at least one product.",
    },
  },
  table: {
    type: Schema.Types.ObjectId,
    ref: "Table",
    required: function () {
      return this.orderType === "dine-in";
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Status: super-set of every possible status across all flows
  // ─────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: [
      "placed",
      "pending",
      "preparing",
      "ready",
      "delivered",
      "completed",
      "archived",
      "cancelled",
    ],
    default: "pending",
  },
  statusTimestamps: {
    placed: { type: Date, default: null },
    pending: { type: Date, default: null },
    preparing: { type: Date, default: null },
    ready: { type: Date, default: null },
    delivered: { type: Date, default: null },
    completed: { type: Date, default: null },
    archived: { type: Date, default: null },
  },

  // ─────────────────────────────────────────────────────────────
  // Flow that was active when the order was created.
  // Never changes after creation. Legacy orders may have null.
  // ─────────────────────────────────────────────────────────────
  flowAtCreation: {
    type: String,
    enum: ["two-step", "three-step", "four-step", "delivery-only", null],
    default: null,
  },

  // Who performed the operational transitions
  preparedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  deliveredBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  deliveredAt: {
    type: Date,
    default: null,
  },

  // Customer edit window deadline (null = unlimited for staff / legacy)
  customerEditDeadline: {
    type: Date,
    default: null,
  },

  payed: {
    type: Boolean,
    default: false,
  },
  totalPrice: {
    type: Number,
  },
  totalCost: {
    type: Number,
    required: false,
    default: null,
  },
  totalProfit: {
    type: Number,
    required: false,
    default: null,
  },
  costSnapshotAt: {
    type: Date,
    required: false,
    default: null,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  rated: {
    type: Boolean,
    default: false,
  },
  isClosed: {
    type: Boolean,
    default: false,
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  superClientId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  comment: {
    type: String,
    required: false,
  },
  tips: {
    type: Number,
    required: false,
  },
  inventoryConsumed: {
    type: Boolean,
    default: false,
    index: true,
  },
  inventoryDeficits: [
    {
      rawMaterialId: {
        type: Schema.Types.ObjectId,
        ref: "RawMaterial",
      },
      rawMaterialName: { type: String },
      unit: { type: String },
      needed: { type: Number },
      available: { type: Number },
      deficit: { type: Number },
      consumedAt: { type: Date, default: Date.now },
    },
  ],
  paymentMethod: {
    type: Schema.Types.ObjectId,
    ref: "PaymentMethod",
    required: false,
  },
});

// Keep the existing statusTimestamps pre-save hook
orderSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    const status = this.status;
    if (!this.statusTimestamps[status]) {
      this.statusTimestamps[status] = new Date();
    }
  }
  next();
});

orderSchema.methods.getStatusDurations = function () {
  const durations = {};
  const timestamps = this.statusTimestamps;

  const statuses = [
    "placed",
    "pending",
    "preparing",
    "ready",
    "delivered",
    "completed",
    "archived",
  ];

  for (let i = 0; i < statuses.length; i++) {
    const currentStatus = statuses[i];
    const nextStatus = statuses[i + 1];

    if (timestamps[currentStatus]) {
      if (nextStatus && timestamps[nextStatus]) {
        durations[currentStatus] =
          timestamps[nextStatus] - timestamps[currentStatus];
      } else {
        durations[currentStatus] = Date.now() - timestamps[currentStatus];
      }
    }
  }

  return durations;
};

// Keep the existing productDetails pre-save hook
orderSchema.pre("save", async function (next) {
  if (this.isModified("products")) {
    for (let i = 0; i < this.products.length; i++) {
      const product = await mongoose
        .model("Product")
        .findById(this.products[i].product);
      if (product) {
        this.products[i].productDetails = {
          _id: product._id,
          name: product.name,
          price: product.price,
        };
      }
    }
  }
  next();
});

const Order = mongoose.model("Order", orderSchema);
module.exports = Order;
