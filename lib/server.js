/**
 * Copyright 2015 Devin Ivy
 * Copyright 2010 Meebo Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	  http://www.apache.org/licenses/LICENSE-2.0
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

var CorsLight = CorsLight || {};

CorsLight.Server = (function() {

	// Reference shortcut so minifier can save on characters
	var win = window;

	var Container = function(namespace, manifest) {

		// unsupported browser
		if(!win.postMessage || !win.localStorage || !win.JSON) {
			console.error('CorsLight not supported by browser.');
			return;
		}

		// We're the top window, don't do anything
		if(win.top == win) {
			console.error('CorsLight server cannot be in top window.');
			return;
		}

		if (typeof namespace === 'object') {
			manifest = namespace;
			namespace = 'cl';
		}

		manifest = manifest || {};

		var cookie = namespace + '_session';

		// Normalize manifest
		// { keyName: [domain1, domainN] }
		var manifestKey;
		var manifestEntry;
		var manifestKeys = Object.keys(manifest);
		for (var i = 0; i < manifestKeys.length; i++) {

			manifestKey = manifestKeys[i];
			manifestEntry = manifest[manifestKey];

			manifest[manifestKey] = [].concat(manifestEntry);
		}

		// Reference shortcut so minifier can save on characters
		var storage = win.localStorage;

		// To allow for session based CL keys (keys that expire immediately
		// after the browser session ends), we piggy back off of traditional
		// browser cookies. This cookie is set the first time CL is loaded
		// and any session based CL keys will be marked with this unique
		// key. The next time the browser is started, a new unique key is created
		// thereby invalidating any previous session based CL keys
		var currentSession = null;
		var cookieRegex = new RegExp('(?:^|;)\\s*' + cookie + '=(\\d+)(?:;|$)')
		var match = document.cookie.match(cookieRegex);
		if (match && match.length) {
			currentSession = match[1];
		}

		if(!currentSession) {
			currentSession = new Date().getTime();
			document.cookie = (cookie+'=' + currentSession + "; ");
		}

		// Set up the API
		var Api = {
			/**
			 * Request object will look like:
			 * {
			 * 	 cmd:'cl::set',
			 * 	 id: 1,
			 * 	 key: unprefixed local storage key,
			 * 	 value: local storage value,
			 * 	 expire: JS date timestamp number,
			 * 	 session: true or false boolean indicating if this token is browser session based
			 * }
			 */

			'cl::set': function(originHostname, requestObj) {

				if (!validRequest(originHostname, requestObj)) {
					return null;
				}

				var key = requestObj.key;

				// Validate date

				if (requestObj.expire !== false) {

					requestObj.expire = Number(requestObj.expire); // Cast to numeric timestamp
					var dateCheck = new Date(requestObj.expire);

					if(dateCheck < new Date()) { // If you pass garbage into the date, this will be false
						logError(requestObj, 'Invalid expiration', originHostname);
						return null;
					}
				}

				// Deposit box contents
				var store = {
					value: requestObj.value,
					expire: requestObj.expire
				}

				// Check if this is requesting to be a session based store
				if(requestObj.session === true) {
					store.session = currentSession; // We check this on retrieve
				}

				// Save
				storage.setItem(namespace + '::' + key, JSON.stringify(store));

				// Send Response Object
				return {
					cmd: requestObj.cmd,
					id: requestObj.id
				};
			},

			/**
			 * Request object will look like:
			 * {
			 * 	cmd: 'cl::get',
			 * 	id: 1,
			 * 	key: local storage key
			 * }
			 */
			'cl::get': function(originHostname, requestObj) {

				if (!validRequest(originHostname, requestObj)) {
					return null;
				}

				var key = requestObj.key;

				var loaded = storage.getItem(namespace + '::' + key);
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
							storage.removeItem(namespace + '::' + key); // Delete expired keys
						}
					}

					// Check if token is session based and whether or not it was set in
					// the current browser session
					if(store.session && store.session !== currentSession) {
						isExpired = true;
						storage.removeItem(namespace + '::' + key);
					}

				}

				var result = (!isExpired && exists) ? store : null;

				return {
					cmd: requestObj.cmd,
					id: requestObj.id,
					result: result
				};
			},

			'cl::unset': function(originHostname, requestObj) {

				if (!validRequest(originHostname, requestObj)) {
					return null;
				}

				var key = requestObj.key;

				storage.removeItem(key + '::' + namespace);

				return {
					cmd: requestObj.cmd,
					id: requestObj.id
				};
			}
		}

		/**
		 * help with debugging issues
		 */
		function logError(requestObj, message, originHostname) {

			if (!requestObj || (typeof requestObj.id != 'number') ) {
				return;
			}

			if (win.console && win.console.log) {
				win.console.log(requestObj.cmd + ' Error: ' + message);
			}
		}

		// Make sure response message has an id and send it on to parent window
		// origin is the URI of the window we're postMessaging to
		function sendResponse(responseObj, origin) {

			if(!responseObj || (typeof responseObj.id != 'number') ) {
				return;
			}

			win.parent.postMessage(JSON.stringify(responseObj), origin);
		}

		// Listener for window message events, receives messages from parent window
		function onMessage(event) {

			// event.origin will always be of the format scheme://hostname:port
			// http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#dom-messageevent-origin
			var originHostname = parseURI(event.origin).hostname;
			var requestObj = JSON.parse(event.data);

			/**
			 * message generally looks like
			 * {
			 * 	cmd: cl::command_name,
			 * 	id: request_id,
			 * 	other parameters
			 * }
			 */

			if(!requestObj || typeof requestObj != 'object' ||
				 !requestObj.cmd || requestObj.id == undefined) {

				// A post message we don't understand
				return;
			}

			if(Api[requestObj.cmd]) {

				// A command we understand, send the response on back to the posting window
				sendResponse(Api[requestObj.cmd](originHostname, requestObj), event.origin);
			}
		}

		// Utility
		function parseURI(uri) {

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
		}

		function validRequest(originHostname, requestObj) {

			// Validate and clean token
			if(!requestObj.key) {
				logError(requestObj, 'No key requested', originHostname);
				return false;
			}

			var key = requestObj.key;

			// Validate key
			if(!key) {
				logError(requestObj, 'Key not specified', originHostname);
				return false;
			}

			// Validate manifest
			if(!manifest[key]) {
				logError(requestObj, 'Invalid key', originHostname);
				return false;
			}

			// Validate origin
			if(!~manifest[key].indexOf(originHostname)) {
				logError(requestObj, 'Invalid hostname', originHostname);
				return false;
			}

			return true;
		}

		// Setup postMessage event listeners
		if (win.addEventListener) {
			win.addEventListener('message', onMessage, false);
		} else if(win.attachEvent) {
			win.attachEvent('onmessage', onMessage);
		}

		// Finally, tell the parent window we're ready.
		win.parent.postMessage(JSON.stringify({ cmd: 'cl::ready' }), "*");

	}

	return Container;

})();
