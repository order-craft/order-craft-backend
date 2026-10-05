const logger = require("../logger");

/**
 * Guards endpoints that should only be called by Order Craft's own
 * internal admin tooling, never by tenants or guests.
 *
 * Caller must send header:  X-Internal-Key: <INTERNAL_API_KEY>
 * where INTERNAL_API_KEY is defined in the server's .env.
 */
const requireInternalKey = (req, res, next) => {
  const expected = process.env.INTERNAL_API_KEY;

  if (!expected) {
    // Fail closed: if the server doesn't have a key configured,
    // nobody gets in.
    logger.error(
      "[INTERNAL] INTERNAL_API_KEY is not set in environment — refusing request to " +
        `${req.method} ${req.originalUrl}`,
    );
    return res.status(403).json({ error: "Forbidden" });
  }

  const provided = req.header("X-Internal-Key");

  if (!provided || provided !== expected) {
    logger.warn(
      `[INTERNAL] Blocked ${req.method} ${req.originalUrl} ` +
        `from IP ${req.ip} (provided key: ${provided ? "present-but-wrong" : "missing"})`,
    );
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
};

module.exports = requireInternalKey;
