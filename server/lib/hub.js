// In-process pub/sub hub for broadcasting events to connected WebSocket clients.
// Topics are colon-namespaced strings: "files:<path>", "session:<id>", "system", etc.

const EventEmitter = require('events');

class Hub extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }

  publish(topic, payload) {
    this.emit('msg', { topic, payload, t: Date.now() });
    // Topic-specific channel for fine-grained subscribers
    this.emit(topic, payload);
  }
}

const hub = new Hub();
module.exports = hub;
