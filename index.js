const express = require("express");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const helmet = require("helmet");
const bodyParser = require("body-parser");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const logger = require("./logger"); // Custom logger
const User = require("./models/User"); // User model
const { Support } = require("./models/Support");
const {
  createSupportRequest,
} = require("./controllers/SupportRequestController");
const { emitToRecipients } = require("./Helpers/notificationRecipients");

// Route imports
const productRoutes = require("./routes/productRoutes");
const menuRoutes = require("./routes/menuRoutes");
const billRoutes = require("./routes/billRoutes");
const userRoutes = require("./routes/userRoutes");
const tablesRoutes = require("./routes/tableRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const sectionRoutes = require("./routes/sectionRoute");
const postRoutes = require("./routes/postRoutes");
const orderRoutes = require("./routes/orderRoutes");
const supportRoutes = require("./routes/supportRoutes");
const paymentMethodsRoutes = require("./routes/paymentMethodRoutes");

const dashboardRoutes = require("./routes/dashboardRoutes");
const rawMaterialRoutes = require("./routes/rawMaterialRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const recipeRoutes = require("./routes/recipeRoutes");

dotenv.config(); // Load environment variables

// ─────────────────────────────────────────────────────────────
// Express + HTTP + Socket.IO bootstrap
// ─────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*", // Update with specific client URL in production
    methods: ["GET", "POST"],
  },
});

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
app.use(cors({ origin: "*", methods: "GET,HEAD,PUT,PATCH,POST,DELETE" }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(helmet());

// Attach io instance to req object
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Whenever a superClient edits a staff's role/assignments, push an event
// to that staff so their socket reconnects and joins the new rooms.
io.emitStaffAssignmentChanged = (staffUserId) => {
  io.to(`user:${staffUserId}`).emit("staffAssignmentChanged", {
    userId: String(staffUserId),
  });
};

// ─────────────────────────────────────────────────────────────
// MongoDB connection
// ─────────────────────────────────────────────────────────────
const connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO);
    logger.info("Connected to MongoDB");
  } catch (error) {
    logger.error("Error connecting to MongoDB:", error);
    throw error;
  }
};

mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected");
});
mongoose.connection.on("connected", () => {
  logger.info("MongoDB connected");
});

// ─────────────────────────────────────────────────────────────
// Request logging
// ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  logger.info(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────
app.use("/auth", userRoutes);
app.use("/tables", tablesRoutes);
app.use("/categories", categoryRoutes);
app.use("/sections", sectionRoutes);
app.use("/products", productRoutes);
app.use("/order", orderRoutes);
app.use("/menu", menuRoutes);
app.use("/bills", billRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/posts", postRoutes);
app.use("/sup", supportRoutes);
app.use("/payment-methods", paymentMethodsRoutes);

// Inventory / raw materials / recipes
app.use("/raw-materials", rawMaterialRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/recipes", recipeRoutes);

// ─────────────────────────────────────────────────────────────
// Socket.IO connection handling
// ─────────────────────────────────────────────────────────────
io.on("connection", async (socket) => {
  const token = socket.handshake.auth.token;
  const requestUrl = socket.handshake.headers.referer;

  // QR-login special case: guest login page before token is issued.
  // We skip auth here, but they can only join the qr-logins room, which
  // is not used for any sensitive fan-out.
  if (requestUrl && requestUrl.includes("/auth/login-qr")) {
    logger.info("[SOCKET] QR login connection - skipping token verification");
    socket.join("qr-logins");
    return;
  }

  if (!token) {
    logger.warn("[SOCKET] No token provided in socket handshake");
    return socket.disconnect();
  }

  try {
    const SECRET_KEY = process.env.JWT_SECRET_KEY;
    const decoded = jwt.verify(token, SECRET_KEY);
    const userId = decoded?.user?.id || decoded?.userId;
    const user = await User.findById(userId);

    if (!user) {
      logger.warn(`[SOCKET] User with ID ${userId} not found`);
      return socket.disconnect();
    }

    // ── SuperClient ──────────────────────────────────────────
    if (user.role === "superClient") {
      socket.join(user._id.toString()); // legacy room
      socket.join(`tenant:${user._id}`); // new tenant room
      socket.join(`user:${user._id}`); // direct room
      logger.info(
        `[SOCKET] SuperClient ${user.fullName} joined tenant:${user._id}`,
      );
    }

    // ── Client (waiter) ──────────────────────────────────────
    else if (user.role === "client" && user.superClient) {
      const scId = user.superClient.toString();

      socket.join(scId); // legacy room
      socket.join(`tenant:${scId}`); // new tenant room
      socket.join(`user:${user._id}`); // direct room

      const role = user.staffRole || "both";
      if (role === "preparer" || role === "both") {
        socket.join(`tenant:${scId}:preparers`);
      }
      if (role === "deliverer" || role === "both") {
        socket.join(`tenant:${scId}:deliverers`);
      }
      for (const planId of user.assignedPlanIds || []) {
        socket.join(`tenant:${scId}:plan:${planId}`);
      }
      for (const tableId of user.assignedTableIds || []) {
        socket.join(`tenant:${scId}:table:${tableId}`);
      }

      logger.info(
        `[SOCKET] Client ${user.fullName} (${role}) joined tenant:${scId} ` +
          `+ ${(user.assignedPlanIds || []).length} plans ` +
          `+ ${(user.assignedTableIds || []).length} tables`,
      );
    }

    // ── Support request handling ────────────────────────────
    socket.on("supportRequest", async (data) => {
      console.log("requesting support");

      const { tableNumber, requestType, requestTypeName } = data;
      const superClientId =
        user.role === "client" ? user.superClient : user._id;

      try {
        // Save to database
        const supportRequest = await createSupportRequest({
          tableNumber,
          requestType,
          superClientId,
        });

        // Notify the right staff (role- and scope-aware).
        // `table: null` means we skip scope filtering for support requests
        // (they are time-sensitive and we prefer over-notify over drop).
        await emitToRecipients(io, {
          event: "supportNotification",
          superClientId,
          table: null,
          payload: {
            tableNumber,
            requestType,
            supportId: supportRequest._id,
            createdAt: supportRequest.createdAt,
            requestTypeName,
          },
        });

        logger.info(
          `Support request ${supportRequest._id} created for Table ${tableNumber}`,
        );
      } catch (error) {
        logger.error("Failed to create support request:", error);
        socket.emit("supportError", {
          message: "Failed to create support request",
        });
      }
    });

    socket.on("supportCallAnswered", async (data) => {
      const { tableNumber, supportId } = data;
      const superClientId =
        user.role === "client" ? user.superClient : user._id;

      logger.debug(`Support call answered event received`, {
        tableNumber,
        supportId,
        superClientId,
        userRole: user.role,
        userId: user._id,
      });

      try {
        logger.debug(
          `Attempting to update support request ${supportId} with answered=true`,
        );

        const updatedSupport = await Support.findByIdAndUpdate(
          supportId,
          { answered: true },
          { new: true },
        );

        if (updatedSupport) {
          logger.debug(`Successfully updated support request`, {
            supportId,
            updatedSupport: updatedSupport.toObject(),
          });
        } else {
          logger.warn(`No support request found with ID: ${supportId}`);
          socket.emit("supportError", {
            message: "Support request not found",
            supportId,
          });
          return;
        }

        // `callAnswered` is a broadcast to the tenant so all staff know
        // this call is being handled (avoids double-answering). Not role-
        // filtered on purpose.
        io.to(`tenant:${superClientId}`).emit("callAnswered", {
          tableNumber,
          supportId,
        });

        logger.info(
          `Call answered for Support ${supportId} (Table ${tableNumber})`,
        );
      } catch (error) {
        logger.error("Failed to update support request:", {
          error: error.message,
          stack: error.stack,
          supportId,
          tableNumber,
        });

        socket.emit("supportError", {
          message: "Failed to update support request",
          details: error.message,
        });
      }
    });

    // ── Disconnect ──────────────────────────────────────────
    socket.on("disconnect", () => {
      logger.info(`[SOCKET] User ${user.fullName} disconnected`);
    });
  } catch (error) {
    logger.error("[SOCKET] Invalid or expired token:", error);
    return socket.disconnect();
  }
});

// ─────────────────────────────────────────────────────────────
// Start the server
// ─────────────────────────────────────────────────────────────
const port = process.env.PORT || 5000;
server.listen(port, () => {
  connect();
  logger.info(`Server is running on port ${port}`);
});
