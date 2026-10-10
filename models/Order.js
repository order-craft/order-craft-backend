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
          // Embedded product details for deleted products
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
    required: [true, "An order must have at least one product"], // ensures the field is present
    validate: {
      validator: function (arr) {
        // array must be non-null and have at least one element
        return Array.isArray(arr) && arr.length > 0;
      },
      message: "An order must contain at least one product.",
    },
    // alternatively, you can use `minlength: 1` in place of `validate`:
    // minlength: [1, "An order must contain at least one product"]
  },
  table: {
    type: Schema.Types.ObjectId,
    ref: "Table",
    required: function () {
      return this.orderType === "dine-in";
    },
  },
  status: {
    type: String,
    enum: ["pending", "preparing", "completed", "archived", "cancelled"],
    default: "pending",
  },
  statusTimestamps: {
    pending: { type: Date, default: null },
    preparing: { type: Date, default: null },
    completed: { type: Date, default: null },
    archived: { type: Date, default: null },
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
    ref: "User", // Reference to User model for superClient
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
    required: false, // used only when all products are paid using the same method
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
});

// the trigger is used to calculate each time the order spent in each status
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

  const statuses = ["pending", "preparing", "completed", "archived"];

  // Iterate over statuses to calculate durations
  for (let i = 0; i < statuses.length; i++) {
    const currentStatus = statuses[i];
    const nextStatus = statuses[i + 1];

    if (timestamps[currentStatus]) {
      // If there's a next status, calculate duration between current and next status
      if (nextStatus && timestamps[nextStatus]) {
        durations[currentStatus] =
          timestamps[nextStatus] - timestamps[currentStatus];
      } else {
        // For the last status (no next status), calculate time until now
        durations[currentStatus] = Date.now() - timestamps[currentStatus];
      }
    }
  }

  return durations; // returns durations in milliseconds
};

// set products details for recuperation in case of delete
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
