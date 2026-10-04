const mongoose = require("mongoose");
const { Schema } = mongoose;

// Comment schema
const CommentSchema = new Schema({
  text: { type: String, required: true },
  author: {
    id: { type: Schema.Types.ObjectId, required: true }, // Reference to the document
    type: { type: String, enum: ["Customer", "User"], required: true }, // Distinguish between Customer and User
  },
  createdAt: { type: Date, default: Date.now },
  replies: [
    {
      text: { type: String, required: true },
      author: {
        id: { type: Schema.Types.ObjectId, required: true },
        type: { type: String, enum: ["Customer", "User"], required: true },
      },
      createdAt: { type: Date, default: Date.now },
    },
  ],
});

// Reaction schema
const ReactionSchema = new Schema({
  type: {
    type: String,
    enum: ["like", "love", "yummy", "haha", "wow", "sad", "angry"],
    required: true,
  },
  users: [
    {
      id: { type: Schema.Types.ObjectId, required: true },
      UserType: { type: String, enum: ["Customer", "User"], required: true },
    },
  ], // Users who reacted
});

// Post schema
const PostSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    summary: { type: String },
    media: [
      {
        url: { type: String, required: true },
        type: { type: String, required: true },
      },
    ],
    comments: [CommentSchema],
    reactions: [ReactionSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const Post = mongoose.model("Post", PostSchema);

module.exports = Post;
