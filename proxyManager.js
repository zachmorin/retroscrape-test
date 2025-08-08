const { URL } = require('url');

class ProxyManager {
  constructor() {
    this.proxies = this.parseProxyPool(process.env.PROXY_POOL || '');
    this.roundRobinIndex = 0;
    this.domainStickyMap = new Map(); // domain -> { proxy, expiresAt }
    this.stickyTtlMs = parseInt(process.env.PROXY_STICKY_TTL_MS || '900000', 10); // 15 minutes
    this.rotateOn = (process.env.PROXY_ROTATE_ON || 'error').toLowerCase();
  }

  parseProxyPool(poolStr) {
    return poolStr
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map((raw, idx) => {
        try {
          const u = new URL(raw);
          const server = `${u.protocol}//${u.host}`;
          const username = u.username || undefined;
          const password = u.password || undefined;
          return {
            id: `p${idx + 1}`,
            raw,
            server,
            username,
            password,
            healthy: true,
            lastFailureAt: 0,
            cooldownMs: 60000
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  hasProxies() {
    return this.proxies.length > 0;
  }

  pickNextProxy() {
    if (!this.hasProxies()) return null;
    const start = this.roundRobinIndex;
    let attempts = 0;
    while (attempts < this.proxies.length) {
      const proxy = this.proxies[this.roundRobinIndex];
      this.roundRobinIndex = (this.roundRobinIndex + 1) % this.proxies.length;

      // Basic cooldown check
      if (!proxy.healthy) {
        const since = Date.now() - proxy.lastFailureAt;
        if (since < proxy.cooldownMs) {
          attempts++;
          continue;
        }
        proxy.healthy = true;
      }
      return proxy;
    }
    // fallback to any
    return this.proxies[start];
  }

  getProxyForDomain(domain) {
    if (!this.hasProxies()) return null;
    const sticky = this.domainStickyMap.get(domain);
    if (sticky && sticky.expiresAt > Date.now()) {
      return sticky.proxy;
    }
    const proxy = this.pickNextProxy();
    if (proxy) {
      this.domainStickyMap.set(domain, {
        proxy,
        expiresAt: Date.now() + this.stickyTtlMs
      });
    }
    return proxy;
  }

  rotateProxyForDomain(domain) {
    if (!this.hasProxies()) return null;
    const proxy = this.pickNextProxy();
    if (proxy) {
      this.domainStickyMap.set(domain, {
        proxy,
        expiresAt: Date.now() + this.stickyTtlMs
      });
    }
    return proxy;
  }

  reportSuccess(proxyId) {
    const proxy = this.proxies.find(p => p.id === proxyId);
    if (proxy) {
      proxy.healthy = true;
    }
  }

  reportFailure(proxyId, reason = '') {
    const proxy = this.proxies.find(p => p.id === proxyId);
    if (proxy) {
      proxy.healthy = false;
      proxy.lastFailureAt = Date.now();
      // Extend cooldown for certain errors
      if (/timeout|blocked|429|captcha/i.test(reason)) {
        proxy.cooldownMs = Math.min(proxy.cooldownMs * 2, 5 * 60 * 1000);
      }
    }
  }
}

module.exports = new ProxyManager();


