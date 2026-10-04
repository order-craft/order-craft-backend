const jwt = require("jsonwebtoken");
const User = require("../models/User");

const verifyClientOrSuperClient = async (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.userId = decoded.userId;
    if (decoded.role === "superClient") {
      req.superClientId = decoded.userId; // Assuming the superClient ID is in the token
      return next();
    }

    if (decoded.role === "client") {
      const user = await User.findById(decoded.userId);
      if (user && user.superClient) {
        req.superClientId = user.superClient; // Assuming the superClient ID is in the user's document
        return next();
      }
    }

    return res
      .status(403)
      .json({ error: "Access denied. Insufficient permissions." });
  } catch (error) {
    return res.status(400).json({ error: "Invalid token." });
  }
};

module.exports = verifyClientOrSuperClient;
