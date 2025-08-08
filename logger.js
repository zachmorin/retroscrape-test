const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

// Async request context storage for requestId propagation
const requestContext = new AsyncLocalStorage();

class Logger {
  constructor() {
    this.logDir = path.join(__dirname, 'logs');
    this.retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || '14', 10);
    this.currentDateStr = null;
    this.stream = null;
    this.ensureLogDirectory();

    // Initialize stream and schedule daily cleanup
    this.rotateStreamIfNeeded();
    this.cleanupOldLogs();
    setInterval(() => this.cleanupOldLogs(), 24 * 60 * 60 * 1000);
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getLogFileName(dateStr = null) {
    const ds = dateStr || new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logDir, `scraper-${ds}.log`);
  }

  rotateStreamIfNeeded() {
    const dateStr = new Date().toISOString().split('T')[0];
    if (this.currentDateStr !== dateStr || !this.stream) {
      try {
        if (this.stream) {
          this.stream.end();
        }
      } catch {}
      this.currentDateStr = dateStr;
      const logFile = this.getLogFileName(dateStr);
      this.stream = fs.createWriteStream(logFile, { flags: 'a' });
      this.stream.on('error', (err) => {
        console.error('Logger stream error:', err);
      });
    }
  }

  formatLogEntry(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const memUsage = process.memoryUsage();
    const store = requestContext.getStore();
    const requestId = store && store.requestId ? store.requestId : undefined;
    
    const logEntry = {
      timestamp,
      level,
      message,
      requestId,
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024)
      },
      environment: process.env.NODE_ENV || 'development',
      ...data
    };
    
    return JSON.stringify(logEntry) + '\n';
  }

  writeLog(level, message, data) {
    // Ensure current day's stream is active
    this.rotateStreamIfNeeded();

    // Normalize and redact sensitive data
    let safeData = this.redactSensitiveData(this.normalizeErrors(data || {}));
    if (safeData == null || typeof safeData !== 'object' || Array.isArray(safeData)) {
      safeData = { data: safeData };
    }
    const logEntry = this.formatLogEntry(level, message, safeData);
    
    // Write to file asynchronously
    try {
      if (this.stream && this.stream.writable) {
        this.stream.write(logEntry);
      } else {
        // Fallback to append if stream not ready
        fs.appendFileSync(this.getLogFileName(), logEntry);
      }
    } catch (err) {
      console.error('Failed to write to log file:', err);
      console.error('Attempted to write to:', this.getLogFileName());
      console.error('Log entry was:', logEntry);
    }
    
    // Also log to console in development or for errors
    if (process.env.NODE_ENV !== 'production' || level === 'ERROR') {
      console.log(`[${level}] ${message}`, safeData);
    }
  }

  error(message, data = {}) {
    this.writeLog('ERROR', message, data);
  }

  warn(message, data = {}) {
    this.writeLog('WARN', message, data);
  }

  info(message, data = {}) {
    this.writeLog('INFO', message, data);
  }

  debug(message, data = {}) {
    if (process.env.NODE_ENV !== 'production') {
      this.writeLog('DEBUG', message, data);
    }
  }

  // Special method for scraping errors with full context
  logScrapingError(url, method, error, context = {}) {
    const errorData = {
      url,
      method,
      errorMessage: error.message,
      errorStack: error.stack,
      errorType: error.constructor.name,
      context
    };
    
    this.error(`Scraping failed for ${url}`, errorData);
  }

  // Log browser console messages
  logBrowserConsole(url, messages) {
    if (messages && messages.length > 0) {
      this.info(`Browser console messages for ${url}`, {
        url,
        consoleMessages: messages
      });
    }
  }

  // Log network failures
  logNetworkFailure(url, failedRequests) {
    if (failedRequests && failedRequests.length > 0) {
      this.warn(`Network failures detected for ${url}`, {
        url,
        failedRequests
      });
    }
  }

  // Get recent errors for the log viewer endpoint
  getRecentLogs(limit = 50, level = null) {
    try {
      const logFile = this.getLogFileName();
      if (!fs.existsSync(logFile)) {
        return [];
      }

      // Read only the tail of large files for efficiency
      const stats = fs.statSync(logFile);
      const maxBytes = 5 * 1024 * 1024; // 5MB tail
      let content = '';

      if (stats.size > maxBytes) {
        const fd = fs.openSync(logFile, 'r');
        try {
          const buffer = Buffer.allocUnsafe(maxBytes);
          fs.readSync(fd, buffer, 0, maxBytes, stats.size - maxBytes);
          content = buffer.toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
      } else {
        content = fs.readFileSync(logFile, 'utf8');
      }
      const lines = content.split('\n').filter(line => line.trim());
      
      let logs = lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(log => log !== null);

      // Filter by level if specified
      if (level) {
        logs = logs.filter(log => log.level === level);
      }

      // Return most recent logs
      return logs.slice(-limit).reverse();
    } catch (err) {
      console.error('Error reading logs:', err);
      return [];
    }
  }

  // Middleware to assign and propagate a requestId across async operations
  get requestMiddleware() {
    return (req, res, next) => {
      try {
        const headerId = req.headers['x-request-id'];
        const requestId = typeof headerId === 'string' && headerId.trim() !== ''
          ? headerId
          : (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
        res.setHeader('X-Request-Id', requestId);
        requestContext.run({ requestId }, next);
      } catch (e) {
        next();
      }
    };
  }

  // Remove or mask sensitive data (e.g., tokens, passwords) from logged objects
  redactSensitiveData(value) {
    const sensitiveKeyPattern = /^(authorization|cookie|set-cookie|password|passwd|secret|token|apiKey|apikey|key)$/i;

    const redactInStringUrl = (str) => {
      try {
        if (!/^https?:\/\//i.test(str)) return str;
        const u = new URL(str);
        const keysToRedact = ['token', 'key', 'apiKey', 'apikey', 'password', 'secret'];
        for (const k of keysToRedact) {
          if (u.searchParams.has(k)) {
            u.searchParams.set(k, '[REDACTED]');
          }
        }
        return u.toString();
      } catch {
        return str;
      }
    };

    const recurse = (val) => {
      if (val == null) return val;
      if (typeof val === 'string') return redactInStringUrl(val);
      if (Array.isArray(val)) return val.map(recurse);
      if (val instanceof Error) {
        return { name: val.name, message: val.message, stack: val.stack };
      }
      if (typeof val === 'object') {
        const out = Array.isArray(val) ? [] : {};
        for (const [k, v] of Object.entries(val)) {
          if (sensitiveKeyPattern.test(k)) {
            out[k] = '[REDACTED]';
          } else {
            out[k] = recurse(v);
          }
        }
        return out;
      }
      return val;
    };

    return recurse(value);
  }

  // Normalize Error instances present in the provided data for consistent logging
  normalizeErrors(data) {
    if (!data || typeof data !== 'object') return data;
    const out = { ...data };
    for (const key of ['error', 'err', 'exception']) {
      if (out[key] instanceof Error) {
        out[key] = { name: out[key].name, message: out[key].message, stack: out[key].stack };
      }
    }
    return out;
  }

  // Delete log files older than retentionDays
  cleanupOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir);
      const now = new Date();
      for (const file of files) {
        const match = /^scraper-(\d{4}-\d{2}-\d{2})\.log$/.exec(file);
        if (!match) continue;
        const dateStr = match[1];
        const fileDate = new Date(dateStr + 'T00:00:00Z');
        const ageDays = (now - fileDate) / (24 * 60 * 60 * 1000);
        if (ageDays > this.retentionDays) {
          try {
            fs.unlinkSync(path.join(this.logDir, file));
          } catch {}
        }
      }
    } catch (e) {
      console.error('Failed to cleanup old logs:', e.message);
    }
  }
}

// Export singleton instance
module.exports = new Logger(); 