'use strict';

// Requirements.
var docopt = require("docopt");
var log4js = require('log4js');
var logpost = require('./../lib/logpost.js');

// Get commandline arguments.
var doc = 'Usage: ' +
  'sumo-logpost <token> [--debug] [--skip-cert-validation] ' +
  'sumo-logpost -h | --help | --version';
var options = docopt.docopt(doc, {
  argv: process.argv.slice(2),
  help: true,
  version: "0.0.0"
});
var token = options['<token>'];

// Drop cert validation if requested.
var nonStrict = options['--skip-cert-validation'];
if (nonStrict) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// Setup logging.
var logger = log4js.getLogger();
var log_level = (options['--debug'] === true) ? "DEBUG" : "INFO";
logger.setLevel(log_level);
logger.debug("Debug logging enabled");

// Helper functions.
function makeGuid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }

  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}

// Create test messages.
var host = 'collectors.sumologic.com';
var path = '/receiver/v1/http/' + token;
var log = logpost.new({
  logger: logger,
  host: host,
  path: path,
  gzip: true,
  cookies: false,
  maxMessages: 1000,
  timeoutMillis: 1000
});

// Make a unique ID so we can query for messages in this run.
var guid = makeGuid();

// Create 320 bytes of padding to get message in the standard length.
var padding = "123456789 ";
for (var i = 0; i < 5; i++) {
  padding += padding;
}

// Create messages on an interval.
var counter = 1;
var interval = setInterval(function () {
  for (var i = 0; i < 50; i++) {
    log.message(
      new Date().toISOString() + " " + guid + " " + padding + counter);
    counter += 1;
  }
}, 0);

// After 10 seconds, initiate shutdown.
setTimeout(function () {
  clearInterval(interval);
  log.shutdown(true);
  logger.debug(
    "DONE with " + (counter - 1) + " messages, " +
    log.messageCount() + " messages sent, token: " + guid);
  logger.debug(
    "DONE with status code counts: " + JSON.stringify(log.statusCodes()));
}, 1000 * 60 * 10);