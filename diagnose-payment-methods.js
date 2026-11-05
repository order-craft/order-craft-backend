// diagnose-payment-methods.js
//
// Run from the backend root:
//   node diagnose-payment-methods.js
//   node diagnose-payment-methods.js <orderId>
//   node diagnose-payment-methods.js <superClientId>
//
// It never modifies the DB. It only reads.

require("dotenv").config();
const mongoose = require("mongoose");

const Order = require("./models/Order");
const PaymentMethod = require("./models/PaymentMethod");

const arg = process.argv[2] || null;

const isObjectId = (v) => /^[0-9a-fA-F]{24}$/.test(String(v || ""));

const hr = (title) => {
  const line = "─".repeat(Math.min(80, (title || "").length + 6));
  console.log(`\n${line}\n  ${title}\n${line}`);
};

const shortId = (v) => (v ? String(v).slice(-6) : null);

async function main() {
  const uri = process.env.MONGO;
  if (!uri) {
    console.error("MONGO env variable is not set — aborting.");
    process.exit(1);
  }

  console.log("Connecting to MongoDB…");
  await mongoose.connect(uri);
  console.log("Connected.\n");

  // ─────────────────────────────────────────────────────────
  // 1. Sanity check: does the schema know about the new fields?
  // ─────────────────────────────────────────────────────────
  hr("1. Schema check — are snapshot fields defined?");
  const orderPaths = Object.keys(Order.schema.paths);
  const hasOrderSnapshot = orderPaths.includes("paymentMethodName");
  const hasProductSnapshot = orderPaths.includes("products.paymentMethodName");
  const hasSplitSnapshot = orderPaths.some((p) =>
    p.startsWith("products.paymentSplits") && p.endsWith("paymentMethodName"),
  );

  console.log(`Order.paymentMethodName          : ${hasOrderSnapshot ? "✓ defined" : "✗ MISSING"}`);
  console.log(`Order.products[].paymentMethodName: ${hasProductSnapshot ? "✓ defined" : "✗ MISSING"}`);
  console.log(`Order.products[].paymentSplits[].paymentMethodName : ${hasSplitSnapshot ? "✓ defined" : "✗ MISSING"}`);

  if (!hasOrderSnapshot && !hasProductSnapshot && !hasSplitSnapshot) {
    console.log(
      "\n  ⚠ No snapshot fields exist on the schema. The 'Unknown' bug is guaranteed — " +
        "apply the model change in models/Order.js first.",
    );
  }

  // ─────────────────────────────────────────────────────────
  // 2. Find the target order
  // ─────────────────────────────────────────────────────────
  let order = null;

  if (arg && isObjectId(arg)) {
    // Try as orderId first
    order = await Order.findById(arg).lean();
    if (!order) {
      // Try as superClientId, get their latest paid order
      order = await Order.findOne({
        superClientId: arg,
        payed: true,
      })
        .sort({ timestamp: -1 })
        .lean();
    }
  } else {
    // No arg — take the most recent paid order in the whole DB
    order = await Order.findOne({ payed: true })
      .sort({ timestamp: -1 })
      .lean();
  }

  if (!order) {
    console.log(
      "\nNo paid order found to inspect. Pass an orderId or superClientId as an argument, " +
        "or make sure at least one paid order exists.",
    );
    return;
  }

  hr(`2. Latest paid order — #${order.orderNumber || shortId(order._id)}`);
  console.log(`_id              : ${order._id}`);
  console.log(`superClientId    : ${order.superClientId}`);
  console.log(`orderType        : ${order.orderType}`);
  console.log(`status           : ${order.status}`);
  console.log(`payed            : ${order.payed}`);
  console.log(`paymentMethod    : ${order.paymentMethod ? String(order.paymentMethod) : "(null/undefined)"}`);
  console.log(`paymentMethodName: ${order.paymentMethodName ?? "(null/undefined)"}`);
  console.log(`totalPrice       : ${order.totalPrice}`);

  // ─────────────────────────────────────────────────────────
  // 3. Per-product line details
  // ─────────────────────────────────────────────────────────
  hr("3. Per-product lines");
  const lines = order.products || [];
  if (lines.length === 0) {
    console.log("  (no products)");
  } else {
    lines.forEach((p, i) => {
      const snapName = p.productDetails?.name || p.product?.name || "(no name)";
      console.log(`\n  [${i}] product=${shortId(p.product)} "${snapName}" qty=${p.quantity}`);
      console.log(`      payedQuantity         : ${p.payedQuantity ?? 0}`);
      console.log(`      paymentMethod (line)  : ${p.paymentMethod ? String(p.paymentMethod) : "(null/undefined)"}`);
      console.log(`      paymentMethodName     : ${p.paymentMethodName ?? "(null/undefined)"}`);

      const splits = p.paymentSplits || [];
      if (splits.length === 0) {
        console.log(`      paymentSplits         : (none)`);
      } else {
        console.log(`      paymentSplits         :`);
        splits.forEach((s, j) => {
          console.log(`        [${j}] qty=${s.quantity}`);
          console.log(`            paymentMethod     : ${s.paymentMethod ? String(s.paymentMethod) : "(null/undefined)"}`);
          console.log(`            paymentMethodName : ${s.paymentMethodName ?? "(null/undefined)"}`);
          console.log(`            paidAt            : ${s.paidAt ? new Date(s.paidAt).toISOString() : "(none)"}`);
        });
      }
    });
  }

  // ─────────────────────────────────────────────────────────
  // 4. Do the referenced PaymentMethod documents still exist?
  // ─────────────────────────────────────────────────────────
  hr("4. Referenced PaymentMethod documents — do they still exist?");

  const referencedIds = new Set();
  if (order.paymentMethod) referencedIds.add(String(order.paymentMethod));
  for (const p of order.products || []) {
    if (p.paymentMethod) referencedIds.add(String(p.paymentMethod));
    for (const s of p.paymentSplits || []) {
      if (s.paymentMethod) referencedIds.add(String(s.paymentMethod));
    }
  }

  if (referencedIds.size === 0) {
    console.log("  (no referenced payment methods)");
  } else {
    for (const id of referencedIds) {
      const pm = await PaymentMethod.findById(id).lean();
      if (pm) {
        console.log(`  ✓ ${id} → "${pm.name}" (still in DB)`);
      } else {
        console.log(`  ✗ ${id} → DELETED (cannot be recovered)`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // 5. What the dashboard would resolve this order to
  // ─────────────────────────────────────────────────────────
  hr("5. What the dashboard controller will report for this order");

  // Exact replica of the resolver you now have in DashboardingController.js
  const getMethodName = (order, lineOrSplit = null) => {
    if (lineOrSplit) {
      if (lineOrSplit.paymentMethodName) return lineOrSplit.paymentMethodName;
      if (lineOrSplit.paymentMethod?.name) return lineOrSplit.paymentMethod.name;
    }
    if (order.paymentMethodName) return order.paymentMethodName;
    if (order.paymentMethod?.name) return order.paymentMethod.name;
    return "Unknown";
  };

  // Reproduce how the report would compute the name if it were run right now.
  // Simulate populate by fetching methods for the order / lines / splits.
  const enrichWithPopulatedMethod = async (doc) => {
    if (!doc) return doc;
    const clone = JSON.parse(JSON.stringify(doc));
    if (clone.paymentMethod) {
      const pm = await PaymentMethod.findById(clone.paymentMethod).lean();
      clone.paymentMethod = pm ? { _id: pm._id, name: pm.name } : null;
    }
    for (const p of clone.products || []) {
      if (p.paymentMethod) {
        const pm = await PaymentMethod.findById(p.paymentMethod).lean();
        p.paymentMethod = pm ? { _id: pm._id, name: pm.name } : null;
      }
      for (const s of p.paymentSplits || []) {
        if (s.paymentMethod) {
          const pm = await PaymentMethod.findById(s.paymentMethod).lean();
          s.paymentMethod = pm ? { _id: pm._id, name: pm.name } : null;
        }
      }
    }
    return clone;
  };

  const enriched = await enrichWithPopulatedMethod(order);

  const reportedName = (() => {
    if (enriched.paymentMethod || enriched.paymentMethodName) {
      return { branch: "order-level", name: getMethodName(enriched) };
    }
    // per-product
    const names = [];
    for (const p of enriched.products || []) {
      const splits =
        Array.isArray(p.paymentSplits) && p.paymentSplits.length > 0
          ? p.paymentSplits
          : [
              {
                quantity: p.quantity,
                paymentMethod: p.paymentMethod ?? enriched.paymentMethod,
                paymentMethodName:
                  p.paymentMethodName ?? enriched.paymentMethodName ?? null,
              },
            ];
      for (const s of splits) {
        names.push(getMethodName(enriched, s));
      }
    }
    return { branch: "per-product", names };
  })();

  if (reportedName.branch === "order-level") {
    const ok = reportedName.name && reportedName.name !== "Unknown";
    console.log(`  Branch taken : order-level`);
    console.log(`  Reported name: "${reportedName.name}"  ${ok ? "✓" : "✗"}`);
    if (!ok) {
      console.log(
        `  → Root cause: the order has neither a paymentMethodName snapshot nor a live populated paymentMethod reference.`,
      );
      if (order.paymentMethod) {
        console.log(
          `    The PaymentMethod with _id=${order.paymentMethod} was deleted, and this order was paid BEFORE the snapshot fields existed.`,
        );
      }
    }
  } else {
    console.log(`  Branch taken : per-product`);
    console.log(`  Reported names: ${JSON.stringify(reportedName.names)}`);
    const unknowns = reportedName.names.filter((n) => n === "Unknown");
    if (unknowns.length === 0) {
      console.log(`  ✓ All split names resolve to real names.`);
    } else {
      console.log(
        `  ✗ ${unknowns.length} split(s) resolve to "Unknown". Check that every paymentSplits entry has paymentMethodName.`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────
  // 6. Summary / prescription
  // ─────────────────────────────────────────────────────────
  hr("6. Verdict");

  const orderSnapshotExists = !!order.paymentMethodName;
  const hasLiveReference = !!order.paymentMethod;
  const liveReferenceResolves = hasLiveReference
    ? !!(await PaymentMethod.findById(order.paymentMethod).lean())
    : false;

  if (!hasOrderSnapshot && !hasProductSnapshot && !hasSplitSnapshot) {
    console.log("  ❌ Schema is missing the snapshot fields. This must be fixed first.");
  } else if (orderSnapshotExists) {
    console.log(
      "  ✓ This order has a paymentMethodName snapshot. If the dashboard shows 'Unknown', " +
        "the controller is not using it — check that the branch guard is `if (order.paymentMethod || order.paymentMethodName)` " +
        "and that getMethodName is used everywhere names are computed.",
    );
  } else if (hasLiveReference && liveReferenceResolves) {
    console.log(
      "  ⚠ This order was paid BEFORE the snapshot existed, but the payment method still exists in the DB. " +
        "Run the backfill script now so it will be preserved when the method is deleted.",
    );
  } else if (!liveReference && !orderSnapshotExists) {
    const anySplitName = (order.products || []).some(
      (p) =>
        p.paymentMethodName || (p.paymentSplits || []).some((s) => s.paymentMethodName),
    );
    if (anySplitName) {
      console.log(
        "  ⚠ The order-level snapshot is missing, but a product-level snapshot exists. " +
          "The controller will only find it if the branch guard accepts `order.paymentMethodName` OR the per-product fallback is complete.",
      );
    } else {
      console.log(
        "  ❌ This order was paid before the snapshot existed AND the payment method has been deleted. " +
          "The name is unrecoverable for this order. New orders will be fine after the fix.",
      );
    }
  } else {
    console.log("  ⚠ Mixed state — see the block above for details.");
  }
}

main()
  .catch((err) => {
    console.error("Diagnostic failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });