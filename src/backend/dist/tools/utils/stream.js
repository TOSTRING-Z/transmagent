"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamResponse = streamResponse;
exports.streamSse = streamSse;
exports.streamJSON = streamJSON;
async function* toAsyncIterable(nodeReadable) {
    for await (const chunk of nodeReadable) {
        // Buffer 或 string 转换为 Uint8Array
        yield typeof chunk === 'string'
            ? new TextEncoder().encode(chunk)
            : chunk;
    }
}
async function* streamResponse(response) {
    if (response.status !== 200) {
        throw new Error(await response.text());
    }
    if (!response.body) {
        throw new Error("No response body returned.");
    }
    // Get the major version of Node.js
    const nodeMajorVersion = parseInt(process.versions.node.split(".")[0], 10);
    if (nodeMajorVersion >= 20) {
        // Use the new API for Node 20 and above
        const stream = ReadableStream.from(response.body);
        for await (const chunk of stream.pipeThrough(new TextDecoderStream("utf-8"))) {
            yield chunk;
        }
    }
    else {
        // Fallback for Node versions below 20
        // Streaming with this method doesn't work as version 20+ does
        const decoder = new TextDecoder("utf-8");
        const nodeStream = response.body;
        for await (const chunk of toAsyncIterable(nodeStream)) {
            yield decoder.decode(chunk, { stream: true });
        }
    }
}
function parseDataLine(line) {
    const json = line.startsWith("data: ")
        ? line.slice("data: ".length)
        : line.slice("data:".length);
    try {
        const data = JSON.parse(json);
        if (data.error) {
            throw new Error(`Error streaming response: ${data.error}`);
        }
        return data;
    }
    catch (e) {
        throw new Error(`Malformed JSON sent from server: ${json}`);
    }
}
function parseSseLine(line) {
    if (line.startsWith("data: [DONE]")) {
        return { done: true, data: undefined };
    }
    if (line.startsWith("data:")) {
        return { done: false, data: parseDataLine(line) };
    }
    if (line.startsWith(": ping")) {
        return { done: true, data: undefined };
    }
    return { done: false, data: undefined };
}
async function* streamSse(response) {
    let buffer = "";
    for await (const value of streamResponse(response)) {
        buffer += value;
        let position;
        while ((position = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, position);
            buffer = buffer.slice(position + 1);
            const { done, data } = parseSseLine(line);
            if (done) {
                break;
            }
            if (data) {
                yield data;
            }
        }
    }
    if (buffer.length > 0) {
        const { done, data } = parseSseLine(buffer);
        if (!done && data) {
            yield data;
        }
    }
}
async function* streamJSON(response) {
    let buffer = "";
    for await (const value of streamResponse(response)) {
        buffer += value;
        let position;
        while ((position = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, position);
            const data = JSON.parse(line);
            yield data;
            buffer = buffer.slice(position + 1);
        }
    }
}
