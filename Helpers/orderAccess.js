/**
 * Pure access-control helpers for staff actions on orders.
 *
 * Everything is decided from:
 *   - staffRole       ("preparer" | "deliverer" | "both" | "superClient")
 *   - assignedPlanIds (Array<ObjectId|string>, empty = unrestricted)
 *   - assignedTableIds(Array<ObjectId|string>, empty = unrestricted)
 *   - order.table.plan._id
 *   - order.table._id
 *
 * No DB access here — callers hydrate `order` with table.plan and pass
 * the staff's assignments from `req`. This makes the helpers unit-testable
 * and keeps the controller logic simple.
 */

const { flowForOrder } = require("./orderFlow");

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────
const asString = (v) => (v == null ? null : String(v));

const toIdSet = (arr) => {
  if (!Array.isArray(arr)) return new Set();
  return new Set(arr.map(asString).filter(Boolean));
};

const isUnrestricted = (planSet, tableSet) =>
  planSet.size === 0 && tableSet.size === 0;

/**
 * Does this staff's assignment cover this order?
 *
 * Rules (from the plan):
 *   - empty assignedPlanIds AND empty assignedTableIds → unrestricted, allow
 *   - if assignedPlanIds has items, the order's table.plan must be in it
 *   - if assignedTableIds has items, the order's table must be in it
 *   - if both are set, allow if EITHER matches (union semantics)
 *   - if the order has no table (to-go / delivery), only unrestricted staff
 *     can act on it
 *
 * @param {object} staff { role, assignedPlanIds, assignedTableIds }
 * @param {object} order hydrated order with `table` populated
 * @returns {boolean}
 */
const staffInScope = (staff, order) => {
  // superClient bypasses scope checks
  if (!staff || staff.role === "superClient") return true;

  const planSet = toIdSet(staff.assignedPlanIds);
  const tableSet = toIdSet(staff.assignedTableIds);

  if (isUnrestricted(planSet, tableSet)) return true;

  if (!order || !order.table) {
    // To-go / delivery orders: only unrestricted staff can act.
    // (If you later want scope by orderType, extend here.)
    return false;
  }

  const orderTableId = asString(order.table._id || order.table);
  const orderPlanId = asString(
    order.table.plan?._id || order.table.plan || null,
  );

  // Union semantics: match EITHER a plan OR a table.
  if (planSet.size > 0 && orderPlanId && planSet.has(orderPlanId)) return true;
  if (tableSet.size > 0 && orderTableId && tableSet.has(orderTableId)) {
    return true;
  }

  return false;
};

// ─────────────────────────────────────────────────────────────
// Role → allowed transitions
// ─────────────────────────────────────────────────────────────
// For each flow, which roles can make each transition. Any missing key means
// "nobody but superClient can do it from this flow".
const TRANSITION_ROLES = {
  "three-step": {
    "pending→preparing": ["preparer", "both"],
    "preparing→completed": ["preparer", "both"],
    "completed→archived": ["superClient"], // payment path
    "pending→cancelled": ["superClient"],
    "preparing→cancelled": ["superClient"],
  },
  "four-step": {
    "pending→preparing": ["preparer", "both"],
    "preparing→ready": ["preparer", "both"],
    "ready→delivered": ["deliverer", "both"],
    "delivered→archived": ["superClient"],
    "pending→cancelled": ["superClient"],
    "preparing→cancelled": ["superClient"],
    "ready→cancelled": ["superClient"],
  },
  "delivery-only": {
    "placed→delivered": ["deliverer", "both"],
    "delivered→archived": ["superClient"],
    "placed→cancelled": ["superClient"],
  },
  "two-step": {
    "placed→archived": ["superClient"],
    "completed→archived": ["superClient"],
    "placed→cancelled": ["superClient"],
  },
};

/**
 * Can this staff perform the given transition on this order?
 *
 * @param {object} staff { role, staffRole, assignedPlanIds, assignedTableIds }
 * @param {object} order hydrated order (with table + table.plan populated)
 * @param {string} from  current status
 * @param {string} to    target status
 * @param {object} opts  { tenant } — for legacy orders without flowAtCreation
 * @returns {{ ok: boolean, reason?: string }}
 */
const canPerformTransition = (staff, order, from, to, opts = {}) => {
  if (!staff) {
    return { ok: false, reason: "No staff context" };
  }

  // superClient: always allowed, but still must obey the state machine
  // (that check is done separately by canTransition). Here we only enforce
  // the "who" dimension.
  if (staff.role === "superClient") {
    return { ok: true };
  }

  // Scope check comes first — even a valid role can't act on the wrong table.
  if (!staffInScope(staff, order)) {
    return {
      ok: false,
      reason: "You are not assigned to this table or plan.",
    };
  }

  // Role check
  const flow = flowForOrder(order, opts.tenant);
  const map = TRANSITION_ROLES[flow];
  if (!map) {
    return { ok: false, reason: `Unknown flow '${flow}'` };
  }

  const key = `${from}→${to}`;
  const allowedRoles = map[key];
  if (!allowedRoles || allowedRoles.length === 0) {
    return {
      ok: false,
      reason: "This transition is not permitted by any role",
    };
  }

  const role = staff.staffRole || "both";
  if (!allowedRoles.includes(role) && role !== "superClient") {
    return {
      ok: false,
      reason: `Role '${role}' cannot perform '${from} → ${to}'`,
    };
  }

  return { ok: true };
};
/**
 * Can this actor edit or cancel this order?
 *
 * Rules:
 *   - superClient: always yes (subject to the state machine, checked elsewhere)
 *   - staff (client):
 *       - must be in scope (or unrestricted)
 *       - deliverers need `rolePermissions.canDelivererEditOrders === true`
 *       - preparers get the same permission as "both" for edit purposes
 *         (they will rarely see an editable order in practice)
 *   - guest (req.role === "guest" or "table"):
 *       - only if the order is in an editable state
 *       - only if `customerEditDeadline` is set and in the future
 *       - if `customerEditDeadline` is null (window disabled), the guest is
 *         allowed ONLY if the order is still in the initial status for its
 *         flow. Once a staff member has moved it, the guest is locked out.
 *
 * @param {object} args
 * @param {object} args.order      hydrated order (needs status, flowAtCreation,
 *                                 customerEditDeadline, statusTimestamps)
 * @param {object} args.staff      { role, staffRole, assignedPlanIds, assignedTableIds }
 * @param {object} args.tenant     superClient doc (needs customerEditWindow, rolePermissions)
 * @param {string} args.actorType  "guest" | "staff"
 * @param {object} [args.now]      injectable clock for tests
 * @returns {{ ok: boolean, reason?: string, deadline?: Date|null }}
 */
const canEditOrder = ({
  order,
  staff,
  tenant,
  actorType,
  now = new Date(),
}) => {
  if (!order) return { ok: false, reason: "Order not found" };

  // Terminal orders: nobody edits them, ever.
  if (["archived", "cancelled"].includes(order.status)) {
    return { ok: false, reason: `Order is already ${order.status}` };
  }

  const isGuest = actorType === "guest";

  // ── Staff path ────────────────────────────────────────────
  if (!isGuest) {
    if (!staff) return { ok: false, reason: "No staff context" };

    // superClient bypasses both scope and role-permission
    if (staff.role === "superClient") {
      return { ok: true, deadline: order.customerEditDeadline || null };
    }

    if (!staffInScope(staff, order)) {
      return {
        ok: false,
        reason: "You are not assigned to this table or plan.",
      };
    }

    // Deliverers need the explicit permission from the tenant.
    const perms = tenant?.rolePermissions || {};
    const role = staff.staffRole || "both";
    if (role === "deliverer" && !perms.canDelivererEditOrders) {
      return {
        ok: false,
        reason: "Editing orders is not permitted for your role.",
      };
    }

    return { ok: true, deadline: order.customerEditDeadline || null };
  }

  // ── Guest path ────────────────────────────────────────────
  // Guests can only edit while the order is in its initial state.
  const flow = flowForOrder(order, tenant);

  const INITIAL_STATUS = {
    "two-step": "placed",
    "three-step": "pending",
    "four-step": "pending",
    "delivery-only": "placed",
  };
  const expectedInitial = INITIAL_STATUS[flow] || "pending";

  // Legacy two-step orders start at "completed" — treat that as initial too.
  const isInitial =
    order.status === expectedInitial ||
    (flow === "two-step" && order.status === "completed");

  if (!isInitial) {
    return {
      ok: false,
      reason: "Order has already been started by the kitchen.",
    };
  }

  const deadline = order.customerEditDeadline
    ? new Date(order.customerEditDeadline)
    : null;

  if (deadline && now > deadline) {
    return {
      ok: false,
      reason: "The edit window has expired.",
      deadline,
    };
  }

  // If deadline is null but the tenant enabled the window, we can still
  // recompute it on the fly. This covers orders created before this
  // feature shipped. If the tenant disabled the window entirely, allow.
  if (!deadline) {
    const cfg = tenant?.customerEditWindow;
    if (cfg && cfg.enabled) {
      const anchorField =
        cfg.from === "preparing"
          ? order.statusTimestamps?.preparing
          : order.statusTimestamps?.[expectedInitial] ||
            order.statusTimestamps?.placed ||
            order.timestamp ||
            order.createdAt;
      if (anchorField) {
        const computed =
          new Date(anchorField).getTime() + (Number(cfg.minutes) || 0) * 60000;
        if (now.getTime() > computed) {
          return {
            ok: false,
            reason: "The edit window has expired.",
            deadline: new Date(computed),
          };
        }
        return { ok: true, deadline: new Date(computed) };
      }
      // If we cannot compute the anchor, be permissive for old data.
      return { ok: true, deadline: null };
    }
    // Window disabled → allow
    return { ok: true, deadline: null };
  }

  return { ok: true, deadline };
};
module.exports = {
  staffInScope,
  canPerformTransition,
  canEditOrder,
  TRANSITION_ROLES,
};
