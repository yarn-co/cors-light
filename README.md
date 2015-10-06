# cors-light
Secure, shared local storage across domains.

## API

### `new CorsLight.Client(uri)`
Creates a new cors-light client where,
 - `uri` - a URI pointing to a page running a cors-light server.

#### `client.get(key, callback)`
#### `client.set(key, value, options, callback)`
#### `client.unset(key, callback)`

### `new CorsLight.Server(namespace, manifest)`
Creates a new cors-light server where,
  - `namespace` - an optional string used to namespace storage associated with this server.
  - `manifest` - an object where each key is a storage key name and each value is a hostname or array of hostnames that can access (set, get, and unset) that key.  For example,

    ```json5
    {
      username: ['trixel.io', 'altered.io']
    }
    ```
