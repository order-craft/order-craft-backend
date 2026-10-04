const jwt = require("jsonwebtoken");

const verifySuperClient = (req, res, next) => {
  const tokenHeader = req.header("Authorization");

  if (!tokenHeader || !tokenHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Access denied. No token provided or invalid format." });
  }
  const token = req.header("Authorization").replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    if (decoded.role !== "superClient") {
      return res
        .status(403)
        .json({ error: "Access denied. Insufficient permissions." });
    }
    req.superClientId = decoded.userId; // Assuming the superClient ID is in the token
    req.role = decoded.role;
    next();
  } catch (error) {
    res.status(400).json({ error: "Invalid token." });
  }
};

module.exports = verifySuperClient;
