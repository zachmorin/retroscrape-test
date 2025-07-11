const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logDir = path.join(__dirname, 'logs');
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getLogFileName() {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logDir, `scraper-${dateStr}.log`);
  }

  formatLogEntry(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const memUsage = process.memoryUsage();
    
    const logEntry = {
      timestamp,
      level,
      message,
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
    const logFile = this.getLogFileName();
    const logEntry = this.formatLogEntry(level, message, data);
    
    // Write to file
    try {
      fs.appendFileSync(logFile, logEntry);
    } catch (err) {
      console.error('Failed to write to log file:', err);
      console.error('Attempted to write to:', logFile);
      console.error('Log entry was:', logEntry);
    }
    
    // Also log to console in development or for errors
    if (process.env.NODE_ENV !== 'production' || level === 'ERROR') {
      console.log(`[${level}] ${message}`, data);
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

      const content = fs.readFileSync(logFile, 'utf8');
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
}

// Export singleton instance
module.exports = new Logger(); 