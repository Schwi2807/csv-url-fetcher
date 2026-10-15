'use strict';
/* errors.js: reason phrases and plain-English explanations for HTTP statuses and fetch failures.
   Errors.status(code)   -> { title, text, fix }
   Errors.network(kind)  -> { title, text, fix }   kinds: cors, network, timeout, offline, invalid_url, insecure, stopped
   Errors.reason(code)   -> 'Not Found' (HTTP/2 responses carry no reason phrase, so the app fills it in) */
const Errors = (() => {
  const REASONS = {
    100: 'Continue', 101: 'Switching Protocols', 200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'Non-Authoritative Information',
    204: 'No Content', 205: 'Reset Content', 206: 'Partial Content', 300: 'Multiple Choices', 301: 'Moved Permanently', 302: 'Found',
    303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request',
    401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
    406: 'Not Acceptable', 407: 'Proxy Authentication Required', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone',
    411: 'Length Required', 412: 'Precondition Failed', 413: 'Content Too Large', 414: 'URI Too Long', 415: 'Unsupported Media Type',
    416: 'Range Not Satisfiable', 417: 'Expectation Failed', 418: "I'm a Teapot", 421: 'Misdirected Request', 422: 'Unprocessable Content',
    423: 'Locked', 424: 'Failed Dependency', 425: 'Too Early', 426: 'Upgrade Required', 428: 'Precondition Required',
    429: 'Too Many Requests', 431: 'Request Header Fields Too Large', 451: 'Unavailable For Legal Reasons', 500: 'Internal Server Error',
    501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout', 505: 'HTTP Version Not Supported',
    507: 'Insufficient Storage', 508: 'Loop Detected', 511: 'Network Authentication Required',
  };

  // [what it means, likely fix]
  const STATUS = {
    400: ['The server could not understand the request; usually the value in the URL is malformed for this API.',
      'Check this row\'s value: stray spaces, wrong format or characters that need URL-encoding (turn "URL-encode values" on).'],
    401: ['The server needs you to log in or send an API key, and none was sent.',
      'This app sends plain GET requests with no credentials. Use a public endpoint, or one that takes the key in the URL (e.g. ?api_key=...) and add it to the base URL.'],
    403: ['The server understood the request but refuses to serve it to you.',
      'The resource may be private, need a key with more access, or block automated requests. Check the API\'s access rules.'],
    404: ['The server has no resource at this path.',
      'Check the base URL ends with the right slash, and that this row\'s value exists. If values contain "/", turn "URL-encode values" off.'],
    405: ['This URL exists but does not accept GET requests.',
      'The endpoint probably expects POST or another method. Check the API docs for a GET endpoint.'],
    408: ['The server gave up waiting for the request.',
      'Usually a slow or busy server. Retry failed later, or lower concurrency.'],
    409: ['The request conflicts with the current state of the resource.',
      'Rare for GET. Check whether the resource is being changed elsewhere, then retry.'],
    410: ['This resource used to exist but has been removed permanently.',
      'The value is outdated; the item was deleted. Remove it from the CSV.'],
    413: ['The request is larger than the server accepts.',
      'Rare for GET. A very long value or base URL may be the cause; shorten it.'],
    414: ['The URL is longer than the server accepts.',
      'This row\'s value (after encoding) makes the URL too long. Shorten the value or the base URL.'],
    415: ['The server does not support the format of the request.',
      'Rare for GET. The endpoint may expect a different API; check the docs.'],
    422: ['The server understood the request, but the value is not valid for it.',
      'Check this row\'s value against what the API expects (type, length, allowed characters).'],
    429: ['Rate limited: you sent too many requests too quickly.',
      'Lower concurrency, wait a little, then use Retry failed. Check the Retry-After header for how long to wait.'],
    500: ['The server hit an error while handling this request. The problem is on the server side.',
      'Retry later. If only some rows fail, their values may trigger a server bug.'],
    501: ['The server does not support this feature.',
      'The endpoint is not implemented for GET; check the API docs.'],
    502: ['A gateway or proxy got a bad answer from the server behind it.',
      'Usually temporary: the upstream server is down or restarting. Retry later.'],
    503: ['The server is overloaded or down for maintenance.',
      'Retry later and lower concurrency. Check the Retry-After header if present.'],
    504: ['A gateway or proxy timed out waiting for the server behind it.',
      'The upstream server is slow. Retry later, or lower concurrency.'],
  };

  const NETWORK = {
    cors: ['BLOCKED by CORS', 'The server answered, but it does not allow web apps on other sites to read its responses (no Access-Control-Allow-Origin header), so the browser hid the response.',
      'Open the URL directly (tap it) to see the response, or use an API that allows cross-origin requests. A proxy can get around this later.'],
    network: ['Network error', 'The request failed before any response arrived. The browser does not say why; the usual causes are: the domain does not exist (DNS failure), the server refused the connection, an SSL/certificate problem, or too many redirects.',
      'Check the domain in the base URL is spelled right and reachable (tap the URL to open it in the browser), then Retry failed.'],
    timeout: ['Timeout', 'No complete response arrived within the timeout.',
      'The server is slow or the response is large. Raise "Timeout per request" or lower concurrency, then Retry failed.'],
    offline: ['Offline', 'This device has no internet connection.',
      'Connect to Wi-Fi or mobile data, then Retry failed.'],
    invalid_url: ['Invalid URL', 'The base URL plus this row\'s value does not form a valid web address.',
      'The base URL must start with http:// or https://. Check for spaces or stray characters in the value, or turn "URL-encode values" on.'],
    insecure: ['Blocked: insecure http URL', 'This app runs on https, and the browser blocks plain http:// requests from https pages (mixed content).',
      'Use the https:// version of the URL if the server has one.'],
    stopped: ['Stopped', 'This request was cancelled with Stop before it finished.',
      'Use Retry failed to run it again.'],
  };

  const reason = (code) => REASONS[code] || '';
  function status(code) {
    const title = `${code} ${reason(code)}`.trim();
    if (STATUS[code]) return { title, text: STATUS[code][0], fix: STATUS[code][1] };
    if (code >= 500) return { title, text: 'The server had a problem handling the request.', fix: 'Retry later; the cause is on the server side.' };
    if (code >= 400) return { title, text: 'The server rejected the request.', fix: 'Check the base URL and this row\'s value against the API docs.' };
    if (code >= 300) return { title, text: 'The server answered with a redirect that was not followed.', fix: 'Open the URL directly to see where it points.' };
    return { title, text: '', fix: '' };
  }
  function network(kind) {
    const n = NETWORK[kind] || NETWORK.network;
    return { title: n[0], text: n[1], fix: n[2] };
  }
  return { reason, status, network, STATUS, NETWORK };
})();
