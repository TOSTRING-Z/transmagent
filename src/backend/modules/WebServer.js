const express = require('express');
const bodyParser = require('body-parser');
const { utils } = require('./globals')
const { EventEmitter } = require('events');

class WebServer extends EventEmitter {
  constructor() {
    super();
    this.app = express();
    this.port = utils.getConfig("webserver")?.port || 3005;

    this.pendingRequests = new Map();

    this.app.use(bodyParser.json());

    this.app.post('/chat/list', async (_req, res) => {
      this.sendProcessingResponse(res, {method: 'list'});
    });

    this.app.post('/chat/checkout', (req, res) => {
      const data = req.body;
      this.sendProcessingResponse(res, {method: 'checkout', data});
    });

    this.app.post('/chat/mode', (req, res) => {
      const data = req.body;
      this.sendProcessingResponse(res, {method: 'mode', data});
    });

    this.app.post('/chat/completions', async (req, res) => {
      const data = req.body;
      this.sendProcessingResponse(res, {method: 'completions', data});
    });
  }

  sendProcessingResponse(res, cdata) {
    // 存储请求
    const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    this.pendingRequests.set(requestId, res);

    // 发出事件，让主进程处理
    this.emit('chatRequest', {
      requestId: requestId,
      cdata: cdata
    });

    // 设置超时
    setTimeout(() => {
      if (this.pendingRequests.has(requestId)) {
        this.pendingRequests.delete(requestId);
        res.status(504).json({ error: 'Request timeout' });
      }
    }, 60 * 60 * 12 * 1000);
  }

  // 处理完成响应的方法
  handleResponse(response) {
    const { requestId, result, error } = response;

    if (this.pendingRequests.has(requestId)) {
      const res = this.pendingRequests.get(requestId);
      this.pendingRequests.delete(requestId);

      if (error) {
        res.status(500).json({
          error: 'Failed to process request',
          message: error.message
        });
      } else {
        res.json(result);
      }
    }
  }

  start() {
    this.server = this.app.listen(this.port, () => {
      console.log(`Web server listening on port ${this.port}`);
    });

    // 在这里设置服务器级别的超时为0（永不超时）
    this.server.timeout = 0;
    this.server.keepAliveTimeout = 0;
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = {
  WebServer
};