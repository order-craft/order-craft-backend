// backfill-payment-method-names.js
//
// Run from the backend root:
//   node backfill-payment-method-names.js
//
// Idempotent — only touches docs where paymentMethodName is null AND the
// referenced PaymentMethod still exists. Safe to re-run.

require("dotenv").config();
const mongoose = require("mongoose");

const Order = require("./models/Order");
const PaymentMethod = require("./models/PaymentMethod");

async function main() {
  const uri = process.env.MONGO;
  if (!uri) {
    console.error("MONGO env variable is not set — aborting.");
    process.exit(1);
  }

  console.log("Connecting to MongoDB…");
  await mongoose.connect(uri);
  console.log("Connected.\n");

  // Cache method names so we don't re-fetch the same one thousands of times.
  const methodNameCache = new Map();
  const resolveName = async (id) => {
    if (!id) return null;
    const key = String(id);
    if (methodNameCache.has(key)) return methodNameCache.get(key);
    const pm = await PaymentMethod.findById(id).select("name").lean();
    const name = pm?.name || null;
    methodNameCache.set(key, name);
    return name;
  };

  const orders = await Order.find({ payed: true }).lean();
  console.log(`Found ${orders.length} paid orders.`);

  let updated = 0;
  let orderLevelSnapshots = 0;
  let lineLevelSnapshots = 0;
  let splitSnapshots = 0;
  let skippedNoReference = 0;

  for (const o of orders) {
    let changed = false;

    // Order-level snapshot
    if (o.paymentMethod && !o.paymentMethodName) {
      const name = await resolveName(o.paymentMethod);
      if (name) {
        await Order.updateOne(
          { _id: o._id },
          { $set: { paymentMethodName: name } },
        );
        orderLevelSnapshots += 1;
        changed = true;
      }
    }

    // Line-level snapshots
    for (let i = 0; i < (o.products || []).length; i++) {
      const p = o.products[i];
      const updates = {};

      if (p.paymentMethod && !p.paymentMethodName) {
        const name = await resolveName(p.paymentMethod);
        if (name) {
          updates[`products.${i}.paymentMethodName`] = name;
          lineLevelSnapshots += 1;
          changed = true;
        }
      }

      for (let j = 0; j < (p.paymentSplits || []).length; j++) {
        const s = p.paymentSplits[j];
        if (s.paymentMethod && !s.paymentMethodName) {
          const name = await resolveName(s.paymentMethod);
          if (name) {
            updates[`products.${i}.paymentSplits.${j}.paymentMethodName`] =
              name;
            splitSnapshots += 1;
            changed = true;
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await Order.updateOne({ _id: o._id }, { $set: updates });
      }
    }

    // Count orders where the reference is gone entirely — these are lost.
    if (!o.paymentMethod && !o.paymentMethodName) {
      const anyLineRef = (o.products || []).some((p) => p.paymentMethod);
      const anySplitRef = (o.products || []).some((p) =>
        (p.paymentSplits || []).some((s) => s.paymentMethod),
      );
      if (!anyLineRef && !anySplitRef) {
        skippedNoReference += 1;
      }
    }

    if (changed) updated += 1;
  }

  console.log(`\nBackfill complete.`);
  console.log(`  Orders updated              : ${updated}`);
  console.log(`  Order-level snapshots added : ${orderLevelSnapshots}`);
  console.log(`  Line-level snapshots added  : ${lineLevelSnapshots}`);
  console.log(`  Split-level snapshots added : ${splitSnapshots}`);
  console.log(`  Orders with no recoverable reference : ${skippedNoReference}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exitCode = 1;
  mongoose.disconnect();
});
