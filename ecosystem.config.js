/**
 * ecosystem.config.js
 */
module.exports = {
    apps: [
        {
            name: 'xmonitor',
            script: 'main.ts',

            interpreter: 'ts-node',
            interpreter_args: '--transpile-only',

            // Log files
            error_file: './logs/monitor-error.log',
            out_file: './logs/monitor-out.log',
            log_file: './logs/monitor-combined.log',
            log_date_format: 'YYYY-MM-DD HH:mm Z',
        },
    ],
};
