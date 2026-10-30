const dns = require('node:dns');

// In Docker with --network none, DNS lookup to an external host must fail.
dns.lookup('example.com', (err) => {
  if (!err) {
    console.error('Expected DNS lookup to fail in isolated container, but it succeeded.');
    process.exit(1);
  }
  console.log(`Confirmed network isolation: DNS lookup failed with ${err.code || err.message}`);
  process.exit(0);
});
