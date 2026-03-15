// models/splitter.model.js
const prisma = require('../../prisma/client');

module.exports = {
    // Model definition for Prisma schema
    model: {
        Splitter: {
            id: { type: 'Int', isId: true, default: { autoincrement: true } },
            name: { type: 'String' },
            splitterId: { type: 'String', unique: true },
            splitRatio: { type: 'String' }, // "1:8", "1:16", "1:32", etc.
            splitterType: { type: 'String', default: 'PLC' }, // "PLC" or "FBT"
            portCount: { type: 'Int' },
            usedPorts: { type: 'Int', default: 0 },
            availablePorts: { type: 'Int', default: 0 },
            isMaster: { type: 'Boolean', default: false },
            masterSplitterId: { type: 'String', optional: true },
            location: {
                type: 'Json',
                optional: true,
                properties: {
                    site: 'String',
                    latitude: 'Float',
                    longitude: 'Float',
                    description: 'String'
                }
            },
            upstreamFiber: {
                type: 'Json',
                optional: true,
                properties: {
                    coreColor: 'String',
                    connectedTo: 'String', // "service-board", "olt", "splitter"
                    connectionId: 'String',
                    port: 'String'
                }
            },
            connectedServiceBoard: {
                type: 'Json',
                optional: true,
                properties: {
                    oltId: 'Int',
                    oltName: 'String',
                    boardSlot: 'Int',
                    boardPort: 'String'
                }
            },
            status: { type: 'String', default: 'active' }, // "active", "inactive", "maintenance"
            notes: { type: 'String', optional: true },
            isActive: { type: 'Boolean', default: true },
            isDeleted: { type: 'Boolean', default: false },
            createdAt: { type: 'DateTime', default: { now: true } },
            updatedAt: { type: 'DateTime', default: { now: true }, updatedAt: true },
            oltId: { type: 'Int', optional: true },
            olt: { type: 'OLT', relation: { fields: ['oltId'], references: ['id'] } },
            ispId: { type: 'Int' },
            isp: { type: 'ISP', relation: { fields: ['ispId'], references: ['id'] } },
            customers: { type: 'Customer', relation: { fields: ['id'], references: ['splitterId'] } },
            slaveSplitters: { type: 'Splitter', relation: { fields: ['splitterId'], references: ['masterSplitterId'] } }
        }
    },

    // Validation functions
    validateSplitter: (data) => {
        const errors = [];

        if (!data.name || data.name.trim() === '') {
            errors.push('Splitter name is required');
        }

        if (!data.splitRatio || !data.splitRatio.match(/^1:\d+$/)) {
            errors.push('Splitter ratio must be in format 1:N (e.g., 1:8)');
        } else {
            const ratio = parseInt(data.splitRatio.split(':')[1]);
            if (ratio <= 0 || ratio > 64) {
                errors.push('Splitter ratio must be between 1:1 and 1:64');
            }
        }

        if (data.portCount) {
            const ratio = parseInt(data.splitRatio?.split(':')[1] || '8');
            if (data.portCount !== ratio) {
                errors.push(`Port count must match splitter ratio (expected: ${ratio})`);
            }
        }

        if (data.usedPorts !== undefined && data.portCount !== undefined) {
            if (data.usedPorts > data.portCount) {
                errors.push('Used ports cannot exceed total port count');
            }
            if (data.usedPorts < 0) {
                errors.push('Used ports cannot be negative');
            }
        }

        if (data.connectedServiceBoard && data.connectedServiceBoard.oltId) {
            if (!data.connectedServiceBoard.boardPort) {
                errors.push('Board port is required when connecting to OLT');
            }
        }

        if (!data.isMaster && !data.masterSplitterId) {
            errors.push('Master splitter ID is required for slave splitters');
        }

        return errors;
    },

    // Calculate derived fields
    calculateDerivedFields: (data) => {
        const splitRatio = data.splitRatio || '1:8';
        const portCount = parseInt(splitRatio.split(':')[1]) || 8;
        const usedPorts = data.usedPorts || 0;
        const availablePorts = Math.max(0, portCount - usedPorts);

        return {
            portCount,
            usedPorts,
            availablePorts,
            splitRatio
        };
    }
};