const Notification = require("../models/Notification");
const logger = require("../logger");

// A connected client's own notifications, newest first — the recovery path
// for anything missed while disconnected, and the initial hydrate on load.
// Scoped to req.userId (trusted, from the verified JWT), never a
// client-supplied recipient id.
const getMyNotifications = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const notifications = await Notification.find({ recipient: req.userId })
      .sort({ createdAt: -1 })
      .limit(limit);

    const unreadCount = await Notification.countDocuments({
      recipient: req.userId,
      read: false,
    });

    res.status(200).json({ notifications, unreadCount });
  } catch (error) {
    logger.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: req.userId },
      { read: true },
      { new: true },
    );
    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }
    res.status(200).json({ notification });
  } catch (error) {
    logger.error("Error marking notification read:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.userId, read: false },
      { read: true },
    );
    res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    logger.error("Error marking all notifications read:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
