/**
 * Vitest setup-bestand dat uitgaand netwerkverkeer naar niet-localhost-adressen
 * blokkeert in e2e-tests. Voorkomt dat een externe dienst (of een DNS-blip) de
 * gate rood kleurt terwijl de eigen code niets mankeert.
 *
 * Toegestaan: 127.0.0.1, localhost, ::1
 * Al het andere gooit een TypeError met het geblokkeerde adres in het bericht.
 *
 * Apps die de guard niet willen, geven eigen setupFiles mee aan e2eTestConfig();
 * de spread in de preset vervangt dan de guard.
 */

/* global URL */

import http from 'node:http';
import https from 'node:https';

const LOCALHOST = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Bepaal of een URL of hostname naar localhost wijst.
 * @param {string | URL} doel
 * @returns {boolean}
 */
function isLocalhost(doel) {
  try {
    const url = doel instanceof URL ? doel : new URL(doel);
    return LOCALHOST.has(url.hostname);
  } catch {
    // Geen geldige URL — behandel als kale hostname (voor http.request(host, ...))
    return LOCALHOST.has(doel);
  }
}

// -- fetch ------------------------------------------------------------------

const originalFetch = globalThis.fetch;

globalThis.fetch = function fetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (!isLocalhost(url)) {
    throw new TypeError(`e2e-network-guard: fetch naar niet-localhost geblokkeerd: ${url}`);
  }
  return originalFetch.call(globalThis, input, init);
};

// -- http/https -------------------------------------------------------------

/**
 * Wrap een http/https-methode zodat niet-localhost-aanroepen geblokkeerd worden.
 * @param {Function} original De originele methode (http.request, http.get, ...)
 * @param {string} naam Naam voor het foutbericht
 * @returns {Function}
 */
function wrapHttp(original, naam) {
  return function wrapped(...args) {
    // node http.request heeft drie overloads; de URL/opties zit in arg 0 of 1.
    let host;
    const eerste = args[0];
    if (typeof eerste === 'string') {
      try {
        host = new URL(eerste).hostname;
      } catch {
        host = eerste;
      }
    } else if (eerste instanceof URL) {
      host = eerste.hostname;
    } else if (eerste && typeof eerste === 'object') {
      host = eerste.hostname ?? eerste.host?.replace(/:\d+$/, '') ?? '';
    }

    if (host && !LOCALHOST.has(host)) {
      throw new TypeError(`e2e-network-guard: ${naam} naar niet-localhost geblokkeerd: ${host}`);
    }
    return original.apply(this, args);
  };
}

http.request = wrapHttp(http.request, 'http.request');
http.get = wrapHttp(http.get, 'http.get');
https.request = wrapHttp(https.request, 'https.request');
https.get = wrapHttp(https.get, 'https.get');
