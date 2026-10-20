const express = require("express");
const {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/NotificationController");
const verifyClientOrSuperClient = require("../middleWares/verifyClientOrSuperClient");

const router = express.Router();

router.get("/", verifyClientOrSuperClient, getMyNotifications);
router.patch("/:id/read", verifyClientOrSuperClient, markNotificationRead);
router.patch("/read-all", verifyClientOrSuperClient, markAllNotificationsRead);

module.exports = router;
