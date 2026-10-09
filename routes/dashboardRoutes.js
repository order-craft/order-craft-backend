const express = require("express");
const {
  getDailyRevenue,
  getMonthlyRevenue,
  getRevenueByClient,
  getRevenueByProduct,
  getMostSoldProducts,
  getOrdersByMonthForYear,
  getRevenueForCurrentYear,
  getRevenueByProductByMonth,
  getRevenueByProductForCurrentWeek,
  getRevenueExcel,
  getRevenueByProductBetweenDates,
  getUserArchivedOrders,
  closeUserOrders,
  getWeeklyRevenue,
  getRevenueBetweenDates,
  getMonthlyGrowthRate,
  getAverageProcessingTime,
  getOrderValueBreakdown,
  getRevenueByWaiterAndPeriod,
  getDailyRevenuePerWaiter,
  getAllUserArchivedOrders,
  getProfitSummary,
  getProductMargins,
  getProfitByPeriod,
} = require("../controllers/DashboardingController");
const verifySuperClient = require("../middleWares/VerifySuperClient");
const verifyClientOrSuperClient = require("../middleWares/verifyClientOrSuperClient");
const verifyToken = require("../middleWares/jerifyToken");

const router = express.Router();

// Route to get daily revenue
router.get("/daily-revenue", verifySuperClient, getDailyRevenue);

router.get("/year-per-month", verifySuperClient, getOrdersByMonthForYear);

// Route to get monthly revenue
router.get("/monthly-revenue", verifySuperClient, getMonthlyRevenue);

//growth current & previous month
router.get("/monthly-revenue-growth", verifySuperClient, getMonthlyGrowthRate);

// Route to get revenue for current week
router.get("/weekly-revenue", verifySuperClient, getWeeklyRevenue);

// Route to get revenue between 2 dates
router.post(
  "/revenue-between-dates",
  verifySuperClient,
  getRevenueBetweenDates,
);

// Route to get revenue by client
router.get("/revenue-by-client", verifySuperClient, getRevenueByClient);
router.post(
  "/revenue-by-waiter-and-period",
  verifySuperClient,
  getRevenueByWaiterAndPeriod,
);
router.post(
  "/daily-revenue-per-waiter",
  verifySuperClient,
  getDailyRevenuePerWaiter,
);

// Route to get revenue by product
router.get("/revenue-by-product", verifySuperClient, getRevenueByProduct);
router.get(
  "/revenue-by-product-by-month",
  verifySuperClient,
  getRevenueByProductByMonth,
);

// Route to get the most sold products
router.get("/most-sold-products", verifySuperClient, getMostSoldProducts);

router.get("/revenue-year", verifySuperClient, getRevenueForCurrentYear);
router.post(
  "/average-processing-time",
  verifySuperClient,
  getAverageProcessingTime,
);
router.post("/average-order-value", verifySuperClient, getOrderValueBreakdown);
router.get("/daily-receipt", verifyClientOrSuperClient, getUserArchivedOrders);
router.post("/history", verifyClientOrSuperClient, getAllUserArchivedOrders);

router.post("/close-daily", verifyClientOrSuperClient, closeUserOrders);

router.get(
  "/revenue-by-product-by-day",
  verifySuperClient,
  getRevenueByProductForCurrentWeek,
);
router.post(
  "/revenue-by-product-between-dates",
  verifySuperClient,
  getRevenueByProductBetweenDates,
);
// ── Profit endpoints ────────────────────────────────────────
router.post("/profit-summary", verifySuperClient, getProfitSummary);
router.get("/product-margins", verifySuperClient, getProductMargins);
router.post("/profit-by-period", verifySuperClient, getProfitByPeriod);

module.exports = router;
