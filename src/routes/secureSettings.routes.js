const express = require('express');
const isAuthenticated = require('../middlewares/isAuthenticated');
const {
  truncateDatabase,
  downloadBackup,
  getBackupSchedule,
  saveBackupSchedule,
  sendBackupNow
} = require('../controllers/secureSettings.controller');

module.exports = (prisma) => {
  const router = express.Router();
  const auth = isAuthenticated(prisma);

  router.use((req, res, next) => {
    req.prisma = prisma;
    next();
  });

  router.post('/truncate', auth, truncateDatabase);
  router.get('/backup/download', auth, downloadBackup);
  router.get('/backup/schedule', auth, getBackupSchedule);
  router.put('/backup/schedule', auth, saveBackupSchedule);
  router.post('/backup/send-now', auth, sendBackupNow);

  return router;
};
