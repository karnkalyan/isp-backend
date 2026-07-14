const fs = require('fs');
const path = require('path');

/**
 * Get all map folders and files
 */
async function listMapFolders(req, res, next) {
    try {
        const ispId = req.ispId;
        const folders = await req.prisma.MapFolder.findMany({
            where: { ispId },
            orderBy: { createdAt: 'asc' },
            include: {
                files: {
                    orderBy: { createdAt: 'asc' },
                    select: { id: true, name: true, fileName: true, data: true, createdAt: true, updatedAt: true }
                }
            }
        });
        res.json(folders);
    } catch (err) {
        next(err);
    }
}

/**
 * Create a new folder
 */
async function createFolder(req, res, next) {
    try {
        const { name, branchId } = req.body;
        const ispId = req.ispId;

        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'Folder name is required' });
        }

        const now = new Date();
        const folder = await req.prisma.MapFolder.create({
            data: {
                name: String(name).trim(),
                ispId,
                branchId: branchId ? Number(branchId) : null,
                updatedAt: now
            }
        });
        res.status(201).json(folder);
    } catch (err) {
        next(err);
    }
}

/**
 * Upload a map file
 */
async function uploadMapFile(req, res, next) {
    try {
        const { folderId, name } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const numericFolderId = Number(folderId);
        if (!Number.isInteger(numericFolderId)) {
            return res.status(400).json({ error: 'A valid folderId is required' });
        }

        const folder = await req.prisma.MapFolder.findFirst({
            where: { id: numericFolderId, ispId: req.ispId }
        });

        if (!folder) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        const parsedData = req.body.parsedData ? JSON.parse(req.body.parsedData) : {};

        const mapFile = await req.prisma.MapFile.create({
            data: {
                name: name || file.originalname,
                fileName: file.filename,
                filePath: `/uploads/gis/${file.filename}`,
                mimeType: file.mimetype,
                folderId: numericFolderId,
                data: parsedData,
                updatedAt: new Date()
            }
        });

        res.status(201).json(mapFile);
    } catch (err) {
        next(err);
    }
}

/**
 * Get file content (GeoJSON)
 */
async function getFileContent(req, res, next) {
    try {
        const { fileId } = req.params;
        const mapFile = await req.prisma.MapFile.findUnique({
            where: { id: Number(fileId) }
        });

        if (!mapFile) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Verify ISP ownership via folder
        const folder = await req.prisma.MapFolder.findUnique({
            where: { id: mapFile.folderId }
        });

        if (!folder || folder.ispId !== req.ispId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(mapFile);
    } catch (err) {
        next(err);
    }
}

/**
 * Delete a map file
 */
async function deleteMapFile(req, res, next) {
    try {
        const { fileId } = req.params;
        const mapFile = await req.prisma.MapFile.findUnique({
            where: { id: Number(fileId) },
            include: { folder: true }
        });

        if (!mapFile) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (!mapFile.folder || mapFile.folder.ispId !== req.ispId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Delete from DB and disk
        await req.prisma.MapFile.delete({ where: { id: Number(fileId) } });
        
        const fullPath = path.join(__dirname, '../../uploads/gis', mapFile.fileName);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }

        res.json({ message: 'File deleted' });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    listMapFolders,
    createFolder,
    uploadMapFile,
    getFileContent,
    deleteMapFile
};
