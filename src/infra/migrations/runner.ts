/**
 * Database Migration Framework
 * 
 * Manages PostgreSQL schema migrations for OpenClaw multi-tenant deployment.
 * Supports versioned migrations with rollback capability.
 */

import { Pool, PoolClient } from 'pg';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Migration {
    version: number;
    name: string;
    up: string;
    down: string;
}

export class MigrationRunner {
    constructor(private pool: Pool) { }

    /**
     * Initialize migrations table
     */
    async initialize(): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
        } finally {
            client.release();
        }
    }

    /**
     * Load migration files from migrations directory
     */
    async loadMigrations(): Promise<Migration[]> {
        const migrationsDir = join(__dirname, 'migrations');
        const files = await readdir(migrationsDir);

        const migrations: Migration[] = [];

        for (const file of files.sort()) {
            if (!file.endsWith('.sql')) continue;

            // Parse filename: 001_create_tenants.sql
            const match = file.match(/^(\d+)_(.+)\.sql$/);
            if (!match) continue;

            const [, versionStr, name] = match;
            const version = parseInt(versionStr, 10);

            const content = await readFile(join(migrationsDir, file), 'utf-8');

            // Split into UP and DOWN sections
            const sections = content.split(/-- DOWN/i);
            const up = sections[0].replace(/-- UP/i, '').trim();
            const down = sections[1]?.trim() || '';

            migrations.push({ version, name, up, down });
        }

        return migrations.sort((a, b) => a.version - b.version);
    }

    /**
     * Get applied migrations
     */
    async getAppliedMigrations(): Promise<number[]> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(
                'SELECT version FROM schema_migrations ORDER BY version'
            );
            return result.rows.map(row => row.version);
        } finally {
            client.release();
        }
    }

    /**
     * Run pending migrations
     */
    async migrate(): Promise<void> {
        await this.initialize();

        const migrations = await this.loadMigrations();
        const applied = await this.getAppliedMigrations();

        const pending = migrations.filter(m => !applied.includes(m.version));

        if (pending.length === 0) {
            console.log('No pending migrations');
            return;
        }

        console.log(`Running ${pending.length} migrations...`);

        for (const migration of pending) {
            await this.runMigration(migration);
        }

        console.log('All migrations completed');
    }

    /**
     * Run a single migration
     */
    private async runMigration(migration: Migration): Promise<void> {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            console.log(`Applying migration ${migration.version}: ${migration.name}`);

            // Run migration SQL
            await client.query(migration.up);

            // Record migration
            await client.query(
                'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
                [migration.version, migration.name]
            );

            await client.query('COMMIT');

            console.log(`✓ Migration ${migration.version} applied`);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`✗ Migration ${migration.version} failed:`, error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Rollback last migration
     */
    async rollback(): Promise<void> {
        const migrations = await this.loadMigrations();
        const applied = await this.getAppliedMigrations();

        if (applied.length === 0) {
            console.log('No migrations to rollback');
            return;
        }

        const lastVersion = applied[applied.length - 1];
        const migration = migrations.find(m => m.version === lastVersion);

        if (!migration) {
            throw new Error(`Migration ${lastVersion} not found`);
        }

        if (!migration.down) {
            throw new Error(`Migration ${lastVersion} has no DOWN script`);
        }

        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            console.log(`Rolling back migration ${migration.version}: ${migration.name}`);

            // Run rollback SQL
            await client.query(migration.down);

            // Remove migration record
            await client.query(
                'DELETE FROM schema_migrations WHERE version = $1',
                [migration.version]
            );

            await client.query('COMMIT');

            console.log(`✓ Migration ${migration.version} rolled back`);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`✗ Rollback ${migration.version} failed:`, error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get migration status
     */
    async status(): Promise<void> {
        const migrations = await this.loadMigrations();
        const applied = await this.getAppliedMigrations();

        console.log('\nMigration Status:');
        console.log('─'.repeat(60));

        for (const migration of migrations) {
            const isApplied = applied.includes(migration.version);
            const status = isApplied ? '✓' : '✗';
            console.log(`${status} ${migration.version.toString().padStart(3, '0')} ${migration.name}`);
        }

        console.log('─'.repeat(60));
        console.log(`Applied: ${applied.length}/${migrations.length}`);
    }
}

/**
 * CLI interface
 */
export async function runMigrationCLI(command: string): Promise<void> {
    const pool = new Pool({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'openclaw',
        user: process.env.POSTGRES_USER || 'openclaw',
        password: process.env.POSTGRES_PASSWORD,
    });

    const runner = new MigrationRunner(pool);

    try {
        switch (command) {
            case 'migrate':
                await runner.migrate();
                break;
            case 'rollback':
                await runner.rollback();
                break;
            case 'status':
                await runner.status();
                break;
            default:
                console.error(`Unknown command: ${command}`);
                console.log('Usage: migrate|rollback|status');
                process.exit(1);
        }
    } finally {
        await pool.end();
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const command = process.argv[2] || 'status';
    runMigrationCLI(command).catch(error => {
        console.error('Migration failed:', error);
        process.exit(1);
    });
}
