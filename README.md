# cors-light

Secure, shared local storage across domains.

[![Build Status](https://travis-ci.org/yarn-co/cors-light.svg?branch=master)](https://travis-ci.org/yarn-co/cors-light)

## Usage

### Client
The client sends requests to a cors-light server to get, set, and unset key-values in the server's store.

```html
<!doctype html>
<html>
  <head>
    <title>Client</title>
    <meta charset="utf-8">
    <script src="client.js"></script>
  </head>
  <body>

    <!-- Should run on leftdomain.com/client.html -->

    <script>

      var client = new CorsLight.Client('http://centraldomain.com/server.html');

      client.get('infos').then(function(result) {
        // result.value contains the value for "infos"
      })
      .catch(function(err) {
        // In case something went wrong
      });

    </script>
  </body>
</html>
```

### Server
The server is responsible for centralized local storage and fielding requests from cors-light clients.  The server is opened in a hidden `<iframe>` by each client.

```html
<!doctype html>
<html>
  <head>
    <title>Server</title>
    <meta charset="utf-8">
    <script src="server.js"></script>
  </head>
  <body>

    <!-- Should run on centraldomain.com/server.html -->

    <script>

      new CorsLight.Server('usage', {
        // The key "infos" is accessible by only clients on leftdomain.com and rightdomain.com
        infos: ['leftdomain.com', 'rightdomain.com']
      });

    </script>
  </body>
</html>
```

## API

### `new CorsLight.Client(uri, [errorHandler])`
Creates a new cors-light client where,
 - `uri` - a URI pointing to a page running a cors-light server.
 - `errorHandler(err)` - an optional callback where errors that are not tied to particular requests will be funneled.

#### `client.get(key, [callback])`
Obtains a cross-domain store where,
 - `key` - the key of the requested store.
 - `callback(err, store)` - an optional callback returning the store for the given `key`.  When not present, `client.get()` will instead return a promise.  If an error occurs, it will be placed in `err`.  The `store` is an object with the following key/values,
  - `value` - the stored value.
  - `expire` - a timestamp indicating when this store is scheduled to expire, `false` if it is not scheduled to expire, or not present when the store is piggy-backing a session.
  - `session` - if this store is using a cookie-bound session for expiration, this will be present with an id for the session.

#### `client.set(key, value, [ttl], [callback])`
Sets a cross-domain store where,
 - `key` - the key of the store being set.
 - `value` - the value to assign to the store.
 - `ttl` - an optional time-to-live for the store, specified in milliseconds.  If set to `'session'`, the store will instead expire with the user's browser session.  If `false` or not specified, the store will not be scheduled to expire.
 - `callback(err)` - an optional callback to indicate success or failure of setting the store.  When not present, `client.set()` will instead return a promise.

#### `client.unset(key, [callback])`
Unsets a cross-domain store where,
 - `key` - the key of the store being unset.
 - `callback(err)` - an optional callback to indicate success or failure of unsetting the store.  When not present, `client.unset()` will instead return a promise.

### `new CorsLight.Server([namespace], manifest)`
Creates a new cors-light server where,
  - `namespace` - an optional string used to namespace storage associated with this server.  Defaults to `'cl'`.
  - `manifest` - an object where each key is a storage key name and each value is a hostname or array of hostnames that can access (set, get, and unset) that key.  For example,

    ```json5
    {
      username: ['trixel.io', 'altered.io']
    }
    ```

# Extras
This project is inspired by (and effectively forked from) the late [XAuth](https://github.com/xauth/xauth), which pioneered the technique used in cors-light to create a client-server model by posting messages between iframes, backed by local storage.  The original technique dates back to 2010.
