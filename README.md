# Reverse Proxy HTTPS

Simple setup https reverse proxy for Node.js with automatic https certificate updating.

# Basic usage

**Run https proxy**

```
node index.js rules.json your@email.com
```

- `rules.json` specifies proxy rules for domains, see [example-rules.json](https://github.com/ViktorQvarfordt/reverse-proxy-https/blob/master/example-rules.json) for example.
- Automatic http -> https redirect server
- Automatic updates of certificates monthly; getting new certs from certbot and restarting server to use new cert files.
- `your@email.com` is needed for certbot. (Only used for certbot, inspect the code if paranoid.)

**Manual get certificates**

```
node index.js rules.json your@email.com update-certs
```
