import connectionManager from './connectionManager.js';
export { ServerService } from './serverConnection.js';

const nullTarget = {
  ws: null,
  clientId: null,
  userId: null,
  permissions: new Set(),
  serverName: null,
  maxFileSize: null,
  tempChannelDeleteDelay: 180,
  address: null,
  connected: false,
  hasPermission() { return false; },
  request() { return Promise.reject(new Error('Not connected')); },
  send() {},
  connect() { return Promise.reject(new Error('Use connectionManager.connect()')); },
  disconnect() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

/**
 * Proxy that delegates all property access and method calls to the currently
 * active connection via connectionManager. Event listeners are tracked as
 * proxy listeners and automatically rebound when the viewed server changes.
 */
const serverService = new Proxy(nullTarget, {
  get(_target, prop, _receiver) {
    if (prop === 'addEventListener') {
      return (type, listener, options) => {
        connectionManager.addProxyListener(type, listener, options);
      };
    }
    if (prop === 'removeEventListener') {
      return (type, listener, options) => {
        connectionManager.removeProxyListener(type, listener, options);
      };
    }

    const conn = connectionManager.getActive();
    if (!conn) {
      const val = nullTarget[prop];
      if (typeof val === 'function') return val.bind(nullTarget);
      return val;
    }

    const val = conn[prop];
    if (typeof val === 'function') return val.bind(conn);
    return val;
  },

  set(_target, prop, value) {
    const conn = connectionManager.getActive();
    if (conn) {
      conn[prop] = value;
    }
    return true;
  },
});

export default serverService;
