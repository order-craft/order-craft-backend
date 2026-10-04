const jwt = require("jsonwebtoken");
const logger = require("../logger"); // Import the logger

const decodeTableToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  logger.info("Token received:", token); // Log the received token

  if (!token) {
    logger.warn("No token provided");
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY); // Use your JWT secret key
    req.superClientId = decoded.user.id; // Assuming the token contains the superClientId
    req.tableId = decoded.table.id;
    req.user = decoded.user.id;
    logger.info("Token decoded successfully:", decoded.user.id); // Log successful decoding
    next();
  } catch (error) {
    logger.error("Invalid token:", error); // Log the error
    return res.status(401).json({ error: "Invalid token" });
  }
};

module.exports = decodeTableToken;
