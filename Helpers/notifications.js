const Notification = require("../models/Notification");
const User = require("../models/User");
const logger = require("../logger");

/**
 * Notify the active table-service server assigned to `table`, for a given
 * order event. Persists the notification first (so it's recoverable via
 * GET /notifications even if the socket push is missed), then pushes it
 * live over the per-user socket room.
 *
 * Deliberately silent/no-op (returns null) when:
 *  - the table has no assigned server (unassigned responsibility — the
 *    order must still proceed, we just don't invent a recipient), or
 *  - the assigned server is inactive (never notify inactive accounts).
 *
 * Never throws — a notification failure must not block the order mutation
 * that triggered it. Callers should still wrap calls defensively.
 */
async function notifyAssignedServer({ io, table, superClientId, type, order }) {
  try {
    if (!table || !table.user) return null;

    const server = await User.findById(table.user).select(
      "verified fullName",
    );
    if (!server || !server.verified) return null;

    const tableNumber = table.number;
    const message =
      type === "new_order"
        ? `New order for Table ${tableNumber}`
        : `Table ${tableNumber}'s order is ready`;

    const doc = await Notification.create({
      superClientId,
      recipient: server._id,
      type,
      order: order._id,
      table: table._id,
      tableNumber,
      message,
    });

    if (io) {
      io.to(`user:${server._id.toString()}`).emit("notification:new", {
        _id: doc._id,
        type: doc.type,
        order: doc.order,
        table: doc.table,
        tableNumber: doc.tableNumber,
        message: doc.message,
        read: doc.read,
        createdAt: doc.createdAt,
      });
    }

    return doc;
  } catch (error) {
    logger.error("notifyAssignedServer failed (non-fatal):", error);
    return null;
  }
}

/**
 * Notify every active preparation-capable staffer in the tenant that a new
 * order came in, so the kitchen sees it even off Order Management. This is
 * deliberately silent on the client (no sound) — it's a heads-up, not the
 * "your table" alert that notifyAssignedServer's "new_order" already covers
 * with sound. `excludeUserId` skips a recipient who already got that sound
 * notification for this same order (e.g. a staffer who both preps and owns
 * the table), so they don't get a second, redundant notification for it.
 *
 * Never throws — same contract as notifyAssignedServer.
 */
async function notifyPrepStaff({ io, superClientId, order, excludeUserId }) {
  try {
    const query = {
      superClient: superClientId,
      canPrepare: true,
      verified: true,
    };
    if (excludeUserId) {
      query._id = { $ne: excludeUserId };
    }
    const prepStaff = await User.find(query).select("_id");
    if (!prepStaff.length) return [];

    const tableNumber = order.table?.number;
    const message = tableNumber
      ? `New order for Table ${tableNumber}`
      : "New order";

    const docs = await Notification.insertMany(
      prepStaff.map((u) => ({
        superClientId,
        recipient: u._id,
        type: "new_order_prep",
        order: order._id,
        table: order.table?._id || order.table,
        tableNumber,
        message,
      })),
    );

    if (io) {
      docs.forEach((doc) => {
        io.to(`user:${doc.recipient.toString()}`).emit("notification:new", {
          _id: doc._id,
          type: doc.type,
          order: doc.order,
          table: doc.table,
          tableNumber: doc.tableNumber,
          message: doc.message,
          read: doc.read,
          createdAt: doc.createdAt,
        });
      });
    }

    return docs;
  } catch (error) {
    logger.error("notifyPrepStaff failed (non-fatal):", error);
    return [];
  }
}

/**
 * Who should be live-notified for a "need something" support request on a
 * given table: the table's assigned server (if active/verified), plus the
 * admin — but only when the admin opted in via `participatesInService`.
 * Returns an array of user-id strings (room name is `user:<id>` for each),
 * deduped. Never throws; an empty array just means nobody gets paged live
 * (the request is still saved and visible in the dashboard either way).
 */
async function resolveSupportRecipients({ tableUserId, superClientId }) {
  const ids = new Set();
  try {
    if (tableUserId) {
      const server = await User.findById(tableUserId).select("verified");
      if (server && server.verified) ids.add(server._id.toString());
    }

    const tenant = await User.findById(superClientId).select(
      "participatesInService orderWorkflowMode",
    );
    if (tenant?.participatesInService) ids.add(superClientId.toString());

    // "shared_delivery" tenants don't rely on fixed per-table servers, so a
    // table often has no assigned user at all — without this, "need
    // something" would silently reach nobody. Fall back to every active
    // service-enabled staffer, the same recipients a new/ready order
    // already reaches via notifyServiceStaff.
    if (tenant?.orderWorkflowMode === "shared_delivery") {
      const serviceStaff = await User.find({
        superClient: superClientId,
        canDeliver: true,
        verified: true,
      }).select("_id");
      serviceStaff.forEach((s) => ids.add(s._id.toString()));
    }
  } catch (error) {
    logger.error("resolveSupportRecipients failed (non-fatal):", error);
  }
  return Array.from(ids);
}

/**
 * Persist + live-push a "need something" support request to each resolved
 * recipient (assigned server, and the admin if opted in) as a regular
 * notification — so it shows in the notification bell/bar exactly like a
 * new-order alert, and survives a page reload/reconnect via GET
 * /notifications instead of only existing as a transient ringtone popup.
 * Stays unread (and therefore shown as pending, with Accept/Decline) until
 * the recipient acts on it or marks it read — same read/unread mechanism
 * already used for order notifications. Never throws.
 */
async function notifySupportRequest({
  io,
  recipientIds,
  superClientId,
  support,
  tableNumber,
  requestTypeName,
}) {
  if (!recipientIds || recipientIds.length === 0) return [];
  try {
    const message = requestTypeName
      ? `${requestTypeName} requested — Table ${tableNumber}`
      : `Table ${tableNumber} needs something`;

    const docs = await Notification.insertMany(
      recipientIds.map((recipientId) => ({
        superClientId,
        recipient: recipientId,
        type: "support_request",
        support: support._id,
        tableNumber,
        message,
      })),
    );

    if (io) {
      docs.forEach((doc) => {
        io.to(`user:${doc.recipient.toString()}`).emit("notification:new", {
          _id: doc._id,
          type: doc.type,
          support: doc.support,
          tableNumber: doc.tableNumber,
          message: doc.message,
          read: doc.read,
          createdAt: doc.createdAt,
        });
      });
    }

    return docs;
  } catch (error) {
    logger.error("notifySupportRequest failed (non-fatal):", error);
    return [];
  }
}

/**
 * Notify every active service-enabled ("canDeliver") staffer in the tenant
 * about a new or ready order, for "shared_delivery" workflow mode — where
 * delivery eligibility is independent of table assignment. Structurally
 * identical to notifyPrepStaff, but these types DO get sound client-side
 * (they're the staff-facing equivalent of notifyAssignedServer's targeted
 * alert, just broadcast to everyone eligible instead of one assigned
 * server). Never throws — same contract as the other helpers here.
 */
async function notifyServiceStaff({ io, superClientId, order, type, excludeUserId }) {
  try {
    const query = {
      superClient: superClientId,
      canDeliver: true,
      verified: true,
    };
    if (excludeUserId) {
      query._id = { $ne: excludeUserId };
    }
    const serviceStaff = await User.find(query).select("_id");
    if (!serviceStaff.length) return [];

    const tableNumber = order.table?.number;
    const message =
      type === "order_ready_service"
        ? tableNumber
          ? `Table ${tableNumber}'s order is ready`
          : "An order is ready"
        : tableNumber
          ? `New order for Table ${tableNumber}`
          : "New order";

    const docs = await Notification.insertMany(
      serviceStaff.map((u) => ({
        superClientId,
        recipient: u._id,
        type,
        order: order._id,
        table: order.table?._id || order.table,
        tableNumber,
        message,
      })),
    );

    if (io) {
      docs.forEach((doc) => {
        io.to(`user:${doc.recipient.toString()}`).emit("notification:new", {
          _id: doc._id,
          type: doc.type,
          order: doc.order,
          table: doc.table,
          tableNumber: doc.tableNumber,
          message: doc.message,
          read: doc.read,
          createdAt: doc.createdAt,
        });
      });
    }

    return docs;
  } catch (error) {
    logger.error("notifyServiceStaff failed (non-fatal):", error);
    return [];
  }
}

module.exports = {
  notifyAssignedServer,
  notifyPrepStaff,
  resolveSupportRecipients,
  notifySupportRequest,
  notifyServiceStaff,
};
