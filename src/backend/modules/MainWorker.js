const { parentPort } = require('worker_threads');
const { WebServer } = require('./WebServer');

let webServer = null;

function chatRequest(request) {
    parentPort.postMessage(request);
}

// 监听主线程消息
parentPort.on('message', async (task) => {
    console.log('MainWorker received task:', task);
    const { type, requestId, result } = task;
    if (type === 'start') {
        webServer = new WebServer();
        webServer.start();
        // 监听WebServer的事件
        webServer.on('chatRequest', chatRequest.bind(this));
    } else {
        webServer.handleResponse({ requestId, result });
    }
});
