const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const Section = require("./Section");

const menuSchema = new Schema({
  sections: [{ type: Schema.Types.ObjectId, ref: "Section", required: true }],
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true, // Ensures each user can have only one menu
  },
});

const Menu = mongoose.model("Menu", menuSchema);
module.exports = Menu;
