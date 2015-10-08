/**
 * Copyright 2015 Devin Ivy
 * Copyright 2010 Meebo Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * History
 *
 * 2015-10-02
 * Heavily modified for use in the cors-light project.
 * -devinivy
 *
 * 2010-04-27
 * Overcommenting
 * -jianshen
 *
 * 2010-04-23
 * Removed a ton of extra abstractions
 * -jianshen
 *
 * 2010-03-26
 * First version of xauth client code
 * -Jian Shen, Meebo
 */


;(function(root) {

  // Reference shortcut so minifier can save on characters
  var win = window;

  var internals = {};

  // Constructor
  var Client = function(uri, errorHandler) {

    // Unsupported browser
    this.disabled = !(win.postMessage && win.localStorage && win.JSON);

    this.uri = uri;
    this.origin = internals.parseUri(uri).hostname;

    // A place for strange responses to go
    this.errorHandler = errorHandler || function() {};

    if (this.disabled) {
      this.errorHandler(new Error('CorsLight is disabled due to browser limitations'));
    }

    // Requests are done asynchronously so we add numeric ids to each
    // postMessage request object. References to the request objects
    // are stored in the openRequests object keyed by the request id.
    this.openRequests = {};
    this._requestId = 0;

    // All requests made before the iframe is ready are queued (referenced by
    // request id) in the requestQueue array and then called in order after
    // the iframe has messaged to us that it's ready for communication
    this._requestQueue = [];

    // Cached references
    this._iframe = null;
    this._postWindow = null;
  };

  Client.prototype.set = function(key, value, ttl, callback) {

    var self = this;

    if (typeof ttl === 'function') {
      callback = ttl;
      ttl = undefined;
    }

    ttl = (typeof ttl !== 'undefined') ? ttl : false;

    var requestObj = {
      cmd: 'cl::set',
      key: key,
      value: value,
      ttl: ttl
    };

    if (callback) {
      requestObj.callback = callback;
      return this._queueRequest(requestObj);
    }

    return new Promise(function(resolve, reject) {

      requestObj.promise = {
        resolve: resolve,
        reject: reject
      };

      self._queueRequest(requestObj);
    });
  };

  Client.prototype.get = function (key, callback) {

    var self = this;

    var requestObj = {
      cmd: 'cl::get',
      key: key
    };

    if (callback) {
      requestObj.callback = callback;
      return this._queueRequest(requestObj);
    }

    return new Promise(function(resolve, reject) {

      requestObj.promise = {
        resolve: resolve,
        reject: reject
      };

      self._queueRequest(requestObj);
    });
  };

  Client.prototype.unset = function(key, callback) {

    var self = this;

    var requestObj = {
      cmd: 'cl::unset',
      key: key
    };

    if (callback) {
      requestObj.callback = callback;
      return this._queueRequest(requestObj);
    }

    return new Promise(function(resolve, reject) {

      requestObj.promise = {
        resolve: resolve,
        reject: reject
      };

      self._queueRequest(requestObj);
    });
  };

  // Hoist private methods

  // All requests funnel thru _queueRequest which assigns it a unique
  // request Id and either queues up the request before the iframe
  // is created or makes the actual request
  Client.prototype._queueRequest = function(requestObj) {

    requestObj.id = this._requestId;
    this.openRequests[requestObj.id] = requestObj;

    this._requestId++;

    // If disabled, respond with an internal error
    if (this.disabled) {
      this._inject({
        cmd: 'cl::internal',
        id: requestObj.id,
        error: 'CorsLight is disabled due to browser limitations'
      });
    }

    // If window isn't ready, add it to a queue
    if (!this._iframe || !this._postWindow) {
      this._requestQueue.push(requestObj.id);
      this._setupWindow(); // must happen after we've added to the queue
    } else {
      this._makeRequest(requestObj);
    }
  };

  // Called once on first command to create the iframe to the specified URI
  Client.prototype._setupWindow = function() {

    if (this._iframe || this._postWindow) { return; }

    // Create iframe dom element
    var doc = win.document;
    this._iframe = doc.createElement('iframe');
    this._iframe.setAttribute('tabindex', '-1');

    // No way you're gonna see this iframe
    var iframeStyle = this._iframe.style;
    iframeStyle.display = 'none';
    iframeStyle.position = 'absolute';
    iframeStyle.height = iframeStyle.width = 0;
    iframeStyle.left = iframeStyle.top = '-999px';

    // Setup postMessage event listeners
    if (win.addEventListener) {
      win.addEventListener('message', this._handleResponse.bind(this), false);
    } else if (win.attachEvent) {
      win.attachEvent('onmessage', this._handleResponse.bind(this));
    }

    // Append iframe to the dom and load up the specified URI
    doc.body.appendChild(this._iframe);
    this._iframe.src = this.uri;
  };

  // Simple wrapper for the postMessage command that sends serialized requests
  // to the iframe window
  Client.prototype._makeRequest = function(requestObj) {

    this._postWindow.postMessage(JSON.stringify(requestObj), this.uri);
  };

  // Called immediately after iframe has told us it's ready for communication
  Client.prototype._makePendingRequests = function() {

    var id;
    var request;
    for (var i = 0, il= this._requestQueue.length; i < il; i++) {

      id = this._requestQueue.shift();
      request = this.openRequests[id];

      this._makeRequest(request);
    }
  };

  // Spoof a response, mostly for internal errors to requests
  Client.prototype._inject = function(response) {

    var event = {
      data: JSON.stringify(response),
      origin: this.uri
    };

    this._handleResponse(event);
  };

  // Listener for window message events, receives messages from only
  // the domain that we set up in the iframe
  Client.prototype._handleResponse = function(event) {

    var responseError;

    // Deserialize request message into object
    var response = JSON.parse(event.data);

    // http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#dom-messageevent-origin
    var originHostname = internals.parseUri(event.origin).hostname;
    if (originHostname != this.origin) {

      // Bad domain, this message is not for us
      responseError = new Error('Response from bad origin: ' + originHostname);
      responseError.response = response;

      return this.errorHandler(responseError);
    }

    if (!response || typeof response !== 'object') {

      responseError = new Error('Malformed response');
      responseError.response = response;

      return this.errorHandler(responseError);
    }

    // Check for special iframe ready message and call any pending
    // requests in our queue made before the iframe was created.
    if (response.cmd == 'cl::ready') {

      // Cache the reference to the iframe window object and schedule pending reqs
      this._postWindow = this._iframe.contentWindow;
      setTimeout(this._makePendingRequests.bind(this), 0);

      return;
    }

    // There's not a request id associated with a bad request,
    // otherwise it would have come back cl::badcommand
    if (response.cmd == 'cl::badrequest') {

      responseError = new Error('Bad request');
      responseError.response = response;

      return this.errorHandler(responseError);
    }

    // Now we should be able to associate the
    // response with an originating request
    var request = null;
    if (typeof response.id === 'number') {
      request = this.openRequests[response.id];
    }

    if (!request) {

      responseError = new Error('Unsolicited response');
      responseError.response = response;

      return this.errorHandler(responseError);
    }

    // At this point we know we have the request, so it's no longer open
    delete this.openRequests[response.id];

    // Look up saved request object and send response message to callback

    var error = response.error ? new Error(response.error) : null;

    if (error) {
      error.request = request;
      error.response = response;
    }

    // Handle callback style
    if (request.callback) {
      return request.callback(error, response.result);
    }

    // Handle promise style
    if (request.promise) {

      if (error) {
        return request.promise.reject(error);
      }

      request.promise.resolve(response.result);
    }

  };

  internals.parseUri = function(uri) {

    var parser = document.createElement('a');
    parser.href = uri;

    return {
      protocol: parser.protocol,
      host: parser.host,
      hostname: parser.hostname,
      port: parser.port,
      pathname: parser.pathname,
      search: parser.search,
      hash: parser.hash
    };
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Client;
  } else if (typeof exports !== 'undefined') {
    exports.CorsLight = exports.CorsLight || {};
    exports.CorsLight.Client = Client;
  } else if (typeof define === 'function' && define.amd) {
    define([], function() {

      return Client;
    });
  } else {
    root.CorsLight = root.CorsLight || {};
    root.CorsLight.Client = Client;
  }

}(this));
