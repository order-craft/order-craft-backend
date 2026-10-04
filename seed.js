const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Table = require("./models/Table");
const Product = require("./models/Product");
const Category = require("./models/Category");
const Menu = require("./models/Menu");
const Order = require("./models/Order");

async function seedDatabase() {
  try {
    await mongoose.connect(
      "mongodb+srv://saadliwissem88:12715083w@cafein.ctsilpo.mongodb.net/?retryWrites=true&w=majority&appName=CafeIn",
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }
    );

    // Clear the existing collections
    await User.deleteMany({});
    await Table.deleteMany({});
    await Product.deleteMany({});
    await Category.deleteMany({});
    await Menu.deleteMany({});
    await Order.deleteMany({});

    // Create users with hashed passwords
    const hashedPassword = await bcrypt.hash("password", 10);
    const superClients = await User.insertMany([
      {
        fullName: "Restaurant Owner 1",
        email: "owner1@example.com",
        password: hashedPassword,
        verificationCode: "12345",
        role: "superClient",
      },
      {
        fullName: "Restaurant Owner 2",
        email: "owner2@example.com",
        password: hashedPassword,
        verificationCode: "54321",
        role: "superClient",
      },
    ]);

    const clients = await User.insertMany([
      {
        fullName: "Waiter 1",
        email: "waiter1@example.com",
        password: hashedPassword,
        verificationCode: "11111",
        role: "client",
        superClient: superClients[0]._id,
      },
      {
        fullName: "Waiter 2",
        email: "waiter2@example.com",
        password: hashedPassword,
        verificationCode: "22222",
        role: "client",
        superClient: superClients[1]._id,
      },
    ]);

    // Create tables
    const tables = await Table.insertMany([
      { number: 1, user: clients[0]._id, superClient: superClients[0]._id },
      { number: 2, user: clients[1]._id, superClient: superClients[1]._id },
    ]);

    // Create products
    const products = await Product.insertMany([
      {
        name: "Veg Mixer",
        description: "Tomato Salad & Carrot",
        price: 5.99,
        rate: 5.0,
        raters: 87,
        img: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=500&q=80",
        available: true,
      },
      {
        name: "Macaroni",
        description: "Cheese Pizza",
        price: 2.99,
        rate: 4.8,
        raters: 32,
        img: "https://images.unsplash.com/photo-1432139555190-58524dae6a55?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=500&q=80",
        available: true,
      },
      {
        name: "Chicken Wings",
        description: "Spicy Chicken Wings",
        price: 7.99,
        rate: 4.5,
        raters: 45,
        img: "https://images.unsplash.com/photo-1598257006929-706f8cb6eb6c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=MnwxMTc3M3wwfDF8c2VhcmNofDN8fGNoaWNrZW4lMjB3aW5nc3xlbnwwfHx8fDE2MjU0NDMyOTI&ixlib=rb-1.2.1&q=80&w=400",
        available: true,
      },
      {
        name: "Beef Burger",
        description: "Juicy Beef Burger",
        price: 8.99,
        rate: 4.7,
        raters: 60,
        img: "https://images.unsplash.com/photo-1597308698434-d0cdd6c8b8b3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=MnwxMTc3M3wwfDF8c2VhcmNofDJ8fGJlZWYlMjBidXJnZXJ8ZW58MHx8fHwxNjI1NDQzMzM5&ixlib=rb-1.2.1&q=80&w=400",
        available: true,
      },
    ]);

    // Create categories
    const categories = await Category.insertMany([
      { name: "Starters", products: [products[0]._id, products[1]._id] },
      { name: "Mains", products: [products[2]._id, products[3]._id] },
    ]);

    // Create menus
    const menus = await Menu.insertMany([
      {
        categories: [categories[0]._id, categories[1]._id],
        user: superClients[0]._id,
      },
      {
        categories: [categories[0]._id, categories[1]._id],
        user: superClients[1]._id,
      },
    ]);

    // Create orders
    const orders = await Order.insertMany([
      {
        products: [{ product: products[0]._id, quantity: 2 }],
        table: tables[0]._id,
        totalPrice: products[0].price * 2,
      },
      {
        products: [{ product: products[1]._id, quantity: 1 }],
        table: tables[1]._id,
        totalPrice: products[1].price,
      },
    ]);

    console.log("Database seeded successfully!");

    mongoose.disconnect();
  } catch (error) {
    console.error("Error seeding database:", error);
    mongoose.disconnect();
  }
}
// seed
const Menu = require("./models/Menu"); // User model
const bcrypt = require("bcrypt");
const createSuperClientAndMenu = async () => {
  try {
    const hashedPassword = await bcrypt.hash("password", 10);
    // Step 1: Create the superClient user
    const newSuperClient = new User({
      fullName: "yassine ben amara",
      email: "benamarayassine7@gmail.com",
      password: hashedPassword, // Make sure to hash the password in production
      role: "superClient",
      phoneNumber: "28795565",
      contractNumber: "CONTRACT124",
      percentage: 4,
      placeName: "cofe yassine",
      placeLocation: {
        long: 35.1680436,
        lat: 8.8260454,
      },
      proxyUrl: "10.2",
      pricingPlan: "percentage",
      defaultIP: "192.168.0.1",
    });

    await newSuperClient.save();

    // Step 2: Create an empty menu and assign the user to it
    const newMenu = new Menu({
      sections: [],
      user: newSuperClient._id, // Assign the user to the menu
    });

    await newMenu.save();

    console.log("SuperClient and Menu created successfully!");
  } catch (error) {
    console.error(error);
  }
};

//createSuperClientAndMenu();

const deleteOrdersBySuperClient = async () => {
  try {
    const superClientId = "67edc7bcc1a837e27b257559";

    // Delete orders with the specified superClientId
    const result = await Order.deleteMany({ superClientId });

    console.log(
      `${result.deletedCount} order(s) deleted for superClientId: ${superClientId}`
    );
  } catch (error) {
    console.error("Error deleting orders:", error);
  } finally {
    mongoose.connection.close();
  }
};

//deleteOrdersBySuperClient();

const copyMenu = async (oldMenuId, newMenuId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const oldMenu = await Menu.findById(oldMenuId)
      .populate({
        path: "sections",
        populate: {
          path: "categories",
          populate: {
            path: "products",
          },
        },
      })
      .session(session);

    if (!oldMenu) {
      throw new Error("Old menu not found");
    }

    const newMenu = await Menu.findById(newMenuId).session(session);
    if (!newMenu) {
      throw new Error("New menu not found");
    }

    const newSections = [];
    for (const oldSection of oldMenu.sections) {
      const newCategories = [];
      for (const oldCategory of oldSection.categories) {
        const newProducts = [];
        for (const oldProduct of oldCategory.products) {
          const newProduct = new Product({
            name: oldProduct.name,
            description: oldProduct.description,
            rate: 0, // Reset rate
            price: oldProduct.price,
            raters: 0, // Reset raters
            img: oldProduct.img,
            available: oldProduct.available,
            types: oldProduct.types,
            discountPercentage: oldProduct.discountPercentage,
          });
          await newProduct.save({ session });
          newProducts.push(newProduct._id);
        }

        const newCategory = new Category({
          name: oldCategory.name,
          products: newProducts,
        });
        await newCategory.save({ session });
        newCategories.push(newCategory._id);
      }

      const newSection = new Section({
        name: oldSection.name,
        categories: newCategories,
      });
      await newSection.save({ session });
      newSections.push(newSection._id);
    }

    newMenu.sections = newSections;
    await newMenu.save({ session });

    await session.commitTransaction();
    session.endSession();
    return newMenu;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};
// copyMenu("669d1becf3c2d49e40d29585","67ae689ab1025bdd3e6a5b43")

// seedDatabase();
const Bill = require("./models/Bill"); // Adjust path as needed

async function createBill(clientId, totalAmount, amountPaid) {
  try {
    const bill = new Bill({
      client: clientId,
      totalAmount,
      amountPaid,
    });

    await bill.save();
    console.log("Bill created successfully:", bill);
  } catch (error) {
    console.error("Error creating bill:", error.message);
  } finally {
    mongoose.disconnect();
  }
}

// Example usage (Replace 'clientId' with a valid ObjectId)
const clientId = "67edc7bcc1a837e27b257559"; // Example ObjectId
createBill(clientId, 0, 0);
