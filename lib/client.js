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
 * 2010-04-23
 * Removed a ton of extra abstractions
 * -jianshen
 *
 * 2010-03-26
 * First version of xauth client code
 * -Jian Shen, Meebo
 */

var CorsLight = CorsLight || {};

CorsLight.Client = (function() {

	// Reference shortcut so minifier can save on characters
	var win = window;

	// Constructor
	var Container = function(uri) {

		// Check for browser capabilities
		this.disabled = !(win.postMessage && win.localStorage && win.JSON);

		this.uri = uri;
		this.hostname = parseURI(uri).hostname;

		// Cached references
		this.iframe = null;
		this.postWindow = null;

		// Requests are done asynchronously so we add numeric ids to each
		// postMessage request object. References to the request objects
		// are stored in the openRequests object keyed by the request id.
		this.openRequests = {};
		this.requestId = 0;

		// All requests made before the iframe is ready are queued (referenced by
		// request id) in the requestQueue array and then called in order after
		// the iframe has messaged to us that it's ready for communication
		this.requestQueue = [];

	};

	// Public
	Container.prototype.set = function(key, value, args, callback) {

		if (typeof args === 'function') {
			callback = args;
			args = {};
		}

		args = args || {};

		var requestObj = {
			cmd: 'cl::set',
			key: key,
			value: value,
			expire: args.expire || false,
			session: args.session || false,
			callback: callback
		};

		_queueRequest.call(this, requestObj);
	};

	Container.prototype.get = function (key, callback) {

		var requestObj = {
			cmd: 'cl::get',
			key: key,
			callback: callback
		};

		_queueRequest.call(this, requestObj);
	};

	Container.prototype.unset = function(key, callback) {

		var requestObj = {
			cmd: 'cl::unset',
			key: key,
			callback: callback
		};

		_queueRequest.call(this, requestObj);
	};

	// Hoist private methods

	// All requests funnel thru _queueRequest which assigns it a unique
	// request Id and either queues up the request before the iframe
	// is created or makes the actual request
	function _queueRequest(requestObj) {

		if (this.disabled) { return; }

		requestObj.id = this.requestId;
		this.openRequests[this.requestId++] = requestObj;

		// If window isn't ready, add it to a queue
		if(!this.iframe || !this.postWindow) {
			this.requestQueue.push(requestObj.id);
			_setupWindow.call(this); // must happen after we've added to the queue
		} else {
			_makeRequest.call(this, requestObj);
		}
	}

	// Called once on first command to create the iframe to the specified URI
	function _setupWindow() {

		if(this.iframe || this.postWindow) { return; }

		// Create hidden iframe dom element
		var doc = win.document;
		this.iframe = doc.createElement('iframe');
		this.iframe.setAttribute('tabindex', '-1');
		var iframeStyle = this.iframe.style;
		iframeStyle.position = 'absolute';
		iframeStyle.height = iframeStyle.width = 0;
		iframeStyle.left = iframeStyle.top = '-999px';

		// Setup postMessage event listeners
		if (win.addEventListener) {
			win.addEventListener('message', _onMessage.bind(this), false);
		} else if (win.attachEvent) {
			win.attachEvent('onmessage', _onMessage.bind(this));
		}

		// Append iframe to the dom and load up the specified URI
		doc.body.appendChild(this.iframe);
		this.iframe.src = this.uri;
	}

	// Simple wrapper for the postMessage command that sends serialized requests
	// to the iframe window
	function _makeRequest(requestObj) {

		this.postWindow.postMessage(JSON.stringify(requestObj), this.uri);
	}

	// Called immediately after iframe has told us it's ready for communication
	function _makePendingRequests() {

		for (var i = 0; i < this.requestQueue.length; i++) {
			_makeRequest.call(this, this.openRequests[this.requestQueue.shift()]);
		}
	}

	// Listener for window message events, receives messages from only
	// the domain that we set up in the iframe
	function _onMessage(event) {

		// event.origin will always be of the format scheme://hostname:port
		// http://www.whatwg.org/specs/web-apps/current-work/multipage/comms.html#dom-messageevent-origin
		var originHostname = parseURI(event.origin).hostname;
		if(originHostname != this.hostname) {
			// Bad domain, reject
			return;
		}

		// unfreeze request message into object
		var msg = JSON.parse(event.data);
		if(!msg) {
			return;
		}

		// Check for special iframe ready message and call any pending
		// requests in our queue made before the iframe was created.
		if(msg.cmd == 'cl::ready') {
			// Cache the reference to the iframe window object
			this.postWindow = this.iframe.contentWindow;
			setTimeout(_makePendingRequests.bind(this), 0);
			return;
		}

		// Look up saved request object and send response message to callback
		var request = this.openRequests[msg.id];
		if(request) {
			if(request.callback) {
				request.callback(msg);
			}
			delete this.openRequests[msg.id];
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

	return Container;

})();
