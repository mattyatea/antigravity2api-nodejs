export const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

type LogLevel = 'info' | 'warn' | 'error';

function logMessage(level: LogLevel, ...args: any[]) {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  const color = { info: colors.green, warn: colors.yellow, error: colors.red }[level];
  console.log(`${colors.gray}${timestamp}${colors.reset} ${color}[${level}]${colors.reset}`, ...args);
}

function logRequest(method: string, path: string, status: number, duration: number) {
  const statusColor = status >= 500 ? colors.red : status >= 400 ? colors.yellow : colors.green;
  console.log(`${colors.cyan}[${method}]${colors.reset} - ${path} ${statusColor}${status}${colors.reset} ${colors.gray}${duration}ms${colors.reset}`);
}

export const log = {
  info: (...args: any[]) => logMessage('info', ...args),
  warn: (...args: any[]) => logMessage('warn', ...args),
  error: (...args: any[]) => logMessage('error', ...args),
  request: logRequest
};

export default log;
