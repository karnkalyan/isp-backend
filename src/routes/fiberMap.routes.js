const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fiberMapController = require('../controllers/fiberMap.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads/gis/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'map-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedExtensions = ['.kml', '.kmz', '.json', '.geojson', '.qgs', '.dxf'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only KML, KMZ, and GeoJSON are allowed.'));
        }
    }
});

module.exports = (prisma) => {
    const router = express.Router();
    const auth = isAuthenticated(prisma);

    router.get('/folders', auth, fiberMapController.listMapFolders);
    router.post('/folders', auth, fiberMapController.createFolder);
    router.post('/files', auth, upload.single('mapFile'), fiberMapController.uploadMapFile);
    router.get('/files/:fileId', auth, fiberMapController.getFileContent);
    router.delete('/files/:fileId', auth, fiberMapController.deleteMapFile);

    return router;
};
