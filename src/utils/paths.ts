/**
 * Paths utility module
 * Unified path retrieval for pkg environment and development environment
 * @module utils/paths
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Detect if running in pkg environment
 */
export const isPkg: boolean = (process as any).pkg !== undefined;

/**
 * Get project root directory
 */
export function getProjectRoot(): string {
    if (isPkg) {
        return path.dirname(process.execPath);
    }
    return path.join(__dirname, '../..');
}

/**
 * Get data directory path
 * In pkg environment, use directory containing executable or current directory
 */
export function getDataDir(): string {
    if (isPkg) {
        // pkg environment: prioritize data directory next to executable
        const exeDir = path.dirname(process.execPath);
        const exeDataDir = path.join(exeDir, 'data');
        // Check if file can be created in that directory
        try {
            if (!fs.existsSync(exeDataDir)) {
                fs.mkdirSync(exeDataDir, { recursive: true });
            }
            return exeDataDir;
        } catch (e) {
            // If cannot create, try current directory
            const cwdDataDir = path.join(process.cwd(), 'data');
            try {
                if (!fs.existsSync(cwdDataDir)) {
                    fs.mkdirSync(cwdDataDir, { recursive: true });
                }
                return cwdDataDir;
            } catch (e2) {
                // Finally use user home directory
                const homeDataDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.antigravity', 'data');
                if (!fs.existsSync(homeDataDir)) {
                    fs.mkdirSync(homeDataDir, { recursive: true });
                }
                return homeDataDir;
            }
        }
    }
    // Development environment
    return path.join(__dirname, '..', '..', 'data');
}

/**
 * Get public static file directory
 */
export function getPublicDir(): string {
    if (isPkg) {
        // pkg environment: prioritize public directory next to executable
        const exeDir = path.dirname(process.execPath);
        const exePublicDir = path.join(exeDir, 'public');
        if (fs.existsSync(exePublicDir)) {
            return exePublicDir;
        }
        // Next, public directory in current directory
        const cwdPublicDir = path.join(process.cwd(), 'public');
        if (fs.existsSync(cwdPublicDir)) {
            return cwdPublicDir;
        }
        // Finally, public directory inside package (via snapshot)
        return path.join(__dirname, '../../public');
    }
    // Development environment
    return path.join(__dirname, '../../public');
}

/**
 * Get image storage directory
 */
export function getImageDir(): string {
    if (isPkg) {
        // pkg environment: prioritize public/images directory next to executable
        const exeDir = path.dirname(process.execPath);
        const exeImageDir = path.join(exeDir, 'public', 'images');
        try {
            if (!fs.existsSync(exeImageDir)) {
                fs.mkdirSync(exeImageDir, { recursive: true });
            }
            return exeImageDir;
        } catch (e) {
            // If cannot create, try current directory
            const cwdImageDir = path.join(process.cwd(), 'public', 'images');
            try {
                if (!fs.existsSync(cwdImageDir)) {
                    fs.mkdirSync(cwdImageDir, { recursive: true });
                }
                return cwdImageDir;
            } catch (e2) {
                // Finally use user home directory
                const homeImageDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.antigravity', 'images');
                if (!fs.existsSync(homeImageDir)) {
                    fs.mkdirSync(homeImageDir, { recursive: true });
                }
                return homeImageDir;
            }
        }
    }
    // Development environment
    return path.join(__dirname, '../../public/images');
}

/**
 * Get .env file path
 */
export function getEnvPath(): string {
    if (isPkg) {
        // pkg environment: prioritize .env next to executable
        const exeDir = path.dirname(process.execPath);
        const exeEnvPath = path.join(exeDir, '.env');
        if (fs.existsSync(exeEnvPath)) {
            return exeEnvPath;
        }
        // Next, .env in current directory
        const cwdEnvPath = path.join(process.cwd(), '.env');
        if (fs.existsSync(cwdEnvPath)) {
            return cwdEnvPath;
        }
        // Return executable directory path (even if not exists)
        return exeEnvPath;
    }
    // Development environment
    return path.join(__dirname, '../../.env');
}

/**
 * Get collection of configuration file paths
 */
export function getConfigPaths(): { envPath: string; configJsonPath: string; examplePath: string } {
    if (isPkg) {
        // pkg environment: prioritize config file next to executable
        const exeDir = path.dirname(process.execPath);
        const cwdDir = process.cwd();

        // Search for .env file
        let envPath = path.join(exeDir, '.env');
        if (!fs.existsSync(envPath)) {
            const cwdEnvPath = path.join(cwdDir, '.env');
            if (fs.existsSync(cwdEnvPath)) {
                envPath = cwdEnvPath;
            }
        }

        // Search for config.json file
        let configJsonPath = path.join(exeDir, 'config.json');
        if (!fs.existsSync(configJsonPath)) {
            const cwdConfigPath = path.join(cwdDir, 'config.json');
            if (fs.existsSync(cwdConfigPath)) {
                configJsonPath = cwdConfigPath;
            }
        }

        // Search for .env.example file
        let examplePath = path.join(exeDir, '.env.example');
        if (!fs.existsSync(examplePath)) {
            const cwdExamplePath = path.join(cwdDir, '.env.example');
            if (fs.existsSync(cwdExamplePath)) {
                examplePath = cwdExamplePath;
            }
        }

        return { envPath, configJsonPath, examplePath };
    }

    // Development environment
    return {
        envPath: path.join(__dirname, '../../.env'),
        configJsonPath: path.join(__dirname, '../../config.json'),
        examplePath: path.join(__dirname, '../../.env.example')
    };
}

/**
 * Calculate relative path for log display
 */
export function getRelativePath(absolutePath: string): string {
    if (isPkg) {
        const exeDir = path.dirname(process.execPath);
        if (absolutePath.startsWith(exeDir)) {
            return '.' + absolutePath.slice(exeDir.length).replace(/\\/g, '/');
        }
        const cwdDir = process.cwd();
        if (absolutePath.startsWith(cwdDir)) {
            return '.' + absolutePath.slice(cwdDir.length).replace(/\\/g, '/');
        }
    }
    return absolutePath;
}
