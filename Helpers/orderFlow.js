const logger = require("../logger");

// ─────────────────────────────────────────────────────────────
// Canonical status super-set. Any status an order may ever hold.
// ─────────────────────────────────────────────────────────────
const ALL_STATUSES = [
  "placed",
  "pending",
  "preparing",
  "ready",
  "delivered",
  "completed",
  "archived",
  "cancelled",
];

// Statuses that end an order's operational life.
const TERMINAL_STATUSES = ["archived", "cancelled"];

// Per-flow allowed transitions.
// Keys = "from" status, values = array of allowed "to" statuses.
const FLOWS = {
  "two-step": {
    placed: ["archived", "cancelled"],
    // Legacy orders created before Feature 1 may still be in "completed".
    completed: ["archived"],
  },
  "three-step": {
    pending: ["preparing", "cancelled"],
    preparing: ["completed", "cancelled"],
    completed: ["archived"],
  },
  "four-step": {
    pending: ["preparing", "cancelled"],
    preparing: ["ready", "cancelled"],
    ready: ["delivered", "cancelled"],
    delivered: ["archived"],
  },
  "delivery-only": {
    placed: ["delivered", "cancelled"],
    delivered: ["archived"],
  },
};

// ─────────────────────────────────────────────────────────────
// Order flow normalization
// ─────────────────────────────────────────────────────────────
const ALLOWED_FLOWS = ["two-step", "three-step", "four-step", "delivery-only"];

/**
 * Returns a flow name guaranteed to be in ALLOWED_FLOWS.
 * Falls back to legacy statusFlowEnabled if orderFlow is missing.
 */
const normalizeOrderFlow = (tenant) => {
  if (!tenant) return "three-step";
  if (typeof tenant === "string" && ALLOWED_FLOWS.includes(tenant)) {
    return tenant;
  }
  const flow = tenant.orderFlow;
  if (flow && ALLOWED_FLOWS.includes(flow)) return flow;
  // Defensive default. After the Feature 15 backfill every tenant has a
  // valid orderFlow, so this branch should never fire in practice.
  return "three-step";
};

/**
 * Returns the flow an order belongs to.
 * Priority: flowAtCreation (locked at creation) > fallback inference > tenant current.
 * Legacy orders (flowAtCreation = null) get an inference from their current status.
 */
const flowForOrder = (order, tenantFallback) => {
  if (!order) return normalizeOrderFlow(tenantFallback);
  if (order.flowAtCreation && ALLOWED_FLOWS.includes(order.flowAtCreation)) {
    return order.flowAtCreation;
  }
  // Legacy inference: if the order is in a status unique to one flow,
  // we can safely conclude the flow.
  if (["placed", "delivered"].includes(order.status)) {
    // Ambiguous between "delivery-only" and a mid-flight two-step legacy.
    // Default to delivery-only for legacy "delivered", two-step for "placed".
    return order.status === "delivered" ? "delivery-only" : "two-step";
  }
  if (["pending", "preparing", "ready"].includes(order.status)) {
    return order.status === "ready" ? "four-step" : "three-step";
  }
  if (order.status === "completed") return "three-step";
  if (order.status === "archived" || order.status === "cancelled") {
    return normalizeOrderFlow(tenantFallback);
  }
  return normalizeOrderFlow(tenantFallback);
};

// ─────────────────────────────────────────────────────────────
// State machine core
// ─────────────────────────────────────────────────────────────

/**
 * Pure predicate.
 * @param {Object} order   The order document (or a plain object with `status`, `flowAtCreation`).
 * @param {String} to      Target status.
 * @param {Object} options { tenant } for legacy orders with flowAtCreation = null.
 * @returns {{ ok: boolean, reason?: string }}
 */
const canTransition = (order, to, options = {}) => {
  if (!order) return { ok: false, reason: "Order not found" };
  if (!ALL_STATUSES.includes(to)) {
    return { ok: false, reason: `Unknown target status '${to}'` };
  }
  if (TERMINAL_STATUSES.includes(order.status)) {
    return {
      ok: false,
      reason: `Cannot transition out of terminal status '${order.status}'`,
    };
  }
  if (order.status === to) {
    return { ok: false, reason: "Order is already in that status" };
  }

  const flow = flowForOrder(order, options.tenant);
  const map = FLOWS[flow];
  if (!map) {
    return { ok: false, reason: `Unknown flow '${flow}'` };
  }

  const allowed = map[order.status] || [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `Transition '${order.status} → ${to}' not allowed in flow '${flow}'`,
    };
  }
  return { ok: true, flow };
};

/**
 * Convenience: which statuses can this order move to right now?
 * Used by the frontend to render buttons.
 */
const nextAllowedStatuses = (order, options = {}) => {
  if (!order) return [];
  if (TERMINAL_STATUSES.includes(order.status)) return [];
  const flow = flowForOrder(order, options.tenant);
  const map = FLOWS[flow];
  if (!map) return [];
  return map[order.status] || [];
};

const isTerminal = (status) => TERMINAL_STATUSES.includes(status);

module.exports = {
  ALL_STATUSES,
  ALLOWED_FLOWS,
  TERMINAL_STATUSES,
  FLOWS,
  canTransition,
  nextAllowedStatuses,
  normalizeOrderFlow,
  flowForOrder,
  isTerminal,
};
