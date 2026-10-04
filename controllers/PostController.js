const Post = require("../models/Post");
const Customer = require("../models/Customer");
const cloudinary = require("../Cloudinary/cloudinary"); // Ensure cloudinary is properly configured in your project
const mongoose = require("mongoose");
const User = require("../models/User");
// Create a new post
const createPost = async (req, res) => {
  try {
    const owner = req.superClientId; // Assume this is set by middleware
    const { summary, files } = req.body; // `files` is an array of Base64 strings
    // Validate required fields
    if (!summary) {
      return res.status(400).json({ error: "Summary is required." });
    }
    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one media file is required." });
    }

    const allowedImageFormats = ["jpg", "jpeg", "png"];
    const allowedVideoFormats = ["mp4", "avi", "mov"];
    const uploadedFiles = [];

    // Validate and upload each file
    for (const file of files) {
      const matches = file.match(
        /^data:(image|video)\/(png|jpe?g|mp4|avi|mov);base64,/
      );

      if (!matches) {
        return res.status(400).json({
          error:
            "Invalid file format. Only images (jpg, jpeg, png) and videos (mp4, avi, mov) are allowed.",
        });
      }

      const mediaType = matches[1]; // 'image' or 'video'
      const format = matches[2]; // e.g., 'png', 'mp4'

      const allowedFormats =
        mediaType === "image" ? allowedImageFormats : allowedVideoFormats;

      if (!allowedFormats.includes(format)) {
        return res.status(400).json({
          error: `Invalid ${mediaType} format. Only ${allowedFormats.join(
            ", "
          )} formats are allowed.`,
        });
      }

      try {
        // Upload to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(file, {
          folder: "order-craft-posts",
          resource_type: mediaType, // 'image' or 'video'
        });

        uploadedFiles.push({
          url: uploadResult.secure_url,
          type: mediaType, // 'image' or 'video'
        });
      } catch (uploadError) {
        return res
          .status(500)
          .json({ error: `Failed to upload file: ${uploadError.message}` });
      }
    }

    // Create the post
    const post = new Post({
      owner,
      summary,
      media: uploadedFiles, // Save file URLs and types
    });

    await post.save();

    res.status(201).json({ message: "Post created successfully.", post });
  } catch (error) {
    console.error("Error creating post:", error);
    res
      .status(500)
      .json({ error: "Error creating post.", details: error.message });
  }
};

// Get all posts
const getAllPosts = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query; // Default to page 1, limit 10
    const superClientId = req.superClientId;

    const posts = await Post.find({ owner: superClientId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate("owner", "fullName email") // Populate owner's details
      .lean(); // Use lean for faster performance and direct object manipulation

    const populatedPosts = await Promise.all(
      posts.map(async (post) => {
        const postObj = { ...post };

        // Populate comments and replies
        const populatedComments = await Promise.all(
          post.comments.map(async (comment) => {
            const commentData = { ...comment };

            // Populate comment author details
            if (comment.author && comment.author.type && comment.author.id) {
              if (comment.author.type === "Customer") {
                commentData.authorDetails = await Customer.findById(
                  comment.author.id,
                  "fullName email username"
                ).lean();
              } else if (comment.author.type === "User") {
                commentData.authorDetails = await User.findById(
                  comment.author.id,
                  "fullName email username"
                ).lean();
              }
            }

            // Populate replies and their authors
            const populatedReplies = await Promise.all(
              comment.replies.map(async (reply) => {
                const replyData = { ...reply };
                if (reply.author && reply.author.type && reply.author.id) {
                  if (reply.author.type === "Customer") {
                    replyData.authorDetails = await Customer.findById(
                      reply.author.id,
                      "fullName email username"
                    ).lean();
                  } else if (reply.author.type === "User") {
                    replyData.authorDetails = await User.findById(
                      reply.author.id,
                      "fullName email username"
                    ).lean();
                  }
                }
                return replyData;
              })
            );

            commentData.replies = populatedReplies;
            return commentData;
          })
        );

        postObj.comments = populatedComments;

        // Check reactions and find the reaction by req.superClientId
        const superClientReaction = post.reactions.find((reaction) =>
          reaction.users.some((user) => user.id.toString() === superClientId)
        );

        postObj.storedReaction = superClientReaction
          ? superClientReaction.type
          : null; // Return the reaction type if found, otherwise null

        return postObj;
      })
    );

    res.status(200).json(populatedPosts);
  } catch (error) {
    console.error("Error fetching posts:", error);
    res
      .status(500)
      .json({ message: "Error fetching posts.", error: error.message });
  }
};

// Get a single post by ID
const getPostById = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId)
      .populate("owner", "fullName email")
      .populate("comments.author", "fullName email")
      .populate("reactions.users", "fullName email");

    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }

    res.status(200).json(post);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching post.", error: error.message });
  }
};

// Add a comment to a post
const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { text, type } = req.body;

    // Validate input
    if (!text || typeof text !== "string" || text.trim() === "") {
      return res.status(400).json({ message: "Comment text is required." });
    }

    if (!["Customer", "User"].includes(type)) {
      return res.status(400).json({ message: "Invalid author type." });
    }

    if (!req.superClientId) {
      return res.status(400).json({ message: "Author ID is required." });
    }

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }

    // Create a new comment object
    const newComment = {
      text,
      author: {
        id: req.superClientId, // Ensure ObjectId conversion
        type, // "Customer" or "User"
      },
      createdAt: new Date(),
    };

    console.log("New Comment:", newComment);

    // Use updateOne to add the comment directly to the post's comments array
    const updatedPost = await Post.updateOne(
      { _id: postId },
      { $push: { comments: newComment } }
    );

    if (updatedPost.modifiedCount > 0) {
      res.status(201).json({
        message: "Comment added successfully.",
        comment: newComment,
      });
    } else {
      res.status(500).json({ message: "Failed to add comment." });
    }
  } catch (error) {
    console.error("Error adding comment:", error);
    res
      .status(500)
      .json({ message: "Error adding comment.", error: error.message });
  }
};

// Update a comment
const updateComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { text } = req.body;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ message: "Comment not found." });
    }

    comment.text = text;
    await post.save();

    res.status(200).json({ message: "Comment updated successfully.", post });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating comment.", error: error.message });
  }
};

// Delete a comment
const deleteComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ message: "Comment not found." });
    }

    comment.remove();
    await post.save();

    res.status(200).json({ message: "Comment deleted successfully.", post });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting comment.", error: error.message });
  }
};

// Add a reply to a comment
const addReply = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { text, type } = req.body;

    // Validate input
    if (!text || typeof text !== "string" || text.trim() === "") {
      return res.status(400).json({ message: "Reply text is required." });
    }

    if (!["Customer", "User"].includes(type)) {
      return res.status(400).json({ message: "Invalid author type." });
    }

    if (!req.superClientId) {
      return res.status(400).json({ message: "Author ID is required." });
    }

    // Construct the reply object
    const newReply = {
      text,
      author: {
        id: req.superClientId,
        type, // "Customer" or "User"
      },
      createdAt: new Date(),
    };

    console.log("New Reply:", newReply);

    // Use updateOne to add the reply directly to the specified comment's replies array
    const result = await Post.updateOne(
      { _id: postId, "comments._id": commentId },
      { $push: { "comments.$.replies": newReply } }
    );

    // Check if the update was successful
    if (result.modifiedCount > 0) {
      res.status(201).json({
        message: "Reply added successfully.",
        reply: newReply,
      });
    } else {
      res.status(404).json({
        message: "Post or comment not found, or reply not added.",
      });
    }
  } catch (error) {
    console.error("Error adding reply:", error);
    res
      .status(500)
      .json({ message: "Error adding reply.", error: error.message });
  }
};

// Add a reaction to a post
const addReaction = async (req, res) => {
  try {
    const { postId } = req.params;
    const { type, userType } = req.body;
    const userId = req.superClientId;

    // Validate input
    if (!type || !userId || !userType) {
      return res.status(400).json({ message: "Invalid input data." });
    }

    // Check if the reaction type is valid
    const validReactions = [
      "like",
      "love",
      "yummy",
      "haha",
      "wow",
      "sad",
      "angry",
    ];
    if (!validReactions.includes(type)) {
      return res.status(400).json({ message: "Invalid reaction type." });
    }

    // Check if the user already reacted with the same type
    const existingReaction = await Post.findOne({
      _id: postId,
      "reactions.type": type,
      "reactions.users.id": userId,
    });

    if (existingReaction) {
      // Remove the user's reaction of the same type
      await Post.updateOne(
        { _id: postId, "reactions.type": type },
        {
          $pull: {
            "reactions.$.users": { id: userId },
          },
        }
      );

      return res
        .status(200)
        .json({ message: "Reaction removed successfully." });
    }

    // Remove the user's existing reaction of a different type
    await Post.updateOne(
      { _id: postId },
      {
        $pull: {
          "reactions.$[].users": { id: userId }, // Remove the user from all reaction types
        },
      }
    );

    // Add the new reaction or update an existing reaction type
    const result = await Post.updateOne(
      {
        _id: postId,
        "reactions.type": type, // Match the reaction type
      },
      {
        $addToSet: {
          "reactions.$.users": { id: userId, userType }, // Add the user to the users array
        },
      }
    );

    // If the reaction type doesn't exist, create it
    if (result.matchedCount === 0) {
      await Post.updateOne(
        { _id: postId },
        {
          $push: {
            reactions: {
              type,
              users: [{ id: userId, userType }], // Add the new reaction type with the user
            },
          },
        }
      );
    }

    res
      .status(200)
      .json({ message: "Reaction added or updated successfully." });
  } catch (error) {
    res.status(500).json({
      message: "Error adding or updating reaction.",
      error: error.message,
    });
  }
};

// Remove a reaction from a post
const removeReaction = async (req, res) => {
  try {
    const { postId } = req.params;
    const { type, userId } = req.body;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }

    const reaction = post.reactions.find((r) => r.type === type);
    if (!reaction) {
      return res.status(404).json({ message: "Reaction not found." });
    }

    reaction.users = reaction.users.filter((id) => id.toString() !== userId);
    if (reaction.users.length === 0) {
      post.reactions = post.reactions.filter((r) => r.type !== type);
    }

    await post.save();
    res.status(200).json({ message: "Reaction removed successfully.", post });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error removing reaction.", error: error.message });
  }
};

// Delete a post
const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;

    // Find the post
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }

    // Remove media files from Cloudinary
    const deleteMediaPromises = post.media.map(async (file) => {
      try {
        const publicId = file.url.split("/").slice(-1)[0].split(".")[0];
        const resourceType = file.type === "image" ? "image" : "video";

        await cloudinary.uploader.destroy(publicId, {
          resource_type: resourceType,
        });
      } catch (error) {
        console.error(
          `Failed to delete media from Cloudinary: ${error.message}`
        );
      }
    });

    await Promise.all(deleteMediaPromises);

    // Delete the post from the database
    await Post.findByIdAndDelete(postId);

    res.status(200).json({ message: "Post deleted successfully." });
  } catch (error) {
    console.error("Error deleting post:", error);
    res
      .status(500)
      .json({ message: "Error deleting post.", error: error.message });
  }
};

module.exports = {
  createPost,
  getAllPosts,
  getPostById,
  addComment,
  updateComment,
  deleteComment,
  addReply,
  addReaction,
  removeReaction,
  deletePost,
};
