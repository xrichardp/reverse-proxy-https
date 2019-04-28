const fs = require('fs')
const http = require('http')
const https = require('https')
const httpProxy = require('http-proxy')
const { exec } = require('child_process')

function parseCommandLineArguments () {
  if (process.argv.length < 3) {
    console.error(`Missing argument: Rules path.`)
    process.exit()
  }
  let rulesPath = process.argv[2]
  if (rulesPath[0] !== '/') {
    rulesPath = `${process.cwd()}/${rulesPath}`
  }
  const rules = require(rulesPath)
  const domains = Object.keys(rules)

  if (process.argv.length < 4) {
    console.error(`Missing argument: email (for certbot).`)
    process.exit()
  }
  const email = process.argv[3]

  let updateCertsManually = false
  if (process.argv.length > 4) {
    if (process.argv[4] !== 'update-certs') {
      console.error(`Bad argument '${process.argv[4]}' should be 'update-certs'`)
      process.exit()
    }
    updateCertsManually = true
  }

  return { rules, domains, email, updateCertsManually }
}

function updateCerts (domains, email, updateCertsManually) {
  console.log(`Updating https certificates for ${domains.join(', ')}.`)
  const cmd = `certbot certonly \
--force-renewal \
--webroot \
-w "${__dirname}/certbot-webroot" \
${domains.map(domain => `-d ${domain}`).join(' ')} \
--config-dir "${__dirname}/certbot-config-dir" \
--work-dir "${__dirname}/certbot-work-dir" \
--logs-dir "${__dirname}/certbot-logs-dir" \
--noninteractive \
--agree-tos \
--email ${email}`
  console.log(cmd)
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error(err)
      process.exit()
    }
    console.log(stdout)
    console.error(stderr)

    if (stdout.indexOf('Certificate not yet due for renewal; no action taken.') !== -1 && updateCertsManually) {
      process.exit()
    }
  })
}

function initProxy () { // This is the proxy; not the server.
  const proxy = httpProxy.createProxyServer({ ws: true })

  proxy.on('error', (err, req, res) => {
    console.error(err)
    res.writeHead && res.writeHead(500, {
      'Content-Type': 'text/plain'
    })
    res.end && res.end('ERROR: Failed to proxy request.')
  })

  return proxy
}

function initHttpsProxyServer (rules) {
  const certBasePath = `${__dirname}/certbot-config-dir/live/`
  const files = fs.readdirSync(certBasePath)
  let file
  if (files.length === 0) {
    console.error(`There are no certs in ${certBasePath}`)
    process.exit()
  }
  file = files[0]
  if (files.length > 1) {
    console.error(`There are more than one cert in ${certBasePath}. Selecting ${file}.`)
  }
  const certPath = `${__dirname}/certbot-config-dir/live/${file}`
  const proxy = initProxy()
  const httpsServer = https.createServer({
    cert: fs.readFileSync(`${certPath}/fullchain.pem`),
    key: fs.readFileSync(`${certPath}/privkey.pem`)
  }, (req, res) => {
    if (req.headers.host in rules) {
      proxy.web(req, res, { target: rules[req.headers.host] })
    } else {
      res.writeHead(500)
      res.end(`ERROR: Unknown domain '${req.headers.host}'`)
    }
  })

  // Enable websocket requests to be proxied
  httpsServer.on('upgrade', function (req, res, head) {
    if (req.headers.host in rules) {
      const target = rules[req.headers.host].match(/(?:http:\/\/)?(.*)/)[1]
      proxy.ws(req, res, head, { target })
    } else {
      console.error(`Bad websocket upgrade. No proxy rule for ${req.headers.host}.`)
      req.status(400).end()
    }
  })

  httpsServer.listen(443, () => console.log('https proxy server live.'))
}

const certbotRequestPath = '/.well-known/acme-challenge'

function initHttpRedirectServer () {
  http.createServer((req, res) => {
    if (req.url.startsWith(certbotRequestPath)) {
      handleCertbotRequest(req, res, () => {
        setTimeout(() => {
          console.log('Certbot did request. Stopping.')
          process.exit()
        }, 1000)
      })
      return
    }
    res.writeHead(301, {
      'Location': `https://${req.headers.host}${req.url}`,
      'Cache-Control': 'max-age=3600'
    })
    res.end()
  }).listen(80, () => console.log('http redirect server is live.'))
}

function initCertbotHttpServer () {
  http.createServer((req, res) => {
    console.log(`HTTP ${req.method} ${req.url}`)
    if (!req.url.startsWith(certbotRequestPath)) {
      throw new Error(`Unexpected request '${req.url}'.`)
    }
    handleCertbotRequest(req, res)
  }).listen(80, () => console.log('temporary http server to handle certbot http challenge is live.'))
}

function handleCertbotRequest (req, res, cb) {
  console.log(`certbot is requesting ${req.url}`)
  const filePath = `${__dirname}/certbot-webroot${req.url}`
  fs.stat(filePath, (err, stat) => {
    if (err) {
      console.log(`failed to read ${filePath}`)
      res.statusCode = 500
      res.end()
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Length': stat.size
    })
    const readStream = fs.createReadStream(filePath)
    readStream.pipe(res)
    readStream.on('end', () => {
      console.log(`delivered file to certbot `)
      cb && cb()
    })
  })
}

function scheduleCertAutoUpdate () {
  const maxTimeout = 2 ** 31 - 1 // Because setInterval is messed up. This is 25 days, ish.
  setInterval(updateCerts, maxTimeout)
}

function main () {
  const { rules, domains, email, updateCertsManually } = parseCommandLineArguments()

  if (updateCertsManually) {
    initCertbotHttpServer()
    updateCerts(domains, email, updateCertsManually)
  } else {
    initHttpsProxyServer(rules)
    initHttpRedirectServer()
    scheduleCertAutoUpdate()
  }
}

main()
