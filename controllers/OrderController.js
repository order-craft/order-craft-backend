const Order = require("../models/Order");
const Bill = require("../models/Bill");
const User = require("../models/User");

const Product = require("../models/Product");
const { Table } = require("../models/Table");
const logger = require("../logger");
const { default: mongoose } = require("mongoose");
const { decrementForOrder } = require("../Helpers/functions");
const { buildProductCostSnapshot } = require("../Helpers/costHelpers");
const OrderCounter = require("../models/OrderCounter");
const { startOfDay, endOfDay } = require("date-fns");
const {
  notifyAssignedServer,
  notifyPrepStaff,
  notifyServiceStaff,
} = require("../Helpers/notifications");

const calculateTotalPrice = async (products) => {
  const productIds = products.map((item) => item.product);

  const existingProducts = await Product.find({ _id: { $in: productIds } });

  return products.reduce((total, item) => {
    const product = existingProducts.find((p) => p._id.equals(item.product));
    if (!product) {
      logger.warn(`Product with ID ${item.product} not found in the database.`);
      return total;
    }

    // Apply discount if it exists
    const discount =
      product.discountPercentage > 0
        ? (product.discountPercentage / 100) * product.price
        : 0;
    const discountedPrice = product.price - discount;

    return total + discountedPrice * item.quantity;
  }, 0);
};

const calculateTotalPriceCreating = async (products) => {
  const productIds = products.map((item) => item.product);

  // Fetch all products from the database
  const existingProducts = await Product.find({ _id: { $in: productIds } });

  // Calculate the total price with discounts
  return products.reduce((total, item) => {
    const product = existingProducts.find((p) => p._id.equals(item.product));
    if (!product) {
      logger.warn(`Product with ID ${item.product} not found in the database.`);
      return total;
    }

    // Calculate the discounted price
    const discountedPrice =
      product.price * (1 - (product.discountPercentage || 0) / 100);

    // Add to the total
    return total + discountedPrice * item.quantity;
  }, 0);
};

const ALLOWED_ORDER_TYPES = ["dine-in", "to-go", "delivery"];

const createOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    // 1️⃣ Start transaction
    session.startTransaction();

    const { products, comment, orderType } = req.body;
    console.log(req.body);
    const tableId = req.tableId || req.body.tableId;
    const userId = req.user;

    // 2️⃣ Validate basic payload
    if (!ALLOWED_ORDER_TYPES.includes(orderType)) {
      return res.status(400).json({ error: "Invalid orderType" });
    }
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: "Products are required" });
    }

    // 3️⃣ Handle dine-in vs to-go/delivery
    let table, superClientId, orderNumber;
    if (orderType === "dine-in") {
      if (!tableId) {
        return res
          .status(400)
          .json({ error: "tableId is required for dine-in orders" });
      }
      table = await Table.findById(tableId).session(session);
      if (!table) {
        return res.status(404).json({ error: "Table not found" });
      }
      superClientId = table.superClient;
    } else {
      superClientId = req.superClientId;
      const todayKey = new Date().toISOString().slice(0, 10);
      const counter = await OrderCounter.findOneAndUpdate(
        { date: todayKey },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session },
      );
      orderNumber = counter.seq;
    }

    // 4️⃣ Verify products exist & availability
    const productIds = products.map((p) => p.product);
    const existing = await Product.find({ _id: { $in: productIds } }).session(
      session,
    );
    if (existing.length !== products.length) {
      return res.status(404).json({ error: "One or more products not found" });
    }
    const unavailable = existing
      .filter((p) => !p.available)
      .map((p) => p._id.toString());
    if (unavailable.length) {
      return res.status(400).json({
        error: "Some products are not available",
        details: products
          .filter((p) => unavailable.includes(p.product.toString()))
          .map((p) => ({
            productId: p.product,
            requestedQuantity: p.quantity,
          })),
      });
    }

    // Read tenant config once
    const tenant = await User.findById(superClientId)
      .select("statusFlowEnabled orderWorkflowMode")
      .session(session);
    const flowEnabled = tenant?.statusFlowEnabled !== false;
    const sharedDelivery = tenant?.orderWorkflowMode === "shared_delivery";
    // 5️⃣ Calculate total price
    const totalPrice = await calculateTotalPrice(products);

    // 5️⃣b Cost snapshot — freeze costs at order creation time
    let totalCost = 0;
    let allSnapshotsPresent = true;

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const snapshot = await buildProductCostSnapshot(p.product, session);

      p.unitCost = snapshot.unitCost;
      p.costBreakdown = snapshot.costBreakdown;
      p.costSnapshotAt = snapshot.costSnapshotAt;

      if (snapshot.unitCost == null) {
        allSnapshotsPresent = false;
      } else {
        totalCost += snapshot.unitCost * (p.quantity || 1);
      }
    }

    const finalTotalCost = allSnapshotsPresent
      ? parseFloat(totalCost.toFixed(4))
      : null;
    const finalTotalProfit =
      finalTotalCost != null
        ? parseFloat((totalPrice - finalTotalCost).toFixed(4))
        : null;
    const finalCostSnapshotAt = allSnapshotsPresent ? new Date() : null;

    // 6️⃣ Build & save the Order
    const orderData = {
      products,
      orderType,
      totalPrice,
      totalCost: finalTotalCost,
      totalProfit: finalTotalProfit,
      costSnapshotAt: finalCostSnapshotAt,
      user: userId,
      superClientId,
      comment,
      status: flowEnabled ? "pending" : "completed",
      statusTimestamps: flowEnabled
        ? { pending: new Date() }
        : { completed: new Date() },
      orderDate: new Date(),
    };
    if (table) orderData.table = table._id;
    if (orderNumber != null) orderData.orderNumber = orderNumber;

    const newOrder = new Order(orderData);
    await newOrder.save({ session });

    // 7️⃣ Link to table if dine‑in
    if (table) {
      table.orders.push(newOrder._id);
      await table.save({ session });
    }

    // 8️⃣ Commit transaction
    await session.commitTransaction();

    // 9️⃣ Populate references **before** ending the session
    await newOrder.populate("products.product");
    await newOrder.populate("table");

    // Re-fetch with full population so the client always gets a consistent shape
    const populated = await Order.findById(newOrder._id)
      .populate("products.product")
      .populate({
        path: "table",
        populate: { path: "plan", select: "name _id" },
      })
      .lean();

    const payload = {
      ...populated,
      statusDurations: newOrder.getStatusDurations(),
      statusFlowEnabled: flowEnabled,
    };

    // 1️⃣0️⃣ Emit to clients
    req.io.to(superClientId.toString()).emit("newOrder", payload);

    // 1️⃣1️⃣ Notify the table's assigned table-service server, if any and
    // active. Never blocks order creation on failure.
    if (newOrder.table) {
      notifyAssignedServer({
        io: req.io,
        table: newOrder.table,
        superClientId,
        type: "new_order",
        order: newOrder,
      }).catch((err) =>
        console.error("Failed to notify assigned server:", err),
      );
    }

    // 1️⃣2️⃣ Let the kitchen/preparation staff know a new order came in, even
    // off Order Management — silent on the client, distinct from the
    // assigned server's sound alert above. Skip the table's own assigned
    // server if they're also prep staff, so that person isn't notified twice.
    // Always fires, regardless of statusFlowEnabled/preparationMode —
    // canPrepare staff should always hear about a new order.
    notifyPrepStaff({
      io: req.io,
      superClientId,
      order: newOrder,
      excludeUserId: newOrder.table?.user || null,
    }).catch((err) => console.error("Failed to notify prep staff:", err));

    // 1️⃣3️⃣ "shared_delivery" mode only: every active service-enabled
    // staffer gets paged too, regardless of table assignment — this is
    // additive to (not a replacement for) the table-based alert above.
    if (sharedDelivery) {
      notifyServiceStaff({
        io: req.io,
        superClientId,
        order: newOrder,
        type: "new_order_service",
      }).catch((err) => console.error("Failed to notify service staff:", err));
    }

    return res.status(201).json({
      message: "Order created successfully",
      order: newOrder,
    });
  } catch (err) {
    // Abort only if still in a transaction
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error("Error creating order:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    // Always end the session last
    session.endSession();
  }
};

const getAllOrders = async (req, res) => {
  try {
    const tableId = req.tableId;

    const orders = await Order.find({
      table: tableId,
      status: { $ne: "archived" }, // Exclude orders with status 'archived'
    })
      .populate("products.product")
      .sort({ timestamp: -1 }); // Sort by timestamp ascending (first orders first)

    if (!orders || orders.length === 0) {
      logger.warn(`No orders found for table ${tableId}`);
      return res.status(404).json({ error: "No orders found for this table" });
    }

    logger.info(`Fetched all orders for table ${tableId}`);
    res.status(200).json(orders);
  } catch (error) {
    logger.error("Error fetching all orders:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getNonDineInOrdersToday = async (req, res, next) => {
  try {
    // Define today's boundaries
    const start = startOfDay(new Date());
    const end = endOfDay(new Date());

    // Query: exclude dine-in orders, filter by createdAt within today's range
    const orders = await Order.find({
      orderType: { $ne: "dine-in" },
      orderNumber: { $exists: true },
      timestamp: { $gte: start, $lte: end },
    })
      .populate("products.product")
      .sort({ timestamp: -1 });

    // Respond with results
    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error("Error in getNonDineInOrdersToday:", error);

    // Handle known error types explicitly
    if (error.name === "MongoError") {
      return res
        .status(500)
        .json({ success: false, error: "Database error occurred" });
    }
    if (error.name === "CastError") {
      return res
        .status(400)
        .json({ success: false, error: "Invalid parameter provided" });
    }

    // Pass unexpected errors to global error handler
    return next(error);
  }
};

const getOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const order = await Order.findById(orderId).populate("products.product");
    if (!order) {
      logger.warn(`Order with ID ${orderId} not found`);
      return res.status(404).json({ error: "Order not found" });
    }
    logger.info(`Fetched order with ID ${orderId}`);
    res.status(200).json(order);
  } catch (error) {
    logger.error(
      `Error fetching order with ID ${req.params.orderId}: ${error.message}`,
      error,
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

const updateOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { products, table, status, payed, comment } = req.body;
    const superClientId = req.superClientId;
    if (products && products.length === 0) {
      const deletedOrder = await Order.findOneAndDelete({
        _id: orderId,
        superClientId,
      });
      if (!deletedOrder) {
        logger.warn(
          `Order with ID ${orderId} not found when attempting to delete`,
        );
        return res.status(404).json({ error: "Order not found" });
      }

      // Remove the order reference from the table
      await Table.findByIdAndUpdate(deletedOrder.table, {
        $pull: { orders: orderId },
      });

      logger.info(`Order with ID ${orderId} deleted successfully`);
      // req.io.emit("newOrder", order);
      req.io.to(superClientId.toString()).emit("newOrder", order); // Emit to specific room

      return res.status(200).json({ message: "Order deleted successfully" });
    }

    const updateData = { table, status, payed, comment };
    if (products) {
      const totalPrice = await calculateTotalPrice(products);
      updateData.products = products;
      updateData.totalPrice = totalPrice;
    }

    const order = await Order.findOneAndUpdate(
      { _id: orderId, superClientId },
      updateData,
      { new: true },
    )
      .populate("products.product")
      .populate("table");
    if (!order) {
      logger.warn(
        `Order with ID ${orderId} not found when attempting to update`,
      );
      return res.status(404).json({ error: "Order not found" });
    }
    logger.info(`Order with ID ${orderId} updated successfully`);
    // req.io.emit("newOrder", order);
    req.io.to(superClientId.toString()).emit("newOrder", order); // Emit to specific room

    res.status(200).json({ message: "Order updated successfully", order });
  } catch (error) {
    logger.error(
      `Error updating order with ID ${req.params.orderId}: ${error.message}`,
      error,
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

const deleteOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const superClientId = req.superClientId;
    const order = await Order.findOne({
      _id: orderId,
      superClientId,
    });
    if (!order) {
      logger.warn(
        `Order with ID ${orderId} not found when attempting to delete`,
      );
      return res.status(404).json({ error: "Order not found" });
    }

    await Order.findOneAndDelete({ _id: orderId, superClientId });
    // Remove the order reference from the table
    await Table.findByIdAndUpdate(order.table, {
      $pull: { orders: orderId },
    });

    logger.info(`Order with ID ${orderId} deleted successfully`);
    req.io.to(superClientId.toString()).emit("deleteOrder", order._id); // Emit to specific room

    console.log("deleted order id is", order._id);
    res.status(200).json({ message: "Order deleted successfully" });
  } catch (error) {
    logger.error(
      `Error deleting order with ID ${req.params.orderId}: ${error.message}`,
      error,
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

const rateOrderProducts = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { ratings } = req.body;

    const order = await Order.findById(orderId).populate("products.product");
    if (!order) {
      logger.warn(
        `Order with ID ${orderId} not found when attempting to rate products`,
      );
      return res.status(404).json({ error: "Order not found" });
    }

    const productsRated = order.products.filter(({ product }) =>
      ratings.hasOwnProperty(product._id.toString()),
    );

    for (let { product } of productsRated) {
      product.rate =
        (product.rate * product.raters + ratings[product._id]) /
        (product.raters + 1);
      product.raters += 1;
      await product.save();
    }

    order.rated = true;
    await order.save();
    logger.info(`Products rated for order ${orderId}`);

    res.status(200).json({ message: "Ratings submitted successfully" });
  } catch (error) {
    logger.error(
      `Error rating products for order ${req.params.orderId}: ${error.message}`,
      error,
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

// add tips to order
const tipOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { selectedTip } = req.body;

    // Check if the selectedTip is greater than 0
    if (selectedTip <= 0) {
      logger.warn(`Invalid tip amount ${selectedTip} for order ${orderId}`);
      return res
        .status(400)
        .json({ error: "Tip amount must be greater than 0" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      logger.warn(
        `Order with ID ${orderId} not found when attempting to rate products`,
      );
      return res.status(404).json({ error: "Order not found" });
    }

    const gaveTips = selectedTip;
    order.tips = gaveTips;
    await order.save();
    logger.info(`tips added for order ${orderId}`);
    res.status(200).json({ message: "Ratings submitted successfully" });
  } catch (error) {
    logger.error(
      `Error adding tips for order ${req.params.orderId}: ${error.message}`,
      error,
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

// Confirm payment for selected orders
const confirmSelectedPayments = async (req, res) => {
  const { orderIds, paymentMethod } = req.body;
  const superId = req.userId;
  const superClientId = req.superClientId;

  logger.info(
    `[CONFIRM_ALL] ENTER req.userId=${req.userId} req.superClientId=${req.superClientId} ` +
      `role=${req.role} orderIds=${JSON.stringify(orderIds)} paymentMethod=${paymentMethod}`,
  );
  try {
    // Basic validation
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      console.warn("No valid order IDs provided");
      return res.status(400).json({ message: "No valid order IDs provided" });
    }
    const validOrderIds = orderIds.filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );
    if (validOrderIds.length === 0) {
      console.warn("No valid order IDs found");
      return res.status(400).json({ message: "No valid order IDs found" });
    }
    if (!paymentMethod) {
      console.warn("No payment method");
      return res.status(400).json({ message: "No payment method is set" });
    }

    // Start a session for the transaction
    const session = await mongoose.startSession();
    let warnings = [];
    let insufficientMaterials = [];
    let deficits = [];

    logger.info(
      `[CONFIRM_ALL] VALIDATION passed rawCount=${orderIds?.length} validCount=${validOrderIds?.length} ` +
        `paymentMethod=${paymentMethod}`,
    );
    try {
      const transactionOptions = {
        readPreference: "primary",
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      };

      await session.withTransaction(async () => {
        // Find unpaid orders within the transaction
        const orders = await Order.find({
          _id: { $in: validOrderIds },
          payed: false,
          superClientId,
        })
          .session(session)
          .populate("superClientId");
        logger.info(
          `[CONFIRM_ALL] QUERY_RESULT validIds=${validOrderIds.length} found=${orders.length} ` +
            `superClientId=${superClientId}`,
        );
        if (!orders.length) {
          throw Object.assign(new Error("No unpaid orders found"), {
            statusCode: 404,
          });
        }

        for (const order of orders) {
          console.log(`Processing order ID: ${order._id}`);

          // Update super client's bill
          if (order.superClientId) {
            const bill = await Bill.findOne({
              client: order.superClientId,
            }).session(session);
            if (bill) {
              const commission = order.totalPrice * 0.04;
              bill.totalAmount += commission;
              await bill.save({ session });
            } else {
              console.warn(
                `No bill found for superClient ${order.superClientId}`,
              );
            }
          }

          // Set payment methods
          const hasSomeProductWithPaymentMethod = order.products.some(
            (p) => p.paymentMethod,
          );
          const hasSomeWithout = order.products.some((p) => !p.paymentMethod);

          if (hasSomeProductWithPaymentMethod && hasSomeWithout) {
            order.products.forEach((product) => {
              if (!product.paymentMethod) {
                product.paymentMethod = paymentMethod;
              }
            });
          } else if (!hasSomeProductWithPaymentMethod && paymentMethod) {
            order.paymentMethod = paymentMethod;
          }

          // Mark order as paid and set user
          order.payed = true;
          order.user = superId;

          // Decrement inventory (exactly once per order)
          if (!order.inventoryConsumed) {
            const decrementResult = await decrementForOrder(order, session);

            if (!decrementResult.skipped) {
              order.inventoryConsumed = true;
              if (
                Array.isArray(decrementResult.deficits) &&
                decrementResult.deficits.length > 0
              ) {
                order.inventoryDeficits.push(...decrementResult.deficits);
              }
            }

            warnings = [...warnings, ...(decrementResult.warnings || [])];
            insufficientMaterials = [
              ...insufficientMaterials,
              ...(decrementResult.insufficientMaterials || []),
            ];
            deficits = [...deficits, ...(decrementResult.deficits || [])];
          }

          // Save the updated order
          await order.save({ session });
          logger.info(
            `[CONFIRM_ALL] ORDER_PAID orderId=${order._id} totalPrice=${order.totalPrice} status=${order.status}`,
          );
          console.log(`Order ${order._id} marked as paid and archived.`);
        }

        // Check and archive tables if all orders are paid
        const tablesToCheck = await Order.distinct("table", {
          _id: { $in: validOrderIds },
        }).session(session);

        for (const tableId of tablesToCheck) {
          const unpaidOrders = await Order.find({
            table: tableId,
            payed: false,
          }).session(session);
          if (unpaidOrders.length === 0) {
            await Order.updateMany(
              { table: tableId },
              { $set: { status: "archived" } },
              { session },
            );
            console.log(`Orders for table ${tableId} archived.`);
          }
        }
        // Notify connected clients (staff + guests) that these orders changed
        for (const orderId of validOrderIds) {
          req.io
            .to(superClientId.toString())
            .emit("orderUpdated", { _id: orderId });
        }
      }, transactionOptions);

      // Construct the response
      const response = {
        message:
          "Selected orders confirmed as paid, and relevant orders archived",
      };
      if (warnings.length > 0) {
        response.warnings = warnings;
      }
      if (insufficientMaterials.length > 0) {
        response.insufficientMaterials = insufficientMaterials;
      }
      if (deficits.length > 0) response.deficits = deficits;
      return res.status(200).json(response);
    } catch (err) {
      logger.error(
        `[CONFIRM_ALL] ERROR name=${err.name} message=${err.message} stack=${err.stack}`,
      );
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      throw err; // Re-throw to outer catch for general error handling
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Error confirming selected payments:", error);
    return res
      .status(500)
      .json({ message: "Error confirming selected payments" });
  }
};

const confirmNotDineinSelectedOrder = async (req, res) => {
  // 1. Extract inputs
  const { orderId, paymentMethod } = req.body;
  const superId = req.userId; // Who is confirming the payment

  try {
    // 2. Basic validation
    if (!orderId || typeof orderId !== "string") {
      console.warn("No valid order ID provided");
      return res.status(400).json({ message: "No valid order ID provided" });
    }
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      console.warn(`Invalid order ID format: ${orderId}`);
      return res.status(400).json({ message: "Invalid order ID format" });
    }
    if (!paymentMethod) {
      console.warn("No payment method provided");
      return res.status(400).json({ message: "No payment method provided" });
    }

    // 3. Start a session for the transaction
    const session = await mongoose.startSession();
    let updatedOrder;
    let warnings = [];
    let insufficientMaterials = [];
    let deficits = [];
    try {
      const transactionOptions = {
        readPreference: "primary",
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      };

      await session.withTransaction(async () => {
        // 4. Fetch the unpaid order and populate superClientId within the transaction
        const order = await Order.findOne({
          _id: orderId,
          payed: false,
          superClientId,
        })
          .session(session)
          .populate("superClientId");
        if (!order) {
          throw Object.assign(new Error("Order not found or already paid"), {
            statusCode: 404,
          });
        }

        console.log(`Processing order ${orderId}`);

        // 5. Update the super-client’s bill (4% commission on totalPrice)
        const superClientId = order.superClientId;
        if (superClientId) {
          const bill = await Bill.findOne({ client: superClientId }).session(
            session,
          );
          if (bill) {
            const commission = order.totalPrice * 0.04;
            bill.totalAmount += commission;
            await bill.save({ session });
            console.log(
              `Updated bill for superClient ${superClientId}. New total: ${bill.totalAmount}`,
            );
          } else {
            console.warn(`No bill found for superClient ${superClientId}`);
          }
        }

        // 6. Update each product’s payedQuantity and paymentMethod
        order.products = order.products.map((product) => {
          const remaining = product.quantity - (product.payedQuantity || 0);
          if (remaining > 0) {
            product.payedQuantity = product.quantity;
            if (!product.paymentMethod) {
              product.paymentMethod = paymentMethod;
            }
          }
          return product;
        });

        // 7. Mark the order as fully paid and archived
        order.payed = true;
        order.status = "archived";
        order.user = superId;

        // 8. Decrement inventory (exactly once per order)
        if (!order.inventoryConsumed) {
          const decrementResult = await decrementForOrder(order, session);

          if (!decrementResult.skipped) {
            order.inventoryConsumed = true;
            if (
              Array.isArray(decrementResult.deficits) &&
              decrementResult.deficits.length > 0
            ) {
              order.inventoryDeficits.push(...decrementResult.deficits);
            }
          }

          warnings = decrementResult.warnings || [];
          insufficientMaterials = decrementResult.insufficientMaterials || [];
          deficits = decrementResult.deficits || [];
        }

        // 9. Persist all changes to the order
        await order.save({ session });
        req.io.to(String(order.superClientId)).emit("orderUpdated", {
          _id: order._id,
          payed: true,
          status: order.status,
        });
        console.log(`Order ${orderId} marked as paid and archived.`);

        updatedOrder = order;
      }, transactionOptions);

      // 10. Construct the response with warnings if any
      const response = {
        message:
          "Order confirmed as paid (all products) and archived successfully.",
        updatedOrder,
      };
      if (warnings.length > 0) {
        response.warnings = warnings;
      }
      if (insufficientMaterials.length > 0) {
        response.insufficientMaterials = insufficientMaterials;
      }
      return res.status(200).json(response);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      throw err; // Re-throw to outer catch for general error handling
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Error in confirmNotDineinSelectedOrder:", error);
    return res.status(500).json({ message: "Error confirming payment" });
  }
};

const confirmSelectedNotDineinProductsPayments = async (req, res) => {
  const { orderId, productIds, paymentMethod } = req.body;
  const superID = req.userId;
  const superClientId = req.superClientId;

  try {
    // Basic validation
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order ID provided" });
    }
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: "No valid product IDs provided" });
    }
    const validProductIds = productIds
      .map((id) => id.split("-")[0])
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validProductIds.length === 0) {
      return res.status(400).json({ message: "No valid product IDs found" });
    }
    if (!paymentMethod) {
      console.warn("No payment method");
      return res.status(400).json({ message: "No payment method is set" });
    }

    // Start a session for the transaction
    const session = await mongoose.startSession();
    let updatedOrder;
    let warnings = [];
    let insufficientMaterials = [];
    let deficits = [];
    try {
      const transactionOptions = {
        readPreference: "primary",
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      };

      await session.withTransaction(async () => {
        // Find the order within the transaction
        const order = await Order.findOne({
          _id: orderId,
          superClientId: req.superClientId,
        })
          .session(session)
          .populate("superClientId");
        if (!order) {
          throw Object.assign(new Error("Order not found"), {
            statusCode: 404,
          });
        }

        let totalPaidAmount = 0;
        const productsToDecrement = []; // Track products that need inventory decrement

        // Update selected products' payedQuantity and paymentMethod
        order.products = order.products.map((product) => {
          if (validProductIds.includes(product.product.toString())) {
            const selectedCount = productIds.filter(
              (id) => id.split("-")[0] === product.product.toString(),
            ).length;

            if (product.payedQuantity < product.quantity) {
              const remainingQuantity =
                product.quantity - product.payedQuantity;
              const quantityToPay = Math.min(selectedCount, remainingQuantity);
              const previousPayedQuantity = product.payedQuantity;

              product.payedQuantity += quantityToPay;

              if (!Array.isArray(product.paymentSplits)) {
                product.paymentSplits = [];
              }
              product.paymentSplits.push({
                quantity: quantityToPay,
                paymentMethod: paymentMethod,
                paidAt: new Date(),
              });

              product.paymentMethod = paymentMethod;

              totalPaidAmount += quantityToPay * product.productDetails.price;

              // Add to decrement list if this product now has newly paid quantities
              if (quantityToPay > 0) {
                productsToDecrement.push({
                  product: product,
                  quantityToDecrement: quantityToPay,
                });
              }
            }
          }
          return product;
        });

        // Decrement inventory for each newly paid product individually
        for (const productInfo of productsToDecrement) {
          // Create a temporary order-like object with just this product for decrementing
          const tempOrderForDecrement = {
            ...order.toObject(),
            products: [
              {
                ...productInfo.product.toObject(),
                quantity: productInfo.quantityToDecrement, // Only decrement for the paid quantity
              },
            ],
          };

          if (tempOrderForDecrement.status != "completed") {
            const decrementResult = await decrementForOrder(
              tempOrderForDecrement,
              session,
            );
            if (decrementResult.warnings) {
              warnings = warnings.concat(decrementResult.warnings);
            }
            if (decrementResult.insufficientMaterials) {
              insufficientMaterials = insufficientMaterials.concat(
                decrementResult.insufficientMaterials,
              );
            }
          }
        }

        // Check if all products are now fully paid
        const allProductsPaid = order.products.every(
          (product) => product.payedQuantity >= product.quantity,
        );

        if (allProductsPaid) {
          order.payed = true;
          order.status = "archived";
          order.user = superID;

          // Update the super client's bill (4% commission on totalPrice)
          if (order.superClientId) {
            const bill = await Bill.findOne({
              client: order.superClientId,
            }).session(session);
            if (bill) {
              const commission = order.totalPrice * 0.04;
              bill.totalAmount += commission;
              await bill.save({ session });
            } else {
              console.warn(
                `No bill found for superClient ${order.superClientId._id}`,
              );
            }
          }

          // Decrement inventory (exactly once per order)
          if (!order.inventoryConsumed) {
            const decrementResult = await decrementForOrder(order, session);

            if (!decrementResult.skipped) {
              order.inventoryConsumed = true;
              if (
                Array.isArray(decrementResult.deficits) &&
                decrementResult.deficits.length > 0
              ) {
                order.inventoryDeficits.push(...decrementResult.deficits);
              }
            }

            warnings = decrementResult.warnings || [];
            insufficientMaterials = decrementResult.insufficientMaterials || [];
            deficits = decrementResult.deficits || [];
          }
        }

        // Save the updated order
        await order.save({ session });
        req.io.to(String(order.superClientId)).emit("orderUpdated", {
          _id: order._id,
          payed: order.payed,
          status: order.status,
        });
        updatedOrder = order;
      }, transactionOptions);

      // Construct the response
      const response = {
        message: "Selected products confirmed as paid",
        updatedOrder,
      };
      if (updatedOrder.payed) {
        response.message += ", order archived";
      } else {
        response.message += ", order remains open";
      }

      // Include warnings and insufficient materials regardless of order completion status
      if (warnings.length > 0) {
        response.warnings = warnings;
      }
      if (insufficientMaterials.length > 0) {
        response.insufficientMaterials = insufficientMaterials;
      }
      if (deficits.length > 0) {
        response.deficits = deficits;
      }

      return res.status(200).json(response);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      throw err; // Re-throw to outer catch for general error handling
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Error confirming selected products payments:", error);
    return res
      .status(500)
      .json({ message: "Error confirming selected products payments" });
  }
};

const confirmSelectedProductsPayments = async (req, res) => {
  const { orderId, productIds, paymentMethod } = req.body;
  const superId = req.userId;
  logger.info(
    `[CONFIRM_PRODUCTS] ENTER req.userId=${req.userId} req.superClientId=${req.superClientId} ` +
      `role=${req.role} orderId=${orderId} productIdsLen=${productIds?.length} paymentMethod=${paymentMethod}`,
  );
  try {
    // Validate inputs
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid order ID provided" });
    }
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: "No valid product IDs provided" });
    }
    const validProductIds = productIds
      .map((id) => id.split("-")[0])
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validProductIds.length === 0) {
      return res.status(400).json({ message: "No valid product IDs found" });
    }
    if (!paymentMethod) {
      console.warn("No payment method");
      return res.status(400).json({ message: "No payment method is set" });
    }

    // Initialize session and variables
    const session = await mongoose.startSession();
    let updatedOrder;
    let warnings = [];
    let insufficientMaterials = [];
    let totalPaidAmount = 0;

    try {
      const transactionOptions = {
        readPreference: "primary",
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      };

      await session.withTransaction(async () => {
        // Load order within transaction
        const order = await Order.findOne({
          _id: orderId,
          superClientId: req.superClientId,
        })

          .session(session)
          .populate("superClientId");
        if (!order) {
          throw Object.assign(new Error("Order not found"), {
            statusCode: 404,
          });
        }
        // ─── [DEBUG][CONFIRM_PRODUCTS] query result ──────────
        logger.info(
          `[CONFIRM_PRODUCTS] QUERY_RESULT found=${!!order} ` +
            (order
              ? `order.superClientId=${order.superClientId} status=${order.status} payed=${order.payed}`
              : ""),
        );
        // ────────────────────────────────────────────────────

        // Update product payments
        order.products = order.products.map((item) => {
          const prodIdStr = item.product.toString();
          if (validProductIds.includes(prodIdStr)) {
            const selectedCount = productIds.filter(
              (rawId) => rawId.split("-")[0] === prodIdStr,
            ).length;
            if (item.payedQuantity < item.quantity) {
              const remainingQuantity = item.quantity - item.payedQuantity;
              const quantityToPay = Math.min(selectedCount, remainingQuantity);
              item.payedQuantity += quantityToPay;

              if (!Array.isArray(item.paymentSplits)) {
                item.paymentSplits = [];
              }
              item.paymentSplits.push({
                quantity: quantityToPay,
                paymentMethod: paymentMethod,
                paidAt: new Date(),
              });

              item.paymentMethod = paymentMethod;

              totalPaidAmount += quantityToPay * item.productDetails.price;
            }
          }
          return item;
        });

        // Check if order is fully paid
        const allProductsPaid = order.products.every(
          (item) => item.payedQuantity >= item.quantity,
        );

        if (allProductsPaid) {
          order.payed = true;
          // Update super client's bill
          if (order.superClientId) {
            const bill = await Bill.findOne({
              client: order.superClientId._id,
            }).session(session);
            if (bill) {
              const commission = order.totalPrice * 0.04;
              bill.totalAmount += commission;
              await bill.save({ session });
            } else {
              console.warn(
                `No bill found for superClient ${order.superClientId._id}`,
              );
            }
          }
          // Decrement inventory
          // Decrement inventory (exactly once per order)
          if (!order.inventoryConsumed) {
            const decrementResult = await decrementForOrder(order, session);

            if (!decrementResult.skipped) {
              order.inventoryConsumed = true;
              if (
                Array.isArray(decrementResult.deficits) &&
                decrementResult.deficits.length > 0
              ) {
                order.inventoryDeficits.push(...decrementResult.deficits);
              }
            }

            warnings = decrementResult.warnings || [];
            insufficientMaterials = decrementResult.insufficientMaterials || [];
            deficits = decrementResult.deficits || [];
          }
        }

        // Save updated order
        await order.save({ session });

        updatedOrder = order;
        req.io.to(String(order.superClientId)).emit("orderUpdated", {
          _id: order._id,
          payed: order.payed,
          status: order.status,
        });
        // Archive table orders if all are paid
        const unpaidOrders = await Order.find({
          table: order.table,
          payed: false,
        }).session(session);
        if (unpaidOrders.length === 0) {
          await Order.updateMany(
            { table: order.table },
            { $set: { status: "archived", user: superId } },
            { session },
          );
        }
      }, transactionOptions);

      // Build response
      const response = {
        message:
          "Selected products confirmed as paid, and table orders archived if needed",
        updatedOrder,
        totalPaidAmount,
      };
      if (updatedOrder.payed) {
        if (warnings.length > 0) {
          response.warnings = warnings;
        }
        if (insufficientMaterials.length > 0) {
          response.insufficientMaterials = insufficientMaterials;
        }
      }
      return res.status(200).json(response);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      throw err;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Error confirming selected products payments:", error);
    return res
      .status(500)
      .json({ message: "Error confirming selected products payments" });
  }
};

const getOrdersBySuperClientIdFIFO = async (req, res) => {
  const superClientId = req.superClientId;

  try {
    const query = {
      superClientId: superClientId,
      status: { $ne: "archived" },
    };

    // Role/responsibility-aware filtering. This is the one endpoint behind
    // the existing Order Management screen, so narrowing it here is what
    // gives each server their "personal view" without a parallel API.
    //
    // - superClient (admin): always unrestricted.
    // - client with canPrepare: unrestricted — preparation must see every
    //   incoming order regardless of table assignment.
    // - client with table assignments but no canPrepare: restricted to
    //   orders on their assigned tables (their "personal view").
    // - client with neither configured yet: unrestricted, so introducing
    //   this feature never silently hides orders from staff an admin
    //   hasn't assigned anything to yet.
    const tenant = await User.findById(superClientId).select(
      "statusFlowEnabled orderWorkflowMode preparationMode",
    );
    const sharedDelivery = tenant?.orderWorkflowMode === "shared_delivery";

    let viewScope = "all";
    let assignedTables = [];
    let canPrepare = null;
    let canDeliver = null;

    if (req.role === "client") {
      const me = await User.findById(req.userId).select("canPrepare canDeliver");
      canPrepare = !!me?.canPrepare;
      canDeliver = !!me?.canDeliver;

      const myTables = await Table.find({
        user: req.userId,
        superClient: superClientId,
      }).select("number");
      assignedTables = myTables.map((t) => ({ _id: t._id, number: t.number }));

      // A service-enabled staffer needs the tenant-wide view in shared
      // delivery mode (to see/claim unassigned ready orders), same as
      // canPrepare already grants — table assignment alone shouldn't
      // restrict them in that mode.
      if (
        !canPrepare &&
        assignedTables.length > 0 &&
        !(sharedDelivery && canDeliver)
      ) {
        query.table = { $in: assignedTables.map((t) => t._id) };
        viewScope = "mine";
      }
    }

    // Find orders with populated data
    const orders = await Order.find(query)
      .populate("products.product")
      .populate({
        path: "table",
        populate: {
          path: "plan",
          select: "name _id", // Include both name and _id
        },
      })
      .populate("deliveryClaimedBy", "fullName")
      .sort({ timestamp: 1 });

    // Extract unique plans from the orders
    const uniquePlans = [];
    const planMap = new Map();

    orders.forEach((order) => {
      if (order.table?.plan) {
        if (!planMap.has(order.table.plan._id.toString())) {
          planMap.set(order.table.plan._id.toString(), true);
          uniquePlans.push({
            _id: order.table.plan._id,
            name: order.table.plan.name,
          });
        }
      }
    });

    // Add status durations for each order
    const ordersWithDurations = orders.map((order) => ({
      ...order.toObject(),
      statusDurations: order.getStatusDurations(),
    }));

    res.status(200).json({
      orders: ordersWithDurations,
      plans: uniquePlans,
      statusFlowEnabled: tenant?.statusFlowEnabled !== false,
      orderWorkflowMode: tenant?.orderWorkflowMode || "existing",
      preparationMode: tenant?.preparationMode || "required",
      viewScope,
      assignedTables,
      canPrepare,
      canDeliver,
    });
  } catch (error) {
    console.error("Error retrieving orders:", error);
    res.status(500).json({ message: "Failed to retrieve orders", error });
  }
};

const updateOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  const { status: newStatus } = req.body;
  const superClientId = req.superClientId;
  // Enforce the tenant's flow setting on the server side
  // Read tenant config for this request
  const tenant = await User.findById(superClientId).select(
    "statusFlowEnabled orderWorkflowMode preparationMode",
  );
  const flowEnabled = tenant?.statusFlowEnabled !== false;
  const sharedDelivery = tenant?.orderWorkflowMode === "shared_delivery";
  const noPrepStage = tenant?.preparationMode === "direct_service";
  // Basic validation
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({ error: "Invalid order ID" });
  }
  if (!["pending", "preparing", "completed", "cancelled"].includes(newStatus)) {
    return res.status(400).json({ error: "Unknown status value" });
  }

  // "direct_service" tenants have no preparation stage at all — reject the
  // transition outright rather than just hiding the button on the frontend.
  if (newStatus === "preparing" && noPrepStage) {
    return res.status(400).json({
      error: "Preparation is skipped for this tenant (Direct Service mode)",
    });
  }

  // Driving the kitchen workflow (accepting an order into preparation, or
  // marking it ready) is a preparation-staff action. A service/delivery-only
  // staffer (canDeliver, no canPrepare) must not move it into "preparing"/
  // "completed" themselves — they only act once it's ready, via the
  // separate deliver/claim-delivery endpoint. This split holds in
  // "direct_service" mode too: prep still completes it, delivery still only
  // claims it afterward — direct_service just removes the "preparing" stage.
  if (
    (newStatus === "preparing" || newStatus === "completed") &&
    req.role === "client"
  ) {
    const me = await User.findById(req.userId).select("canPrepare");
    if (!me?.canPrepare) {
      return res.status(403).json({
        error: "Only preparation staff can move an order to this status",
      });
    }
  }

  const session = await mongoose.startSession();

  // Declare variables outside transaction to access after
  let updatedOrder;
  let warnings = [];
  let insufficientMaterials = [];
  let deficits = [];
  try {
    const transactionOptions = {
      readPreference: "primary",
      readConcern: { level: "local" },
      writeConcern: { w: "majority" },
    };

    await session.withTransaction(async () => {
      // Load order inside transaction
      // Inside your transaction, modify the findById line:
      const order = await Order.findById(orderId)
        .populate("table")
        .populate("products.product")
        .session(session);
      if (!order) {
        throw Object.assign(new Error("Order not found"), { statusCode: 404 });
      }
      if (order.status == "archived") {
        throw Object.assign(new Error("Status change not allowed"), {
          statusCode: 400,
        });
      }

      // When the flow is disabled, only allow the workflow on orders that
      // were created while the flow was ON (i.e. they're already past
      // pending). A pending/preparing order created pre-toggle must remain
      // progressable. (Direct Service orders legitimately start "pending"
      // when the flow is on, so this guard is about statusFlowEnabled only.)
      if (
        !flowEnabled &&
        (newStatus === "pending" || newStatus === "preparing") &&
        order.status !== "pending" &&
        order.status !== "preparing"
      ) {
        throw Object.assign(
          new Error("Status flow is disabled for this tenant"),
          { statusCode: 400 },
        );
      }

      // Update status
      order.status = newStatus;
      order.statusTimestamps[newStatus] = new Date();

      // Decrement inventory BEFORE saving (single save below)
      if (newStatus === "completed" && !order.inventoryConsumed) {
        const decrementResult = await decrementForOrder(order, session);

        if (!decrementResult.skipped) {
          order.inventoryConsumed = true;
          if (
            Array.isArray(decrementResult.deficits) &&
            decrementResult.deficits.length > 0
          ) {
            order.inventoryDeficits.push(...decrementResult.deficits);
          }
        }

        warnings = decrementResult.warnings || [];
        insufficientMaterials = decrementResult.insufficientMaterials || [];
        deficits = decrementResult.deficits || [];
      }

      // Single save — persists status + inventoryConsumed + deficits
      await order.save({ session });
      updatedOrder = order;

      // On completed, decrement stock — only if not already consumed
      if (newStatus === "completed" && !order.inventoryConsumed) {
        const decrementResult = await decrementForOrder(order, session);

        if (!decrementResult.skipped) {
          order.inventoryConsumed = true;
          if (
            Array.isArray(decrementResult.deficits) &&
            decrementResult.deficits.length > 0
          ) {
            order.inventoryDeficits.push(...decrementResult.deficits);
          }
        }

        warnings = decrementResult.warnings || [];
        insufficientMaterials = decrementResult.insufficientMaterials || [];
        deficits = decrementResult.deficits || [];
      }

      // Don't return anything - just let the transaction complete
    }, transactionOptions);
    // Refresh the order to ensure we have latest data

    updatedOrder = await Order.findOne({ _id: orderId, superClientId })
      .populate("table")
      .populate("products.product")
      .session(session);

    // Now we can access our variables that were set during the transaction
    console.log("Transaction completed successfully");

    // Verify the data
    if (!updatedOrder) {
      throw new Error("Transaction succeeded but no order was processed");
    }

    // Emit over WebSocket
    req.io.to(superClientId.toString()).emit("orderUpdated", updatedOrder);

    // Notify the assigned table-service server that their table's order is
    // ready. Only on the pending/preparing → completed transition — not on
    // every save — and never blocks the response on failure.
    if (newStatus === "completed" && updatedOrder.table) {
      notifyAssignedServer({
        io: req.io,
        table: updatedOrder.table,
        superClientId,
        type: "order_ready",
        order: updatedOrder,
      }).catch((err) =>
        console.error("Failed to notify assigned server:", err),
      );
    }

    // "shared_delivery" mode only: every active service-enabled staffer
    // gets paged too — table-independent, so not gated on updatedOrder.table.
    if (newStatus === "completed" && sharedDelivery) {
      notifyServiceStaff({
        io: req.io,
        superClientId,
        order: updatedOrder,
        type: "order_ready_service",
      }).catch((err) =>
        console.error("Failed to notify service staff:", err),
      );
    }

    // Construct response
    const response = {
      message: "Order status updated",
      order: updatedOrder,
    };

    // Add warnings and insufficientMaterials if they exist
    if (Array.isArray(warnings) && warnings.length > 0) {
      response.warnings = warnings;
    }
    if (
      Array.isArray(insufficientMaterials) &&
      insufficientMaterials.length > 0
    ) {
      response.insufficientMaterials = insufficientMaterials;
    }
    if (Array.isArray(deficits) && deficits.length > 0) {
      response.deficits = deficits;
    }

    return res.json(response);
  } catch (err) {
    console.error("Error in updateOrderStatus:", err);
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    session.endSession();
  }
};

// Marks a "completed" (ready) order as delivered to the table. Kept as a
// separate action from status, rather than a new status value, so the
// existing pending → preparing → completed → archived flow (payment,
// inventory decrement, etc.) is untouched. Authorization: the table's
// currently assigned active table-service server, or an admin — and, only
// when the table has no active assigned server, any active staff member
// with table-service responsibility (so a ready order can never get stuck
// with no one permitted to deliver it).
const markOrderDelivered = async (req, res) => {
  try {
    const { orderId } = req.params;
    const superClientId = req.superClientId;
    const callerId = (req.userId || req.superClientId).toString();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    const order = await Order.findOne({
      _id: orderId,
      superClientId,
    }).populate("table");

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    if (order.status !== "completed") {
      return res
        .status(400)
        .json({ error: "Only ready (completed) orders can be delivered" });
    }
    if (order.deliveredAt) {
      return res.status(400).json({ error: "Order already delivered" });
    }

    // A prior delivery claim — e.g. made while the tenant was in
    // "shared_delivery" mode — takes precedence over table assignment.
    // Switching the tenant back to "existing" must not silently transfer
    // that responsibility to whoever the table happens to be assigned to,
    // nor let anyone else deliver it out from under the claimer.
    const claimedBy = order.deliveryClaimedBy?.toString() || null;
    const iAmClaimer = claimedBy && claimedBy === callerId;

    if (req.role !== "superClient" && claimedBy && !iAmClaimer) {
      return res.status(403).json({
        error: "This order was already accepted by another server",
      });
    }

    if (req.role !== "superClient" && !claimedBy) {
      const assignedServerId = order.table?.user?.toString();
      const isAssignedServer =
        assignedServerId && assignedServerId === req.userId?.toString();

      if (!isAssignedServer) {
        // No active assigned server for this table — fall back to any
        // active staff member who has table-service responsibility.
        const hasAnyTableAssignment = await Table.exists({
          user: req.userId,
          superClient: superClientId,
        });
        const assignedServerIsActive =
          assignedServerId &&
          (await User.exists({ _id: assignedServerId, verified: true }));

        if (assignedServerIsActive || !hasAnyTableAssignment) {
          return res.status(403).json({
            error: "Only the assigned server or an admin can mark this delivered",
          });
        }
      }
    }

    // Atomic, race-safe against a concurrent accept/claim/deliver on the
    // same order — mirrors claimDelivery's findOneAndUpdate guard pattern.
    // Also stamps deliveryClaimedBy (if not already set) so "who's
    // responsible" stays tracked the same way regardless of which mode the
    // order was actually delivered under — this is what lets claimDelivery
    // correctly refuse to re-offer an already-delivered order for claiming
    // after a later switch back to "shared_delivery".
    const updated = await Order.findOneAndUpdate(
      { _id: orderId, superClientId, status: "completed", deliveredAt: null },
      {
        $set: {
          deliveredAt: new Date(),
          deliveredBy: callerId,
          ...(claimedBy
            ? {}
            : { deliveryClaimedBy: callerId, deliveryClaimedAt: new Date() }),
        },
      },
      { new: true },
    )
      .populate("table")
      .populate("products.product")
      .populate("deliveryClaimedBy", "fullName");

    if (!updated) {
      return res.status(409).json({ error: "Order was already delivered" });
    }

    req.io.to(superClientId.toString()).emit("orderUpdated", updated);

    return res.status(200).json({ message: "Order marked as delivered", order: updated });
  } catch (error) {
    console.error("Error marking order delivered:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// "shared_delivery" workflow mode only: any active service-enabled
// (canDeliver) staffer — or an admin — can claim a ready, unclaimed order,
// first-come-first-served. Claiming is distinct from delivering: it never
// touches deliveredAt/deliveredBy, and no further click is required for
// v1 — the claim itself is the terminal server-facing action.
//
// Concurrency: the atomic findOneAndUpdate below (matching only while
// deliveryClaimedBy is still null) is what makes this race-safe — MongoDB
// serializes writes to a single document, so of two near-simultaneous
// claims exactly one query still matches and the other gets back null.
// No transaction needed; this is a single-document conditional update.
const claimDelivery = async (req, res) => {
  try {
    const { orderId } = req.params;
    const superClientId = req.superClientId;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    const tenant = await User.findById(superClientId).select(
      "orderWorkflowMode",
    );
    if (tenant?.orderWorkflowMode !== "shared_delivery") {
      return res.status(400).json({
        error: "Delivery claiming is not enabled for this tenant",
      });
    }

    if (req.role === "client") {
      const me = await User.findById(req.userId).select("canDeliver");
      if (!me?.canDeliver) {
        return res.status(403).json({
          error: "Only service-enabled staff can claim a delivery",
        });
      }
    }

    const claimed = await Order.findOneAndUpdate(
      {
        _id: orderId,
        superClientId,
        status: "completed",
        deliveryClaimedBy: null,
        // Never re-offer an order that was already delivered directly
        // (e.g. under "existing" mode before switching to
        // "shared_delivery") — it's genuinely done, not available.
        deliveredAt: null,
      },
      {
        $set: {
          deliveryClaimedBy: req.userId || req.superClientId,
          deliveryClaimedAt: new Date(),
        },
      },
      { new: true },
    )
      .populate("table")
      .populate("products.product")
      .populate("deliveryClaimedBy", "fullName");

    if (!claimed) {
      const existing = await Order.findOne({ _id: orderId, superClientId }).select(
        "status deliveryClaimedBy deliveredAt",
      );
      if (!existing) {
        return res.status(404).json({ error: "Order not found" });
      }
      if (existing.status !== "completed") {
        return res.status(400).json({ error: "Order is not ready" });
      }
      if (existing.deliveredAt) {
        return res.status(400).json({ error: "Order was already delivered" });
      }
      return res.status(409).json({
        error: "Already accepted by another server",
      });
    }

    req.io.to(superClientId.toString()).emit("orderUpdated", claimed);

    return res.status(200).json({ message: "Order claimed", order: claimed });
  } catch (error) {
    console.error("Error claiming delivery:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

//Delete all cancelled orders
const deleteCancelledOrders = async (req, res) => {
  try {
    const superClientId = req.superClientId;

    // Find all cancelled orders with the matching superClientId
    const cancelledOrders = await Order.find({
      status: "cancelled",
      superClientId: superClientId,
    });

    if (cancelledOrders.length === 0) {
      return res.status(404).json({ error: "No cancelled orders found" });
    }

    // Delete each cancelled order and remove its reference from the table
    for (const order of cancelledOrders) {
      await Order.findByIdAndDelete(order._id);

      // Remove the order reference from the table
      await Table.findByIdAndUpdate(order.table, {
        $pull: { orders: order._id },
      });

      req.io.to(superClientId.toString()).emit("newOrder", order._id); // Emit to specific room
      console.log("Deleted order ID is", order._id);
    }

    res.status(200).json({ message: "Cancelled orders deleted successfully" });
  } catch (error) {
    logger.error(
      `Error deleting cancelled orders for superClientId ${req.superClientId}: ${error.message}`,
      error,
    );
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  createOrder,
  getAllOrders,
  getNonDineInOrdersToday,
  getOrder,
  updateOrder,
  deleteOrder,
  rateOrderProducts,
  confirmSelectedPayments,
  confirmNotDineinSelectedOrder,
  getOrdersBySuperClientIdFIFO,
  updateOrderStatus,
  confirmSelectedProductsPayments,
  confirmSelectedNotDineinProductsPayments,
  tipOrder,
  deleteCancelledOrders,
  markOrderDelivered,
  claimDelivery,
};
