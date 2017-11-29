//  region Introduction
//  sigfox-iot-cloud is a framework for building a Sigfox server, based on AWS or Google Cloud.
//  Clients should not use this library directly, use sigfox-gcloud or sigfox-aws instead.
/* eslint-disable camelcase, no-console, no-nested-ternary, global-require, import/no-unresolved, max-len */

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Declarations
//  Helper constants to detect if we are running on Google Cloud or AWS.
//  const isGoogleCloud = !!process.env.FUNCTION_NAME || !!process.env.GAE_SERVICE;
const isAWS = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const isProduction = (process.env.NODE_ENV === 'production');  //  True on production server.

//  Load the Google Cloud or AWS libraries first.
let cloud = null;

//  Next load the other libraries.
const util = require('util');
const uuidv4 = require('uuid/v4');
const stringify = require('json-stringify-safe');

const logKeyLength = process.env.LOGKEYLENGTH ? parseInt(process.env.LOGKEYLENGTH, 10) : 40;  //  Width of the left column in logs

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Utility Functions

function sleep(req, res, millisec) {
  //  Returns a promise that waits for the number of milliseconds and returns res.
  return new Promise((accept) => {
    setTimeout(() => {
      accept(res);
    }, millisec);
  });
}

function removeNulls(obj, level) {
  //  Remove null values recursively before logging to Google Cloud.
  //  We don't remove circular references because Google Cloud Logging
  //  removes circular references.  level should initially be null.
  if (obj === null || obj === undefined || typeof obj === 'function') {
    return null;  //  Parent should discard this item.
  }
  //  If obj is a scalar value, return.
  if (!Array.isArray(obj) && typeof obj !== 'object') {
    return obj;  // Valid scalar.
  }
  if (level > 3) return '(truncated)';  //  Truncate at depth 3 to reduce log size.
  const nextLevel = (level || 0) + 1;
  //  If obj is an array, clean each array item.
  if (Array.isArray(obj)) {
    const result = [];
    for (const item of obj) {
      let cleanItem = removeNulls(item, nextLevel);
      //  If item is invalid, push a "removed" message to preserve array length.
      if (cleanItem === null) cleanItem = '(removed)';
      result.push(cleanItem);
    }
    return result;
  }
  //  Else clean the object by each key.
  if (typeof obj === 'object') {
    //  Google cannot log objects without hasOwnProperty.  We copy item by item to restore hasOwnProperty.
    const result = {};
    for (const key of Object.keys(obj)) {
      const item = obj[key];
      const cleanItem = removeNulls(item, nextLevel);
      //  Skip any invalid items.
      if (cleanItem === null) continue;
      result[key] = cleanItem;
    }
    return result;
  }
  //  Should not come here.
  return obj;
}

function dumpError(error, action, para) {
  //  Dump the error to the console and suppress the error.  Return the error.
  //  Action and para are optional.
  console.error(action || '', error.message, error.stack, stringify(para || '', null, 2));
  return error;
}

function dumpNullError(error, action, para) {
  //  Dump the error to the console and suppress the error.  Return null.
  //  Action and para are optional.
  dumpError(error, action, para);
  return null;
}

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Instrumentation Functions: Trace the execution of this Sigfox Callback across multiple Cloud Functions via Google Cloud Tracing or AWS X-Ray

function getSpanName(req) {
  //  Return a span name based on the device ID, sequence number and basestationTime:
  //    device_seqNumber_baseStationTime
  //  Will be used to trace the request across Cloud Functions.
  const body = req.body || {};
  const device = req.device
    ? req.device.toUpperCase()
    : body.device
      ? body.device.toUpperCase()
      : 'missing_device';
  const seqNumber = (req.seqNumber !== null && req.seqNumber !== undefined)
  ? req.seqNumber
  : (body.seqNumber !== null && body.seqNumber !== undefined)
    ? body.seqNumber
    : 'missing_seqNumber';
  return [device, seqNumber].join(' seq:');
}

function startRootSpan(req, rootTrace0) {
  //  Start a root-level trace and span to trace the request across Cloud Functions.
  //  Returns { rootTrace, rootSpan } objects.  rootTrace0 should be null, unless
  //  passed by getRootSpan to init the root span.  Derived from
  //  https://github.com/zbjornson/gcloud-trace/blob/master/src/index.js
  //  Create the root trace.
  const labels = {};
  const rootTrace = rootTrace0 || cloud.startTrace(req);
  //  Start the span.
  const rootSpanName = getSpanName(req);
  const rootSpan = rootTrace ? rootTrace.startSpan(rootSpanName, labels) : null;
  if (rootSpan && rootTrace) rootSpan.end = rootTrace.end.bind(rootTrace);
  //  Cache the root trace and span in the request object.
  Object.assign(req, {
    rootTracePromise: Promise.resolve(rootTrace),
    rootSpanPromise: Promise.resolve(rootSpan),
  });
  return { rootTrace, rootSpan };
}

function getRootSpan(req, rootTraceId0) {
  //  Return the current root trace and span for tracing the request across Cloud Functions,
  //  based on the rootTraceId passed by the previous Cloud Function.  Return the
  //  cached copy from req if available. Returns 2 promises: { rootTracePromise, rootSpanPromise }
  if (!req.rootTracePromise || !req.rootSpanPromise) {
    //  We create the trace locally instead of calling tracing.getTrace because the trace
    //  may not be written to Google Cloud yet as we call another Cloud Function.
    const rootTraceId = rootTraceId0 || req.rootTraceId;
    if (!rootTraceId) {
      //  Missing trace ID.
      if (process.env.SHOW_TRACE_ERRORS) dumpError(new Error('missing_traceid'));
      return {
        rootTracePromise: Promise.resolve(null),
        rootSpanPromise: Promise.resolve(null),
      };
    }
    const rootTrace = cloud.createRootTrace(req, rootTraceId);
    //  Randomly assign the starting span ID.  Must not clash with previously assigned span ID
    //  for this trace ID.
    //  eslint-disable-next-line no-underscore-dangle
    if (rootTrace) rootTrace._spanIdInc = parseInt(Math.random() * 1000000, 10);
    //  Create a span from the trace.  Will be cached in request.
    startRootSpan(req, rootTrace);
  }
  return {
    rootTracePromise: req.rootTracePromise,
    rootSpanPromise: req.rootSpanPromise,
  };
}

function endRootSpan(req) {
  //  End the current root-level span for tracing the request across Cloud Functions.
  //  Returns a promise.
  return getRootSpan(req).rootSpanPromise
    .then((rootSpan) => {
      if (rootSpan) rootSpan.end();  // eslint-disable-next-line no-param-reassign
      if (req.rootTracePromise) delete req.rootTracePromise;  // eslint-disable-next-line no-param-reassign
      if (req.rootSpanPromise) delete req.rootSpanPromise;  //  Remove cache.
      return 'OK';
    })
    .catch(dumpNullError);
}

function createChildSpan(req, name0, labels) {
  //  Create a child span to trace a task in this module.  Returns a promise.
  const name = [
    cloud.functionName,
    (name0 || 'missing_name').split('/').join(' / '),
  ].join(' / ');
  return getRootSpan(req).rootSpanPromise
    .then((rootSpan) => {
      if (!rootSpan) return null;
      return rootSpan.startSpan(name, labels);
    })
    .catch(dumpNullError);
}

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Logging Functions: Log to Google Cloud Logging, Error Reporting and PubSub or AWS CloudWatch

//  Write log records in batches by 20 records normally, max 10000 records when flushing.
const batchSize = flush => (flush ? 10000 : 20);
const logTasks = [];  //  List of logging tasks to be completed.  They return a log entry.
// eslint-disable-next-line no-unused-vars
let taskCount = 0;  //  Number of logging tasks completed so far.
//  Maps operationid to the promise for the child span, for instrumentation.
const allSpanPromises = {};

function createTraceID(now0) {
  //  Return a trace ID array with local time MMSS-uuid for display later.
  const now = now0 || Date.now();
  const s = new Date(now + (8 * 60 * 60 * 1000 * 100)).toISOString();
  return [`${s.substr(14, 2)}${s.substr(17, 2)}-${uuidv4()}`];
}

function writeLog(req, loggingLog0, flush) {
  //  Execute each log task one tick at a time, so it doesn't take too much resources.
  //  If flush is true, flush all logs without waiting for the tick, i.e. when quitting.
  //  Returns a promise.
  const size = batchSize(flush);
  if (logTasks.length === 0) return Promise.resolve('OK');
  //  If not flushing, wait till we got sufficient records to form a batch.
  if (!flush && logTasks.length < size) { // eslint-disable-next-line no-use-before-define
    return Promise.resolve('insufficient');
  }
  //  Gather a batch of tasks and run them in parallel.
  const batch = [];
  for (;;) {
    if (batch.length >= size) break;
    if (logTasks.length === 0) break;
    const task = logTasks.shift();
    if (!task) continue;
    //  Add the task to the batch.
    batch.push(task(cloud.getLogger()).catch(dumpNullError));
    taskCount += 1;
  }
  // console.log(`writeLog2 ${taskCount} / ${batch.length} / ${logTasks.length}`);
  //  Wait for the batch to finish.
  return Promise.all(batch)
    .then((res) => {
      //  Write the non-null records.
      const entries = res.filter(x => (x !== null && x !== undefined));
      if (entries.length === 0) return 'nothing';
      //  Rightfully for Google Cloud we should wait for this promise to complete, but it introduces a 1-second delay.
      //  However we will deallocate the logger in shutdown() so it's OK.  No issue for AWS since we log to console.
      cloud.getLogger().write(entries)  //  Async
        .catch(error => console.error('writeLog', error.message, error.stack, JSON.stringify(entries, null, 2)));
      return 'OK'; //
    })
    .then(() => {  //  If flushing, don't wait for the tick.
      if (flush) return 'OK';
      // eslint-disable-next-line no-use-before-define
      scheduleLog(req, cloud.getLogger());  //  Wait for next tick before writing.
      return 'OK';
    })
    .catch(dumpError);
}

// eslint-disable-next-line no-unused-vars
function scheduleLog(req, loggingLog0) {
  //  Schedule for the log to be written at every tick, if there are tasks.
  const size = batchSize(null);
  //  If not enough tasks to make a batch, try again later.
  if (logTasks.length < size) return;
  //  const loggingLog = loggingLog0;
  process.nextTick(() => {
    try {
      writeLog(req, cloud.getLogger())
        .catch(dumpError);
    } catch (err) { dumpError(err); }
  });
}

function flushLog(req) {
  //  We are about to quit.  Write all log items.
  return writeLog(req, null, true)
    .catch(dumpError);
}

function getLogMetadata(para, now, operation) {
  //  Return the mandatory metadata for Cloud Logging.
  const level = para.err ? 'ERROR' : 'DEBUG';
  const timestamp = new Date(now);
  const resource = process.env.GAE_SERVICE
    //  For Google App Engine.
    ? {
      type: 'gae_app',
      labels: {
        module_id: process.env.GAE_SERVICE,
        version_id: process.env.GAE_VERSION,
      } }
    //  For Google Cloud Functions.
    : { type: 'cloud_function', labels: { function_name: cloud.functionName } };
  const metadata = {
    timestamp,
    severity: level.toUpperCase(),
    operation,
    resource,
  };
  return metadata;
}

function deferLog(req, action, para0, record, now, operation, loggingLog0) { /* eslint-disable no-param-reassign */
  //  Write the action and parameters to Cloud Logging for normal log,
  //  or to Cloud Error Reporting if para contains error.
  //  loggingLog contains the Cloud logger.  Returns a promise.
  try {
    //  Don't log any null values, causes Log errors.
    const para = removeNulls(para0 || {});
    //  Log to a queue for easier analysis.
    //  eslint-disable-next-line no-use-before-define
    return logQueue(req, action, para)
      .catch(dumpError)
      .then(() => {
        //  Log the parameters.
        //  noinspection Eslint
        for (const key of Object.keys(para)) {  //  noinspection JSUnfilteredForInLoop
          let json = null;
          try {
            //   Strip off any special symbols.
            const val = para[key];
            if (key === '_req') continue;
            if (key === 'error' && (val === null || val === {})) continue;
            if (val === undefined) continue;
            json = stringify(val);
            record[key] = JSON.parse(json);
          } catch (err) {  /* eslint-disable no-console */
            console.error('deferLog', err.message, err.stack, json);
          } /* eslint-enable no-console */
        }
        //  Log the user properties.
        if (req.user) {
          record.user = { email: req.user.email || req.user.emails || req.user };
        }
        record.source = cloud.sourceName;
        if (!isProduction || process.env.CIRCLECI) {  //  Log to console in dev.
          const out = [action, util.inspect(record, { colors: true })].join(' | ');
          if (para.err) console.error(out);
          else console.log(out);
        }
        //  Else log to Cloud Logging.
        const direction =
          (para && para.result) ? '<<'    //  Call has completed
            : (action === 'start') ? '>>' //  Call has started
            : '__';
        let key = `_${direction}_[ ${para.device || req.device || ' ? ? ? '} ]____${action || '    '}____`;
        if (key.length < logKeyLength) key += '_'.repeat(logKeyLength - key.length);
        const event = {};
        event[key] = para;
        const metadata = getLogMetadata(para, now, operation);
        // console.log('deferLog2', key, JSON.stringify(event, null, 2), JSON.stringify(metadata, null, 2)); ////
        return loggingLog0.entry(metadata, event);
      })
      .catch(dumpNullError);
  } catch (err) {
    return Promise.resolve(dumpNullError(err));
  }
} /* eslint-enable no-param-reassign */

function getOperation(req, action, para) {
  //  Return the operation object for Cloud Logging.
  //  If para contains an error or result, end the child span.
  //  Else create the child span if this is the first time.
  const operationid = [
    action,
    (req.traceid && req.traceid[0]) ? req.traceid[0] : 'missing_traceid',
  ].join('_');
  const operation = {
    //  Optional. An arbitrary operation identifier. Log entries with the same identifier are assumed to be part of the same operation.
    id: operationid,
    //  Optional. An arbitrary producer identifier. The combination of id and producer must be globally unique. Examples for producer: "MyDivision.MyBigCompany.com", "github.com/MyProject/MyApplication".
    producer: 'unabiz.com',
    //  Optional. Set this to True if this is the first log entry in the operation.
    //  eslint-disable-next-line no-unneeded-ternary
    first: allSpanPromises[operationid] ? false : true,
    //  Optional. Set this to True if this is the last log entry in the operation.
    //  eslint-disable-next-line no-unneeded-ternary
    last: (para.err || para.result) ? true : false,
  };
  //  Don't instrument for Google App Engine.
  if (process.env.GAE_SERVICE || process.env.DISABLE_INSTRUMENTATION) return operation;

  //  If first time: Instrument the function by creating a child span.
  if (operation.first) allSpanPromises[operationid] = createChildSpan(req, action);
  else if (operation.last && allSpanPromises[operationid]) {
    //  If last time: End the child span.
    const promise = allSpanPromises[operationid];
    //  Change the promise to return null in case we call twice.
    allSpanPromises[operationid] = Promise.resolve(null);
    promise
      .then(span => (span ? span.end() : 'skipped'))
      .catch(dumpError);
  }
  return operation;
}

/* eslint-disable no-underscore-dangle, import/newline-after-import, no-param-reassign */
function log(req0, action, para0) {
  //  Write the action and parameters to Cloud Logging for normal log,
  //  or to Cloud Error Reporting if para contains error.
  //  Returns the error, if it exists, or the result, else null.
  //  req contains the Express or PubSub request info.
  //  Don't log any null values, causes Cloud Logging errors.
  try {
    const now = Date.now();
    const req = req0 || {};
    const para = Object.assign({}, para0);
    const err = para0.err || para0.error || null;

    if (!req.traceid) req.traceid = createTraceID(now);
    //  Compute the duration in seconds with 1 decimal place.
    if (req.starttime) para.duration = parseInt((now - req.starttime) / 100, 10) / 10.0;
    else req.starttime = now;
    if (err) dumpError(err, action, para);
    if (err && isProduction) {
      try {
        //  Report the error to the cloud.
        cloud.reportError(req, err, action, para);
      } catch (err2) { dumpError(err2); }
      try {
        //  Flush all logs.
        writeLog(req, null, true);
      } catch (err2) { dumpError(err2); }
    }
    const record = { timestamp: `${now}`, action };
    if (err) {
      //  If error appears in "error" field, move to "err" field.
      para.err = err;
      if (para.error) delete para.error;
      record.status = 'error';
    } else if (para.status) record.status = para.status;
    if (req) {
      //  Copy common request properties.
      if (req.userid) para.userid = req.userid;
      if (req.deviceid) para.deviceid = req.deviceid;
    }
    //  Create the log operation.
    const operation = getOperation(req, action, para);
    if (process.env.LOG_FOREGROUND) {  //  For debugging, log in foreground.
      deferLog(req, action, para, record, now, operation, cloud.getLogger())
        .then(entry => cloud.getLogger().write(entry))  // .catch(dumpError);
        .catch(error => console.error('log', error.message, error.stack));
      return err || para.result || null;
    }
    //  Enqueue and write the log in the next tick, so we don't block.
    logTasks.push(loggingLog0 => (
      deferLog(req, action, para, record, now, operation, loggingLog0)
        .catch(dumpError)
    ));
    scheduleLog({});  //  Schedule for next tick.
    return err || para.result || null;
  } catch (err) {
    dumpError(err);
    return para0 ? (para0.err || para0.error || para0.result || null) : null;
  }
} /* eslint-enable no-param-reassign, global-require */

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Messaging Functions: Dispatch messages between Cloud Functions via Google Cloud PubSub or AWS IoT MQTT Queues

//  Custom routing function to remap the projectId and topicName to deliver to another queue.
let customTransformRoute = null;

//  logQueue will log to the queues according to this array of { projectId, topicName }
let logQueueConfig = [];

//  Map of topic names that generated 'resource not found' errors and should not be sent.
const errorQueues = {};

function setLogQueue(config) {
  //  logQueue will log to the queues according to config, an array of { projectId, topicName }
  logQueueConfig = config || [];
}

function setRoute(route) {
  //  If required, set the routing function to remap the projectId and topicName to deliver to another queue.
  customTransformRoute = route;
}

function transformRoute(req, type, device, projectId, topicName) {
  //  If required, remap the projectId and topicName to deliver to another queue.
  if (customTransformRoute) return customTransformRoute(req, type, device, projectId, topicName);
  return { credentials: Object.assign({}, projectId), topicName };
}

function isProcessedMessage(/* req, message */) {
  //  Return true if this message is being or has been processed recently by this server
  //  or another server.  We check the central queue.  In case of error return false.
  //  Returns a promise.
  return Promise.resolve(false);  //  TODO
}

function publishJSON(req, topic, obj0) {
  //  Publish the object as a JSON message to the PubSub topic.
  //  Returns a promise.
  try {
    if (!topic || !obj0) return Promise.resolve('missing_topic_obj');
    if (errorQueues[topic.name]) {
      //  Don't send to queues that don't exist.
      return Promise.resolve(`skipped ${topic.name}`);
    }
    // eslint-disable-next-line no-param-reassign
    if (obj0.type === null) delete obj0.type;
    const obj = removeNulls(obj0);
    // console.log('publishJSON', topic.name, JSON.stringify(obj, null, 2));
    const buf = new Buffer(stringify(obj));
    const size = buf.length;
    return topic.publisher().publish(buf)
      .catch((error) => { // eslint-disable-next-line no-use-before-define
        console.error('publishJSON', error.message, error.stack, topic.name, size, buf.toString());
        if (error.message && error.message.toLowerCase().indexOf('resource not found') >= 0) {
          //  Queue does not exist.  Ignore future messages because exceptions are expensive to handle.
          errorQueues[topic.name] = error.message;
        }
        return error;
      });
  } catch (error) {
    console.error('publishJSON', error.message, error.stack);
    return Promise.resolve('OK');
  }
}

function logQueue(req, action, para0, logQueueConfig0) { /* eslint-disable global-require, no-param-reassign */
  //  Write log to a PubSub queue for easier analysis.
  //  If specified, logQueueConfig will override the default log queues.
  //  TODO: Reuse the PubSub clients to write batches of records.
  try {
    if (logQueueConfig.length === 0) return Promise.resolve('nothing');
    const now = Date.now();
    if (!req) req = {};
    if (!para0) para0 = {};
    if (!req.traceid) req.traceid = createTraceID(now);
    //  Compute the duration in seconds with 1 decimal place.
    if (req.starttime) para0.duration = parseInt((now - req.starttime) / 100, 10) / 10.0;
    else req.starttime = now;
    const starttime = req.starttime;
    const traceid = req.traceid;

    //  Extract the log fields.
    let userid = null;
    let companyid = null;
    let token = null;
    if (req.userid) userid = req.userid;
    if (req.companyid) companyid = req.companyid;
    if (req && req.get) token = req.get('Authorization') || req.get('token');
    if (token && token.length >= 20) token = `${token.substr(0, 20)}...`;
    const para = removeNulls(para0);

    //  Write the log to pubsub queues.  Each config contains { projectId, topicName }
    // eslint-disable-next-line no-unused-vars
    const msg = { timestamp: now, starttime, traceid, userid, companyid, token, action, para }; // eslint-disable-next-line prefer-const
    let promises = Promise.resolve('start');
    const result = [];
    (logQueueConfig0 || logQueueConfig).forEach((config) => {
      const topic = cloud.getQueue(req, config.projectId, config.topicName);
      promises = promises
        .then(() => publishJSON(req, topic, msg))
        //  Suppress any errors so logging can continue.
        .catch(dumpError)
        .then((res) => { result.push(res); });
    });
    return promises //  Suppress any errors.
      .catch(dumpError)
      .then(() => result);
  } catch (err) {
    return Promise.resolve(dumpError(err));
  }
} /* eslint-enable global-require, no-param-reassign */

function publishMessage(req, oldMessage, device, type) {
  //  Publish the message to the device or message type queue in PubSub.
  //  If device is non-null, publish to sigfox.devices.<<device>>
  //  If type is non-null, publish to sigfox.types.<<type>>
  //  If device and type are both null, publish to sigfox.received.
  //  If message contains options.unpackBody=true, then send message.body as the root of the
  //  message.  This is used for sending log messages to BigQuery via Google Cloud DataFlow.
  //  The caller must have called server/bigquery/validateLogSchema.
  //  Returns a promise for the PubSub publish result.
  const topicName0 = device
    ? `sigfox.devices.${device}`
    : type
      ? `sigfox.types.${type}`
      : 'sigfox.received';
  const projectId0 = (cloud.credentials && cloud.credentials.projectId)
    ? cloud.credentials.projectId : null;
  const res = transformRoute(req, type, device, projectId0, topicName0);
  const projectId = res.projectId;
  const topicName = res.topicName;
  const topic = cloud.getQueue(req, projectId, topicName);
  log(req, 'publishMessage', { device: oldMessage.device, type, topic: topic ? topic.name : null });
  let message = Object.assign({}, oldMessage,
    device ? { device: (device === 'all') ? oldMessage.device : device }
      : type ? { type }
      : { device: oldMessage.device });
  if (device === 'all') message.device = oldMessage.device;

  //  If no more routing, unpack the message for easier rule writing.
  let endOfRoute = false;
  if (isAWS) {
    //  TODO: AWS now unpacks the message at end of route.  To harmonise with Google Cloud.
    if (message.route && message.route.length === 0) {
      message.options = Object.assign({}, message.options, { unpackBody: true });
      endOfRoute = true;
    }
  }

  //  If message contains options.unpackBody=true, then send message.body as the root of the
  //  message.  This is used for sending log messages to BigQuery via Google Cloud DataFlow.
  //  The caller must have called server/bigquery/validateLogSchema.
  if (message.options && message.options.unpackBody) {
    //  The original content goes into "metadata" field.
    const metadata = message;
    message = message.body;
    delete metadata.body;
    message.metadata = metadata;
  }
  const pid = projectId || '';
  const destination = topicName;
  //  If you get an error here because the queue doesn't exist, it may be OK.
  //  sigfox.devices.all should always exist, but sigfox.devices.<<device>> and
  //  sigfox.types.<<type>> don't have to exist unless you need them for custom processing.
  return publishJSON(req, topic, message)
    .then((result) => {
      log(req, 'publishMessage', { result, destination, topicName, message, device: oldMessage.device, type, projectId: pid });
      if (!endOfRoute) return result;

      //  If no more routing, save the unpacked message as AWS Thing State.
      return cloud.createDevice(req, oldMessage.device)
        .then(() => cloud.updateDeviceState(req, oldMessage.device, message))
        .then(() => result)
        .catch((error) => {
          log(req, 'publishMessage', { error, destination, topicName, message, device: oldMessage.device, type });
          return result;  //  Suppress the error.
        });
    })
    .catch((error) => {
      log(req, 'publishMessage', { error, destination, topicName, message, device: oldMessage.device, type, projectId: pid });
      return error;  //  Suppress the error.
    });
}

function updateMessageHistory(req, oldMessage) {
  //  Update the message history in the message. Records the duration that
  //  was spent processing this request, also latency of message delivery.
  //  Message history is an array of records, from earliest to latest:
  //  [ { timestamp, end, duration, latency, source, function }, ... ]
  //  Source is the message queue that supplied the message:
  //  e.g. projects/myproject/topics/sigfox.devices.all
  //  Duration and latency are in seconds.
  //  Returns the updated clone of the message.
  const message = Object.assign({}, oldMessage);  //  Clone the message.
  if (!message.history) message.history = [];
  const timestamp = req.starttime;
  const end = Date.now();
  //  Compute the duration in seconds with 1 decimal place.
  const duration = timestamp ? (parseInt((end - timestamp) / 100, 10) / 10.0) : 0;
  //  Compute the latency between queues in second with 1 decimal place.
  const lastSend = (message.history.length > 0)
    ? message.history[message.history.length - 1].end
    : null;  //  Get the last send time.
  const latency = lastSend ? (parseInt((timestamp - lastSend) / 100, 10) / 10.0) : 0;
  //  Source looks like projects/myproject/topics/sigfox.devices.all
  const source = (req && req.event) ? req.event.resource : req.path;
  const rec = {
    timestamp,
    end,
    duration,
    latency,
    source,
    function: cloud.functionName,
  };
  message.history.push(rec);
  return message;
}

function dispatchMessage(req, oldMessage, device) {
  //  Dispatch the message to the next step in the route of the message.
  //  message contains { device, type, body, query, route }
  //  route looks like [ messagetype1, messagetype2, ... ]
  //  Returns a promise for the updated message.  Caller must have set
  //  const req = { starttime: Date.now(), event };
  if (!oldMessage) return Promise.resolve({});
  //  If already dispatched, return.
  if (oldMessage.isDispatched) return Promise.resolve(oldMessage);
  log(req, 'dispatchMessage', { device });
  //  Update the message history.
  const message = updateMessageHistory(req, oldMessage);
  if (!message.route || message.route.length === 0) {
    //  No more steps to dispatch, so exit.
    const result = message;
    log(req, 'dispatchMessage', { result, status: 'no_route', message, device });
    return Promise.resolve(result);
  }
  //  Get the next step and publish the message there.
  //  Don't use shift() because it mutates the original object:
  //  const type = msg.route.shift();
  message.type = message.route[0];
  message.route = message.route.slice(1);
  let dev = null;
  let type = message.type;
  if (isAWS) {
    //  TODO: Harmonise the routing logic between AWS and Google Cloud.
    if (type === 'all') {
      //  For AWS, send to sigfox.devices.deviceid when type=all.
      type = null;
      dev = device;
    }
  }
  const route = message.route;
  const destination = type;
  const result = message;
  return publishMessage(req, message, dev, type)
    .then(res => log(req, 'dispatchMessage',
      { result, destination, res, route, message, device, type }))
    .catch(error => log(req, 'dispatchMessage',
      { error, destination, route, message, device, type }))
    .then(() => result);
}

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Metadata Functions: Read function metadata from Google Cloud Metadata store and environment variables.

function getEnvironment(/* req */) {
  //  Returns the environment keys and values as metadata: { key1: val1, key2: val2, ... }
  //  On Google Cloud the keys can contain '-'.  But AWS environment doesn't allow.
  //  So we copy all keys with '_' and change to '-' instead.
  const metadata = Object.assign({}, process.env);
  const keys = Object.keys(metadata);
  for (const key of keys) {
    if (key.indexOf('_') < 0) continue;
    const val = metadata[key];
    metadata[key.split('_').join('-')] = val;
  }
  return metadata;
}

function getFunctionMetadata(req, authClient) {
  //  Returns a promise for function metadata keys and values: { key1: val1, key2: val2, ... }
  //  We get the cloud-specific metadata (e.g. Google Cloud Metadata Store) then
  //  merge with the environment variables.  Environment variables will override
  //  cloud-specific metadata.
  //  Get cloud metadata.
  return cloud.getFunctionMetadata(req, authClient)
    .then((cloudMetadata) => {
      //  Merge the environment metadata with cloud metadata.  Environment overrides cloud.
      const envMetadata = getEnvironment(req);
      const result = Object.assign({}, cloudMetadata, envMetadata);
      log(req, 'getFunctionMetadata', { result, cloudMetadata, envMetadata });
      return result;
    })
    .catch((error) => {
      log(req, 'getFunctionMetadata', { error });
      throw error;
    });
}

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Main Function

function runTask(req, event, task, device, body, message) {
  //  The task is the pluggable function, provided by the caller,
  //  that will perform a single step of Sigfox message processing
  //  e.g. decodeStructuredMessage, logToGoogleSheets.
  //  Wait for the task to complete then dispatch to next step.
  //  Returns a promise for the dispatched message.
  log(req, 'task', { device, body, event, message });
  let updatedMessage = message;
  return task(req, device, body, message)
    .then(result => log(req, 'task', { result, device, body, event, message }))
    .then((result) => { updatedMessage = result; return result; })
    .catch(error => log(req, 'task', { error, device, body, event, message }))
    .then(() => dispatchMessage(req, updatedMessage, device))
    //  Return the updated message as the result.
    .then(() => updatedMessage)
    .catch((error) => { throw error; });
}

function endTask(req) {
  //  Clean up before exiting by flushing the Cloud Log and Cloud Trace.
  //  Don't throw any errors here because the logs have closed.
  //  Returns a promise.
  return Promise.all([
    //  End the root span for Cloud Trace to write the trace.
    endRootSpan(req).catch(dumpError),
    //  Flush the log and wait for it to be completed.
    flushLog(req).catch(dumpError),
  ]);
}

function main(para1, para2, para3, para4) {
  //  Start point for the Cloud Function, which is triggered by the delivery
  //  of a queue message. Decode the Sigfox message and perform the task specified
  //  by the caller to process the Sigfox message.  Then dispatch the next step of
  //  the route in the message, previously set by routeMessage.
  //  task should have the signature task(req, device, body, message).
  //  For AWS, event is the message itself.
  //  For Google Cloud, event contains
  //  { eventType: "providers/cloud.pubsub/eventTypes/topic.publish"
  //    resource: "projects/myproject/topics/sigfox.devices.all"
  //    timestamp: "2017-05-06T10:19:29.666Z"
  //    data: {…}  //  Base64 encoded Sigfox message
  //    eventId: "120816659675797" }
  //  Google Cloud and AWS pass parameters differently.
  //  We send to the respective modules to decode.
  const para = cloud.init(para1, para2, para3, para4);
  const event = para.event;
  const task = para.task;
  let result = null;
  let error = null;
  if (!task) throw new Error('Task function missing');
  if (typeof task !== 'function') throw new Error(`Task should be a function, not ${typeof task}: ${task}`);
  const req = Object.assign({}, para.req, { starttime: Date.now(), event });  //  Record start time.
  //  Decode the message.
  const message = event.body ? event  //  AWS
    : JSON.parse(Buffer.from(event.data.data, 'base64').toString());  //  Google Cloud
  const device = message ? message.device : null;
  const body = message ? message.body : null;
  const rootTraceId = message.rootTraceId || null;
  req.uuid = body ? body.uuid : 'missing_uuid';
  Object.assign(req, { device, body, rootTraceId });  //  For logging and instrumentation.
  if (message.isDispatched) delete message.isDispatched;

  //  Continue the root-level span (created in sigfoxCallback) to trace this request across Cloud Functions.
  getRootSpan(req, rootTraceId);
  //  Write the first log record in Cloud Logging as "start".
  log(req, 'start', { device, body, event, message });

  //  If the message is already processed by another server, skip it.
  return isProcessedMessage(req, message)
    .then(isProcessed => (
      isProcessed
        ? log(req, 'skip', { result: message, isProcessed, device, body, event, message })
        //  Else wait for the task to complete then dispatch the next step.
        //  Suppress all errors else Google or AWS will retry the message.
        : (runTask(req, event, task, device, body, message)
          .catch((err) => { error = err; dumpError(err); }))
    ))
    .then((res) => { result = res; })
    //  Log the final result i.e. the dispatched message.
    .then(() => log(req, 'result', { result, device, body, event, message }))
    //  Flush the log and wait for it to be completed.
    .then(() => endTask(req))
    .catch(dumpError)
    //  Tell the cloud to close any logging connections.  Call the AWS callback.
    .then(() => cloud.shutdown(req, true, error, result));
}

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Exports

module.exports = (cloud0) => {
  //  Return the common interface that works for Google Cloud and AWS.
  //  Save the instance of sigfox-gcloud or sigfox-aws passed in. We expose the cloud-specific functions from the instance.
  if (cloud0) cloud = cloud0;
  return {
    isProduction,
    isGoogleCloud: cloud.isGoogleCloud,
    isAWS: cloud.isAWS,
    projectId: cloud.projectId,
    functionName: cloud.functionName,
    sleep,
    removeNulls,

    //  Logging
    log,
    error: log,
    flushLog,

    //  Instrumentation
    dumpError,
    dumpNullError,
    createTraceID,
    startRootSpan,

    //  Messaging
    publishJSON,
    logQueue,
    publishMessage,
    updateMessageHistory,
    dispatchMessage,

    //  Config
    setLogQueue,
    setRoute,

    //  Metadata
    authorizeFunctionMetadata: cloud.authorizeFunctionMetadata,
    getFunctionMetadata,

    //  Device State: device state functions for AWS.  Not implemented for Google Cloud yet.
    createDevice: cloud.createDevice,
    getDeviceState: cloud.getDeviceState,
    updateDeviceState: cloud.updateDeviceState,

    //  Startup
    init: cloud.init,
    main,
    endTask,

    //  For unit test only.
    getRootSpan,
    endRootSpan,
    createChildSpan,
  };
};

//  //////////////////////////////////////////////////////////////////////////////////// endregion
