const { validationResult } = require('express-validator');

/**
 * Request validation middleware
 * @param {Object} schema - Validation schema
 * @returns {Function} Express middleware
 */
function validateRequest(schema) {
    return (req, res, next) => {
        const errors = [];

        // Validate each field in schema
        Object.keys(schema).forEach(field => {
            const fieldRules = schema[field];
            const value = req.body[field] || req.query[field] || req.params[field];

            // Check required fields
            if (fieldRules.required && (value === undefined || value === null || value === '')) {
                errors.push({
                    field,
                    message: `${field} is required`,
                    value
                });
                return;
            }

            // Skip further validation if value is not provided and not required
            if (value === undefined || value === null) {
                return;
            }

            // Type validation
            if (fieldRules.type) {
                const typeCheck = validateType(value, fieldRules.type);
                if (!typeCheck.valid) {
                    errors.push({
                        field,
                        message: `${field} must be of type ${fieldRules.type}`,
                        value,
                        expectedType: fieldRules.type,
                        actualType: typeCheck.actualType
                    });
                    return;
                }
            }

            // Enum validation
            if (fieldRules.enum && !fieldRules.enum.includes(value)) {
                errors.push({
                    field,
                    message: `${field} must be one of: ${fieldRules.enum.join(', ')}`,
                    value,
                    allowedValues: fieldRules.enum
                });
            }

            // Array schema validation
            if (fieldRules.type === 'array' && fieldRules.schema && Array.isArray(value)) {
                value.forEach((item, index) => {
                    if (typeof item === 'object' && fieldRules.schema) {
                        const itemErrors = validateObject(item, fieldRules.schema);
                        if (itemErrors.length > 0) {
                            itemErrors.forEach(error => {
                                errors.push({
                                    field: `${field}[${index}].${error.field}`,
                                    message: error.message,
                                    value: error.value
                                });
                            });
                        }
                    }
                });
            }

            // Object schema validation
            if (fieldRules.type === 'object' && fieldRules.schema && typeof value === 'object') {
                const objectErrors = validateObject(value, fieldRules.schema);
                if (objectErrors.length > 0) {
                    objectErrors.forEach(error => {
                        errors.push({
                            field: `${field}.${error.field}`,
                            message: error.message,
                            value: error.value
                        });
                    });
                }
            }
        });

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                errors: errors
            });
        }

        next();
    };
}

/**
 * Validate type of value
 * @param {*} value - Value to check
 * @param {string} expectedType - Expected type
 * @returns {Object} Validation result
 */
function validateType(value, expectedType) {
    let actualType = typeof value;

    if (Array.isArray(value)) {
        actualType = 'array';
    } else if (value === null) {
        actualType = 'null';
    } else if (value instanceof Date) {
        actualType = 'date';
    }

    const typeMap = {
        string: actualType === 'string',
        number: actualType === 'number' && !isNaN(value),
        boolean: actualType === 'boolean',
        array: actualType === 'array',
        object: actualType === 'object' && !Array.isArray(value) && value !== null,
        date: actualType === 'date' || (actualType === 'string' && !isNaN(Date.parse(value)))
    };

    return {
        valid: typeMap[expectedType] || false,
        actualType
    };
}

/**
 * Validate object against schema
 * @param {Object} obj - Object to validate
 * @param {Object} schema - Validation schema
 * @returns {Array} Array of errors
 */
function validateObject(obj, schema) {
    const errors = [];

    Object.keys(schema).forEach(field => {
        const fieldRules = schema[field];
        const value = obj[field];

        if (fieldRules.required && (value === undefined || value === null || value === '')) {
            errors.push({
                field,
                message: `${field} is required`,
                value
            });
            return;
        }

        if (value !== undefined && value !== null && fieldRules.type) {
            const typeCheck = validateType(value, fieldRules.type);
            if (!typeCheck.valid) {
                errors.push({
                    field,
                    message: `${field} must be of type ${fieldRules.type}`,
                    value,
                    expectedType: fieldRules.type,
                    actualType: typeCheck.actualType
                });
            }
        }

        if (fieldRules.enum && value && !fieldRules.enum.includes(value)) {
            errors.push({
                field,
                message: `${field} must be one of: ${fieldRules.enum.join(', ')}`,
                value,
                allowedValues: fieldRules.enum
            });
        }
    });

    return errors;
}

module.exports = validateRequest;