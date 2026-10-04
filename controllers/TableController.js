const { baseUrl } = require("../Helpers/BaseUrl");
const Order = require("../models/Order");
const { Table, Plan } = require("../models/Table");
const User = require("../models/User");

const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");

const createTable = async (req, res) => {
  try {
    const superClient = req.superClientId;
    const { number, plan } = req.body;

    // Validate that the plan exists and belongs to this superClient
    const planExists = await Plan.findOne({
      _id: plan,
      createdBy: superClient,
    });

    if (!planExists) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    // Check if a table with the same number already exists for this superClient
    const existingTable = await Table.findOne({ number, superClient });

    if (existingTable) {
      return res.status(400).json({ error: "Table number already exists" });
    }

    // Create new table
    const newTable = new Table({
      number,
      superClient,
      plan,
    });

    const savedTable = await newTable.save();

    // Get proxy URL from user
    const user = await User.findById(superClient);
    if (!user || !user.proxyUrl) {
      return res
        .status(400)
        .json({ error: "Proxy URL not configured for this client" });
    }

    // Create payload for JWT
    const payload = {
      tableId: savedTable._id,
      number: savedTable.number,
      superClient: savedTable.superClient,
    };

    // Generate JWT and QR code (rest of your existing code)
    const token = jwt.sign(payload, process.env.JWT_SECRET_KEY);
    const qrCodeData = `${baseUrl}/login?token=${token}`;

    QRCode.toDataURL(qrCodeData, async (err, url) => {
      if (err) {
        return res.status(500).json({ error: "Failed to generate QR code" });
      }

      savedTable.qrCode = url;
      await savedTable.save();

      res.status(201).json({
        table: savedTable,
        qrCodeUrl: url,
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all tables for the authenticated user
const getTables = (req, res) => {
  Table.find({ user: req.userId })
    .then((tables) => res.json(tables))
    .catch((error) => res.status(500).json({ error: error.message }));
};

// Update a table
const updateTable = async (req, res) => {
  try {
    const { plan } = req.body;

    // If updating plan, validate it exists
    if (plan) {
      const planExists = await Plan.findOne({
        _id: plan,
        createdBy: req.superClientId,
      });

      if (!planExists) {
        return res.status(400).json({ error: "Invalid plan" });
      }
    }

    const updatedTable = await Table.findOneAndUpdate(
      { _id: req.params.id, superClient: req.superClientId },
      req.body,
      { new: true }
    );

    if (!updatedTable) {
      return res.status(404).send("Table not found");
    }
    res.json(updatedTable);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a table and its associated orders
const deleteTable = async (req, res) => {
  try {
    // Find the table by ID and userId
    const table = await Table.findOne({
      _id: req.params.id,
      superClient: req.userId,
    });

    if (!table) {
      console.warn("Table not found or does not belong to user.");
      return res.status(404).send("Table not found");
    }

    // Delete the table
    const deleted = await Table.findByIdAndDelete(req.params.id);

    if (deleted) {
      console.log("Table deleted successfully:", deleted._id);
    } else {
      console.warn("Table was not deleted (possibly already removed).");
    }

    res.status(204).send(); // No content response after deletion
  } catch (error) {
    console.error("Error deleting table and orders:", error);
    res.status(500).json({ error: error.message });
  }
};

const getTablesWithUnpaiedOrders = async (req, res) => {
  try {
    const tables = await Table.find({
      superClient: req.superClientId,
    }).populate({
      path: "orders",
      match: { payed: false }, // Only populate unpaid orders
    });

    const tablesWithUnpaidOrders = tables.map((table) => ({
      ...table.toObject(),
      unpaidOrders: table.orders.length > 0,
      qrCode: table.qrCode, // Include the QR code field
    }));

    res.status(200).json(tablesWithUnpaidOrders);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching tables with unpaid orders",
      error: err.message,
    });
  }
};

const getTableById = async (req, res) => {
  try {
    const { id } = req.params;
    const superClient = req.superClientId;

    // Find the table by ID and ensure it belongs to the authenticated superClient
    const table = await Table.findOne({ _id: id, superClient }).populate({
      path: "orders",
      match: { status: { $ne: "archived" } }, // Exclude archived orders
      populate: {
        path: "products.product", // Populate the products in each order
        model: "Product", // Ensure the model name is correct
      },
    });

    if (!table) {
      console.log(
        `Table with ID: ${id} not found or does not belong to SuperClient ID: ${superClient}`
      );
      return res.status(404).json({ error: "Table not found" });
    }

    res.status(200).json(table);
  } catch (error) {
    console.error(`Error fetching table details: ${error.message}`);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
};
//move orders from table to another
const moveOrdersToTable = async (req, res) => {
  try {
    const { sourceTableId, targetTableId } = req.body;
    const superClient = req.superClientId;

    // Find the source table and ensure it belongs to the authenticated superClient
    const sourceTable = await Table.findOne({
      _id: sourceTableId,
      superClient,
    }).populate({
      path: "orders",
      match: { status: { $ne: "archived" } }, // Exclude archived orders
    });

    if (!sourceTable) {
      return res.status(404).json({
        error: "Source table not found or does not belong to the SuperClient",
      });
    }

    // Check if there are any non-archived orders
    if (!sourceTable.orders.length) {
      return res.status(400).json({
        error: "No orders with status not archived in the source table",
      });
    }

    // Find the target table and ensure it belongs to the authenticated superClient
    const targetTable = await Table.findOne({
      _id: targetTableId,
      superClient,
    });

    if (!targetTable) {
      return res.status(404).json({
        error: "Target table not found or does not belong to the SuperClient",
      });
    }

    // Update orders to reference the target table
    const orderIds = sourceTable.orders.map((order) => order._id);

    await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { table: targetTableId } }
    );

    // Add orders to the target table
    targetTable.orders.push(...orderIds);

    // Remove orders from the source table (keep only archived orders)
    sourceTable.orders = sourceTable.orders.filter(
      (order) => order.status === "archived"
    );

    // Save both tables
    await targetTable.save();
    await sourceTable.save();

    res.status(200).json({ message: "Orders moved successfully" });
  } catch (error) {
    console.error(`Error moving orders: ${error.message}`);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
};

const createReservation = async (req, res) => {
  try {
    const { tableId, startTime, endTime } = req.body;
    const superClient = req.superClientId;

    // Validate table existence
    const table = await Table.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }

    // Check for conflicting reservations
    const conflictingReservation = table.reservations.find(
      (reservation) =>
        new Date(startTime) < new Date(reservation.endTime) &&
        new Date(endTime) > new Date(reservation.startTime)
    );

    if (conflictingReservation) {
      return res
        .status(400)
        .json({ error: "Table is already reserved for this time period" });
    }

    // Add reservation to table
    table.reservations.push({ user: superClient, startTime, endTime });
    await table.save();

    res
      .status(201)
      .json({ message: "Reservation created successfully", table });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getReservationsForTable = async (req, res) => {
  try {
    const { tableId } = req.params;

    // Find table and populate reservations
    const table = await Table.findById(tableId).populate("reservations.user");
    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }

    res.status(200).json({ reservations: table.reservations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const checkTableAvailability = async (req, res) => {
  try {
    const { tableId, startTime, endTime } = req.body;

    // Validate table existence
    const table = await Table.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }

    // Check for conflicting reservations
    const isAvailable = !table.reservations.some(
      (reservation) =>
        new Date(startTime) < new Date(reservation.endTime) &&
        new Date(endTime) > new Date(reservation.startTime)
    );

    res.status(200).json({ available: isAvailable });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteReservation = async (req, res) => {
  try {
    const { tableId, reservationId } = req.params;

    // Find table and reservation
    const table = await Table.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }

    const reservationIndex = table.reservations.findIndex(
      (reservation) => reservation._id.toString() === reservationId
    );

    if (reservationIndex === -1) {
      return res.status(404).json({ error: "Reservation not found" });
    }

    // Remove reservation
    table.reservations.splice(reservationIndex, 1);
    await table.save();

    res
      .status(200)
      .json({ message: "Reservation deleted successfully", table });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateReservation = async (req, res) => {
  try {
    const { tableId, reservationId } = req.params;
    const { startTime, endTime } = req.body;

    // Find table and reservation
    const table = await Table.findById(tableId);
    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }

    const reservation = table.reservations.find(
      (reservation) => reservation._id.toString() === reservationId
    );

    if (!reservation) {
      return res.status(404).json({ error: "Reservation not found" });
    }

    // Check for conflicting reservations
    const conflictingReservation = table.reservations.find(
      (res) =>
        res._id.toString() !== reservationId &&
        new Date(startTime) < new Date(res.endTime) &&
        new Date(endTime) > new Date(res.startTime)
    );

    if (conflictingReservation) {
      return res
        .status(400)
        .json({ error: "Table is already reserved for this time period" });
    }

    // Update reservation
    reservation.startTime = new Date(startTime);
    reservation.endTime = new Date(endTime);
    await table.save();

    res
      .status(200)
      .json({ message: "Reservation updated successfully", table });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
const getAllReservations = async (req, res) => {
  try {
    const superClient = req.superClientId;

    // Find all tables for the authenticated superClient
    const tables = await Table.find({ superClient }).populate({
      path: "reservations.user",
      select: "name email", // Select specific fields for the user
    });

    // Extract reservations and associate them with table info
    const reservations = tables.flatMap((table) =>
      table.reservations.map((reservation) => ({
        ...reservation.toObject(),
        table: {
          id: table._id,
          number: table.number,
        },
      }))
    );

    res.status(200).json({ reservations });
  } catch (error) {
    console.error("Error fetching reservations:", error.message);
    res.status(500).json({ error: "Failed to fetch reservations" });
  }
};
const getTablesWithReservations = async (req, res) => {
  try {
    const superClient = req.superClientId;
    const { date } = req.body;

    // Use the provided date or default to the current day
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    // Fetch all tables with reservations for the given date
    const tables = await Table.find({ superClient })
      .populate("superClient", "name")
      .populate("user", "name");

    // Filter reservations by the specified date
    const formattedTables = tables.map((table) => ({
      _id: table._id,
      number: table.number,
      superClient: table.superClient,
      reservations: table.reservations
        .filter(
          (reservation) =>
            new Date(reservation.startTime) >= startOfDay &&
            new Date(reservation.startTime) <= endOfDay
        )
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime)), // Sort reservations by time
    }));

    res.status(200).json(formattedTables);
  } catch (error) {
    console.error("Error fetching tables with reservations:", error);
    res
      .status(500)
      .json({ message: "Error fetching tables with reservations" });
  }
};
const getRevenueByTable = async (req, res) => {
  const superClientId = req.superClientId;

  try {
    // Fetch orders with table information
    const orders = await Order.find({
      status: ["preparing", "completed"],
      superClientId: superClientId,
    }).populate("table", "number"); // Assuming 'table' is a reference to a Table model with 'number' field

    // Calculate revenue by table
    const revenueByTable = orders.reduce((result, order) => {
      const tableNumber = order.table?.number; // Using optional chaining in case table reference is missing

      if (!tableNumber) return result; // Skip if no table number

      if (!result[tableNumber]) {
        result[tableNumber] = {
          tableNumber: tableNumber,
          totalRevenue: 0,
        };
      }

      // Calculate order total (products + tips)
      const orderTotal =
        order.products.reduce((sum, productEntry) => {
          return (
            sum +
            (productEntry.productDetails?.price || 0) * productEntry.quantity
          );
        }, 0) + (order.tips || 0);

      result[tableNumber].totalRevenue += orderTotal;

      return result;
    }, {});

    // Convert to array and sort by table number (ascending)
    const formattedRevenue = Object.values(revenueByTable).sort(
      (a, b) => a.tableNumber - b.tableNumber
    );

    res.status(200).json(formattedRevenue);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve revenue by table",
      error: error.message,
    });
  }
};
const getRevenueByTableArchived = async (req, res) => {
  const superClientId = req.superClientId;

  try {
    // Fetch orders with table information
    const orders = await Order.find({
      status: ["archived"],
      superClientId: superClientId,
    }).populate("table", "number"); // Assuming 'table' is a reference to a Table model with 'number' field

    // Calculate revenue by table
    const revenueByTable = orders.reduce((result, order) => {
      const tableNumber = order.table?.number; // Using optional chaining in case table reference is missing

      if (!tableNumber) return result; // Skip if no table number

      if (!result[tableNumber]) {
        result[tableNumber] = {
          tableNumber: tableNumber,
          totalRevenue: 0,
        };
      }

      // Calculate order total (products + tips)
      const orderTotal =
        order.products.reduce((sum, productEntry) => {
          return (
            sum +
            (productEntry.productDetails?.price || 0) * productEntry.quantity
          );
        }, 0) + (order.tips || 0);

      result[tableNumber].totalRevenue += orderTotal;

      return result;
    }, {});

    // Convert to array and sort by table number (ascending)
    const formattedRevenue = Object.values(revenueByTable).sort(
      (a, b) => a.tableNumber - b.tableNumber
    );

    res.status(200).json(formattedRevenue);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve revenue by table",
      error: error.message,
    });
  }
};

module.exports = {
  createTable,
  getTables,
  updateTable,
  deleteTable,
  getTablesWithUnpaiedOrders,
  getTableById,
  createReservation,
  getReservationsForTable,
  checkTableAvailability,
  deleteReservation,
  updateReservation,
  getAllReservations,
  getTablesWithReservations,
  moveOrdersToTable,
  getRevenueByTable,
  getRevenueByTableArchived,
};
