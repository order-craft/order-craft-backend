const { RequestType, Support } = require("../models/Support");
const { Table } = require("../models/Table");

const logger = require("../logger"); // À adapter selon ton projet

// SuperClient CRUD for Request Types

const createRequestType = async (req, res) => {
  try {
    const { name, icon } = req.body;
    const superClientId = req.superClientId;

    const newRequestType = await RequestType.create({
      name,
      icon: icon || "❓",
      superClientId,
    });

    logger.info(
      `RequestType created: ${newRequestType._id} by SuperClient ${superClientId}`
    );

    res.status(201).json({ success: true, data: newRequestType });
  } catch (error) {
    logger.error(`Failed to create request type: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Failed to create request type",
      error: error.message,
    });
  }
};

const getRequestTypes = async (req, res) => {
  try {
    const requestTypes = await RequestType.find({
      superClientId: req.superClientId,
      isActive: true,
    });

    logger.info(`Fetched request types for SuperClient ${req.superClientId}`);

    res.status(200).json({ success: true, data: requestTypes });
  } catch (error) {
    logger.error(`Failed to fetch request types: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Failed to fetch request types",
      error: error.message,
    });
  }
};

const updateRequestType = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, isActive } = req.body;

    const updatedType = await RequestType.findOneAndUpdate(
      { _id: id, superClientId: req.superClientId },
      { name, icon, isActive },
      { new: true, runValidators: true }
    );

    if (!updatedType) {
      logger.warn(
        `RequestType ${id} not found for SuperClient ${req.superClientId}`
      );
      return res.status(404).json({
        success: false,
        message: "Request type not found or not owned by this superclient",
      });
    }

    logger.info(
      `RequestType ${id} updated by SuperClient ${req.superClientId}`
    );

    res.status(200).json({ success: true, data: updatedType });
  } catch (error) {
    logger.error(
      `Failed to update request type ${req.params.id}: ${error.message}`
    );
    res.status(500).json({
      success: false,
      message: "Failed to update request type",
      error: error.message,
    });
  }
};

const deleteRequestType = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedType = await RequestType.findOneAndDelete({
      _id: id,
      superClientId: req.superClientId,
    });

    if (!deletedType) {
      logger.warn(
        `RequestType ${id} not found for deletion by SuperClient ${req.superClientId}`
      );
      return res.status(404).json({
        success: false,
        message: "Request type not found or not owned by this superclient",
      });
    }

    logger.info(
      `RequestType ${id} deleted by SuperClient ${req.superClientId}`
    );

    res.status(200).json({
      success: true,
      message: "Request type deleted successfully",
    });
  } catch (error) {
    logger.error(
      `Failed to delete request type ${req.params.id}: ${error.message}`
    );
    res.status(500).json({
      success: false,
      message: "Failed to delete request type",
      error: error.message,
    });
  }
};

// Customer Support Request Handling

const createSupportRequest = async ({
  tableNumber,
  requestType,
  superClientId,
}) => {
  try {
    // First find the table by number and superClient
    const table = await Table.findOne({
      number: tableNumber,
      superClient: superClientId,
    });

    if (!table) {
      throw new Error(`Table ${tableNumber} not found for this superClient`);
    }

    const newSupport = new Support({
      requestType,
      superClientId,
      table: table._id, // Use the found table's ID
      answered: false,
    });

    const savedSupport = await newSupport.save();
    logger.info(
      `New support request created for Table ${tableNumber} (ID: ${table._id}): ${savedSupport._id}`
    );

    return {
      ...savedSupport.toObject(),
      tableNumber, // Include the original table number in the response
      tableUser: table.user, // Assigned server for this table, if any
    };
  } catch (error) {
    logger.error("Error creating support request:", error);
    throw error;
  }
};

const getSupportRequests = async (req, res) => {
  try {
    const { answered, limit = 20 } = req.query;
    const query = { superClientId: req.superClientId };
    if (answered !== undefined) query.answered = answered;

    const requests = await Support.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate("requestType table");

    logger.info(
      `Fetched support requests for SuperClient ${req.superClientId} (answered=${answered})`
    );

    res.status(200).json({ success: true, data: requests });
  } catch (error) {
    logger.error(`Failed to fetch support requests: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Failed to fetch support requests",
      error: error.message,
    });
  }
};

const markAsAnswered = async (req, res) => {
  try {
    const { id } = req.params;

    const updatedRequest = await Support.findOneAndUpdate(
      { _id: id, superClientId: req.superClientId },
      { answered: true },
      { new: true }
    ).populate("requestType table");

    if (!updatedRequest) {
      logger.warn(
        `Support request ${id} not found for SuperClient ${req.superClientId}`
      );
      return res.status(404).json({
        success: false,
        message: "Support request not found or not owned by this superclient",
      });
    }

    logger.info(
      `Support request ${id} marked as answered by SuperClient ${req.superClientId}`
    );

    res.status(200).json({ success: true, data: updatedRequest });
  } catch (error) {
    logger.error(
      `Failed to update support request ${req.params.id}: ${error.message}`
    );
    res.status(500).json({
      success: false,
      message: "Failed to update support request",
      error: error.message,
    });
  }
};
const deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedType = await Support.findOneAndDelete({
      _id: id,
      superClientId: req.superClientId,
    });

    if (!deletedType) {
      logger.warn(
        `Suupport Request ${id} not found for deletion by SuperClient ${req.superClientId}`
      );
      return res.status(404).json({
        success: false,
        message: "Support Request not found or not owned by this superclient",
      });
    }

    logger.info(
      `Support Request ${id} deleted by SuperClient ${req.superClientId}`
    );

    res.status(200).json({
      success: true,
      message: "Request type deleted successfully",
    });
  } catch (error) {
    logger.error(
      `Failed to deleted Support request  ${req.params.id}: ${error.message}`
    );
    res.status(500).json({
      success: false,
      message: "Failed to deleted Support request ",
      error: error.message,
    });
  }
};

module.exports = {
  markAsAnswered,
  getSupportRequests,
  createSupportRequest,
  deleteRequestType,
  updateRequestType,
  getRequestTypes,
  createRequestType,
  deleteRequest,
};
