const jwt = require("jsonwebtoken");
const User = require("../models/User");

const verifyToken = async (req, res, next) => {
  const authHeader = req.header("Authorization");
  if (!authHeader) {
    return res.status(401).json({ error: "Unauthorized - No token provided" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized - No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.userId = decoded.userId;
    req.superClientId = decoded.table?.superClient || decoded.user?.id;
    req.role = decoded.role; // Add role to the request object

    // Deactivated staff accounts must not be able to perform protected
    // actions even with a still-valid JWT (tokens aren't revocable in this
    // architecture, so we re-check on every request instead).
    if (decoded.role === "client") {
      const user = await User.findById(decoded.userId).select("verified");
      if (!user || !user.verified) {
        return res
          .status(403)
          .json({ error: "Access denied. Account is inactive." });
      }
    }

    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ error: "Unauthorized - Invalid token" });
  }
};

module.exports = verifyToken;
