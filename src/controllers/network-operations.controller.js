const service = require('../services/network-operations.service');

async function dashboard(req, res, next) {
  try { res.json({ success: true, data: await service.getDashboardSnapshot(req) }); } catch (error) { next(error); }
}

async function onts(req, res, next) {
  try { res.json({ success: true, ...(await service.listOnts(req)) }); } catch (error) { next(error); }
}

module.exports = { dashboard, onts };
