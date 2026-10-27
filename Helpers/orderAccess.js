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

module.exports = {
  staffInScope,
  canPerformTransition,
  TRANSITION_ROLES,
};
