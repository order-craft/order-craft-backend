const express = require("express");
const verifyToken = require("../middleWares/jerifyToken");
const verifyClientOrSuperClient = require("../middleWares/verifyClientOrSuperClient");

const {
  getTablesWithUnpaiedOrders,
  createTable,
  getTableById,
  deleteTable,
  getTables,
  updateTable,
  createReservation,
  getReservationsForTable,
  checkTableAvailability,
  deleteReservation,
  updateReservation,
  getTablesWithReservations,
  moveOrdersToTable,
  getRevenueByTable,
  getRevenueByTableArchived,
  assignStaffToTable,
  getTablesAssignmentOverview,
} = require("../controllers/TableController");
const verifySuperClient = require("../middleWares/VerifySuperClient");
const {
  createPlan,
  getPlans,
  getPlan,
  updatePlan,
  deletePlan,
} = require("../controllers/planController");

const router = express.Router();

// Routes for table operations
router.get("/", verifyClientOrSuperClient, getTablesWithUnpaiedOrders); // Get tables with unpaid orders
// Routes for table operations
// IMPORTANT: specific routes must come before "/:id" or Express will shadow them
router.get("/all", verifyToken, getTables); // Get all tables for the authenticated user
router.get("/guru/revenue-per-table", verifySuperClient, getRevenueByTable);
router.get(
  "/dashboard/revenue-per-table",
  verifySuperClient,
  getRevenueByTableArchived,
);
router.get(
  "/assignments/overview",
  verifySuperClient,
  getTablesAssignmentOverview,
); // Admin: all tables + assigned server + unresolved flags
router.get("/:id", verifyClientOrSuperClient, getTableById); // Get a single table by ID
router.post("/", verifySuperClient, createTable); // Create a new table
router.put("/:id", verifySuperClient, updateTable); // Update an existing table
router.patch("/:id/assign-staff", verifySuperClient, assignStaffToTable); // Assign/unassign table-service server
router.delete("/:id", verifySuperClient, deleteTable); // Delete a table

// Routes for reservation operations
router.post("/reservations", verifyClientOrSuperClient, createReservation); // Create a new reservation
router.get(
  "/:tableId/reservations",
  verifyClientOrSuperClient,
  getReservationsForTable,
); // Get reservations for a specific table
router.post(
  "/reservations/all",
  verifyClientOrSuperClient,
  getTablesWithReservations,
); // Get reservations
router.post("/availability", verifyClientOrSuperClient, checkTableAvailability); // Check table availability for a time range
router.post("/move-orders", verifyClientOrSuperClient, moveOrdersToTable); // Check table availability for a time range
router.delete(
  "/:tableId/reservations/:reservationId",
  verifyClientOrSuperClient,
  deleteReservation,
); // Delete a specific reservation
router.put(
  "/:tableId/reservations/:reservationId",
  verifyClientOrSuperClient,
  updateReservation,
); // Update an existing reservation

//plans routes
router.post("/plans", verifySuperClient, createPlan);
router.get("/get/plans", verifyClientOrSuperClient, getPlans);
router.get("/plans/:id", verifyClientOrSuperClient, getPlan);
router.put("/plans/:id", verifySuperClient, updatePlan);
router.delete("/plans/:id", verifySuperClient, deletePlan);

module.exports = router;
