/**
 * ecosystem.config.js
 */
module.exports = {
    apps: [
        {
            name: 'xmonitor',
            script: 'main.ts',

            // Use ts-node so we can run the .ts directly
            interpreter: 'ts-node',
            interpreter_args: '--transpile-only',

            // Run a single instance as this is a singleton monitoring task
            instances: 1,

            // Auto-restart on crash
            autorestart: true,
            restart_delay: 5000,         // wait 5s before restarting

            // Restart if memory grows too large
            max_memory_restart: '500M',

            // Working directory (optional, defaults to process.cwd())
            cwd: './',

            // Environment vars (dotenv in your script will load AWS_*, SES_FROM_EMAIL, etc.)
            env: {
                NODE_ENV: 'development',
            },
            env_production: {
                NODE_ENV: 'production',
            },

            // Log files
            error_file: './logs/monitor-error.log',
            out_file: './logs/monitor-out.log',
            log_file: './logs/monitor-combined.log',
            log_date_format: 'YYYY-MM-DD HH:mm Z',
        },
    ],
};
