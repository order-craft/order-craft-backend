module.exports = async function restrictToWifi(req, res, next) {
  try {
    const proxyAuth = req.headers["x-proxy-auth"];
    const localIP = req.headers["x-verified-local-ip"];
    const expectedToken = process.env.SECURE_TRANSACTION_TOKEN;

    console.log("=== RestrictToWifi Debug ===");
    console.log("x-proxy-auth:", proxyAuth);
    console.log("Expected Token:", expectedToken);
    console.log("x-verified-local-ip:", localIP);
    console.log("Full Headers:", req.headers);

    if (proxyAuth !== expectedToken || !localIP) {
      return res.status(403).json({
        message: "Invalid proxy request",
        reason: !localIP ? "Missing local IP" : "Invalid auth token",
        proxyAuth,
        expectedToken,
      });
    }

    if (!localIP.startsWith("192.168.0.")) {
      return res.status(403).json({
        message: "IP not from local network",
        clientIP: localIP,
      });
    }

    next();
  } catch (error) {
    console.error("WiFi restriction middleware error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
