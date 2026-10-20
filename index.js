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
const { Table } = require("./models/Table");
const {
  createSupportRequest,
} = require("./controllers/SupportRequestController");
const {
  resolveSupportRecipients,
  notifySupportRequest,
} = require("./Helpers/notifications");
const Notification = require("./models/Notification");
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
const notificationRoutes = require("./routes/notificationRoutes");

dotenv.config(); // Load environment variables

// Initialize express app and server
const app = express();
const server = http.createServer(app);

// Initialize socket.io with CORS
const io = socketIo(server, {
  cors: {
    origin: "*", // Update with specific client URL in production
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors({ origin: "*", methods: "GET,HEAD,PUT,PATCH,POST,DELETE" }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(helmet());

// Attach io instance to req object
app.use((req, res, next) => {
  req.io = io;
  next();
});

// MongoDB connection
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

// Logging incoming requests
app.use((req, res, next) => {
  logger.info(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// Routes
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

// By Kadhem
app.use("/raw-materials", rawMaterialRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/recipes", recipeRoutes);
app.use("/notifications", notificationRoutes);

io.on("connection", async (socket) => {
  const token = socket.handshake.auth.token;
  const requestUrl = socket.handshake.headers.referer; // Get the request URL

  // Skip token verification for /auth/login-qr requests
  if (requestUrl && requestUrl.includes("/auth/login-qr")) {
    logger.info("QR login connection - skipping token verification");
    socket.join("qr-logins"); // Optional: join a special room
    return; // Skip the rest of the auth flow
  }
  if (!token) {
    logger.warn("No token provided in socket handshake");
    return socket.disconnect();
  }

  try {
    const SECRET_KEY = process.env.JWT_SECRET_KEY;
    const decoded = jwt.verify(token, SECRET_KEY);
    const userId = decoded?.user?.id || decoded?.userId;
    const user = await User.findById(userId);

    if (!user) {
      logger.warn(`User with ID ${userId} not found`);
      return socket.disconnect();
    }

    // A deactivated staff account must not receive live updates or
    // notifications, even if it still holds a valid (unexpired) JWT.
    if (user.role === "client" && !user.verified) {
      logger.warn(`Inactive client ${user._id} attempted socket connection`);
      return socket.disconnect();
    }

    // Room joining logic remains the same...
    if (user.role === "superClient") {
      // Superclient joins their own room
      socket.join(user._id.toString());
      logger.info(`SuperClient ${user.fullName} joined room ${user._id}`);
    } else if (user.role === "client" && user.superClient) {
      // Waiters join their superclient's room
      socket.join(user.superClient.toString());
      logger.info(
        `Client ${user.fullName} joined superClient room ${user.superClient}`
      );
    }

    // Every authenticated user also joins a personal room, used to push
    // targeted notifications (new order / order ready) to the specific
    // assigned table-service server without broadcasting to the whole
    // tenant room above.
    socket.join(`user:${user._id.toString()}`);

    // Modified support request handling
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

        // Only the table's assigned server (plus the admin, if they opted
        // in via participatesInService) gets paged — not the whole venue.
        const recipientIds = await resolveSupportRecipients({
          tableUserId: supportRequest.tableUser,
          superClientId,
        });

        recipientIds.forEach((id) => {
          io.to(`user:${id}`).emit("supportNotification", {
            tableNumber,
            requestType,
            supportId: supportRequest._id, // Include the support request ID
            createdAt: supportRequest.createdAt,
            requestTypeName,
          });
        });

        // Also persist + push it into the regular notification bell, so it
        // stays visible (and actionable) even if the ringtone popup is
        // missed or dismissed, until it's accepted/declined.
        notifySupportRequest({
          io,
          recipientIds,
          superClientId,
          support: supportRequest,
          tableNumber,
          requestTypeName,
        }).catch((err) =>
          logger.error("Failed to push support notification:", err),
        );

        logger.info(
          `Support request ${supportRequest._id} created for Table ${tableNumber} (notified ${recipientIds.length} recipient(s))`
        );
      } catch (error) {
        logger.error("Failed to create support request:", error);
        socket.emit("supportError", {
          message: "Failed to create support request",
        });
      }
    });

    // Modified call answer handling
    socket.on("supportCallAnswered", async (data) => {
      const { tableNumber, supportId } = data; // Now expecting supportId
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
        // Debug log before database operation
        logger.debug(
          `Attempting to update support request ${supportId} with answered=true`
        );

        const updatedSupport = await Support.findByIdAndUpdate(
          supportId,
          { answered: true },
          { new: true } // Return the updated document
        );

        // Debug log after database operation
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

        // Clear the matching bell notification(s) for everyone who had one,
        // so it stops showing as pending now that it's been accepted.
        Notification.updateMany(
          { support: supportId },
          { read: true },
        ).catch((err) =>
          logger.error("Failed to mark support notifications read:", err),
        );

        // Notify the same people who got the original request (assigned
        // server + opted-in admin), so their popup closes too.
        const table = await Table.findOne({
          number: tableNumber,
          superClient: superClientId,
        }).select("user");
        const recipientIds = await resolveSupportRecipients({
          tableUserId: table?.user,
          superClientId,
        });

        logger.debug(
          `Notifying ${recipientIds.length} recipient(s) about answered call`,
          {
            tableNumber,
            supportId,
          }
        );

        recipientIds.forEach((id) => {
          io.to(`user:${id}`).emit("callAnswered", {
            tableNumber,
            supportId,
          });
        });

        // The customer's guest session is issued with user.id = superClientId
        // (see qrLogin), so their socket joins this same tenant room — it's
        // the only way to reach them. Always include it here regardless of
        // the admin's participatesInService setting, or the customer never
        // learns their request was accepted.
        io.to(superClientId.toString()).emit("callAnswered", {
          tableNumber,
          supportId,
        });

        logger.info(
          `Call answered for Support ${supportId} (Table ${tableNumber})`
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

    // A staffer declined a support request instead of accepting it. Unlike
    // acceptance, this doesn't mark the Support record answered — someone
    // else (another staffer, or the same one later) can still pick it up —
    // it only lets the customer know a human looked at it and couldn't take
    // it right now, instead of leaving them wondering in silence.
    socket.on("supportRequestDeclined", (data) => {
      const { tableNumber, supportId } = data;
      const superClientId =
        user.role === "client" ? user.superClient : user._id;

      io.to(superClientId.toString()).emit("supportRequestDeclined", {
        tableNumber,
        supportId,
      });

      logger.info(
        `Support request ${supportId} declined for Table ${tableNumber}`
      );
    });

    // Disconnect handler remains the same...
    socket.on("disconnect", () => {
      logger.info(`User ${user.fullName} disconnected`);
    });
  } catch (error) {
    logger.error("Invalid or expired token:", error);
    return socket.disconnect();
  }
});

// Start the server
const port = process.env.PORT || 5000;
server.listen(port, () => {
  connect();
  logger.info(`Server is running on port ${port}`);
});
