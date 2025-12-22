/**
 * Intelligent Memory Manager
 * Uses tiered strategy to dynamically adjust cache and object pools based on memory pressure
 * Thresholds dynamically calculated based on user config memoryThreshold (MB)
 * @module utils/memoryManager
 */

import logger from './logger.js';
import { GC_COOLDOWN } from '../config/constants.js';

/**
 * Memory Pressure Level Enum
 */
export enum MemoryPressure {
  LOW = 'low',       // < 30% Threshold - Normal operation
  MEDIUM = 'medium', // 30%-60% Threshold - Light cleanup
  HIGH = 'high',     // 60%-100% Threshold - Aggressive cleanup
  CRITICAL = 'critical' // > 100% Threshold - Emergency cleanup
}

/**
 * Calculate thresholds based on user config
 * @param thresholdMB - User configured memory threshold (MB), i.e., high pressure threshold
 * @returns Thresholds in bytes for each level
 */
function calculateThresholds(thresholdMB: number) {
  const highBytes = thresholdMB * 1024 * 1024;
  return {
    LOW: Math.floor(highBytes * 0.3),      // 30% is low pressure threshold
    MEDIUM: Math.floor(highBytes * 0.6),   // 60% is medium pressure threshold
    HIGH: highBytes,                        // 100% is high pressure threshold (user config)
    TARGET: Math.floor(highBytes * 0.5)    // 50% is target memory
  };
}

// Default threshold (100MB), overridden by config on init
export let THRESHOLDS = calculateThresholds(100);

// Object pool max size configuration (adjusted by pressure)
const POOL_SIZES = {
  [MemoryPressure.LOW]: { chunk: 30, toolCall: 15, lineBuffer: 5 },
  [MemoryPressure.MEDIUM]: { chunk: 20, toolCall: 10, lineBuffer: 3 },
  [MemoryPressure.HIGH]: { chunk: 10, toolCall: 5, lineBuffer: 2 },
  [MemoryPressure.CRITICAL]: { chunk: 5, toolCall: 3, lineBuffer: 1 }
};

/**
 * MemoryManager Class
 */
class MemoryManager {
  currentPressure: MemoryPressure;
  cleanupCallbacks: Set<(pressure: MemoryPressure) => void>;
  lastGCTime: number;
  gcCooldown: number;
  checkInterval: NodeJS.Timeout | null;
  isShuttingDown: boolean;
  configuredThresholdMB: number;
  stats: {
    gcCount: number;
    cleanupCount: number;
    peakMemory: number;
  };

  constructor() {
    this.currentPressure = MemoryPressure.LOW;
    this.cleanupCallbacks = new Set();
    this.lastGCTime = 0;
    this.gcCooldown = GC_COOLDOWN;
    this.checkInterval = null;
    this.isShuttingDown = false;
    this.configuredThresholdMB = 100;

    // Stats
    this.stats = {
      gcCount: 0,
      cleanupCount: 0,
      peakMemory: 0
    };
  }

  /**
   * Set memory threshold (load from config)
   * @param thresholdMB - Memory threshold (MB)
   */
  setThreshold(thresholdMB: number) {
    if (thresholdMB && thresholdMB > 0) {
      this.configuredThresholdMB = thresholdMB;
      THRESHOLDS = calculateThresholds(thresholdMB);
      logger.info(`Memory threshold set: ${thresholdMB}MB (LOW: ${Math.floor(THRESHOLDS.LOW / 1024 / 1024)}MB, MEDIUM: ${Math.floor(THRESHOLDS.MEDIUM / 1024 / 1024)}MB, HIGH: ${Math.floor(THRESHOLDS.HIGH / 1024 / 1024)}MB)`);
    }
  }

  /**
   * Get current threshold config
   */
  getThresholds() {
    return {
      configuredMB: this.configuredThresholdMB,
      lowMB: Math.floor(THRESHOLDS.LOW / 1024 / 1024),
      mediumMB: Math.floor(THRESHOLDS.MEDIUM / 1024 / 1024),
      highMB: Math.floor(THRESHOLDS.HIGH / 1024 / 1024),
      targetMB: Math.floor(THRESHOLDS.TARGET / 1024 / 1024)
    };
  }

  /**
   * Start memory monitoring
   * @param interval - Check interval (ms)
   */
  start(interval: number = 30000) {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      if (!this.isShuttingDown) {
        this.check();
      }
    }, interval);

    // Initial check immediately
    this.check();
    logger.info(`Memory manager started (Interval: ${interval / 1000}s)`);
  }

  /**
   * Stop memory monitoring
   */
  stop() {
    this.isShuttingDown = true;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.cleanupCallbacks.clear();
    logger.info('Memory manager stopped');
  }

  /**
   * Register cleanup callback
   * @param callback - Cleanup function, receives pressure argument
   */
  registerCleanup(callback: (pressure: MemoryPressure) => void) {
    this.cleanupCallbacks.add(callback);
  }

  /**
   * Unregister cleanup callback
   */
  unregisterCleanup(callback: (pressure: MemoryPressure) => void) {
    this.cleanupCallbacks.delete(callback);
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      external: usage.external,
      heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024 * 10) / 10
    };
  }

  /**
   * Determine pressure level
   */
  getPressureLevel(heapUsed: number): MemoryPressure {
    if (heapUsed < THRESHOLDS.LOW) return MemoryPressure.LOW;
    if (heapUsed < THRESHOLDS.MEDIUM) return MemoryPressure.MEDIUM;
    if (heapUsed < THRESHOLDS.HIGH) return MemoryPressure.HIGH;
    return MemoryPressure.CRITICAL;
  }

  /**
   * Get object pool sizes for current pressure
   */
  getPoolSizes() {
    return POOL_SIZES[this.currentPressure];
  }

  /**
   * Get current pressure level
   */
  getCurrentPressure() {
    return this.currentPressure;
  }

  /**
   * Check memory and trigger cleanup
   */
  check() {
    const { heapUsed, heapUsedMB } = this.getMemoryUsage();
    const newPressure = this.getPressureLevel(heapUsed);

    // Update peak stats
    if (heapUsed > this.stats.peakMemory) {
      this.stats.peakMemory = heapUsed;
    }

    // Log pressure change
    if (newPressure !== this.currentPressure) {
      logger.info(`Memory pressure changed: ${this.currentPressure} -> ${newPressure} (${heapUsedMB}MB)`);
      this.currentPressure = newPressure;
    }

    // Execute strategy based on pressure
    switch (newPressure) {
      case MemoryPressure.CRITICAL:
        this.handleCriticalPressure(heapUsedMB);
        break;
      case MemoryPressure.HIGH:
        this.handleHighPressure(heapUsedMB);
        break;
      case MemoryPressure.MEDIUM:
        this.handleMediumPressure(heapUsedMB);
        break;
      // LOW pressure needs no special handling
    }

    return newPressure;
  }

  /**
   * Handle Medium Pressure
   */
  handleMediumPressure(heapUsedMB: number) {
    // Notify modules to shrink object pools
    this.notifyCleanup(MemoryPressure.MEDIUM);
    this.stats.cleanupCount++;
  }

  /**
   * Handle High Pressure
   */
  handleHighPressure(heapUsedMB: number) {
    logger.info(`Memory high (${heapUsedMB}MB), performing aggressive cleanup`);
    this.notifyCleanup(MemoryPressure.HIGH);
    this.stats.cleanupCount++;

    // Try GC (with cooldown)
    this.tryGC();
  }

  /**
   * Handle Critical Pressure
   */
  handleCriticalPressure(heapUsedMB: number) {
    logger.warn(`Memory critical (${heapUsedMB}MB), performing emergency cleanup`);
    this.notifyCleanup(MemoryPressure.CRITICAL);
    this.stats.cleanupCount++;

    // Force GC (ignore cooldown)
    this.forceGC();
  }

  /**
   * Notify all registered cleanup callbacks
   */
  notifyCleanup(pressure: MemoryPressure) {
    for (const callback of this.cleanupCallbacks) {
      try {
        callback(pressure);
      } catch (error: any) {
        logger.error('Cleanup callback failed:', error.message);
      }
    }
  }

  /**
   * Try to trigger GC (with cooldown)
   */
  tryGC() {
    const now = Date.now();
    if (now - this.lastGCTime < this.gcCooldown) {
      return false;
    }
    return this.forceGC();
  }

  /**
   * Force trigger GC
   */
  forceGC() {
    if (global.gc) {
      const before = this.getMemoryUsage().heapUsedMB;
      global.gc();
      this.lastGCTime = Date.now();
      this.stats.gcCount++;
      const after = this.getMemoryUsage().heapUsedMB;
      logger.info(`GC Complete: ${before}MB -> ${after}MB (Freed ${(before - after).toFixed(1)}MB)`);
      return true;
    }
    return false;
  }

  /**
   * Manually trigger check and cleanup
   */
  cleanup() {
    return this.check();
  }

  /**
   * Get stats
   */
  getStats() {
    const memory = this.getMemoryUsage();
    return {
      ...this.stats,
      currentPressure: this.currentPressure,
      currentHeapMB: memory.heapUsedMB,
      peakMemoryMB: Math.round(this.stats.peakMemory / 1024 / 1024 * 10) / 10,
      poolSizes: this.getPoolSizes(),
      thresholds: this.getThresholds()
    };
  }
}

// Export singleton
const memoryManager = new MemoryManager();
export default memoryManager;

// Unified wrapper for registering cleanup callbacks
export function registerMemoryPoolCleanup(pool: any[], getMaxSize: () => number) {
  memoryManager.registerCleanup(() => {
    const maxSize = getMaxSize();
    while (pool.length > maxSize) {
      pool.pop();
    }
  });
}