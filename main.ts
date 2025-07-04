#!/usr/bin/env ts-node

import {SendEmailCommand, SESClient} from '@aws-sdk/client-ses';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import schedule, {RecurrenceRule} from 'node-schedule';
import * as path from 'path';

dotenv.config();

interface MonitorConfig {
    label: string;
    url: string;
    emails: string[];
    interval: number; // milliseconds
}

interface MonitorState {
    lastUp: boolean | null;
}

const CONFIG_PATH = process.argv[2] || './config.json';
const LOG_DIR = path.resolve(__dirname, 'logs');

// SES client (v3)
const ses = new SESClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});

async function sendEmail(to: string[], subject: string, body: string) {
    try {
        const cmd = new SendEmailCommand({
            Destination: {ToAddresses: to},
            Message: {
                Body: {Text: {Data: body}},
                Subject: {Data: subject},
            },
            Source: process.env.SES_FROM_EMAIL,
        });
        await ses.send(cmd);
        console.log(`📧 Sent: ${subject} → ${to.join(', ')}`);
    } catch (err) {
        console.error('SES error:', err);
    }
}

function ensureLogDir() {
    return fs.promises.mkdir(LOG_DIR, {recursive: true});
}

function logLine(label: string, entry: object) {
    const file = path.join(LOG_DIR, `${label.replace(/\s+/g, '_')}.log`);
    const line = JSON.stringify(entry) + '\n';
    fs.appendFile(file, line, err => {
        if (err) console.error(`✍️  Log error for ${label}:`, err);
    });
}

async function checkOnce(cfg: MonitorConfig, state: MonitorState) {
    const start = Date.now();
    let statusCode: number | null = null;
    let errorMsg: string | null = null;
    let isConnectionError = false;

    try {
        const res = await axios.get(cfg.url, {timeout: 30_000});
        statusCode = res.status;
    } catch (e: any) {
        if (e.response) {
            // HTTP error with response
            statusCode = e.response.status;
        } else {
            // Network error (no response)
            errorMsg = e.message;
            isConnectionError = true;
        }
    }

    const duration = Date.now() - start;

    // Define downtime as network/connection error OR HTTP 5xx
    const isDowntime =
        isConnectionError ||
        (statusCode !== null && statusCode >= 500);

    const up = !isDowntime;

    // Log every check
    logLine(cfg.label, {
        timestamp: new Date().toISOString(),
        url: cfg.url,
        statusCode,
        error: errorMsg,
        responseTimeMs: duration,
        up,
    });

    // Handle state changes and notifications
    if (state.lastUp === null) {
        // First-ever check - just record the state, don't send notification yet
        // This prevents the initial check from triggering alerts
        state.lastUp = up;
        console.log(`Initial check for "${cfg.label}": ${up ? 'UP' : 'DOWN'}`);
    }
    else if (state.lastUp && !up) {
        // Site was up but is now down - send alert
        await sendEmail(
            cfg.emails,
            `[ALERT] ${cfg.label} went DOWN (${new Date().toLocaleString('en-GB', {dateStyle: 'short', timeStyle: 'short'})})`,
            `${cfg.label} (${cfg.url}) is now down: ${errorMsg || `status ${statusCode}`}`
        );
        state.lastUp = up;
    }
    else if (!state.lastUp && up) {
        // Site was down but is now up - send recovery
        await sendEmail(
            cfg.emails,
            `[RECOVERY] ${cfg.label} is UP (${new Date().toLocaleString('en-GB', {dateStyle: 'short', timeStyle: 'short'})})`,
            `${cfg.label} (${cfg.url}) has recovered (status ${statusCode}).`
        );
        state.lastUp = up;
    }
    // No change in state, just update the timestamp
    else {
        state.lastUp = up;
    }
}

function buildRule(interval: number): RecurrenceRule {
    const rule = new schedule.RecurrenceRule();
    const sec = Math.floor(interval / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);

    if (sec < 60) {
        rule.second = new schedule.Range(0, 59, sec);
    }
    else if (sec % 60 === 0 && min < 60) {
        rule.second = 0;
        rule.minute = new schedule.Range(0, 59, min);
    }
    else if (min % 60 === 0 && hr < 24) {
        rule.second = 0;
        rule.minute = 0;
        rule.hour = new schedule.Range(0, 23, hr);
    }
    else {
        // fallback to once-per-day at midnight if >24h
        rule.second = 0;
        rule.minute = 0;
        rule.hour = 0;
    }

    return rule;
}

async function main() {
    try {
        const raw = await fs.promises.readFile(CONFIG_PATH, 'utf-8');
        const configs: MonitorConfig[] = JSON.parse(raw);
        await ensureLogDir();

        console.log(`Monitoring ${configs.length} target(s). Logs in ${LOG_DIR}`);

        // Create a map to track monitors
        const monitors = new Map();

        configs.forEach(cfg => {
            const state: MonitorState = {lastUp: null};
            monitors.set(cfg.label, state);

            // Schedule recurring checks
            const rule = buildRule(cfg.interval);
            schedule.scheduleJob(rule, () => {
                checkOnce(cfg, state).catch(console.error);
            });

            console.log(`✅ Scheduled "${cfg.label}" every ${cfg.interval}ms`);
        });

        // Perform initial checks after a short delay to let the system initialize
        setTimeout(() => {
            configs.forEach(cfg => {
                const state = monitors.get(cfg.label);
                checkOnce(cfg, state).catch(console.error);
            });
        }, 1000);

        console.log(`Logs are saved in ${LOG_DIR}`);
    } catch (err) {
        console.error('Fatal startup error:', err);
        process.exit(1);
    }
}

process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

main().then();