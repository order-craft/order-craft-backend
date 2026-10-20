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
      req.superClientId = decoded.userId;
      req.role = decoded.role;

      return next();
    }

    if (decoded.role === "client") {
      const user = await User.findById(decoded.userId);
      if (user && user.superClient) {
        if (!user.verified) {
          return res
            .status(403)
            .json({ error: "Access denied. Account is inactive." });
        }
        req.superClientId = user.superClient;
        req.role = decoded.role;
        req.userVerified = user.verified;

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
