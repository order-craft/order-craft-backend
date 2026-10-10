const mongoose = require("mongoose");
const Order = require("../models/Order");
const User = require("../models/User");
const getDailyRevenue = async (req, res) => {
  const superClientId = req.superClientId;

  if (!superClientId) {
    return res.status(400).json({ message: "SuperClientId is required" });
  }

  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const orders = await Order.find({
      status: "archived",
      timestamp: { $gte: startOfDay },
      superClientId,
    }).populate([
      {
        path: "products.product",
        select: "price discountPercentage",
      },
      {
        path: "products.paymentMethod",
        select: "name",
      },
      {
        path: "paymentMethod",
        select: "name",
      },
    ]);

    let totalRevenue = 0;
    const revenueByPaymentMethod = {};

    for (const order of orders) {
      totalRevenue += order.totalPrice;

      if (order.paymentMethod) {
        const methodName = order.paymentMethod.name;
        revenueByPaymentMethod[methodName] =
          (revenueByPaymentMethod[methodName] || 0) + order.totalPrice;
      } else {
        for (const product of order.products) {
          const basePrice = product.product?.price ?? 0;
          const discount = product.product?.discountPercentage ?? 0;
          const finalUnitPrice = basePrice * (1 - discount / 100);

          const splits =
            Array.isArray(product.paymentSplits) &&
            product.paymentSplits.length > 0
              ? product.paymentSplits
              : [
                  {
                    quantity: product.quantity,
                    paymentMethod: product.paymentMethod ?? order.paymentMethod,
                  },
                ];

          for (const split of splits) {
            const methodName =
              split.paymentMethod?.name ??
              product.paymentMethod?.name ??
              order.paymentMethod?.name ??
              "unknown";
            const revenue = finalUnitPrice * (split.quantity || 0);
            revenueByPaymentMethod[methodName] =
              (revenueByPaymentMethod[methodName] || 0) + revenue;
          }
        }
      }
    }

    res.status(200).json({
      totalRevenue,
      revenueByPaymentMethod,
    });
  } catch (error) {
    console.error("Error retrieving daily revenue:", error);
    res.status(500).json({
      message: "Failed to retrieve daily revenue",
      error: error.message,
    });
  }
};

//get revenues for current month
const getMonthlyRevenue = async (req, res) => {
  const superClientId = req.superClientId;

  if (!superClientId) {
    return res.status(400).json({ message: "SuperClientId is required" });
  }

  if (!mongoose.Types.ObjectId.isValid(superClientId)) {
    return res.status(400).json({ message: "Invalid SuperClientId format" });
  }

  try {
    const startOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );

    // Récupérer toutes les commandes archivées du mois en cours
    const orders = await Order.find({
      status: "archived",
      timestamp: { $gte: startOfMonth },
      superClientId,
    })
      .populate("products.product")
      .populate("paymentMethod")
      .populate("products.paymentMethod");

    const revenueByDay = {};
    const revenueByPaymentMethod = {};
    let totalRevenue = 0;

    for (const order of orders) {
      const day = order.timestamp.getDate();

      if (!revenueByDay[day]) revenueByDay[day] = 0;

      if (order.paymentMethod) {
        // Whole order paid with a single method (order-level)
        let orderRevenue = 0;

        for (const item of order.products) {
          const product = item.product;
          if (!product || !product.price) continue;

          const discount = product.discountPercentage || 0;
          const priceAfterDiscount = product.price * (1 - discount / 100);
          orderRevenue += item.quantity * priceAfterDiscount;
        }

        const methodName = order.paymentMethod.name || "Unknown";
        revenueByPaymentMethod[methodName] =
          (revenueByPaymentMethod[methodName] || 0) + orderRevenue;

        totalRevenue += orderRevenue;
        revenueByDay[day] += orderRevenue;
      } else {
        // Products may carry per-unit splits with different methods
        for (const item of order.products) {
          const product = item.product;
          if (!product || !product.price) continue;

          const discount = product.discountPercentage || 0;
          const priceAfterDiscount = product.price * (1 - discount / 100);

          const splits =
            Array.isArray(item.paymentSplits) && item.paymentSplits.length > 0
              ? item.paymentSplits
              : [
                  {
                    quantity: item.quantity,
                    paymentMethod: item.paymentMethod,
                  },
                ];

          for (const split of splits) {
            const method =
              split.paymentMethod?.name ||
              item.paymentMethod?.name ||
              "Unknown";
            const productRevenue = (split.quantity || 0) * priceAfterDiscount;

            revenueByPaymentMethod[method] =
              (revenueByPaymentMethod[method] || 0) + productRevenue;

            totalRevenue += productRevenue;
            revenueByDay[day] += productRevenue;
          }
        }
      }
    }

    const formattedRevenue = Object.entries(revenueByDay).map(
      ([day, total]) => ({
        _id: { day: parseInt(day) },
        dailyRevenue: total,
      }),
    );

    res.status(200).json({
      totalRevenue,
      dailyRevenue: formattedRevenue,
      revenueByPaymentMethod,
    });
  } catch (error) {
    console.error("Error retrieving monthly revenue:", error);
    res.status(500).json({
      message: "Failed to retrieve monthly revenue",
      error: error.message,
    });
  }
};

// growth current & previous month
const getMonthlyGrowthRate = async (req, res) => {
  const superClientId = req.superClientId;

  if (!superClientId) {
    return res.status(400).json({ message: "SuperClientId is required" });
  }

  if (!mongoose.Types.ObjectId.isValid(superClientId)) {
    return res.status(400).json({ message: "Invalid SuperClientId format" });
  }

  try {
    const currentDate = new Date();
    const startOfCurrentMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1,
    );
    const startOfPreviousMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() - 1,
      1,
    );
    const endOfPreviousMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      0,
    ); // Last day of the previous month

    // Fetch orders for the current month and filter by superClientId
    const currentMonthOrders = await Order.find({
      status: "archived",
      timestamp: { $gte: startOfCurrentMonth },
      superClientId, // Directly filter by superClientId
    });

    // Calculate current month revenue
    const currentMonthRevenue = currentMonthOrders.reduce(
      (total, order) => total + order.totalPrice,
      0,
    );

    // Fetch orders for the previous month and filter by superClientId
    const previousMonthOrders = await Order.find({
      status: "archived",
      timestamp: { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth },
      superClientId, // Directly filter by superClientId
    });

    // Calculate previous month revenue
    const previousMonthRevenue = previousMonthOrders.reduce(
      (total, order) => total + order.totalPrice,
      0,
    );

    // Calculate growth rate
    let growthRate = 0;
    if (previousMonthRevenue > 0) {
      growthRate =
        ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) *
        100;
    } else if (currentMonthRevenue > 0) {
      growthRate = 100; // If there's no revenue in the previous month and some revenue in the current month, growth rate is 100%
    }

    res.status(200).json({
      currentMonthRevenue,
      previousMonthRevenue,
      growthRate: growthRate.toFixed(2), // Limiting to 2 decimal places
    });
  } catch (error) {
    console.error("Error retrieving monthly growth rate:", error);
    res.status(500).json({
      message: "Failed to retrieve monthly growth rate",
      error: error.message,
    });
  }
};

//get revenues for current week
const getWeeklyRevenue = async (req, res) => {
  const superClientId = req.superClientId;

  if (!superClientId) {
    return res.status(400).json({ message: "SuperClientId is required" });
  }

  if (!mongoose.Types.ObjectId.isValid(superClientId)) {
    return res.status(400).json({ message: "Invalid SuperClientId format" });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 6);

    const endDate = new Date(today);
    endDate.setHours(23, 59, 59, 999);

    const prevStartDate = new Date(startDate);
    prevStartDate.setDate(startDate.getDate() - 7);

    const prevEndDate = new Date(startDate);
    prevEndDate.setHours(23, 59, 59, 999);

    // Fetch orders for current and previous week
    const [currentWeekOrders, prevWeekOrders] = await Promise.all([
      Order.find({
        status: "archived",
        timestamp: { $gte: startDate, $lte: endDate },
        superClientId,
      })
        .populate("products.product")
        .populate("paymentMethod")
        .populate("products.paymentMethod"),
      Order.find({
        status: "archived",
        timestamp: { $gte: prevStartDate, $lte: prevEndDate },
        superClientId,
      }),
    ]);

    // Revenue calculation for previous week (simplified)
    const prevWeekRevenue = prevWeekOrders.reduce(
      (total, order) => total + order.totalPrice,
      0,
    );

    const revenueByPaymentMethod = {};
    let currentWeekRevenue = 0;

    const dailyRevenue = {};

    for (const order of currentWeekOrders) {
      const orderDate = order.timestamp.getDate();

      // Accumulate per-day revenue
      if (!dailyRevenue[orderDate]) {
        dailyRevenue[orderDate] = 0;
      }

      if (order.paymentMethod) {
        // Single payment method for entire order
        let orderRevenue = 0;

        for (const item of order.products) {
          const product = item.product;
          if (!product || !product.price) continue;

          const discount = product.discountPercentage || 0;
          const priceAfterDiscount = product.price * (1 - discount / 100);
          orderRevenue += item.quantity * priceAfterDiscount;
        }

        const methodName = order.paymentMethod.name || "Unknown";

        revenueByPaymentMethod[methodName] =
          (revenueByPaymentMethod[methodName] || 0) + orderRevenue;

        currentWeekRevenue += orderRevenue;
        dailyRevenue[orderDate] += orderRevenue;
      } else {
        // Products may carry per-unit splits with different methods
        for (const item of order.products) {
          const product = item.product;
          if (!product || !product.price) continue;

          const discount = product.discountPercentage || 0;
          const priceAfterDiscount = product.price * (1 - discount / 100);

          const splits =
            Array.isArray(item.paymentSplits) && item.paymentSplits.length > 0
              ? item.paymentSplits
              : [
                  {
                    quantity: item.quantity,
                    paymentMethod: item.paymentMethod,
                  },
                ];

          for (const split of splits) {
            const method =
              split.paymentMethod?.name ||
              item.paymentMethod?.name ||
              "Unknown";
            const productRevenue = (split.quantity || 0) * priceAfterDiscount;

            revenueByPaymentMethod[method] =
              (revenueByPaymentMethod[method] || 0) + productRevenue;

            currentWeekRevenue += productRevenue;
            dailyRevenue[orderDate] += productRevenue;
          }
        }
      }
    }

    const formattedRevenue = Object.entries(dailyRevenue).map(
      ([day, total]) => ({
        _id: { day: parseInt(day) },
        dailyRevenue: total,
      }),
    );

    const growthRate =
      prevWeekRevenue > 0
        ? ((currentWeekRevenue - prevWeekRevenue) / prevWeekRevenue) * 100
        : 0;

    res.status(200).json({
      currentWeekRevenue,
      prevWeekRevenue,
      growthRate,
      dailyRevenue: formattedRevenue,
      revenueByPaymentMethod,
    });
  } catch (error) {
    console.error("Error retrieving weekly revenue:", error);
    res.status(500).json({
      message: "Failed to retrieve weekly revenue",
      error: error.message,
    });
  }
};

//get revenue between 2 dates
const getRevenueBetweenDates = async (req, res) => {
  const { startDate, endDate } = req.body;
  const superClientId = req.superClientId;

  if (!superClientId) {
    return res.status(400).json({ message: "SuperClientId is required" });
  }

  if (!mongoose.Types.ObjectId.isValid(superClientId)) {
    return res.status(400).json({ message: "Invalid SuperClientId format" });
  }

  const currentDate = new Date();
  const defaultEndDate = new Date(currentDate);
  defaultEndDate.setHours(23, 59, 59, 999);

  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 14);
  defaultStartDate.setHours(0, 0, 0, 0);

  const start = startDate ? new Date(startDate) : defaultStartDate;
  const end = endDate ? new Date(endDate) : defaultEndDate;

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ message: "Invalid date format" });
  }

  try {
    const orders = await Order.find({
      status: "archived",
      timestamp: { $gte: start, $lte: end },
      superClientId,
    })
      .populate("products.product")
      .populate("paymentMethod")
      .populate("products.paymentMethod");

    if (orders.length === 0) {
      return res
        .status(404)
        .json({ message: "No revenue found for the given date range." });
    }

    const revenueByPaymentMethod = {};
    const revenue = {};

    for (const order of orders) {
      const year = order.timestamp.getFullYear();
      const month = order.timestamp.getMonth() + 1;
      const day = order.timestamp.getDate();
      const key = `${year}-${month}-${day}`;

      if (!revenue[key]) {
        revenue[key] = 0;
      }

      if (order.paymentMethod) {
        let orderRevenue = 0;
        for (const item of order.products) {
          const product = item.product;
          if (!product || !product.price) continue;

          const discount = product.discountPercentage || 0;
          const priceAfterDiscount = product.price * (1 - discount / 100);
          orderRevenue += item.quantity * priceAfterDiscount;
        }

        const methodName = order.paymentMethod.name || "Unknown";
        revenueByPaymentMethod[methodName] =
          (revenueByPaymentMethod[methodName] || 0) + orderRevenue;

        revenue[key] += orderRevenue;
      } else {
        for (const item of order.products) {
          const product = item.product;
          if (!product || !product.price) continue;

          const discount = product.discountPercentage || 0;
          const priceAfterDiscount = product.price * (1 - discount / 100);

          const splits =
            Array.isArray(item.paymentSplits) && item.paymentSplits.length > 0
              ? item.paymentSplits
              : [
                  {
                    quantity: item.quantity,
                    paymentMethod: item.paymentMethod,
                  },
                ];

          for (const split of splits) {
            const methodName =
              split.paymentMethod?.name ||
              item.paymentMethod?.name ||
              "Unknown";
            const productRevenue = (split.quantity || 0) * priceAfterDiscount;

            revenueByPaymentMethod[methodName] =
              (revenueByPaymentMethod[methodName] || 0) + productRevenue;

            revenue[key] += productRevenue;
          }
        }
      }
    }

    const formattedRevenue = Object.entries(revenue).map(([key, total]) => {
      const [year, month, day] = key.split("-").map(Number);
      return {
        _id: { year, month, day },
        dailyRevenue: total,
      };
    });

    res.status(200).json({
      dailyRevenue: formattedRevenue,
      revenueByPaymentMethod,
      totalRevenue: Object.values(revenue).reduce((sum, val) => sum + val, 0),
    });
  } catch (error) {
    console.error("Error retrieving revenue between dates:", error);
    res.status(500).json({
      message: "Failed to retrieve revenue between dates",
      error: error.message,
    });
  }
};

const getRevenueByClient = async (req, res) => {
  const superClientId = req.superClientId; // Assuming this comes from authentication

  try {
    // Find orders with 'archived' status and matching superClientId
    const orders = await Order.find({
      status: "archived",
      superClientId, // Directly filter by superClientId
    }).populate("user", "fullName"); // Populate 'user' field and select 'fullName'

    // Calculate revenue by client
    const revenue = orders.reduce((result, order) => {
      const clientId = order.user?._id;
      const clientName = order.user?.fullName;
      const orderDate = new Date(order.timestamp);
      const year = orderDate.getFullYear();
      const month = orderDate.getMonth(); // Get month as 0-11 (0 = January, 11 = December)
      const yearMonthKey = `${year}-${month + 1}`; // Format as "YYYY-MM" (add 1 to month to make it 1-12)

      // Initialize if not already set
      if (!result[clientId]) {
        result[clientId] = {
          name: clientName, // Store the client name
          revenueByMonth: {},
        };
      }
      if (!result[clientId].revenueByMonth[yearMonthKey]) {
        result[clientId].revenueByMonth[yearMonthKey] = 0;
      }

      // Add the order's totalPrice to the appropriate client and month
      result[clientId].revenueByMonth[yearMonthKey] += order.totalPrice;
      return result;
    }, {});

    // Format the revenue data for response
    const formattedRevenue = Object.entries(revenue).map(
      ([clientId, { name, revenueByMonth }]) => {
        const monthlyData = Object.entries(revenueByMonth).map(
          ([yearMonth, total]) => ({
            month: yearMonth,
            totalRevenue: total,
          }),
        );

        return {
          clientId,
          clientName: name, // Include client name
          monthlyRevenue: monthlyData,
        };
      },
    );

    res.status(200).json(formattedRevenue);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve revenue by client per month",
      error: error.message,
    });
  }
};

// This controller will handle the logic for fetching revenue for a specific waiter (client) within a specified period. If no waiter or dates are provided, it will default to all waiters and the current month
const getRevenueByWaiterAndPeriod = async (req, res) => {
  const { clientId, startDate, endDate } = req.body;
  const superClientId = req.superClientId;

  // Default to the current month if no dates are provided
  const defaultEndDate = new Date();
  const defaultStartDate = new Date(defaultEndDate);
  defaultStartDate.setDate(1); // Start of the current month

  const queryStartDate = startDate ? new Date(startDate) : defaultStartDate;
  const queryEndDate = endDate ? new Date(endDate) : defaultEndDate;

  try {
    // Build the query
    const query = {
      superClientId,
      status: "archived",
      timestamp: { $gte: queryStartDate, $lte: queryEndDate },
    };

    // Add clientId to the query if provided
    if (clientId) {
      query.user = clientId;
    }

    // Find orders matching the query
    const orders = await Order.find(query).populate("user", "fullName");

    // Calculate revenue
    const revenue = orders.reduce((result, order) => {
      const clientId = order.user?._id;
      const clientName = order.user?.fullName;

      // Initialize if not already set
      if (!result[clientId]) {
        result[clientId] = {
          name: clientName,
          totalRevenue: 0,
        };
      }

      // Add the order's totalPrice to the client's total revenue
      result[clientId].totalRevenue += order.totalPrice;
      return result;
    }, {});

    // Format the response
    const formattedRevenue = Object.entries(revenue).map(
      ([clientId, { name, totalRevenue }]) => ({
        clientId,
        clientName: name,
        totalRevenue,
      }),
    );

    res.status(200).json(formattedRevenue);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve revenue by waiter and period",
      error: error.message,
    });
  }
};

// This controller will fetch the daily revenue for each waiter (client) associated with a specific owner (superClient).
const getDailyRevenuePerWaiter = async (req, res) => {
  const superClientId = req.superClientId; // Assuming this comes from authentication
  const { date } = req.body; // Date for which revenue is requested

  // Default to today's date if no date is provided
  const queryDate = date ? new Date(date) : new Date();

  try {
    // Find orders for the specified date and superClientId
    const orders = await Order.find({
      superClientId,
      status: "archived",
      timestamp: {
        $gte: new Date(queryDate.setHours(0, 0, 0, 0)), // Start of the day
        $lte: new Date(queryDate.setHours(23, 59, 59, 999)), // End of the day
      },
    }).populate("user", "fullName"); // Populate waiter details

    // Calculate revenue per waiter
    const revenuePerWaiter = orders.reduce((result, order) => {
      const waiterId = order.user?._id;
      const waiterName = order.user?.fullName;

      if (!result[waiterId]) {
        result[waiterId] = {
          name: waiterName,
          totalRevenue: 0,
        };
      }

      result[waiterId].totalRevenue += order.totalPrice;
      return result;
    }, {});

    // Format the response
    const formattedRevenue = Object.values(revenuePerWaiter).map((waiter) => ({
      name: waiter.name,
      totalRevenue: waiter.totalRevenue,
    }));

    res.status(200).json(formattedRevenue);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve daily revenue per waiter",
      error: error.message,
    });
  }
};

const getUserArchivedOrders = async (req, res) => {
  const userId = req.userId; // Use the authenticated user's ID
  console.log(userId);

  try {
    // Find orders with 'archived' status, where isClosed is false and the user matches the current user
    const orders = await Order.find({
      status: "archived",
      isClosed: false,
      user: userId, // Ensure the user matches the authenticated user
    }).populate("user", "fullName"); // Populate 'user' to get fullName

    // Format product details directly from productDetails instead of populating
    const orderData = orders.map((order) => ({
      orderId: order._id,
      products: order.products.map((productEntry) => ({
        productId: productEntry.productDetails._id,
        productName: productEntry.productDetails.name,
        productPrice: productEntry.productDetails.price,
        quantity: productEntry.quantity,
        totalPrice: productEntry.quantity * productEntry.productDetails.price, // Calculate total for each product
      })),
      totalPrice: order.totalPrice, // The total price of the entire order
      tips: order.tips,
      timestamp: order.timestamp, // Timestamp when the order was placed
    }));

    // Calculate the overall total revenue for all orders combined
    const totalRevenue = orderData.reduce(
      (acc, order) => acc + order.totalPrice,
      0,
    );

    // Format the response data
    const responseData = {
      orders: orderData, // Array of order details
      totalRevenue, // Overall total of all orders
    };

    // Send back the response with orders and total revenue
    res.status(200).json(responseData);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve archived orders",
      error: error.message,
    });
    console.log(error);
  }
};
const getAllUserArchivedOrders = async (req, res) => {
  const userId = req.userId; // authenticated user's ID
  const { startDate, endDate } = req.body; // read from request body

  try {
    // Build the base query
    const match = { status: "archived", user: userId };

    // If both dates are provided, add a timestamp filter
    if (startDate || endDate) {
      const fromDate = startDate ? new Date(startDate) : null;
      const toDateRaw = endDate ? new Date(endDate) : null;

      // Validation
      if ((startDate && isNaN(fromDate)) || (endDate && isNaN(toDateRaw))) {
        return res.status(400).json({
          message:
            "Invalid date format. Use ISO 8601 (e.g., 2025-08-01 or 2025-08-01T00:00:00Z).",
        });
      }

      // To make endDate inclusive: add +1 day and use $lt
      const toDateExclusive =
        toDateRaw && !isNaN(toDateRaw)
          ? new Date(toDateRaw.getTime() + 24 * 60 * 60 * 1000)
          : null;

      match.timestamp = {};
      if (fromDate) match.timestamp.$gte = fromDate;
      if (toDateExclusive) match.timestamp.$lt = toDateExclusive;

      if (fromDate && toDateRaw && toDateRaw < fromDate) {
        return res.status(400).json({
          message: "`startDate` must be before or equal to `endDate`.",
        });
      }
    }

    // Query orders
    const orders = await Order.find(match).populate("user", "fullName");

    // Format response
    const orderData = orders.map((order) => ({
      orderId: order._id,
      products: order.products.map((productEntry) => ({
        productId: productEntry.productDetails._id,
        productName: productEntry.productDetails.name,
        productPrice: productEntry.productDetails.price,
        quantity: productEntry.quantity,
        totalPrice: productEntry.quantity * productEntry.productDetails.price,
      })),
      totalPrice: order.totalPrice ?? 0,
      tips: order.tips ?? 0,
      timestamp: order.timestamp,
      userFullName: order.user?.fullName,
    }));

    const totalRevenue = orderData.reduce(
      (acc, order) => acc + (order.totalPrice || 0),
      0,
    );

    res.status(200).json({
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
      count: orderData.length,
      totalRevenue,
      orders: orderData,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to retrieve archived orders",
      error: error.message,
    });
  }
};

const closeUserOrders = async (req, res) => {
  const userId = req.userId; // Get the current user's ID from the request

  try {
    // Find all orders that match the current user, are archived, and not yet closed
    const ordersToClose = await Order.find({
      user: userId, // Match the current user's orders
      isClosed: false, // Only find orders where isClosed is false
      status: "archived", // Ensure the orders are archived
    });

    // If no matching orders are found, return a 404 response
    if (ordersToClose.length === 0) {
      return res.status(404).json({
        message: "No open archived orders found for the current user.",
      });
    }

    // Transform the orders to include product details instead of populating
    const ordersWithProductDetails = ordersToClose.map((order) => {
      const productsWithDetails = order.products.map((product) => ({
        name: product.productDetails.name,
        quantity: product.quantity,
        price: product.productDetails.price,
        total: product.quantity * product.productDetails.price,
      }));
      return { ...order.toObject(), products: productsWithDetails };
    });

    // Perform the update to set isClosed to true
    await Order.updateMany(
      {
        _id: { $in: ordersToClose.map((order) => order._id) }, // Update only the found orders
      },
      {
        $set: { isClosed: true }, // Set isClosed to true
      },
    );

    // Return the modified orders with product details
    res.status(200).json({
      message: "All matching orders have been successfully closed.",
      closedOrders: ordersWithProductDetails, // Return the orders that were closed with product details
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to close orders",
      error: error.message,
    });
  }
};

const getRevenueByProduct = async (req, res) => {
  const superClientId = req.superClientId;

  try {
    // Fetch orders using 'status' and 'superClientId' directly in the query
    const orders = await Order.find({
      status: "archived",
      superClientId: superClientId, // Filter by superClientId directly
    });

    // Calculate revenue using the productDetails field directly
    const revenue = orders.reduce((result, order) => {
      order.products.forEach((productEntry) => {
        const { productDetails, quantity } = productEntry;

        // Ensure productDetails exists (in case products were deleted)
        if (productDetails) {
          const productId = productDetails._id;
          if (!result[productId]) {
            result[productId] = {
              productName: productDetails.name,
              totalRevenue: 0,
            };
          }
          result[productId].totalRevenue += quantity * productDetails.price;
        }
      });
      return result;
    }, {});

    // Format the revenue data for response
    const formattedRevenue = Object.entries(revenue).map(
      ([productId, details]) => ({
        _id: productId,
        productName: details.productName,
        totalRevenue: details.totalRevenue,
      }),
    );

    res.status(200).json(formattedRevenue);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve revenue by product",
      error: error.message,
    });
  }
};

const getRevenueByProductByMonth = async (req, res) => {
  const superClientId = req.superClientId;

  try {
    // Get the current year and date
    const currentYear = new Date().getFullYear();
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // JavaScript months are 0-based

    // Find orders from the current year, without the unnecessary table population
    const orders = await Order.find({
      status: "archived",
      timestamp: {
        $gte: new Date(`${currentYear}-01-01T00:00:00Z`),
        $lt: new Date(`${currentYear + 1}-01-01T00:00:00Z`),
      },
      superClientId: superClientId, // Directly filter by superClientId
    });

    // Group revenue by product and month
    const revenue = orders.reduce((result, order) => {
      const month = new Date(order.timestamp).getMonth() + 1; // Get month from timestamp
      if (month > currentMonth) return result; // Skip future months

      order.products.forEach((productEntry) => {
        const { productDetails, quantity } = productEntry;

        // Ensure productDetails exists (in case products were deleted)
        if (productDetails) {
          const productId = productDetails._id;
          if (!result[month]) result[month] = {};
          if (!result[month][productId]) {
            result[month][productId] = {
              productName: productDetails.name,
              totalRevenue: 0,
            };
          }
          result[month][productId].totalRevenue +=
            quantity * productDetails.price;
        }
      });
      return result;
    }, {});

    // Format the revenue data for response
    const formattedRevenue = Object.entries(revenue).map(
      ([month, products]) => ({
        month: parseInt(month, 10),
        products: Object.entries(products).map(([productId, details]) => ({
          _id: productId,
          productName: details.productName,
          totalRevenue: details.totalRevenue,
        })),
      }),
    );

    res.status(200).json(formattedRevenue);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve revenue by product by month",
      error: error.message,
    });
  }
};

const getMostSoldProducts = async (req, res) => {
  const superClientId = req.superClientId;

  try {
    // Find orders with 'archived' status and filter by superClientId directly
    const orders = await Order.find({
      status: "archived",
      superClientId: superClientId, // Filter by superClientId directly in the query
    });

    // Calculate the total quantity sold using the productDetails field directly
    const products = orders.reduce((result, order) => {
      order.products.forEach((productEntry) => {
        const { productDetails, quantity } = productEntry;

        // Ensure productDetails exists (in case products were deleted)
        if (productDetails) {
          const productId = productDetails._id;
          if (!result[productId]) {
            result[productId] = {
              productName: productDetails.name,
              totalSold: 0,
            };
          }
          result[productId].totalSold += quantity;
        }
      });
      return result;
    }, {});

    // Format the product data for response
    const formattedProducts = Object.entries(products)
      .map(([productId, details]) => ({
        _id: productId,
        productName: details.productName,
        totalSold: details.totalSold,
      }))
      .sort((a, b) => b.totalSold - a.totalSold); // Sort by total sold

    const top10Products = formattedProducts.slice(0, 10); // Get the top 10

    res.status(200).json(top10Products);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve most sold products",
      error: error.message,
    });
  }
};

const getOrdersByMonthForYear = async (req, res) => {
  const superClientId = req.superClientId;

  if (!superClientId) {
    return res.status(400).json({ message: "SuperClientId is required" });
  }

  if (!mongoose.Types.ObjectId.isValid(superClientId)) {
    return res.status(400).json({ message: "Invalid SuperClientId format" });
  }

  try {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);
    const endOfYear = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59);

    // Fetch orders with filtering by status and superClientId directly in the query
    const orders = await Order.find({
      status: "archived",
      superClientId: superClientId, // Directly filter by superClientId
      timestamp: { $gte: startOfYear, $lte: endOfYear },
    });

    // Group orders by month
    const ordersByMonth = orders.reduce((result, order) => {
      const month = order.timestamp.getMonth() + 1; // Get the month (1-12)
      if (!result[month]) {
        result[month] = [];
      }
      result[month].push(order);
      return result;
    }, {});

    // Format the orders by month for the response
    const formattedOrders = Object.entries(ordersByMonth).map(
      ([month, orders]) => ({
        _id: { month: parseInt(month) },
        orders: orders,
      }),
    );

    res.status(200).json(formattedOrders);
  } catch (error) {
    console.error("Error retrieving orders by month:", error);
    res.status(500).json({
      message: "Failed to retrieve orders by month",
      error: error.message,
    });
  }
};

const getRevenueByProductBetweenDates = async (req, res) => {
  const superClientId = req.superClientId;
  const { startDate, endDate } = req.body;

  if (!startDate || !endDate) {
    return res.status(400).json({
      message: "Start date and end date are required",
    });
  }

  try {
    // Fetch orders between startDate and endDate for the specific superClientId
    const orders = await Order.find({
      status: "archived",
      superClientId: superClientId, // Filter by superClientId directly in the query
      timestamp: { $gte: new Date(startDate), $lte: new Date(endDate) },
    });

    // Calculate revenue using the productDetails field directly
    const revenue = orders.reduce((result, order) => {
      order.products.forEach((productEntry) => {
        const { productDetails, quantity } = productEntry;

        // Ensure productDetails exists (in case products were deleted)
        if (productDetails) {
          const productId = productDetails._id;
          if (!result[productId]) {
            result[productId] = {
              productName: productDetails.name,
              totalRevenue: 0,
            };
          }
          result[productId].totalRevenue += quantity * productDetails.price;
        }
      });
      return result;
    }, {});

    // Format the revenue data for response
    const formattedRevenue = Object.entries(revenue).map(
      ([productId, details]) => ({
        _id: productId,
        productName: details.productName,
        totalRevenue: details.totalRevenue,
      }),
    );

    res.status(200).json(formattedRevenue);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve revenue by product",
      error: error.message,
    });
  }
};

const getMonthlyRevenueForSpecificMonth = async (req, res) => {
  const { superClientId } = req;
  const { month, year } = req.body;

  if (!superClientId) {
    return res.status(400).json({ message: "SuperClientId is required" });
  }

  if (!mongoose.Types.ObjectId.isValid(superClientId)) {
    return res.status(400).json({ message: "Invalid SuperClientId format" });
  }

  if (month == null || year == null) {
    return res.status(400).json({ message: "Month and year are required" });
  }

  if (month < 1 || month > 12) {
    return res
      .status(400)
      .json({ message: "Invalid month value. It should be between 1 and 12." });
  }

  try {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999); // last day of the month

    // Query orders for the given month and year, filtering by superClientId
    const orders = await Order.find({
      status: "archived",
      superClientId: superClientId,
      timestamp: { $gte: startOfMonth, $lte: endOfMonth },
    });

    // Calculate the daily revenue for the selected month
    const revenue = orders.reduce((result, order) => {
      const day = order.timestamp.getDate();
      if (!result[day]) {
        result[day] = 0;
      }
      result[day] += order.totalPrice;
      return result;
    }, {});

    // Format the revenue data to send as response
    const formattedRevenue = Object.entries(revenue).map(([day, total]) => ({
      _id: { day: parseInt(day) },
      dailyRevenue: total,
    }));

    res.status(200).json(formattedRevenue);
  } catch (error) {
    console.error("Error retrieving monthly revenue:", error);
    res.status(500).json({
      message: "Failed to retrieve monthly revenue",
      error: error.message,
    });
  }
};

const getRevenueForCurrentYear = async (req, res) => {
  const superClientId = req.superClientId;

  if (!superClientId) {
    return res.status(400).json({ message: "SuperClientId is required" });
  }

  if (!mongoose.Types.ObjectId.isValid(superClientId)) {
    return res.status(400).json({ message: "Invalid SuperClientId format" });
  }

  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    // Query all orders for the current year that match the superClientId and status
    const orders = await Order.find({
      status: "archived",
      superClientId: superClientId,
      timestamp: {
        $gte: new Date(currentYear, 0, 1), // Start of the year
        $lte: new Date(currentYear, 11, 31, 23, 59, 59), // End of the year
      },
    });

    // Initialize an array to store revenue for each month
    const monthlyRevenue = Array(12).fill(0);

    // Process orders and accumulate revenue by month
    orders.forEach((order) => {
      const month = order.timestamp.getMonth(); // Get the month of the order
      monthlyRevenue[month] += order.totalPrice; // Add the order's total price to the appropriate month
    });

    // Format the response to include only up to the current month
    const formattedRevenue = months
      .slice(0, currentMonth + 1) // Only include up to the current month
      .map((monthName, index) => ({
        month: monthName,
        revenue: monthlyRevenue[index],
      }));

    res.status(200).json(formattedRevenue);
  } catch (error) {
    console.error("Error retrieving yearly revenue:", error);
    res.status(500).json({
      message: "Failed to retrieve yearly revenue",
      error: error.message,
    });
  }
};

const getRevenueByProductForCurrentWeek = async (req, res) => {
  const superClientId = req.superClientId;

  try {
    const now = new Date();

    // Get the start of the week (Sunday)
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    startOfWeek.setHours(0, 0, 0, 0); // Set time to midnight

    // Get the end of the week (Saturday)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999); // Set time to the end of the day

    // Query for orders within the week for the given superClientId
    const orders = await Order.find({
      status: "archived",
      timestamp: { $gte: startOfWeek, $lte: endOfWeek },
      superClientId: superClientId, // Filter by superClientId directly
    });

    // Initialize an object to store revenue data per day and product
    const dailyProductRevenue = {};

    // Loop through the orders to populate dailyProductRevenue
    orders.forEach((order) => {
      const day = new Date(order.timestamp).toISOString().split("T")[0]; // Format date as YYYY-MM-DD
      if (!dailyProductRevenue[day]) {
        dailyProductRevenue[day] = {}; // Initialize the day's product revenue object
      }

      // Loop through the products and calculate their revenue
      order.products.forEach((product) => {
        const { productDetails, quantity } = product;
        if (productDetails) {
          const productId = productDetails._id;
          if (!dailyProductRevenue[day][productId]) {
            dailyProductRevenue[day][productId] = {
              productName: productDetails.name,
              totalRevenue: 0,
            };
          }
          // Calculate the revenue for each product
          dailyProductRevenue[day][productId].totalRevenue +=
            quantity * productDetails.price;
        }
      });
    });

    // Format the response to return data for each day of the week
    const formattedRevenue = Object.entries(dailyProductRevenue).map(
      ([date, products]) => ({
        date,
        products: Object.entries(products).map(([productId, details]) => ({
          _id: productId,
          productName: details.productName,
          totalRevenue: details.totalRevenue,
        })),
      }),
    );

    res.status(200).json(formattedRevenue);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve weekly product revenue",
      error: error.message,
    });
  }
};

const getAverageProcessingTime = async (req, res) => {
  const { startDate, endDate } = req.body;
  const superClientId = req.superClientId;
  const tenant = await User.findById(superClientId).select("statusFlowEnabled");
  if (tenant && tenant.statusFlowEnabled === false) {
    return res.status(200).json({
      statusFlowDisabled: true,
      message: "Status flow is disabled — processing times are not tracked.",
    });
  }
  // Set default dates if not provided
  const defaultEndDate = new Date();
  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultEndDate.getDate() - 7);

  const queryStartDate = startDate ? new Date(startDate) : defaultStartDate;
  const queryEndDate = endDate ? new Date(endDate) : defaultEndDate;

  try {
    // Query orders within date range
    const orders = await Order.find({
      timestamp: { $gte: queryStartDate, $lte: queryEndDate },
      status: { $in: ["pending", "preparing", "completed"] },
      superClientId: superClientId,
    }).sort({ timestamp: 1 });

    let pendingToPreparingDurations = [];
    let preparingToCompletedDurations = [];
    let skippedOrders = 0;

    orders.forEach((order) => {
      const statusDurations = order.getStatusDurations();

      // Validate and calculate pending → preparing duration
      if (statusDurations.pending && statusDurations.preparing) {
        const duration = statusDurations.preparing - statusDurations.pending;
        if (duration > 0) {
          pendingToPreparingDurations.push(duration);
        } else {
          skippedOrders++;
          console.warn(
            `Skipped order ${order._id}: Invalid pending→preparing duration (${duration}ms)`,
          );
        }
      }

      // Validate and calculate preparing → completed duration
      if (statusDurations.preparing && statusDurations.completed) {
        const duration = statusDurations.completed - statusDurations.preparing;
        if (duration > 0) {
          preparingToCompletedDurations.push(duration);
        } else {
          skippedOrders++;
          console.warn(
            `Skipped order ${order._id}: Invalid preparing→completed duration (${duration}ms)`,
          );
        }
      }
    });

    // Enhanced stats calculation with validation
    const calculateStats = (durations, stageName) => {
      if (durations.length === 0) {
        console.warn(`No valid durations found for ${stageName}`);
        return {
          avg: 0,
          min: 0,
          max: 0,
          count: 0,
          isValid: false,
        };
      }

      const totalDuration = durations.reduce(
        (sum, duration) => sum + duration,
        0,
      );
      const avg = totalDuration / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);

      return {
        avg: Math.round(avg / 60000), // Convert to minutes
        min: Math.round(min / 60000),
        max: Math.round(max / 60000),
        count: durations.length,
        isValid: true,
      };
    };

    const pendingToPreparingStats = calculateStats(
      pendingToPreparingDurations,
      "pending→preparing",
    );
    const preparingToCompletedStats = calculateStats(
      preparingToCompletedDurations,
      "preparing→completed",
    );

    res.status(200).json({
      // Processing time stats
      avgPendingToPreparing: pendingToPreparingStats.avg,
      minPendingToPreparing: pendingToPreparingStats.min,
      maxPendingToPreparing: pendingToPreparingStats.max,
      avgPreparingToCompleted: preparingToCompletedStats.avg,
      minPreparingToCompleted: preparingToCompletedStats.min,
      maxPreparingToCompleted: preparingToCompletedStats.max,

      // Metadata
      orderCount: orders.length,
      validPendingToPreparingCount: pendingToPreparingStats.count,
      validPreparingToCompletedCount: preparingToCompletedStats.count,
      skippedOrders,
      startDate: queryStartDate.toISOString().split("T")[0],
      endDate: queryEndDate.toISOString().split("T")[0],

      // Validity flags
      hasValidPendingToPreparing: pendingToPreparingStats.isValid,
      hasValidPreparingToCompleted: preparingToCompletedStats.isValid,
    });
  } catch (error) {
    console.error("Error calculating average processing time:", error);
    res.status(500).json({
      message: "Failed to calculate average processing time",
      error: error.message,
      details: {
        startDate: queryStartDate.toISOString(),
        endDate: queryEndDate.toISOString(),
        superClientId,
      },
    });
  }
};
const getOrderValueBreakdown = async (req, res) => {
  const { startDate, endDate, highValueThreshold } = req.body;
  const superClientId = req.superClientId;

  if (!superClientId) {
    return res.status(400).json({
      message: "SuperClient ID is required",
    });
  }

  if (!startDate || !endDate) {
    return res.status(400).json({
      message: "Start date and end date are required",
    });
  }

  try {
    // Query only archived orders for the given superClientId within the date range
    const orders = await Order.find({
      timestamp: { $gte: new Date(startDate), $lte: new Date(endDate) },
      status: "archived",
      superClientId: superClientId,
    });

    if (!orders.length) {
      return res.status(200).json({
        message:
          "No archived orders found for the given superClient ID in the date range",
        averageOrderValue: 0,
        highValueOrders: [],
      });
    }

    // Calculate total revenue and high-value orders
    let totalOrderValue = 0;
    const highValueOrders = [];

    orders.forEach((order) => {
      totalOrderValue += order.totalPrice;

      // Check if the order qualifies as high-value
      if (order.totalPrice >= (highValueThreshold || 100)) {
        highValueOrders.push(order);
      }
    });

    // Calculate average order value
    const averageOrderValue = parseFloat(
      (totalOrderValue / orders.length).toFixed(2),
    );

    // Return results
    res.status(200).json({
      averageOrderValue,
      highValueOrders,
    });
  } catch (error) {
    console.error("Error calculating orders by superClient:", error);
    res.status(500).json({
      message: "Failed to calculate orders by superClient",
      error,
    });
  }
};
/**
 * Profit summary for a date range.
 * Body: { startDate?, endDate? }
 * Defaults: last 30 days.
 *
 * Returns:
 *   {
 *     range: { startDate, endDate },
 *     orderCount,
 *     revenue,          // sum of totalPrice
 *     cost,             // sum of totalCost (only orders that have it)
 *     profit,           // sum of totalProfit
 *     marginPercent,
 *     ordersWithoutSnapshot,   // count — cost is unreliable for these
 *     excludedOrderIds,        // ids of orders missing the snapshot
 *   }
 */
const getProfitSummary = async (req, res) => {
  const superClientId = req.superClientId;
  const { startDate, endDate } = req.body || {};

  const defaultEndDate = new Date();
  defaultEndDate.setHours(23, 59, 59, 999);

  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 30);
  defaultStartDate.setHours(0, 0, 0, 0);

  const start = startDate ? new Date(startDate) : defaultStartDate;
  const end = endDate ? new Date(endDate) : defaultEndDate;

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ message: "Invalid date format" });
  }

  try {
    const orders = await Order.find({
      status: "archived",
      superClientId,
      timestamp: { $gte: start, $lte: end },
    }).lean();

    if (orders.length === 0) {
      return res.status(200).json({
        range: { startDate: start, endDate: end },
        orderCount: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        marginPercent: 0,
        ordersWithoutSnapshot: 0,
        excludedOrderIds: [],
      });
    }

    let revenue = 0;
    let cost = 0;
    let profit = 0;
    const excludedOrderIds = [];

    for (const o of orders) {
      revenue += Number(o.totalPrice) || 0;

      if (o.totalCost == null || o.costSnapshotAt == null) {
        excludedOrderIds.push(o._id);
      } else {
        cost += Number(o.totalCost) || 0;
        profit += Number(o.totalProfit) || 0;
      }
    }

    const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;

    res.status(200).json({
      range: { startDate: start, endDate: end },
      orderCount: orders.length,
      revenue: parseFloat(revenue.toFixed(4)),
      cost: parseFloat(cost.toFixed(4)),
      profit: parseFloat(profit.toFixed(4)),
      marginPercent: parseFloat(marginPercent.toFixed(2)),
      ordersWithoutSnapshot: excludedOrderIds.length,
      excludedOrderIds,
    });
  } catch (error) {
    console.error("Error calculating profit summary:", error);
    res.status(500).json({
      message: "Failed to calculate profit summary",
      error: error.message,
    });
  }
};

/**
 * Per-product margins.
 * Uses stored `costBreakdown` from each archived order line — historical.
 * Products without a recipe at order time will have `unitCost: null`
 * and are counted but not priced.
 *
 * Returns array of:
 *   {
 *     productId, productName,
 *     unitsSold,
 *     avgSellPrice,          // weighted: totalRevenue / unitsSold
 *     avgUnitCost,           // weighted: totalCost / unitsSoldWithRecipe
 *     revenue, cost, profit,
 *     marginPercent,
 *     unitsWithoutRecipe,    // how many units had no recipe
 *   }
 */
const getProductMargins = async (req, res) => {
  const superClientId = req.superClientId;

  try {
    const orders = await Order.find({
      status: "archived",
      superClientId,
    }).lean();

    const map = new Map();

    for (const order of orders) {
      for (const line of order.products || []) {
        const productId = line.productDetails?._id ?? line.product;
        if (!productId) continue;

        const key = String(productId);
        const qty = Number(line.quantity) || 0;
        const unitPrice = Number(line.productDetails?.price) || 0;

        // Apply discount: if line carries it, else look at breakdown presence.
        // We don't have discountPercentage on the order line, so use
        // productDetails.price as-is (that's what was charged).
        const lineRevenue = unitPrice * qty;

        let entry = map.get(key);
        if (!entry) {
          entry = {
            productId,
            productName: line.productDetails?.name || "Unknown",
            unitsSold: 0,
            unitsWithRecipe: 0,
            revenue: 0,
            cost: 0,
          };
          map.set(key, entry);
        }

        entry.unitsSold += qty;
        entry.revenue += lineRevenue;

        if (line.unitCost != null) {
          entry.unitsWithRecipe += qty;
          entry.cost += Number(line.unitCost) * qty;
        }
      }
    }

    const result = Array.from(map.values()).map((e) => {
      const profit = e.revenue - e.cost;
      const marginPercent = e.revenue > 0 ? (profit / e.revenue) * 100 : 0;
      const avgSellPrice = e.unitsSold > 0 ? e.revenue / e.unitsSold : 0;
      const avgUnitCost =
        e.unitsWithRecipe > 0 ? e.cost / e.unitsWithRecipe : null;

      return {
        productId: e.productId,
        productName: e.productName,
        unitsSold: e.unitsSold,
        unitsWithoutRecipe: e.unitsSold - e.unitsWithRecipe,
        avgSellPrice: parseFloat(avgSellPrice.toFixed(4)),
        avgUnitCost:
          avgUnitCost != null ? parseFloat(avgUnitCost.toFixed(4)) : null,
        revenue: parseFloat(e.revenue.toFixed(4)),
        cost: parseFloat(e.cost.toFixed(4)),
        profit: parseFloat(profit.toFixed(4)),
        marginPercent: parseFloat(marginPercent.toFixed(2)),
      };
    });

    // Sort by profit descending
    result.sort((a, b) => b.profit - a.profit);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error calculating product margins:", error);
    res.status(500).json({
      message: "Failed to calculate product margins",
      error: error.message,
    });
  }
};

/**
 * Daily profit for a date range.
 * Body: { startDate?, endDate? }
 * Defaults: last 14 days.
 *
 * Returns:
 *   {
 *     range: { startDate, endDate },
 *     daily: [{ date: "YYYY-MM-DD", revenue, cost, profit, marginPercent, orderCount }],
 *     totals: { revenue, cost, profit, marginPercent, orderCount },
 *     ordersWithoutSnapshot,
 *   }
 */
const getProfitByPeriod = async (req, res) => {
  const superClientId = req.superClientId;
  const { startDate, endDate } = req.body || {};

  const defaultEndDate = new Date();
  defaultEndDate.setHours(23, 59, 59, 999);

  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 14);
  defaultStartDate.setHours(0, 0, 0, 0);

  const start = startDate ? new Date(startDate) : defaultStartDate;
  const end = endDate ? new Date(endDate) : defaultEndDate;

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ message: "Invalid date format" });
  }

  try {
    const orders = await Order.find({
      status: "archived",
      superClientId,
      timestamp: { $gte: start, $lte: end },
    }).lean();

    const byDay = new Map();
    let totalRevenue = 0;
    let totalCost = 0;
    let totalProfit = 0;
    let orderCount = 0;
    let ordersWithoutSnapshot = 0;

    for (const o of orders) {
      const d = new Date(o.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      if (!byDay.has(key)) {
        byDay.set(key, {
          date: key,
          revenue: 0,
          cost: 0,
          profit: 0,
          orderCount: 0,
        });
      }

      const bucket = byDay.get(key);
      const rev = Number(o.totalPrice) || 0;
      bucket.revenue += rev;
      bucket.orderCount += 1;
      totalRevenue += rev;
      orderCount += 1;

      if (o.totalCost == null || o.costSnapshotAt == null) {
        ordersWithoutSnapshot += 1;
      } else {
        const c = Number(o.totalCost) || 0;
        const p = Number(o.totalProfit) || 0;
        bucket.cost += c;
        bucket.profit += p;
        totalCost += c;
        totalProfit += p;
      }
    }

    const daily = Array.from(byDay.values())
      .map((b) => ({
        date: b.date,
        revenue: parseFloat(b.revenue.toFixed(4)),
        cost: parseFloat(b.cost.toFixed(4)),
        profit: parseFloat(b.profit.toFixed(4)),
        marginPercent:
          b.revenue > 0
            ? parseFloat(((b.profit / b.revenue) * 100).toFixed(2))
            : 0,
        orderCount: b.orderCount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const marginPercent =
      totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    res.status(200).json({
      range: { startDate: start, endDate: end },
      daily,
      totals: {
        revenue: parseFloat(totalRevenue.toFixed(4)),
        cost: parseFloat(totalCost.toFixed(4)),
        profit: parseFloat(totalProfit.toFixed(4)),
        marginPercent: parseFloat(marginPercent.toFixed(2)),
        orderCount,
      },
      ordersWithoutSnapshot,
    });
  } catch (error) {
    console.error("Error calculating profit by period:", error);
    res.status(500).json({
      message: "Failed to calculate profit by period",
      error: error.message,
    });
  }
};
module.exports = {
  getDailyRevenue,
  getMonthlyRevenue,
  getRevenueByClient,
  getRevenueByProduct,
  getMostSoldProducts,
  getOrdersByMonthForYear,
  getRevenueByProductBetweenDates,
  getMonthlyRevenueForSpecificMonth,
  getRevenueForCurrentYear,
  getRevenueByProductByMonth,
  getRevenueByProductForCurrentWeek,
  getUserArchivedOrders,
  closeUserOrders,
  getWeeklyRevenue,
  getRevenueBetweenDates,
  getMonthlyGrowthRate,
  getAverageProcessingTime,
  getOrderValueBreakdown,
  getRevenueByWaiterAndPeriod,
  getDailyRevenuePerWaiter,
  //history
  getAllUserArchivedOrders,
  //profit
  getProfitSummary,
  getProductMargins,
  getProfitByPeriod,
};
