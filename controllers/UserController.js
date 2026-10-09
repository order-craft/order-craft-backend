const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { validationResult } = require("express-validator");
const User = require("../models/User");
const { Table } = require("../models/Table");
const nodemailer = require("nodemailer");
const cloudinary = require("../Cloudinary/cloudinary");
const logger = require("../logger"); // Import the logger

const register = async (req, res) => {
  try {
    const { name, email, pwd, rpwd } = req.body;

    if (name === "" || email === "" || pwd === "") {
      logger.warn("All fields are required for registration");
      return res.status(401).json({ error: "All fields are required" });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logger.warn("Invalid email format provided for registration");
      return res.status(402).json({ error: "Invalid email format" });
    }
    if (pwd !== rpwd) {
      logger.warn("Password and repeated password do not match");
      return res.status(406).json({ error: "Please verify your password" });
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      logger.warn(`Client with email ${email} already exists`);
      return res
        .status(400)
        .json({ error: "Client with this email already exists" });
    }
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(pwd, saltRounds);

    const verificationCode = Math.floor(100000 + Math.random() * 900000);

    const user = new User({
      fullName: name,
      email: email,
      password: hashedPassword,
      verificationCode: verificationCode,
      verified: false,
    });

    await user.save();
    logger.info(`Client registered successfully with email ${email}`);
    res
      .status(201)
      .json({ message: "Client registered successfully", userId: user._id });

    sendVerifEmail(email, verificationCode, res, name);
  } catch (error) {
    logger.error("Error registering user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const sendVerifEmail = (email, verificationCode, res, name) => {
  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: "saadliwissem88@gmail.com",
      pass: process.env.MAIL_SENDER_PASS,
    },
  });

  const mailOptions = {
    from: "saadliwissem88@gmail.com",
    to: email,
    subject: " Cafe'In Account Verification",
    text: `Hello, ${name} in order to create an account please give back this verification code : ${verificationCode} to the administration`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      logger.error("Failed to send verification email:", error);
      return res
        .status(500)
        .json({ error: "Failed to send verification email" });
    } else {
      logger.info("Verification email sent: " + info.response);
      res.status(201).json({
        message: "Client registered successfully. Verification email sent.",
      });
    }
  });
};

//change password verification code sender
const sendChangePwdVerifCode = async (req, res) => {
  try {
    const { oldPassword } = req.body;
    const superClientId = req.superClientId;

    // Validate if the ID is provided
    if (!superClientId) {
      return res.status(400).json({ error: "SuperClient ID is missing" });
    }

    const user = await User.findById(superClientId);

    // Check if user exists
    if (!user) {
      logger.warn(`User with ID ${superClientId} not found.`);
      return res.status(404).json({ error: "User not found" });
    }

    const email = user.email;

    // Ensure email exists
    if (!email) {
      logger.warn(`User ${superClientId} does not have an email.`);
      return res.status(400).json({ error: "User email is missing" });
    }

    // Verify the old password
    const isPasswordCorrect = await bcrypt.compare(oldPassword, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({ error: "Old password is incorrect" });
    }

    // Generate a 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000);

    // Configure mail transporter
    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: process.env.MAIL_SENDER_EMAIL, // Use environment variable
        pass: process.env.MAIL_SENDER_PASS,
      },
    });

    // Email content
    const mailOptions = {
      from: process.env.MAIL_SENDER_EMAIL, // Use environment variable
      to: email,
      subject: "Order Craft Account Password Reset",
      text: `Hello ${user.fullName},\n\nWe've received a request to change your password. Here is your verification code: ${verificationCode}.\n\nIf you did not request this, please ignore this email.`,
    };

    // Send email
    transporter.sendMail(mailOptions, async (error, info) => {
      if (error) {
        logger.error(`Failed to send verification email to ${email}:`, error);
        return res
          .status(500)
          .json({ error: "Failed to send verification email" });
      } else {
        logger.info(
          `Verification email sent successfully to ${email}: ${info.response}`,
        );

        // Save the verification code to the user document
        await User.updateOne(
          { _id: superClientId }, // Find the user by their ID
          { $set: { changePwdCode: verificationCode } }, // Update the changePwdCode field
        );

        return res.status(200).json({
          message: "Verification email sent successfully.",
        });
      }
    });
  } catch (error) {
    logger.error("Unexpected error in sendChangePwdVerifCode:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
// change pwd after sending verification code
const changeSuperClientPassword = async (req, res) => {
  try {
    const { verificationCode, newPassword, confirmPassword } = req.body;
    const superClientId = req.superClientId;

    // Validate if the ID is provided
    if (!superClientId) {
      return res.status(400).json({ error: "SuperClient ID is missing" });
    }

    const user = await User.findById(superClientId);

    // Check if user exists
    if (!user) {
      logger.warn(`User with ID ${superClientId} not found.`);
      return res.status(404).json({ error: "User not found" });
    }

    // Check if the verification code matches
    if (user.changePwdCode !== Number(verificationCode)) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    // Check if new passwords match
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "New passwords do not match" });
    }

    // Hash the new password before saving it
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Clear the verification code
    await User.updateOne(
      { _id: superClientId }, // Find the user by their ID
      { password: hashedPassword },
      { $unset: { changePwdCode: "" } }, // Unset the changePwdCode field
    );

    return res.status(200).json({
      message: "Password changed successfully.",
    });
  } catch (error) {
    logger.error("Unexpected error in changePassword:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
//send email verification for personal details change
const sendChangePersonalDettailsVerifCode = async (req, res) => {
  try {
    const { newemail, newpersonalPhoneNumber } = req.body;
    const superClientId = req.superClientId;

    // Validate if the ID is provided
    if (!superClientId) {
      return res.status(400).json({ error: "SuperClient ID is missing" });
    }

    const user = await User.findById(superClientId);

    // Check if user exists
    if (!user) {
      logger.warn(`User with ID ${superClientId} not found.`);
      return res.status(404).json({ error: "User not found" });
    }

    const email = user.email;

    // Ensure email exists
    if (!email) {
      logger.warn(`User ${superClientId} does not have an email.`);
      return res.status(400).json({ error: "User email is missing" });
    }
    // Check if the email or phone number has actually changed
    if (
      user.email === newemail &&
      user.personalPhoneNumber === newpersonalPhoneNumber
    ) {
      return res
        .status(400)
        .json({ error: "No changes detected in email or phone number" });
    }
    // Validate new email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(newemail)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Validate phone number format (exactly 8 digits)
    const phoneRegex = /^\d{8}$/;
    if (!phoneRegex.test(newpersonalPhoneNumber)) {
      return res.status(400).json({ error: "Phone number must be 8 digits" });
    }

    // Generate a 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000);

    // Configure mail transporter
    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: process.env.MAIL_SENDER_EMAIL, // Use environment variable
        pass: process.env.MAIL_SENDER_PASS,
      },
    });

    // Email content
    const mailOptions = {
      from: process.env.MAIL_SENDER_EMAIL, // Use environment variable
      to: email,
      subject: "Order Craft Account Verification Code",
      text: `Hello ${user.fullName},\n\nWe've received a request to change personal details. Here is your verification code: ${verificationCode}.\n\nIf you did not request this, please ignore this email.`,
    };

    // Send email
    transporter.sendMail(mailOptions, async (error, info) => {
      if (error) {
        logger.error(`Failed to send verification email to ${email}:`, error);
        return res
          .status(500)
          .json({ error: "Failed to send verification email" });
      } else {
        logger.info(
          `Verification email sent successfully to ${email}: ${info.response}`,
        );
        console.log(verificationCode);
        // Save the verification code to the user document
        await User.updateOne(
          { _id: superClientId },
          {
            $set: {
              newEmail: newemail,
              NewpersonalPhoneNumber: newpersonalPhoneNumber,
              changePDCode: verificationCode,
            },
          },
        );

        return res.status(200).json({
          message: "Verification email sent successfully.",
        });
      }
    });
  } catch (error) {
    logger.error("Unexpected error in sendChangePDVerifCode:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// change super client personal details
const changeSuperClientPD = async (req, res) => {
  try {
    const { PDVerifCode } = req.body;
    const superClientId = req.superClientId;

    // Validate if the ID is provided
    if (!superClientId) {
      return res.status(400).json({ error: "SuperClient ID is missing" });
    }

    const user = await User.findById(superClientId);

    // Check if user exists
    if (!user) {
      logger.warn(`User with ID ${superClientId} not found.`);
      return res.status(404).json({ error: "User not found" });
    }

    // Check if the verification code matches
    if (user.changePDCode !== Number(PDVerifCode)) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    // Clear the verification code
    await User.updateOne(
      { _id: superClientId }, // Find the user by their ID
      {
        $set: {
          email: user.newEmail,
          personalPhoneNumber: user.NewpersonalPhoneNumber,
        },
        $unset: {
          newEmail: "", // Remove newEmail
          newPersonalPhoneNumber: "", // Remove newPersonalPhoneNumber
          changePDCode: "", // Remove changePDCode
        },
      },
    );

    return res.status(200).json({
      message: "Personal Details changed successfully.",
    });
  } catch (error) {
    logger.error("Unexpected error in changing personal details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
const CodeVerification = async (req, res) => {
  try {
    const { userId, code } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      logger.warn(`User with ID ${userId} not found for verification`);
      return res.status(404).json({ error: "User not found" });
    }
    if (user.verificationCode !== code) {
      logger.warn(`Invalid verification code for user ${userId}`);
      return res.status(400).json({ error: "Invalid verification code" });
    }
    user.verified = true;
    await user.save();
    logger.info(`User with ID ${userId} verified successfully`);
    res.status(200).json({ message: "Client verified successfully" });
  } catch (error) {
    logger.error("Error verifying user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const resendCode = async (req, res) => {
  try {
    const { userId } = req.body;
    const newVerificationCode = Math.floor(100000 + Math.random() * 900000);

    if (!userId) {
      logger.warn("User ID is required to resend verification code");
      return res
        .status(400)
        .json({ error: "Error occurred, please try again later" });
    }

    const user = await User.findById(userId);
    if (!user) {
      logger.warn(
        `User with ID ${userId} not found for resending verification code`,
      );
      return res.status(404).json({ error: "Client not found" });
    }
    user.verificationCode = newVerificationCode;
    await user.save();
    sendVerifEmail(user.email, newVerificationCode);
    logger.info(`Verification code resent successfully to user ${userId}`);
    res.status(200).json({ message: "Verification code resent successfully" });
  } catch (error) {
    logger.error("Error resending verification code:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const login = async (req, res) => {
  try {
    // Get email and password from the request body
    let { email, password } = req.body;
    const pwd = password;

    // Normalize email: trim spaces and convert to lowercase
    email = email.trim().toLowerCase();

    // Validate request fields
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn("Validation errors in login request");
      return res.status(400).json({ errors: errors.array() });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      logger.warn(`Invalid login attempt with email ${email}`);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Check if password matches
    const passwordMatch = await bcrypt.compare(pwd, user.password);
    if (!passwordMatch) {
      logger.warn(`Invalid login attempt with email ${email}`);
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Check if user is verified
    if (!user.verified) {
      logger.warn(`Unverified user ${email} attempting to log in`);
      return res
        .status(403)
        .json({ error: "Please verify your account", userId: user._id });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET_KEY,
      { expiresIn: "24h" },
    );

    logger.info(`User ${email} logged in successfully`);
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    console.log("Decoded token" + JSON.stringify(decoded));
    res.status(200).json({ token, name: user.fullName, id: user._id });
  } catch (error) {
    logger.error("Error logging in user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getUserById = async (req, res) => {
  try {
    const userId = req.userId;

    // Ne sélectionne que les champs non sensibles à renvoyer
    const user = await User.findById(userId).select(
      "fullName email img role phoneNumber contractNumber percentage placeName placeLocation distance placeLogo placePicture profilePicture PlaceAddress defaultIP proxyUrl pricingPlan personalPhoneNumber statusFlowEnabled",
    );

    if (!user) {
      logger.warn(`User with ID ${userId} not found`);
      return res.status(404).json({ message: "User not found" });
    }

    // Tu peux aussi vérifier si c'est bien un superClient ici
    if (user.role !== "superClient") {
      logger.warn(`User with ID ${userId} is not a superClient`);
      return res.status(403).json({ message: "Access denied" });
    }

    logger.info(`Fetched sanitized data for superClient ${userId}`);
    res.status(200).json(user);
  } catch (error) {
    logger.error("Error fetching user data:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const getPlaceDetails = async (req, res) => {
  try {
    const userId = req.superClientId;
    const user = await User.findById(userId);
    if (!user) {
      logger.warn(`User with ID ${userId} not found`);
      return res.status(404).json({ message: "User not found" });
    }

    logger.info(`Fetched data for user ${userId}`);
    res.status(200).json(user);
  } catch (error) {
    logger.error("Error fetching user data:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const uploadProfileImage = async (req, res) => {
  try {
    const image = req.body.image;
    const userId = req.superClientId;

    // Check if userId exists
    if (!userId) {
      logger.warn("No user ID provided in request.");
      return res.status(400).json({ error: "User ID is required." });
    }

    // Check if image is provided
    if (!image) {
      logger.warn(`No image provided for user ${userId}`);
      return res.status(400).json({ error: "Image is required." });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      logger.warn(`User not found with ID: ${userId}`);
      return res.status(404).json({ error: "User not found." });
    }

    // Upload image to Cloudinary
    const uploadedImage = await cloudinary.uploader.upload(image, {
      public_id: `profile_images/${userId}`,
      overwrite: true,
      allowed_formats: ["jpg", "jpeg", "png"],
    });

    const imageUrl = uploadedImage.secure_url;

    // Update user's profile picture URL
    await User.findByIdAndUpdate(userId, { profilePicture: imageUrl });

    logger.info(`Profile image uploaded successfully for user ${userId}`);
    res.status(200).json({ message: "Profile image uploaded successfully." });
  } catch (error) {
    logger.error("Error uploading profile image:", error);
    res.status(500).json({ error: "Internal server error." });
  }
};

// update business details modal

const updateBusinessDetails = async (req, res) => {
  try {
    const {
      placeName,
      PlaceAddress,
      phoneNumber,
      distance,
      lat,
      long,
      logoPreview,
      picturePreview,
      statusFlowEnabled,
    } = req.body.placeData;

    const userId = req.superClientId;

    if (!userId) {
      logger.warn("No user ID provided in request.");
      return res.status(400).json({ error: "User ID is required." });
    }

    const user = await User.findById(userId);
    if (!user) {
      logger.warn(`User not found with ID: ${userId}`);
      return res.status(404).json({ error: "User not found." });
    }

    const updateData = {
      placeName,
      PlaceAddress,
      phoneNumber,
      distance,
      placeLocation: {
        lat,
        long,
      },
    };

    // Update placeLocation if both lat and long are present
    if (lat && long && typeof lat === "number" && typeof long === "number") {
      updateData.placeLocation = {
        lat: lat,
        long: long,
      };
    }

    // Persist the order-flow flag when supplied
    if (typeof statusFlowEnabled === "boolean") {
      updateData.statusFlowEnabled = statusFlowEnabled;
    }

    // Handle image uploads if provided
    if (logoPreview) {
      const uploadedLogo = await cloudinary.uploader.upload(logoPreview, {
        public_id: `place_logos/${userId}`,
        overwrite: true,
        allowed_formats: ["jpg", "jpeg", "png"],
      });
      updateData.placeLogo = uploadedLogo.secure_url;
    }

    if (picturePreview) {
      const uploadedPicture = await cloudinary.uploader.upload(picturePreview, {
        public_id: `place_pictures/${userId}`,
        overwrite: true,
        allowed_formats: ["jpg", "jpeg", "png"],
      });
      updateData.placePicture = uploadedPicture.secure_url;
    }

    console.log(updateData);
    await User.findByIdAndUpdate(userId, updateData);

    // Live-notify every open client tab of this tenant
    if (typeof statusFlowEnabled === "boolean") {
      req.io
        .to(userId.toString())
        .emit("tenantConfigChanged", { statusFlowEnabled });
    }

    logger.info(`Business details updated for user ${userId}`);
    return res
      .status(200)
      .json({ message: "Business details updated successfully." });
  } catch (error) {
    logger.error("Error updating business details:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

const changePassword = async (req, res) => {
  try {
    const { newPassword, userId, currentPassword } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      logger.warn(`User with ID ${userId} not found for password change`);
      return res.status(404).json({ message: "User not found" });
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
      logger.warn(`Incorrect current password for user ${userId}`);
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    user.password = hashedNewPassword;
    await user.save();

    logger.info(`Password changed successfully for user ${userId}`);
    return res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    logger.error("Error changing password:", error);
    res.status(500).json({ message: "Server error" });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      logger.warn("Email is required for password reset");
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      logger.warn(`Password reset requested for non-existent email ${email}`);
      return res.status(404).json({ error: "User not found" });
    }

    const code = Math.floor(100000 + Math.random() * 900000);

    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: "saadliwissem88@gmail.com",
        pass: process.env.MAIL_SENDER_PASS,
      },
    });

    const mailOptions = {
      from: "saadliwissem88@gmail.com",
      to: email,
      subject: "Password Reset Request",
      text: `You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n
      This is your verification code: ${code}\n\n
      If you did not request this, please ignore this email and your password will remain unchanged.\n`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        logger.error("Failed to send password reset email:", error);
        return res
          .status(500)
          .json({ error: "Failed to send password reset email" });
      } else {
        logger.info("Password reset email sent: " + info.response);
        res.status(200).json({ message: "Password reset email sent" });
      }
    });
    user.forgetPwdCode = code;
    await user.save();
  } catch (error) {
    logger.error("Error in forgotPassword:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { verificationCode, newPassword } = req.body;

    const user = await User.findOne({
      forgetPwdCode: verificationCode,
      // resetPasswordExpires: { $gt: Date.now() }, // This should be removed as it's not part of the provided model
    });

    if (!user) {
      logger.warn(`Invalid or expired password reset code`);
      return res
        .status(400)
        .json({ error: "Password reset token is invalid or has expired" });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    user.password = hashedPassword;
    user.forgetPwdCode = undefined;
    await user.save();

    logger.info(`Password has been reset successfully for user ${user._id}`);
    res.status(200).json({ message: "Password has been reset successfully" });
  } catch (error) {
    logger.error("Error resetting password:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const loginTable = async (req, res) => {
  const { email, password, tableNumber } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      logger.warn(`Invalid credentials provided for email ${email}`);
      console.log(`Invalid credentials provided for email ${email}`);

      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn(`Invalid credentials provided for email ${email}`);
      console.log(`Invalid credentials provided for email ${email}`);

      return res.status(400).json({ msg: "Invalid credentials" });
    }

    if (user.role !== "superClient" && user.role !== "client") {
      logger.warn(`Unauthorized login attempt by user ${email}`);
      console.log(`Unauthorized login attempt by user ${email}`);

      return res.status(403).json({ msg: "User not authorized" });
    }
    if (user.verified !== true) {
      logger.warn(`user ${email} is not active and trying to open a table`);
      console.log(`user ${email} is not active and trying to open a table`);

      return res.status(403).json({ msg: "User not active" });
    }

    const table = await Table.findOne({
      number: tableNumber,
      superClient: user.role === "superClient" ? user._id : user.superClient,
    });

    if (!table) {
      logger.warn(`Table not found or not authorized for email ${email}`);
      return res.status(400).json({ msg: "Table not found or not authorized" });
    }

    const payload = {
      user: {
        id: user.id,
        role: user.role,
      },
      table: {
        id: table._id,
        number: table.number,
        superClient: table.superClient,
      },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET_KEY,
      { expiresIn: "24h" },
      (err, token) => {
        if (err) throw err;
        logger.info(
          `User ${email} logged in successfully to table ${tableNumber}`,
        );
        res.json({ token });
      },
    );
  } catch (err) {
    logger.error("Server error in loginTable:", err);
    res.status(500).send("Server error");
  }
};

//QR login

// Haversine distance in meters between two points given as
// { lat, lon } objects (accepts string or number for either field).
const haversineDistanceMeters = (a, b) => {
  const lat1 = Number(a?.lat);
  const lon1 = Number(a?.lon ?? a?.long);
  const lat2 = Number(b?.lat);
  const lon2 = Number(b?.lon ?? b?.long);

  if (![lat1, lon1, lat2, lon2].every((n) => Number.isFinite(n))) {
    return null; // cannot compute
  }

  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
};

const qrLogin = async (req, res) => {
  const { token, lat, lon } = req.body;

  // ─── [DEBUG] entry ────────────────────────────────────────
  logger.info(
    `[QRLOGIN] ENTER ip=${req.ip} lat=${lat} lon=${lon} tokenLen=${token?.length || 0}`,
  );
  // ─────────────────────────────────────────────────────────

  try {
    if (!token) {
      logger.warn("[QRLOGIN] Missing token in body");
      return res.status(400).json({ msg: "QR token is required" });
    }

    // Client must supply a location; server enforces the check.
    if (lat == null || lon == null) {
      logger.warn("[QRLOGIN] Missing lat/lon in body");
      return res
        .status(400)
        .json({ msg: "Location (lat, lon) is required to log in" });
    }

    const decodedToken = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const { number: tableNumber, superClient } = decodedToken;

    logger.info(
      `[QRLOGIN] DECODED tableNumber=${tableNumber} superClient=${superClient}`,
    );

    const tableData = await Table.findOne({
      number: tableNumber,
      superClient: superClient,
    });
    if (!tableData) {
      logger.warn(
        `[QRLOGIN] Table not found tableNumber=${tableNumber} superClient=${superClient}`,
      );
      return res.status(400).json({ msg: "Table not found or not authorized" });
    }

    const superClientData = await User.findById(superClient);
    if (!superClientData || superClientData.role !== "superClient") {
      logger.warn(`[QRLOGIN] SuperClient not found id=${superClient}`);
      return res
        .status(400)
        .json({ msg: "SuperClient not found or not authorized" });
    }

    const { placeName, placeLocation, distance, placeLogo } = superClientData;

    // ─── Server-side geolocation check ────────────────────────
    const guestLocation = { lat, lon };
    const cafeLocation = {
      lat: placeLocation?.lat,
      lon: placeLocation?.long ?? placeLocation?.lon,
    };

    const meters = haversineDistanceMeters(guestLocation, cafeLocation);

    logger.info(
      `[QRLOGIN] DISTANCE_CHECK guestLat=${lat} guestLon=${lon} ` +
        `cafeLat=${cafeLocation.lat} cafeLon=${cafeLocation.lon} ` +
        `meters=${meters} allowed=${distance}`,
    );

    if (meters == null) {
      logger.warn(
        "[QRLOGIN] DISTANCE_UNCOMPUTABLE — cafe coordinates malformed",
      );
      return res
        .status(400)
        .json({ msg: "Café location is not configured properly" });
    }

    const allowed = Number(distance) || 0;
    if (meters > allowed) {
      logger.warn(
        `[QRLOGIN] REJECTED_TOO_FAR meters=${meters.toFixed(2)} allowed=${allowed}`,
      );
      return res.status(403).json({
        msg: "You are too far from the café to place an order",
        distanceMeters: Math.round(meters),
        allowedMeters: allowed,
      });
    }
    // ─────────────────────────────────────────────────────────

    const payload = {
      user: { id: decodedToken.superClient, role: "superClient" },
      table: { id: tableData._id, number: tableData.number },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET_KEY,
      { expiresIn: process.env.GUEST_SESSION_EXPIRES_IN || "1h" },
      (err, newToken) => {
        if (err) throw err;
        logger.info(
          `[QRLOGIN] SUCCESS tableNumber=${tableData.number} superClient=${superClient} distanceOk=${Math.round(meters)}/${allowed}`,
        );
        res.json({
          token: newToken,
          message: "Logged in successfully",
          tableNumber: tableData.number,
          placeName,
          placeLocation,
          distance,
          placeLogo,
          statusFlowEnabled: superClientData.statusFlowEnabled !== false,
        });
      },
    );
  } catch (err) {
    logger.error(`[QRLOGIN] ERROR message=${err.message}`);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

const getClientsBySuperClientId = async (req, res) => {
  try {
    const superClientId = req.superClientId; // Retrieved from the middleware

    if (!superClientId) {
      logger.warn("SuperClient ID is required to fetch clients");
      return res.status(400).json({ error: "SuperClient ID is required" });
    }

    const clients = await User.find({
      role: "client",
      superClient: superClientId,
    });

    if (!clients.length) {
      logger.warn(`No clients found for SuperClient ID ${superClientId}`);
      return res.status(404).json({ message: "No clients found" });
    }

    logger.info(`Fetched clients for SuperClient ID ${superClientId}`);
    res.status(200).json(clients);
  } catch (error) {
    logger.error("Error fetching clients:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const createUser = async (req, res) => {
  const { fullName, email, password } = req.body;

  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Check if user with the same email already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    logger.warn(`User with email ${email} already exists`);
    return res
      .status(400)
      .json({ error: "User with this email already exists" });
  }

  try {
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user object
    const newUser = new User({
      fullName,
      email,
      password: hashedPassword,
      superClient: req.superClientId, // Link the client to the superClient
    });

    // Save user to the database
    await newUser.save();

    logger.info(
      `User ${email} created successfully by superClient ${req.superClientId}`,
    );
    res
      .status(201)
      .json({ message: "User created successfully", userId: newUser._id });
  } catch (error) {
    logger.error("Error creating user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const superClientId = req.superClientId;

    // Only delete users that belong to this superClient.
    // A superClient cannot delete another superClient or themselves via this route.
    const user = await User.findOneAndDelete({
      _id: userId,
      superClient: superClientId,
      role: "client",
    });
    if (!user) {
      logger.warn(
        `User with ID ${userId} not found or not owned by superClient ${superClientId}`,
      );
      return res.status(404).json({ message: "User not found" });
    }

    logger.info(`User with ID ${userId} deleted successfully`);
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    logger.error("Error deleting user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
const changeUserVerificationStatus = async (req, res) => {
  try {
    const userId = req.params.id;
    const { verified } = req.body;
    const superClientId = req.superClientId;

    if (typeof verified !== "boolean") {
      return res
        .status(400)
        .json({ message: "Invalid 'verified' value. Must be a boolean." });
    }

    // Ownership: user must exist and belong to this superClient
    // (superClient can also toggle themselves, if needed)
    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { superClient: superClientId },
          { _id: superClientId, role: "superClient" },
        ],
      },
      { verified },
      { new: true },
    );

    if (!user) {
      logger.warn(
        `User with ID ${userId} not found or not owned by superClient ${superClientId}`,
      );
      return res.status(404).json({ message: "User not found" });
    }

    logger.info(
      `User with ID ${userId} verification status updated successfully`,
    );
    res
      .status(200)
      .json({ message: "User verification status updated successfully", user });
  } catch (error) {
    logger.error("Error updating user verification status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const role = req.role;
    const superClientId = req.superClientId;
    const {
      fullName,
      email,
      password,
      phoneNumber,
      contractNumber,
      percentage,
      placeName,
      longitude,
      latitude,
    } = req.body;

    // Load target user and verify ownership before touching anything
    const target = await User.findOne({
      _id: userId,
      superClient: superClientId,
    });
    if (!target) {
      logger.warn(
        `User with ID ${userId} not found or not owned by superClient ${superClientId}`,
      );
      return res.status(404).json({ message: "User not found" });
    }

    // A superClient can only edit their own client staff through this route.
    // Editing another superClient's profile, or their own superClient record,
    // is not allowed here.
    if (target.role !== "client") {
      return res
        .status(403)
        .json({ message: "Cannot edit this user through this endpoint" });
    }

    // Only whitelist fields that a superClient is allowed to change on their staff
    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (email) updateData.email = email;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;
    if (contractNumber) updateData.contractNumber = contractNumber;
    if (percentage !== undefined) updateData.percentage = percentage;
    if (placeName) updateData.placeName = placeName;
    if (latitude && longitude) {
      updateData.placeLocation = { lat: latitude, long: longitude };
    }

    // Password change, if provided
    if (password) {
      const saltRounds = 10;
      updateData.password = await bcrypt.hash(password, saltRounds);
    }

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    });
    if (!user) {
      logger.warn(`User with ID ${userId} not found for update`);
      return res.status(404).json({ message: "User not found" });
    }

    logger.info(`User with ID ${userId} updated successfully`);
    res.status(200).json({ message: "User updated successfully", user });
  } catch (error) {
    logger.error("Error updating user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = {
  register,
  login,
  uploadProfileImage,
  changePassword,
  CodeVerification,
  resendCode,
  getUserById,
  loginTable,
  forgotPassword,
  resetPassword,
  getClientsBySuperClientId,
  createUser,
  updateUser,
  deleteUser,
  changeUserVerificationStatus,
  qrLogin,
  getPlaceDetails,
  sendChangePwdVerifCode,
  changeSuperClientPassword,
  sendChangePersonalDettailsVerifCode,
  changeSuperClientPD,
  updateBusinessDetails,
};
