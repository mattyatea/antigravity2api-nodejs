import fs from 'fs';
import path from 'path';
import config from '../config/index.js';
import { getImageDir, isPkg } from './paths.js';
import { MIME_TO_EXT } from '../config/constants.js';
import os from 'os';

const IMAGE_DIR = getImageDir();

// Ensure image directory exists (development environment)
if (!isPkg && !fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/**
 * Clean up old images exceeding limit
 */
function cleanOldImages(maxCount: number = 10) {
    const files = fs.readdirSync(IMAGE_DIR)
        .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
        .map(f => ({
            name: f,
            path: path.join(IMAGE_DIR, f),
            mtime: fs.statSync(path.join(IMAGE_DIR, f)).mtime.getTime()
        }))
        .sort((a, b) => b.mtime - a.mtime);

    if (files.length > maxCount) {
        files.slice(maxCount).forEach(f => fs.unlinkSync(f.path));
    }
}

/**
 * Save base64 image locally and return access URL
 */
export function saveBase64Image(base64Data: string, mimeType: string): string {
    // @ts-ignore
    const ext = MIME_TO_EXT[mimeType] || 'jpg';
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const filepath = path.join(IMAGE_DIR, filename);

    // Decode and save
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filepath, buffer);

    // Clean up old images
    // @ts-ignore
    cleanOldImages(config.maxImages);

    // Return access URL
    // @ts-ignore
    const baseUrl = config.imageBaseUrl || `http://${getLocalIp()}:${config.server.port}`;
    return `${baseUrl}/images/${filename}`;
}

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}
