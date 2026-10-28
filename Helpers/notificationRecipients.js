const User = require("../models/User");
const logger = require("../logger");

/**
 * Central place that decides WHO gets a notification.
 *
 * Two concepts are separated:
 *   - "receive" (can this user see / be pinged for this event?)
 *   - "act"     (can this user perform the transition?)
 *
 * We only implement "receive" here. "Act" lives in Helpers/orderAccess.js.
 *
 * Rooms convention (joined by clients on socket connect):
 *   tenant:{superClientId}                              — everyone
 *   tenant:{superClientId}:preparers                    — staffRole ∈ {preparer, both}
 *   tenant:{superClientId}:deliverers                   — staffRole ∈ {deliverer, both}
 *   tenant:{superClientId}:plan:{planId}                — staff with that plan
 *   tenant:{superClientId}:table:{tableId}              — staff with that table
 *   user:{userId}                                       — per-user direct
 *
 * The recipient resolver never emits itself; it returns a list of
 * { userIds, rooms, playSound } that the caller passes to
 * `emitToRecipients`.
 */

const tenantRoom = (id) => `tenant:${id}`;
const preparersRoom = (id) => `tenant:${id}:preparers`;
const deliverersRoom = (id) => `tenant:${id}:deliverers`;
const planRoom = (id, planId) => `tenant:${id}:plan:${planId}`;
const tableRoom = (id, tableId) => `tenant:${id}:table:${tableId}`;
const userRoom = (id) => `user:${id}`;

/**
 * Load the minimum set of staff we need to make a routing decision.
 * We only fetch staff for THIS tenant, with only the fields the router uses.
 */
const loadStaffForTenant = async (superClientId) => {
  return User.find({
    role: "client",
    superClient: superClientId,
    verified: true,
  }).select("_id staffRole assignedPlanIds assignedTableIds notifications");
};

const superClientPrefs = (superClient) => {
  const p = superClient?.notificationPreferences || {};
  return {
    muteOrderNotifications: !!p.muteOrderNotifications,
    muteSupportNotifications: !!p.muteSupportNotifications,
    muteStaffNotifications: !!p.muteStaffNotifications,
  };
};

/**
 * Resolve recipients for a given event.
 *
 * @param {object} args
 * @param {string} args.event             "newOrder" | "orderUpdated" | "orderReady" | "orderDelivered" | "supportNotification"
 * @param {string} args.superClientId
 * @param {object} [args.superClient]     hydrated superClient doc (for prefs)
 * @param {object} [args.staff]           array of hydrated client users (for perf)
 * @param {object} [args.order]           hydrated order (table.plan populated)
 * @param {object} [args.table]           hydrated table (plan populated)
 * @param {string} [args.actorUserId]     user who performed the action — excluded from fan-out
 * @returns {{ rooms: string[], userIds: string[], playSound: boolean }}
 */
const resolveRecipients = async ({
  event,
  superClientId,
  superClient = null,
  staff = null,
  order = null,
  table = null,
  actorUserId = null,
}) => {
  const rooms = new Set();
  const userIds = new Set();
  let playSound = true;

  // Skip the actor in every branch.
  const isActor = (id) =>
    actorUserId != null && String(id) === String(actorUserId);

  // Make sure we have the objects we need
  const sc = superClient || (await User.findById(superClientId));
  const scPrefs = superClientPrefs(sc);
  const staffList = staff || (await loadStaffForTenant(superClientId));

  const tableDoc = table || order?.table || null;
  const planId = tableDoc?.plan?._id
    ? String(tableDoc.plan._id)
    : tableDoc?.plan
      ? String(tableDoc.plan)
      : null;
  const tableId = tableDoc?._id
    ? String(tableDoc._id)
    : tableDoc
      ? String(tableDoc)
      : null;

  // Convenience predicate: does this staff member receive events for this
  // table/plan? Empty assignments = unrestricted.
  const inScope = (staffMember) => {
    const plans = (staffMember.assignedPlanIds || []).map(String);
    const tables = (staffMember.assignedTableIds || []).map(String);
    if (plans.length === 0 && tables.length === 0) return true;
    if (planId && plans.includes(planId)) return true;
    if (tableId && tables.includes(tableId)) return true;
    return false;
  };

  // Per-user preference reader
  const staffWants = (staffMember, key) => {
    const prefs = staffMember.notifications || {};
    return prefs[key] !== false;
  };

  if (event === "newOrder") {
    // Preparers get it.
    for (const s of staffList) {
      if (isActor(s._id)) continue;
      const role = s.staffRole || "both";
      if (role !== "preparer" && role !== "both") continue;
      if (!staffWants(s, "newOrder")) continue;
      if (!inScope(s)) continue;

      rooms.add(userRoom(s._id));
      userIds.add(String(s._id));
    }

    // SuperClient gets their own per-user room ONLY — not the tenant room.
    // The tenant room is reserved for genuinely tenant-wide events
    // (productUpdated, tenantConfigChanged, deleteOrder). Emitting a
    // role-filtered event to the tenant room reaches every staff member,
    // which defeats the role filter.
    if (!scPrefs.muteOrderNotifications && sc) {
      if (!isActor(sc._id)) {
        rooms.add(userRoom(sc._id));
        userIds.add(String(sc._id));
      }
    } else if (scPrefs.muteOrderNotifications) {
      playSound = false;
    }
  } else if (event === "orderUpdated") {
    // Status changed or payment changed. Preparers and deliverers both care,
    // because the state machine may be advancing on either side.
    for (const s of staffList) {
      if (isActor(s._id)) continue;
      const role = s.staffRole || "both";
      if (role !== "preparer" && role !== "deliverer" && role !== "both") {
        continue;
      }
      if (!inScope(s)) continue;
      rooms.add(userRoom(s._id));
      userIds.add(String(s._id));
    }
    if (!scPrefs.muteOrderNotifications && sc) {
      if (!isActor(sc._id)) {
        rooms.add(userRoom(sc._id));
        userIds.add(String(sc._id));
      }
    } else if (scPrefs.muteOrderNotifications) {
      playSound = false;
    }
  } else if (event === "orderReady") {
    // Only deliverers care that an order is ready for pickup.
    for (const s of staffList) {
      if (isActor(s._id)) continue;
      const role = s.staffRole || "both";
      if (role !== "deliverer" && role !== "both") continue;
      if (!staffWants(s, "orderReady")) continue;
      if (!inScope(s)) continue;
      rooms.add(userRoom(s._id));
      userIds.add(String(s._id));
    }
    if (!scPrefs.muteOrderNotifications && sc) {
      if (!isActor(sc._id)) {
        rooms.add(userRoom(sc._id));
        userIds.add(String(sc._id));
      }
    } else if (scPrefs.muteOrderNotifications) {
      playSound = false;
    }
  } else if (event === "orderDelivered") {
    // Deliverers already know (they did it). Preparers might want the
    // "closed" signal, deliverers on other tables can ignore.
    for (const s of staffList) {
      if (isActor(s._id)) continue;
      const role = s.staffRole || "both";
      if (role !== "preparer" && role !== "both") continue;
      if (!staffWants(s, "orderDelivered")) continue;
      if (!inScope(s)) continue;
      rooms.add(userRoom(s._id));
      userIds.add(String(s._id));
    }
    if (!scPrefs.muteOrderNotifications && sc) {
      if (!isActor(sc._id)) {
        rooms.add(userRoom(sc._id));
        userIds.add(String(sc._id));
      }
    } else if (scPrefs.muteOrderNotifications) {
      playSound = false;
    }
  } else if (event === "supportNotification") {
    // Support calls are a floor concern → deliverers only.
    for (const s of staffList) {
      if (isActor(s._id)) continue;
      const role = s.staffRole || "both";
      if (role !== "deliverer" && role !== "both") continue;
      if (!staffWants(s, "support")) continue;
      if (!inScope(s)) continue;
      rooms.add(userRoom(s._id));
      userIds.add(String(s._id));
    }
    if (!scPrefs.muteSupportNotifications && sc) {
      if (!isActor(sc._id)) {
        rooms.add(userRoom(sc._id));
        userIds.add(String(sc._id));
      }
    } else if (scPrefs.muteSupportNotifications) {
      playSound = false;
    }
  } else {
    logger.warn(
      `[NOTIFICATIONS] Unknown event '${event}', defaulting to tenant room`,
    );
    rooms.add(tenantRoom(superClientId));
  }

  return { rooms: Array.from(rooms), userIds: Array.from(userIds), playSound };
};

/**
 * Convenience: resolve recipients and emit in one call.
 *
 * @param {SocketIO.Server} io
 * @param {object} args   same as resolveRecipients, plus { payload }
 */
const emitToRecipients = async (io, args) => {
  const { payload, ...rest } = args;
  const { rooms, playSound } = await resolveRecipients(rest);

  const finalPayload = { ...payload, playSound };

  for (const room of rooms) {
    io.to(room).emit(rest.event, finalPayload);
  }

  return { rooms, playSound };
};

module.exports = {
  resolveRecipients,
  emitToRecipients,
  tenantRoom,
  preparersRoom,
  deliverersRoom,
  planRoom,
  tableRoom,
  userRoom,
};
