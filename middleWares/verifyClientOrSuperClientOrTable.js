const jwt = require("jsonwebtoken");
const User = require("../models/User");

const verifyClientOrSuperClientOrTable = async (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

    if (decoded.role === "superClient") {
      req.superClientId = decoded.userId; // Assuming the superClient ID is in the token
      return next();
    }

    if (decoded.role === "client") {
      const user = await User.findById(decoded.userId).select(
        "superClient staffRole assignedPlanIds assignedTableIds notifications",
      );
      if (user && user.superClient) {
        req.superClientId = user.superClient;
        req.role = decoded.role;
        req.staffRole = user.staffRole || "both";
        req.assignedPlanIds = user.assignedPlanIds || [];
        req.assignedTableIds = user.assignedTableIds || [];
        req.staffNotifications = user.notifications || {
          newOrder: true,
          support: true,
          orderReady: true,
          orderDelivered: true,
        };

        return next();
      }
    }

    if (decoded.user.role === "superClient" && decoded.table.id) {
      req.superClientId = decoded.user.id; // Assuming the superClient ID is in the user's documen
      return next();
    }

    return res
      .status(403)
      .json({ error: "Access denied. Insufficient permissions." });
  } catch (error) {
    return res.status(400).json({ error: "Invalid token." });
  }
};

module.exports = verifyClientOrSuperClientOrTable;
