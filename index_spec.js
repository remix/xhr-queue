'use strict';

/* eslint-env jasmine */

jasmine.clock().install();

var newXhrQueue = require('./index');

describe('newXhrQueue', function() {
  var requests;
  var connectionCallbacks;
  var xhrQueue;

  function respond(request, options) {
    var status = options && options.status;
    request.status = status === undefined ? 200 : status;
    request.callback(undefined, { statusCode: request.status }, {});
    jasmine.clock().tick(1);
  }

  function respondToRequestWithUrl(url, options) {
    var filteredRequests = requests.filter(function(request) {
      return request.url === url && request.status == null;
    });

    if (filteredRequests.length === 0) throw new Error('No request found with url ' + url);
    if (filteredRequests.length > 1) {
      throw new Error('More than one requests found with url ' + url);
    }

    respond(filteredRequests[0], options);
  }

  function getOpenRequestUrls() {
    return requests
      .filter(function(request) {
        return request.status == null && request.statusText !== 'abort';
      })
      .map(function(request) {
        return request.url;
      });
  }

  function getAbortedRequestUrls() {
    return requests
      .filter(function(request) {
        return request.statusText === 'abort';
      })
      .map(function(request) {
        return request.url;
      });
  }

  function getAbortedRequestCount() {
    return getAbortedRequestUrls().length;
  }

  beforeEach(function() {
    requests = [];
    connectionCallbacks = [];
    xhrQueue = newXhrQueue({
      xhrFunc: function(req, callback) {
        var request = Object.assign({}, req, { callback: callback });
        requests.push(request);
        return {
          abort: function() {
            request.statusText = 'abort';
          }
        };
      },
      connectionCallback: function(type) {
        connectionCallbacks.push(type);
      }
    });
  });

  it('calls the callback when done', function() {
    var callback = jasmine.createSpy('callback');

    xhrQueue.xhr({ url: '/write-1', method: 'POST' }, callback);
    jasmine.clock().tick(1);
    respondToRequestWithUrl('/write-1');

    expect(callback).toHaveBeenCalled();
  });

  it('separates reads and writes, and only allows one write request at a time', function() {
    xhrQueue.xhr({ url: '/read-1' }, function() {});
    xhrQueue.xhr({ url: '/read-2', method: 'POST', overrideQueueItemType: 'read' }, function() {});
    xhrQueue.xhr({ url: '/read-3' }, function() {});
    xhrQueue.xhr({ url: '/write-1', method: 'POST' }, function() {});
    xhrQueue.xhr({ url: '/read-4' }, function() {});
    xhrQueue.xhr({ url: '/read-5' }, function() {});
    xhrQueue.xhr({ url: '/write-2', overrideQueueItemType: 'write' }, function() {});
    xhrQueue.xhr({ url: '/read-6' }, function() {});
    xhrQueue.xhr({ url: '/read-7' }, function() {});
    jasmine.clock().tick(1);

    expect(getOpenRequestUrls()).toEqual(['/read-1', '/read-2', '/read-3']);

    respondToRequestWithUrl('/read-1');
    respondToRequestWithUrl('/read-2');

    expect(getOpenRequestUrls()).toEqual(['/read-3']);

    respondToRequestWithUrl('/read-3');

    expect(getOpenRequestUrls()).toEqual(['/write-1']);
    respondToRequestWithUrl('/write-1');

    expect(getOpenRequestUrls()).toEqual(['/read-4', '/read-5']);

    respondToRequestWithUrl('/read-4');
    respondToRequestWithUrl('/read-5');

    expect(getOpenRequestUrls()).toEqual(['/write-2']);
    respondToRequestWithUrl('/write-2');

    expect(getOpenRequestUrls()).toEqual(['/read-6', '/read-7']);
  });

  describe('with ignorePreviousByUrl', function() {
    describe('with an in-flight GET request', function() {
      it('aborts the request', function() {
        var request = { url: '/req', method: 'GET', ignorePreviousByUrl: true };
        xhrQueue.xhr(request);
        jasmine.clock().tick(1);
        xhrQueue.xhr(request);
        jasmine.clock().tick(1);
        expect(getAbortedRequestCount()).toBe(1);
        expect(getOpenRequestUrls()).toEqual(['/req']);
      });

      it('does not invoke the callback', function() {
        var request = { url: '/req', method: 'GET', ignorePreviousByUrl: true };
        var callback1 = jasmine.createSpy('callback1');
        var callback2 = jasmine.createSpy('callback2');
        xhrQueue.xhr(request, callback1);
        jasmine.clock().tick(1);
        xhrQueue.xhr(request, callback2);
        jasmine.clock().tick(1);

        respond(requests[0]);
        respond(requests[1]);

        expect(callback1).not.toHaveBeenCalled();
        expect(callback2).toHaveBeenCalled();
      });
    });

    describe('with an in-flight POST request', function() {
      it('does not abort the request', function() {
        var request = { url: '/req', method: 'POST', ignorePreviousByUrl: true };
        xhrQueue.xhr(request);
        jasmine.clock().tick(1);
        xhrQueue.xhr(request);
        jasmine.clock().tick(1);
        expect(getAbortedRequestCount()).toBe(0);
        expect(getOpenRequestUrls()).toEqual(['/req']);
      });

      it('does not invoke the callback', function() {
        var request = { url: '/req', method: 'POST', ignorePreviousByUrl: true };
        var callback1 = jasmine.createSpy('callback1');
        var callback2 = jasmine.createSpy('callback2');
        xhrQueue.xhr(request, callback1);
        jasmine.clock().tick(1);
        xhrQueue.xhr(request, callback2);
        jasmine.clock().tick(1);

        respond(requests[0]);
        respond(requests[1]);

        expect(callback1).not.toHaveBeenCalled();
        expect(callback2).toHaveBeenCalled();
      });
    });
  });

  describe('canceling an in-flight read request', function() {
    var queuePointers;
    var read1Callback;

    beforeEach(function() {
      read1Callback = jasmine.createSpy('read1Callback');
      queuePointers = {
        '/read-1': xhrQueue.xhr({ url: '/read-1' }, read1Callback),
        '/write-1': xhrQueue.xhr({ url: '/write-1', method: 'POST' }, function() {})
      };
    });

    it('should return true', function() {
      jasmine.clock().tick(1);
      expect(queuePointers['/read-1'].cancel()).toBe(true);
      jasmine.clock().tick(1);
    });

    it('should abort the request', function() {
      jasmine.clock().tick(1);
      queuePointers['/read-1'].cancel();
      expect(getAbortedRequestUrls()).toEqual(['/read-1']);
      jasmine.clock().tick(1);
    });

    it('should refresh the queue', function() {
      jasmine.clock().tick(1);
      queuePointers['/read-1'].cancel();
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual(['/write-1']);
    });

    it('should not invoke the callback', function() {
      jasmine.clock().tick(1);
      queuePointers['/read-1'].cancel();
      jasmine.clock().tick(1);
      expect(read1Callback).not.toHaveBeenCalled();
    });
  });

  describe('canceling an in-flight write request', function() {
    var queuePointers;
    var write1Callback;

    beforeEach(function() {
      write1Callback = jasmine.createSpy('write1Callback');
      queuePointers = {
        '/write-1': xhrQueue.xhr({ url: '/write-1', method: 'POST' }, write1Callback)
      };
    });

    it('should return false', function() {
      jasmine.clock().tick(1);
      expect(queuePointers['/write-1'].cancel()).toBe(false);
    });

    it('should not abort the request', function() {
      jasmine.clock().tick(1);
      queuePointers['/write-1'].cancel();
      expect(getAbortedRequestUrls()).toEqual([]);
    });

    it('should invoke the callback', function() {
      jasmine.clock().tick(1);
      queuePointers['/write-1'].cancel();
      jasmine.clock().tick(1);
      respondToRequestWithUrl('/write-1');
      jasmine.clock().tick(1);
      expect(write1Callback).toHaveBeenCalled();
    });
  });

  describe('canceling queued requests', function() {
    var queuePointers;
    var write1Callback;
    var read2Callback;

    beforeEach(function() {
      write1Callback = jasmine.createSpy('write1Callback');
      read2Callback = jasmine.createSpy('read2Callback');
      queuePointers = {
        '/read-1': xhrQueue.xhr({ url: '/read-1' }, function() {}),
        '/write-1': xhrQueue.xhr({ url: '/write-1', method: 'POST' }, write1Callback),
        '/read-2': xhrQueue.xhr({ url: '/read-2' }, read2Callback)
      };
    });

    it('should return true', function() {
      jasmine.clock().tick(1);
      expect(queuePointers['/write-1'].cancel()).toBe(true);
      expect(queuePointers['/read-2'].cancel()).toBe(true);
      jasmine.clock().tick(1);
    });

    it('should not send the request', function() {
      jasmine.clock().tick(1);
      queuePointers['/write-1'].cancel();
      queuePointers['/read-2'].cancel();
      jasmine.clock().tick(1);
      respondToRequestWithUrl('/read-1');
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual([]);
    });

    it('should not invoke the callback', function() {
      jasmine.clock().tick(1);
      expect(queuePointers['/write-1'].cancel()).toBe(true);
      expect(queuePointers['/read-2'].cancel()).toBe(true);
      jasmine.clock().tick(1);
      respondToRequestWithUrl('/read-1');
      jasmine.clock().tick(1);
      expect(write1Callback).not.toHaveBeenCalled();
      expect(read2Callback).not.toHaveBeenCalled();
    });
  });

  it('allows canceling later requests during an earlier request callback', function() {
    var queuePointers = {
      '/write-1': xhrQueue.xhr({ url: '/write-1', method: 'POST' }, function() {
        queuePointers['/write-2'].cancel();
        queuePointers['/read-2'].cancel();
      }),
      '/write-2': xhrQueue.xhr({ url: '/write-2', method: 'POST' }, function() {}),
      '/read-1': xhrQueue.xhr({ url: '/read-1' }, function() {}),
      '/read-2': xhrQueue.xhr({ url: '/read-2' }, function() {}),
      '/read-3': xhrQueue.xhr({ url: '/read-3' }, function() {})
    };
    jasmine.clock().tick(1);

    respondToRequestWithUrl('/write-1');
    jasmine.clock().tick(1);

    expect(getOpenRequestUrls()).toEqual(['/read-1', '/read-3']);
  });

  describe('losing connection', function() {
    it('dispatches a connection_lost event when losing connection', function() {
      xhrQueue.xhr({ url: '/read' }, function() {});
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual(['/read']);

      respondToRequestWithUrl('/read', { status: 0 });
      expect(connectionCallbacks).toEqual(['connection_lost']);
      expect(getOpenRequestUrls()).toEqual([]);
    });

    it('stops the queue entirely until connection is restored', function() {
      xhrQueue.xhr({ url: '/read' }, function() {});
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual(['/read']);

      respondToRequestWithUrl('/read', { status: 0 });
      expect(getOpenRequestUrls()).toEqual([]);

      xhrQueue.xhr({ url: '/read' }, function() {});
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual([]);
      expect(xhrQueue.getQueuedUrls()).toEqual(['/read', '/read']);
    });

    it('allows retrying', function() {
      xhrQueue.xhr({ url: '/read' }, function() {});
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual(['/read']);

      respondToRequestWithUrl('/read', { status: 0 });
      expect(getOpenRequestUrls()).toEqual([]);

      xhrQueue.retry();
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual(['/read']);

      respondToRequestWithUrl('/read');
      expect(connectionCallbacks).toEqual(['connection_lost', 'connection_restored']);
      expect(getOpenRequestUrls()).toEqual([]);
    });

    it('does not let you cancel a failed request (to prevent weird interactions between retrying and cancelling)', function() {
      var request = xhrQueue.xhr({ url: '/read' }, function() {});
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual(['/read']);

      respondToRequestWithUrl('/read', { status: 0 });
      expect(getOpenRequestUrls()).toEqual([]);

      expect(request.cancel()).toEqual(false);

      xhrQueue.retry();
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual(['/read']);

      respondToRequestWithUrl('/read');
      expect(connectionCallbacks).toEqual(['connection_lost', 'connection_restored']);
      expect(getOpenRequestUrls()).toEqual([]);
    });

    it('when ignoring a failed request, it removes the callback, but still retries it', function() {
      var callbackForFailedRequest = jasmine.createSpy('callbackForFailedRequest');
      xhrQueue.xhr({ url: '/read' }, callbackForFailedRequest);
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual(['/read']);

      respondToRequestWithUrl('/read', { status: 0 });
      expect(getOpenRequestUrls()).toEqual([]);

      var callbackForSuccessfulRequest = jasmine.createSpy('callbackForSuccessfulRequest');
      xhrQueue.xhr({ url: '/read', ignorePreviousByUrl: true }, callbackForSuccessfulRequest);
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual([]);
      expect(xhrQueue.getQueuedUrls()).toEqual(['/read', '/read']);

      xhrQueue.retry();
      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual(['/read']);

      respondToRequestWithUrl('/read');
      expect(connectionCallbacks).toEqual(['connection_lost', 'connection_restored']);
      expect(getOpenRequestUrls()).toEqual(['/read']);
      expect(callbackForFailedRequest).not.toHaveBeenCalled();

      jasmine.clock().tick(1);
      expect(getOpenRequestUrls()).toEqual(['/read']);
      respondToRequestWithUrl('/read');
      expect(getOpenRequestUrls()).toEqual([]);
      expect(connectionCallbacks).toEqual(['connection_lost', 'connection_restored']);
      expect(callbackForFailedRequest).not.toHaveBeenCalled();
      expect(callbackForSuccessfulRequest).toHaveBeenCalled();
    });
  });

  it('returns a promise if no callback is passed', function() {
    var promise = xhrQueue.xhr({ url: '/write-1', method: 'POST' });
    expect(promise instanceof Promise).toBe(true);

    jasmine.clock().tick(1);
    respondToRequestWithUrl('/write-1');
    return promise;
  });
});
