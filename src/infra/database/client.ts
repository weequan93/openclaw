import { pool, query, transaction, healthCheck, close } from './pool.js';

/**
 * Database client wrapper
 * Re-exports pool functions for convenience
 */

export { pool, query, transaction, healthCheck, close };

// Default export
export default {
    pool,
    query,
    transaction,
    healthCheck,
    close,
};
