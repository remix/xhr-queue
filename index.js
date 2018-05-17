'use strict';

module.exports = function newXhrQueue(options) {
  var xhrFunc = options.xhrFunc;
  var debugName = options.debugName || 'xhrQueue';
  var enableDebugging = options.enableDebugging || false;
  var connectionCallback = options.connectionCallback || function() {};
  var queue = [];

  function removeFromQueue(queueItem) {
    var queueIndex = queue.indexOf(queueItem);
    if (queueIndex < 0) return;
    queue.splice(queueIndex, 1);
  }

  function printQueue() {
    if (!enableDebugging) return;

    var outputString = [];
    var outputArgs = [];

    outputString.push('%s: ');
    outputArgs.push(debugName);

    queue.forEach(function(queueItem) {
      if (queueItem.inFlight) {
        outputString.push('%c');
        if (queueItem.cancelled) {
          outputArgs.push('font-weight: bold; text-decoration:line-through');
        } else {
          outputArgs.push('font-weight: bold');
        }
      }

      outputString.push('[');
      outputString.push(queueItem.type === 'write' ? 'W' : 'R');
      outputString.push(queueItem.debugId);
      outputString.push('] ');

      if (queueItem.inFlight) {
        outputString.push('%c');
        outputArgs.push('');
      }
    });

    // Add some padding. Each item has the same length, because debugIds are padded.
    outputString.push(new Array(100 - '[W001] '.length * queue.length).join(' '));

    outputString.push(' %O');
    outputArgs.push(queue.slice());

    console.log(outputString.join(''), outputArgs); // eslint-disable-line no-console
  }

  var debugId = 0;
  function nextDebugId() {
    // Generate a string with 3 characters, like "001".
    debugId = (debugId + 1) % 1000;
    var debugString = '' + debugId;
    return new Array('999'.length - debugString.length + 1).join('0') + debugString;
  }

  var refreshQueue = function(retry) {
    // Wait at least one tick so we can cancel some requests.
    setTimeout(function() {
      var queueItemsToPutInFlight = [];

      // When retrying, just put failed queue items in flight again. Leave the
      // rest sitting in the queue until the failed items succeed again.
      if (retry) {
        queue.forEach(function(queueItem) {
          if (queueItem.failed) queueItemsToPutInFlight.push(queueItem);
        });
      } else {
        var failedRequests = queue.filter(function(queueItem) {
          return queueItem.failed;
        }).length;

        var inFlightReads = queue.filter(function(queueItem) {
          return queueItem.type === 'read' && queueItem.inFlight;
        }).length;

        var inFlightWrites = queue.filter(function(queueItem) {
          return queueItem.type === 'write' && queueItem.inFlight;
        }).length;

        if (inFlightReads > 0 && inFlightWrites > 0) {
          throw new Error('xhrQueue: Cannot have both reads and writes in flight');
        }

        if (inFlightWrites > 1) {
          throw new Error('xhrQueue: Too many writes in flight: ' + inFlightWrites);
        }

        // If there's no currently in flight write, flush the queue until we find
        // the first write, but don't include it unless there are no reads before it
        // (to prevent backend serialization errors between the write and the reads
        // before it).
        if (failedRequests === 0 && inFlightWrites === 0) {
          for (var i = 0; i < queue.length; i++) {
            if (!queue[i].inFlight) {
              if (queue[i].type === 'read') {
                queueItemsToPutInFlight.push(queue[i]);
              } else if (queue[i].type === 'write') {
                if (inFlightReads === 0 && queueItemsToPutInFlight.length === 0) {
                  queueItemsToPutInFlight.push(queue[i]);
                }
                break;
              }
            }
          }
        }
      }

      queueItemsToPutInFlight.forEach(function(queueItem) {
        queueItem.inFlight = true; // eslint-disable-line no-param-reassign
        var isRetry = queueItem.failed;
        queueItem.failed = false; // eslint-disable-line no-param-reassign
        // eslint-disable-next-line no-param-reassign
        queueItem.handle = xhrFunc(queueItem.request, function(error, response, body) {
          if (error || response.statusCode === 0) {
            queueItem.failed = true; // eslint-disable-line no-param-reassign
            connectionCallback('connection_lost');
            return;
          } else if (isRetry) {
            connectionCallback('connection_restored');
          }

          // Remove from queue when finished.
          removeFromQueue(queueItem);

          if (response.statusCode >= 400) {
            // For now we just call the callback, and keep going, potentially
            // getting into an inconsistent state. In the future, we should have
            // this block the queue, and show a global "retry" button.
            // See https://paper.dropbox.com/doc/Frontend-error-banner-p8gaPrLoPg252h7Wn8MIV
            if (window.console && window.console.warn && !window.jasmine) {
              window.console.warn(
                'Request failed but subsequent requests in the queue continued processing...'
              );
            }
          }

          if (typeof queueItem.callback === 'function') {
            queueItem.callback(error, response, body);
          }

          refreshQueue();
        });
      });

      printQueue();
    });
  };

  return {
    xhr: function(request, callback) {
      var type =
        request.overrideQueueItemType ||
        (!request.method || request.method.toUpperCase() === 'GET' ? 'read' : 'write');
      if (type !== 'read' && type !== 'write') throw new Error('Invalid queueItem.type: ' + type);

      if (request.ignorePreviousByUrl) {
        var hasSameUrl = function(item) {
          return item.request.url === request.url;
        };
        queue.filter(hasSameUrl).forEach(function(item) {
          // When the caller specifies that previous requests should be ignored, it signals
          // that the callback should never be invoked. A best effort at cancellation is made
          // but the request is still allowed to complete if it is in flight, otherwise it might
          // cause race conditions on the backend.
          // eslint-disable-next-line no-param-reassign
          item.callback = null;
          item.cancel();
        });
      }

      var queueItem = {
        request: request,
        callback: callback,
        type: type,
        inFlight: false,
        cancelled: false,
        failed: false,
        handle: null,
        debugId: nextDebugId()
      };
      queueItem.cancel = function() {
        if (this.failed) return false;
        if (this.cancelled) return true;

        if (this.inFlight) {
          if (type === 'write') return false;
          this.handle.abort();
        }

        this.cancelled = true;
        removeFromQueue(this);
        refreshQueue();
        return true;
      }.bind(queueItem);

      queue.push(queueItem);
      refreshQueue();

      return {
        cancel: queueItem.cancel.bind(queueItem)
      };
    },
    getQueuedUrls: function() {
      return queue.map(function(queueItem) {
        return queueItem.request.url;
      });
    },
    retry: function() {
      refreshQueue(true);
    }
  };
};
