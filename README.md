# xhrQueue
[![NPM version](https://badge.fury.io/js/xhr-queue.svg)](http://badge.fury.io/js/xhr-queue)
[![devDependencies Status](https://david-dm.org/remix/xhr-queue/dev-status.svg)](https://david-dm.org/remix/xhr-queue?type=dev)
[![Open Source Love](https://badges.frapsoft.com/os/mit/mit.svg?v=102)](https://github.com/ellerbrock/open-source-badge/)
[![Build Status](https://secure.travis-ci.org/remix/xhr-queue.svg)](http://travis-ci.org/remix/xhr-queue)

A queue for HTTP requests, to guarantee a sequential order. This prevents conflicts between requests. It also removes the need for some callbacks in the frontend code. And it removes the need for throttling/debouncing, leading to a snappier user experience. Finally, it allows for retrying failed requests when the connection drops.

Check out [this blog post](https://blog.remix.com/request-queuing-965ea7f917f7) for more details.

## Example:
Before:
```js
const saveBusStops = debounce((project_id, stops) => {
  xhr({
    method: 'POST',
    url: `${project_id}/bus_stops`,
    json: {stops},
  }).then(() =>
    xhr({ url: `${project_id}/stats`})
      .then((body) => updateStats(body))
  );
}, 3000);
```

After:
```js
function saveBusStops(project_id, stops) {
  window.xhrQueue.xhr({
    method: 'POST',
    url: `${project_id}/bus_stops`,
    json: {stops},
    ignorePreviousByUrl: true,
  });
  window.xhrQueue.xhr({
    url: `${project_id}/stats`,
    ignorePreviousByUrl: true,
  }, (error, response, body) => updateStats(body));
}
```

## Usage
At Remix, we use this with the [xhr package](https://github.com/naugtur/xhr). We set it up something like this:
```js
window.xhrQueue = require('xhr-queue')({
  xhrFunc: require('xhr'),
  connectionCallback: (type) => {
    if (type === 'connection_lost') {
      // show retry banner
      // when doing a retry, call window.xhrQueue.retry()
    } else {
      // hide retry banner
    }
  },
  enableDebugging: localStorage.xhrQueueEnableDebugging,
});
```

We then write HTTP requests like this:
```js
window.xhrQueue.xhr({
  url: `${project_id}/stats`,
  ignorePreviousByUrl: true,
}, (error, response, body) => updateStats(body));
```

The `ignorePreviousByUrl` will remove any existing requests in the queue that have the same URL.

By default, we will any requests with `method` other than `GET` as a "write request", which means they cannot be executed in parallel with other requests:

```js
window.xhrQueue.xhr({
  method: 'POST',
  url: `${project_id}/bus_stops`,
  json: {stops},
  ignorePreviousByUrl: true,
});
```

## Overriding request types

If you need to mark a `GET` request as a write request, or a `POST` request as a read request (e.g. when you have to send a bunch of data that can't fit into a `GET` request), you can override it using `overrideQueueItemType`:

```js
window.xhrQueue.xhr({
  method: 'POST',
  url: `${project_id}/demographics_stats`,
  json: {stops},
  ignorePreviousByUrl: true,
  overrideQueueItemType: 'read',
});
```

## Other ways to cancel requests

In addition to cancelling requests using `ignorePreviousByUrl`, you can also use the `ignorePreviousBy` option to specify custom logic for matching previous requests against the current one:

```js
window.xhrQueue.xhr({
  url: `${project_id}/stats`,
  query: { type: 'skub' },
  ignorePreviousBy(previousRequest, currentRequest) {
    return (
      previousRequest.url === currentRequest.url &&
      previousRequest.query &&
      currentRequest.query &&
      previousRequest.query.type === currentRequest.query.type
    )
  },
}, (error, response, body) => updateStats(body));
```

You can also manually cancel a request:

```js
const request = window.xhrQueue.xhr({
  url: `${project_id}/stats`,
  ignorePreviousByUrl: true,
});

setTimeout(() => request.cancel(), 1000);
```

Note that when a write request is cancelled while it is already in flight (by using `cancel()`, `ignorePreviousByUrl`, or `ignorePreviousBy`), the queue will still wait until the request is finished. In case of read requests, we attempt to abort the request, but allow continuing the queue.

When using `ignorePreviousByUrl` or `ignorePreviousBy`, the callback from the previous request will be ignored (it will not be called).

## Other methods

To see which URLs are currently queued, use `window.xhrQueue.getQueuedUrls()`.

To retry failed requests because of dropped connection (requests with status code 0), use `window.xhrQueue.retry()`. Also see the setup example above.

To visualise to the console what's happening in the queue, initialise the queue with `enableDebugging: true`. To distinguish multiple queues, initialise with `debugName: 'my queue name'`.

## Integration tests

In integration tests, it can be more robust to use the xhrQueue to determine when requests have finished, instead of just looking at in-flight requests. For example, at Remix we use [transactional-capybara](https://github.com/iangreenleaf/transactional_capybara), which we monkey-patch like this:

```ruby
module TransactionalCapybara
  module AjaxHelpers
    class PageWaiting
      def finished_ajax_requests?
        run_js("window.xhrQueue.getQueuedUrls().length").zero?
      end
    end
  end
end
```

## License
[MIT](LICENSE)
