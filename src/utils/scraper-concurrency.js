import { AppError } from '../errors/app-error.js';
import { ERROR_CODES } from '../errors/error-codes.js';

function parseIntEnv(value, fallback, min, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  const normalized = Math.trunc(parsed);
  if (normalized < min) return fallback;
  if (normalized > max) return max;
  return normalized;
}

class ScraperConcurrencyLimiter {
  constructor({ maxConcurrency, maxQueue, queueTimeoutMs }) {
    this.maxConcurrency = maxConcurrency;
    this.maxQueue = maxQueue;
    this.queueTimeoutMs = queueTimeoutMs;
    this.activeCount = 0;
    this.pendingQueue = [];
  }

  getStats() {
    return {
      maxConcurrency: this.maxConcurrency,
      maxQueue: this.maxQueue,
      queueTimeoutMs: this.queueTimeoutMs,
      activeCount: this.activeCount,
      queuedCount: this.pendingQueue.length,
    };
  }

  run(taskFn, taskName = 'scraper_task') {
    return new Promise((resolve, reject) => {
      const queuedAt = Date.now();

      const job = {
        run: taskFn,
        resolve,
        reject,
        taskName,
        queuedAt,
        timeoutId: null,
      };

      if (this.activeCount < this.maxConcurrency) {
        this.#startJob(job);
        return;
      }

      if (this.pendingQueue.length >= this.maxQueue) {
        reject(
          new AppError(
            'Scraper queue is full. Try again later.',
            429,
            ERROR_CODES.SCRAPER_QUEUE_FULL,
            {
              taskName,
              ...this.getStats(),
            }
          )
        );
        return;
      }

      if (this.queueTimeoutMs > 0) {
        job.timeoutId = setTimeout(() => {
          const index = this.pendingQueue.indexOf(job);
          if (index !== -1) {
            this.pendingQueue.splice(index, 1);
            job.reject(
              new AppError(
                'Scraper queue wait timeout exceeded.',
                429,
                ERROR_CODES.SCRAPER_QUEUE_TIMEOUT,
                {
                  taskName,
                  waitMs: Date.now() - queuedAt,
                  ...this.getStats(),
                }
              )
            );
          }
        }, this.queueTimeoutMs);
      }

      this.pendingQueue.push(job);
    });
  }

  #startJob(job) {
    if (job.timeoutId) {
      clearTimeout(job.timeoutId);
      job.timeoutId = null;
    }

    this.activeCount += 1;

    Promise.resolve()
      .then(() => job.run())
      .then((result) => {
        this.#completeJob();
        job.resolve(result);
      })
      .catch((error) => {
        this.#completeJob();
        job.reject(error);
      });
  }

  #completeJob() {
    this.activeCount -= 1;
    this.#drainQueue();
  }

  #drainQueue() {
    while (this.activeCount < this.maxConcurrency && this.pendingQueue.length > 0) {
      const nextJob = this.pendingQueue.shift();
      this.#startJob(nextJob);
    }
  }
}

const scraperLimiter = new ScraperConcurrencyLimiter({
  maxConcurrency: parseIntEnv(process.env.SCRAPER_MAX_CONCURRENCY, 2, 1, 20),
  maxQueue: parseIntEnv(process.env.SCRAPER_MAX_QUEUE, 12, 0, 500),
  queueTimeoutMs: parseIntEnv(process.env.SCRAPER_QUEUE_TIMEOUT_MS, 15000, 0, 300000),
});

export function runWithScraperLimiter(taskFn, taskName) {
  return scraperLimiter.run(taskFn, taskName);
}

export function getScraperLimiterStats() {
  return scraperLimiter.getStats();
}
