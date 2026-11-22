const { PassThrough } = require("node:stream");
const serverless = require("serverless-http");
const { createRuntimeApp } = require("./runtime");

exports.handler = serverless(createRuntimeApp(), {
  request(req) {
    // Give Express's body parser a readable synthetic socket for Lambda events.
    const { encrypted, remoteAddress, address } = req.socket;
    req.socket = Object.assign(new PassThrough(), {
      encrypted,
      remoteAddress,
      address,
    });
  },
});
