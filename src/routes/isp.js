// File: src/routes/isp.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure the uploads folder exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

module.exports = (prisma) => {
  const router = express.Router();

  // --- Create ISP with logo upload ---
  router.post('/', upload.single('logo'), async (req, res, next) => {
    try {
      const {
        companyName,
        masterEmail,
        passwordHash,
        businessType,
        website,
        contactPerson,
        phoneNumber,
        description,
        address,
        city,
        state,
        zipCode,
        country,
        asnNumber,
        ipv4Blocks,
        ipv6Blocks,
        upstreamProviders
      } = req.body;

      const logoUrl = req.file ? `/uploads/${req.file.filename}` : null;

      // --- Required field validation ---
      if (!companyName) return res.status(400).json({ error: 'companyName is required' });
      if (!masterEmail) return res.status(400).json({ error: 'masterEmail is required' });

      const isp = await prisma.iSP.create({
        data: {
          companyName,
          masterEmail,
          passwordHash,
          businessType,
          website,
          contactPerson,
          phoneNumber,
          description,
          address,
          city,
          state,
          zipCode,
          country,
          asnNumber,
          ipv4Blocks,
          ipv6Blocks,
          upstreamProviders,
          logoUrl
        },
      });

      res.status(201).json(isp);
    } catch (err) {
      next(err);
    }
  });

  // --- Get all ISPs ---
  router.get('/', async (req, res, next) => {
    try {
      const list = await prisma.iSP.findMany();
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  // --- Get ISP by ID ---
  router.get('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const isp = await prisma.iSP.findUnique({ where: { id } });
      if (!isp) return res.status(404).json({ error: 'ISP not found' });
      res.json(isp);
    } catch (err) {
      next(err);
    }
  });

  // --- Update ISP with optional logo ---
  router.put('/:id', upload.single('logo'), async (req, res, next) => {
    try {
      const id = Number(req.params.id);

      let updatedData = { ...req.body };
      if (req.file) {
        updatedData.logoUrl = `/uploads/${req.file.filename}`;
      }

      const updated = await prisma.iSP.update({
        where: { id },
        data: updatedData,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // --- Delete ISP ---
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await prisma.iSP.delete({ where: { id } });
      res.sendStatus(204);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
