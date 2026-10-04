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

        // Notify the SuperClient and their room
        io.to(superClientId.toString()).emit("supportNotification", {
          tableNumber,
          requestType,
          supportId: supportRequest._id, // Include the support request ID
          createdAt: supportRequest.createdAt,
          requestTypeName,
        });

        logger.info(
          `Support request ${supportRequest._id} created for Table ${tableNumber}`
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

        // Notify the SuperClient and their room
        logger.debug(
          `Notifying superClient ${superClientId} about answered call`,
          {
            tableNumber,
            supportId,
          }
        );

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
