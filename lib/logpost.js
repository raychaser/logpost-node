'use strict';

// Requirements.
var zlib = require('zlib');
var http = require('https');
var HttpsAgent = require('agentkeepalive').HttpsAgent;

// Logpost object.
function Logpost(options) {

  // Apply options.
  this.logger = options.logger;
  this.host = options.host;
  this.path = options.path;
  this.gzip = options.gzip || false;
  this.cookies = options.cookies || false;
  this.maxMessages = options.maxMessages || 10;
  this.timeoutMillis = options.timeoutMillis || 1000;
  this.maxSockets = options.maxSockets || 32;
  this.debug('host: ' + this.host +
    ', path: ' + this.path +
    ', gzip: ' + this.gzip +
    ', cookies: ' + this.cookies +
    ', maxMessages: ' + this.maxMessages +
    ', timeoutMillis: ' + this.timeoutMillis);

  // Various helper members.
  this.buffer = [];
  this.requestCounter = 1;
  this.messageCounter = 0;
  this.statusCodeCounter = {};
  this.cookieString = '';

  // The crucial http agent to support keep alive.
  this.agent = new HttpsAgent({
    keepAlive: true,
    maxSockets: this.maxSockets,
    maxFreeSockets: 8,
    timeout: 10000,
    keepAliveTimeout: 5000
  });

  // This gets the timeout interval going.
  this.resetTimeout();
}

Logpost.prototype.message = function (message) {

  // Add the message to the buffer and flush if the buffer is full.
  this.buffer.push(message);
  if (this.buffer.length >= this.maxMessages) {
    this.debug("buffer full");
    this.flush();
  }
};

Logpost.prototype.messageCount = function () {
  return this.messageCounter;
};

Logpost.prototype.statusCodes = function () {
  return this.statusCodeCounter;
};

Logpost.prototype.shutdown = function (flush) {

  // Flush if requested.
  if (flush) {
    this.flush();
  }

  // Cancel the timeout interval.
  this.cancelTimeout();
};

// Private

Logpost.prototype.debug = function (s) {
  if (this.logger) {
    this.logger.debug("logpost: " + s);
  }
};

Logpost.prototype.error = function (s) {
  if (this.logger) {
    this.logger.error("logpost: " + s);
  } else {
    console.error("logpost: " + s);
  }
};

Logpost.prototype.resetTimeout = function () {

  // Setup the timeout interval, and flush on each timeout.
  var self = this;
  this.timeoutFun = setTimeout(function () {
    self.flush();
  }, this.timeoutMillis);
};

Logpost.prototype.cancelTimeout = function () {
  clearTimeout(this.timeoutFun);
};

Logpost.prototype.flush = function () {

  // No timeouts while we flush.
  this.cancelTimeout();

  // Only flush if we actually have any messages.
  if (this.buffer.length > 0) {

    // Glue the messages together separated by newlines.
    this.debug("logpost: flushing " + this.buffer.length + " messages");
    var data = "";
    var bufferLength = this.buffer.length;
    for (var i = 0; i < bufferLength; i++) {
      data += this.buffer[i] + "\n";
    }
    this.messageCounter += bufferLength;
    this.buffer = [];

    if (this.gzip) {

      // Compress the glued together messages.
      var self = this;
      var buf = new Buffer(data, 'utf-8');
      zlib.gzip(buf, function (error, result) {

        // Errors?
        if (!error) {

          // Post the compressed messages.
          self.post(result);

        } else {

          // TODO @raychaser Now what??
          self.error("Error during gzip");
          self.error(error);
        }
      });
    } else {

      // Post the glued together messages.
      this.post(data);
    }

  }
  this.resetTimeout();
};

Logpost.prototype.post = function (data) {
  var self = this;
  var requestCounter = this.requestCounter;

  var queuedTimestamp = Date.now();
  var startedTimestamp;

  var options = {
    host: this.host,
    path: this.path,
    method: 'POST',
    agent: this.agent,
    headers: {
      'Content-Length': data.length,
      'Connection': 'keep-alive'
    }
  };
  if (this.gzip) {
    options.headers['Content-Encoding'] = 'gzip';
  }
  if (this.cookies && this.cookieString !== '') {
    options.headers.Cookie = this.cookieString;
  }

  this.requestCounter += 1;
  this.debug(
    'logpost: (' + requestCounter + ') sending bytes: ' + data.length);

  var req = http.request(options, function (response) {
    var chunks = [];
    response.on('data', function (chunk) {
      chunks += chunk;
    });
    response.on('end', function () {

      var queuedElapsed = Date.now() - queuedTimestamp;
      var startedElapsed = Date.now() - startedTimestamp;

      var statusCode = response.statusCode;
      var counter = self.statusCodeCounter[statusCode];
      if (!counter) {
        counter = 0;
      }
      counter += 1;
      self.statusCodeCounter[statusCode] = counter;

      // Check whether we need to update cookies.
      var cookieString = '';
      var cookies = response.headers['set-cookie'];
      if (self.cookies) {
        if (cookies !== undefined) {
          for (var i = 0; i < cookies.length; i++) {
            cookieString += cookies[i] + "; ";
          }
          self.cookieString = cookieString;
        }
      }

      // Debug message and done.
      var statusMessage =
        (response.statusMessage) ? ' (' + response.statusMessage + ')' : '';
      self.debug(
        'logpost: (' + requestCounter + ') done, queued ms: ' + queuedElapsed +
        ' exec ms: ' + startedElapsed + ', status: ' + statusCode +
        statusMessage);
    });
  });

  req.on('error', function (error) {

    // TODO @raychaser What now?
    self.error("Error during request");
    self.error(error);
  });

  req.on('socket', function (socket) {
    startedTimestamp = Date.now();
  });

  // Write the data and end the request.
  req.write(data);
  req.end();
};

exports.new = function (options) {
  return new Logpost(options);
};