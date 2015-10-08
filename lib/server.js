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
 * 2010-04-16
 * Added in checks for disabled and blocked tokens
 * -jianshen
 *
 * 2010-03-26
 * First version of xauth server code
 * -Jian Shen, Meebo
 */

;(function(root) {

  // Reference shortcut so minifier can save on characters
  var win = window;

  var internals = {
    created: false
  };

  var Server = function(namespace, manifest) {

    // Unsupported browser
    this.disabled = !(win.postMessage && win.localStorage && win.JSON);

    // We're the top window, don't do anything
    if (win.top == win) {
      throw new Error('CorsLight server cannot be in top window.');
    }

    // We're the top window, don't do anything
    if (internals.created) {
      throw new Error('Only one CorsLight server is allowed on a page.');
    }

    internals.created = true;

    if (typeof namespace === 'object') {
      manifest = namespace;
      namespace = null;
    }

    this.namespace = namespace || 'cl';
    this.manifest = manifest || {};

    // Normalize manifest
    // { keyName: [domain1, domainN] }

    var manifestKey;
    var manifestEntry;
    var manifestKeys = Object.keys(this.manifest);
    for (var i = 0; i < manifestKeys.length; i++) {

      manifestKey = manifestKeys[i];
      manifestEntry = this.manifest[manifestKey];

      this.manifest[manifestKey] = [].concat(manifestEntry);
    }

    // Strap the API onto this instance

    this.api = {};

    var apiKey;
    var apiKeys = Object.keys(Server.api);
    for (var j = 0; j < apiKeys.length; j++) {

      apiKey = apiKeys[j];
      this.api[apiKey] = Server.api[apiKey].bind(this);
    }

    this.cookie = this.namespace + '_session';

    // Reference shortcut so minifier can save on characters
    this._storage = win.localStorage;

    // Setup postMessage event listeners
    if (win.addEventListener) {
      win.addEventListener('message', this._handleRequest.bind(this), false);
    } else if (win.attachEvent) {
      win.attachEvent('onmessage', this._handleRequest.bind(this));
    }

    // Finally, tell the parent window we're ready.
    this._sendResponse(Server.ready, "*");

  };

  Server.generateApiResponse = function(requestObj) {
    return {
      act: requestObj.act,
      id: requestObj.id
    }
  };

  Server.badAction = function(requestObj) {
    return {
      act: 'cl::badaction',
      id: requestObj.id,
      result: null,
      error: 'Bad action: ' + requestObj.act
    };
  };

  Server.badRequest = {
    act: 'cl::badrequest',
    result: null,
    error: 'Bad request'
  };

  Server.ready = {
    act: 'cl::ready'
  };

  // Methods will need to be bound to a server instance
  Server.api = {
    /**
     * Request object will look like:
     * {
     *    act:'cl::set',
     *    id: 1,
     *    key: unprefixed local storage key,
     *    value: local storage value,
     *    expire: JS date timestamp number,
     *    session: true or false boolean indicating if this token is browser session based
     * }
     */
    set: function(originHostname, requestObj) {

      var response = Server.generateApiResponse(requestObj);

      var error = this._validateRequestKey(originHostname, requestObj);

      if (error) {
        response.error = error;
        return response;
      }

      var key = requestObj.key;

      // Deposit box contents
      var store = {
        value: requestObj.value
      };

      // Setup TTL (milliseconds)

      var ttl = requestObj.ttl;

      if (ttl === 'session') {

        store.session = this._getCurrentSession();

      } else if (typeof ttl === 'number' && ttl >= 0) {

        store.expire = Date.now() + parseInt(ttl);

      } else if (ttl === false) {

        store.expire = false;

      } else {

        response.error = 'Invalid TTL';
        return response;
      }

      // Save
      this._storage.setItem(this._namespacedKey(key), JSON.stringify(store));

      // Send Response Object
      return response;
    },

    /**
     * Request object will look like:
     * {
     *   act: 'cl::get',
     *   id: 1,
     *   key: local storage key
     * }
     */
    get: function(originHostname, requestObj) {

      var response = Server.generateApiResponse(requestObj);

      var error = this._validateRequestKey(originHostname, requestObj);

      if (error) {
        response.error = error;
        return response;
      }

      var key = requestObj.key;

      var loaded = this._storage.getItem(this._namespacedKey(key));
      var store = loaded ? JSON.parse(loaded) : null;

      var isExpired = false;
      var exists = true;

      if (!store) {
        exists = false;
      } else {

        // Check if token is expired

        if (store.expire !== false) {
          var dateCheck = new Date(store.expire);
          if (dateCheck < new Date()) {
            isExpired = true;
            this._storage.removeItem(this._namespacedKey(key)); // Delete expired keys
          }
        }

        // Check if token is session based and whether or not it was set in
        // the current browser session
        if (store.session && store.session !== this._getCurrentSession()) {
          isExpired = true;
          this._storage.removeItem(this._namespacedKey(key));
        }

      }

      response.result = (!isExpired && exists) ? store : null;

      return response;
    },

    unset: function(originHostname, requestObj) {

      var response = Server.generateApiResponse(requestObj);

      var error = this._validateRequestKey(originHostname, requestObj);

      if (error) {
        response.error = error;
        return response;
      }

      var key = requestObj.key;

      this._storage.removeItem(this._namespacedKey(key));

      return response;
    }
  };

  // To allow for session based CL keys (keys that expire immediately
  // after the browser session ends), we piggy back off of traditional
  // browser cookies. This cookie is set the first time CL is loaded
  // and any session based CL keys will be marked with this unique
  // key. The next time the browser is started, a new unique key is created
  // thereby invalidating any previous session based CL keys
  Server.prototype._getCurrentSession = function() {

    var cookieRegex = new RegExp('(?:^|;)\\s*' + this.cookie + '=(\\d+)(?:;|$)')
    var match = document.cookie.match(cookieRegex);

    // Existing
    if (match && match.length) {
      return parseInt(match[1]);
    }

    // Create new
    var newSession = new Date().getTime();
    document.cookie = (this.cookie + '=' + newSession + "; ");
    return newSession;
  };

  Server.prototype._validateRequestKey = function(originHostname, requestObj) {

    var key = requestObj.key;

    // Validate key
    if (!key) {

      return 'Key not specified';
    }

    // Validate manifest
    if (!this.manifest[key]) {

      return 'Invalid key';
    }

    // Validate origin
    if (!~this.manifest[key].indexOf(originHostname)) {

      return 'Invalid origin';
    }

    return null;
  };

  Server.prototype._namespacedKey = function(key) {

    return this.namespace + '::' + key;
  };

  // Make sure response message has an id and send it on to parent window
  // origin is the URI of the window we're postMessaging to
  Server.prototype._sendResponse = function(responseObj, origin) {

    if (typeof responseObj !== 'object' || !origin) {
      throw new Error('Bad arguments');
    }

    win.parent.postMessage(JSON.stringify(responseObj), origin);
  };

  // Listener for window message events, receives messages from parent window
  Server.prototype._handleRequest = function(event) {

    // event.origin will always be of the format scheme://hostname:port
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#dom-messageevent-origin
    var originHostname = internals.parseUri(event.origin).hostname;
    var requestObj = JSON.parse(event.data);

    /**
     * message generally looks like
     * {
     *   act: cl::actionname,
     *   id: request_id,
     *   other parameters
     * }
     */
    if (!requestObj || typeof requestObj !== 'object' ||
       !requestObj.act || typeof requestObj.id === 'undefined') {

      this._sendResponse(Server.badRequest, event.origin);
      return;
    }

    // 'cl::actionname' -> ['cl', 'actionname'] -> 'actionname'
    var action = requestObj.act.split('::');
    action = (action.length === 2 && action[0] === 'cl') ? action[1] : null;

    if (!action || !this.api[action]) {

      this._sendResponse(Server.badAction(requestObj), event.origin);
      return;
    }

    // A action we understand, send the response on back to the posting window
    var response = this.api[action](originHostname, requestObj);

    this._sendResponse(response, event.origin);
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
    module.exports = Server;
  } else if (typeof exports !== 'undefined') {
    exports.CorsLight = exports.CorsLight || {};
    exports.CorsLight.Server = Server;
  } else if (typeof define === 'function' && define.amd) {
    define([], function() {

      return Server;
    });
  } else {
    root.CorsLight = root.CorsLight || {};
    root.CorsLight.Server = Server;
  }

}(this));
