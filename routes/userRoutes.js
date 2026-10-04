const express = require("express");
const {
  register,
  login,
  uploadProfileImage,
  changePassword,
  CodeVerification,
  resendCode,
  getUserById,
  loginTable,
  getClientsBySuperClientId,
  createUser,
  deleteUser,
  updateUser,
  changeUserVerificationStatus,
  qrLogin,
  getPlaceDetails,
  sendChangePwdVerifCode,
  changeSuperClientPassword,
  sendChangePersonalDettailsVerifCode,
  changeSuperClientPD,
  updateBusinessDetails,
} = require("../controllers/UserController");
const verifyToken = require("../middleWares/jerifyToken");
const verifySuperClient = require("../middleWares/VerifySuperClient");
const verifyClientOrSuperClientOrTable = require("../middleWares/verifyClientOrSuperClientOrTable");
const router = express.Router();

// Define routes for User model
router.post("/register", register); // Create a new user
router.post("/login", login); // login user
router.get("/get-user", verifyToken, getUserById);
router.get("/place-details", verifyClientOrSuperClientOrTable, getPlaceDetails);

router.post("/uploadProfileImage", verifyToken, uploadProfileImage);
router.put("/changepwd", verifyToken, changePassword);
router.post(
  "/client/pwd-verification-code",
  verifySuperClient,
  sendChangePwdVerifCode
);
router.post(
  "/client/change-password",
  verifySuperClient,
  changeSuperClientPassword
);
router.post(
  "/client/personal-details-change",
  verifySuperClient,
  sendChangePersonalDettailsVerifCode
);
router.post(
  "/client/verify-pd-change-code",
  verifySuperClient,
  changeSuperClientPD
);
router.post("/verifyUser", CodeVerification);
router.post("/resendcode", resendCode);
router.post("/login-table", loginTable);
router.post("/login-qr", qrLogin);

//routes for superClient
router.get(
  "/superClient/getUsers",
  verifySuperClient,
  getClientsBySuperClientId
);
router.post("/superClient/create-user", verifySuperClient, createUser);
router.post(
  "/superClient/change-profile",
  verifySuperClient,
  uploadProfileImage
);
router.post(
  "/superClient/update-business-details",
  verifySuperClient,
  updateBusinessDetails
);

router.delete("/superClient/:id", verifySuperClient, deleteUser);
router.put("/superClient/:id", verifySuperClient, updateUser);
router.patch("/superClient/:id/verify", changeUserVerificationStatus);

module.exports = router;
