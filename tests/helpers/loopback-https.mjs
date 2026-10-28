// TEST-ONLY self-signed localhost key, inlined since .gitignore drops .pem. Never reuse.
import https from "node:https";
import net from "node:net";
import { makeConfig } from "./harness.mjs";

export const TEST_CERT = [
  "-----BEGIN CERTIFICATE-----",
  "MIIDJzCCAg+gAwIBAgIUA2TbBOBcNq/MU5KfhfJD8kdvHkQwDQYJKoZIhvcNAQEL",
  "BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAxNTExNDkxOVoYDzIxMjYw",
  "OTIxMTE0OTE5WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB",
  "AQUAA4IBDwAwggEKAoIBAQDDgAFqAJGghMFK4Vo4MFdK2ye9/bOOywlvPNcQkob1",
  "ot3HPgil6W3a40c18S9nRh27Cio6Y3BmBBnGH5BFfKKVNh8ekfi8AmbT3XYQBUPZ",
  "Ds9YKxuLpviX2CkydhjB1J7GIsavfZlCkx1O46Ru7kLb45W7ANeHtjEK26InKjBT",
  "rs89qo98+cAJdPaWYw2PPQe4w/EztwpiAvEAVZBzEdWpLeeB5w6HhCn87Pu8z4Wr",
  "MIJU5lstf9XwsBULt6Wm7Kx1M++k9qSMSNY4A/WY3wdxHDGQPMZsrQFCAvs7Y0En",
  "GhBThX6gWT9pCCXp4tFvmmRPtJqNosN1VZYAArP5yOkjAgMBAAGjbzBtMB0GA1Ud",
  "DgQWBBQnO1QVLQuKGzEPXeT/jNeVaVLDyDAfBgNVHSMEGDAWgBQnO1QVLQuKGzEP",
  "XeT/jNeVaVLDyDAPBgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGHBH8AAAGCCWxv",
  "Y2FsaG9zdDANBgkqhkiG9w0BAQsFAAOCAQEAsq4IRkdygkWCrgLZ/aZRDSRq5kg8",
  "ejXlY5fBsDUETGKukH/5/50rspYswxsH5hW/fI8x3o1qv6ICnMlSyPKZ7aILHXmX",
  "AZPFMw13QX/r3RrDlDHCva0MzEEgGBhG/UX+4x8BiCwwUnPhCjWEOlUiBY1cUDMi",
  "pK9FBOybbsJkBzdzhkrj89o4KJfpuMo2k/FFa2WQgNFu2yQ72NK36JcSIoLoWbG0",
  "G+eoiIDYTs8VIJqibji4QAFmE2QHnJxNXRXsb1jdYeWnUE4SiwiqxI+bZhM7pn/P",
  "Aj16kmVZt2J3fpu88GbLFf6m1iKsIqeDg5VWrCNQhSlKfDZ6I1FrfpDp4g==",
  "-----END CERTIFICATE-----",
].join("\n");
export const TEST_KEY = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDDgAFqAJGghMFK",
  "4Vo4MFdK2ye9/bOOywlvPNcQkob1ot3HPgil6W3a40c18S9nRh27Cio6Y3BmBBnG",
  "H5BFfKKVNh8ekfi8AmbT3XYQBUPZDs9YKxuLpviX2CkydhjB1J7GIsavfZlCkx1O",
  "46Ru7kLb45W7ANeHtjEK26InKjBTrs89qo98+cAJdPaWYw2PPQe4w/EztwpiAvEA",
  "VZBzEdWpLeeB5w6HhCn87Pu8z4WrMIJU5lstf9XwsBULt6Wm7Kx1M++k9qSMSNY4",
  "A/WY3wdxHDGQPMZsrQFCAvs7Y0EnGhBThX6gWT9pCCXp4tFvmmRPtJqNosN1VZYA",
  "ArP5yOkjAgMBAAECggEAT3tY19RgYH7oqP1itSpuKvhbuYIOQNUqQkfddhbkeLRc",
  "71a4pF95cr7pYjRq3dVjW/o/fdqUxV0Qb3zApoeMABbvYvncwu9FCAjnKY9CbNp5",
  "EPMBsW7SbcWLxkC+QvujC5Hy7kElkKwIA91IKnOCyixGYS9v8PRxDuWJkNu1pyda",
  "QDdyPLZanPDoybYOogJ7XjmVVnPNS3ZNZgr9XmSvT2/aqRSaahE/smrKrcUaOggd",
  "4ntkScSYxAPAmR9WJWIl+OWOhDyyho+wEDkeNdEkPs/L6DDUggK2A652dvkTG6ca",
  "WUYBNLBxjlCFQGEWwCVpDMxdtQWDPuBKRCUTj97H8QKBgQDumq3zkxLkW+KfgPvL",
  "CPI7t9awEZDUVNURPXSTyFf3lT5NcCsyWgN9bmvHFCtvd6OSRHVuMSwUvyt+DdSP",
  "PifF4jV5xvVBvkCZa0rjSvZNlz3TudcU3kYd6S2rxoKg1d/RI5IEDJBiHVgW8hKW",
  "hfMpRANU2r26esEMVmIoGxDjUwKBgQDRwNPHxI85sHfeMxa2elktKZLme1CZZUEy",
  "cvXwI6MiDtoLnflp50zhMUJiCWQEEd8J7sqSCPBSP7pcHX4/x3U0LW63VoffCJm0",
  "vepQJZJF0Nsd8I/z0IC0Wb8IaTGaAK6HCD9bq9xdxWuROrD6mXG4zXeXNZDj+/4E",
  "hUMtw9x48QKBgQC8AUclUHKnWrtDgQdlYMQ1R9Ky4vRiSgGk1u6fb1HY9FCmBccT",
  "opdzYukrcPoUl4lcO/Lng3k/U656YX1l7My8AFSwgpNHXRhbio30cGGIm64MwTb2",
  "63kGInBpFD5jaoIzsTphVGED3ilF0zHQRvVlQ4D4gG7Um9q21O38ue7hnwKBgQC8",
  "FEiSD0lSNE83ed363/hIi8fCTX63HVj5sKWgn4PuzRxtYEi90n5YSsA4gi0hjRjO",
  "okUX71X2mlgzsup6rBIHKFnnoXqR3fddXxHUrevcGGvyC7w4ppRRo0utcg3dBpF4",
  "WUfenlsp5hUPE26QNrkHOY3rk0eJdnKOgSP8zGxMMQKBgQC5zD4ro6xthj3ZEvCW",
  "7iqK7OQCjZiQZQh8QMS7WNnXlccmQE2fQ3vJmNmQGRI7yfnscg5Zqr65pH7XhvVN",
  "dQ0RCKJ3kNIC0c9W4quanDxmKODw3uhAMXNBCUaVqkQ10P25aksYwBja39pHg6uP",
  "corNmEx9WHPnJzPiBtybRkW3PQ==",
  "-----END PRIVATE KEY-----",
].join("\n");

export async function startLoopbackHttps(handler) {
  const requests = [];
  const server = https.createServer({ cert: TEST_CERT, key: TEST_KEY }, (req, res) => {
    const r = { method: req.method, path: req.url, headers: req.headers };
    requests.push(r);
    req.resume();
    req.on("end", () => {
      const { status = 200, body, headers = {} } = handler(r) ?? {};
      const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(text);
    });
  });
  return listen(server, { requests });
}

export async function startDroppingServer() {
  const server = net.createServer((socket) => socket.destroy());
  return listen(server, {});
}

async function listen(server, extra) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    ...extra,
    port: server.address().port,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// `rootCaOnly` mimics QSEOW_ROOT_CERT_PATH alone: cfg.ca set, no client cert.
export function loopbackConfig(port, opts = {}) {
  const cfg = makeConfig({ groups: ["admin"], allowMutations: true, ...opts });
  return {
    ...cfg,
    host: "127.0.0.1",
    enginePort: port,
    proxyPort: port,
    qpsPort: port,
    tlsVerify: true,
    cert: opts.rootCaOnly ? undefined : { cert: Buffer.from(TEST_CERT), key: Buffer.from(TEST_KEY), ca: Buffer.from(TEST_CERT) },
    ...(opts.rootCaOnly ? { ca: Buffer.from(TEST_CERT) } : {}),
  };
}
