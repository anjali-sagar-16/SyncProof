const { processSyncBatch } = require('../services/syncEngine');

/**
 * POST /api/sync
 * Synchronizes a batch of queued client mutations.
 * Supports idempotent replays, 3-way auto-merging, and collision flagging.
 */
async function sync(req, res, next) {
  try {
    const { mutations } = req.body;

    if (!mutations || !Array.isArray(mutations)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: "Request body must include a 'mutations' array.",
      });
    }

    if (mutations.length === 0) {
      return res.status(200).json({
        processed: 0,
        results: [],
      });
    }

    const batchResult = await processSyncBatch(mutations, req.user);

    res.status(200).json(batchResult);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  sync,
};
