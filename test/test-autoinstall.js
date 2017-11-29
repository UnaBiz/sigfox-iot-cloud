//  Test to verify that AutoInstall can install dependencies and run a wrapper.
//  For AWS: Copy the entire source code and paste into a Lambda function.
//    Set Handler to "index.main".  Set Environment variable NODE_ENV to "production".
//    Set Memory to 512 MB. Set Timeout to 5 mins.
//    Set Execution Role to "lambda_iot", where "lambda_iot" is a role defined with
//    policy "LambdaExecuteIoTUpdate" (see "../policy/LambdaExecuteIoTUpdate.json").

/* eslint-disable camelcase,max-len,global-require,import/no-unresolved,no-nested-ternary */
//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region AutoInstall: List all dependencies here, or just paste the contents of package.json. AutoInstall will install these dependencies before calling wrap().
const package_json = /* eslint-disable quote-props,quotes,comma-dangle,indent */
//  PASTE PACKAGE.JSON BELOW  //////////////////////////////////////////////////////////
{
  "uuid": "^3.1.0"
}
//  PASTE PACKAGE.JSON ABOVE  //////////////////////////////////////////////////////////
; /* eslint-enable quote-props,quotes,comma-dangle,indent */

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Declarations: Don't use any require() or process.env in this section because AutoInstall has not loaded our dependencies yet.

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Message Processing Code

function wrap(scloud) {  //  scloud will be either sigfox-gcloud or sigfox-aws, depending on platform.
  //  Wrap the module into a function so that all we defer loading of dependencies,
  //  and ensure that cloud resources are properly disposed. For AWS, wrap() is called after
  //  all dependencies have been loaded.
  let wrapCount = 0; //  Count how many times the wrapper was reused.

  //  List all require() here because AutoInstall has loaded our dependencies. Don't include sigfox-gcloud or sigfox-aws, they are added by AutoInstall.
  const uuid = require('uuid');  // For testing only.

  function main(event, context, callback) {
    console.log({ wrapCount }); wrapCount += 1;  //  Count how many times the wrapper was reused.

    console.log('main', { event, context, callback, scloud, uuid });
    return callback(null, 'OK');
  }
  //  Expose these functions outside of the wrapper.
  //  "main" is called to execute the wrapped function when the dependencies and wrapper have been loaded.
  return { main };
}

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Standard Code for AutoInstall Startup Function 1.0.  Do not modify.  https://github.com/UnaBiz/sigfox-iot-cloud/blob/master/autoinstall.js
/*  eslint-disable camelcase,no-unused-vars,import/no-absolute-path,import/no-unresolved,no-use-before-define,global-require,max-len,no-tabs,brace-style,import/no-extraneous-dependencies */
const wrapper = {};  //  The single reused wrapper instance (initially empty) for invoking the module functions.
exports.main = process.env.FUNCTION_NAME ? require('sigfox-gcloud/main').getMainFunction(wrapper, wrap, package_json)  //  Google Cloud.
  : (event, context, callback) => {
    const afterExec = error => error ? callback(error, 'AutoInstall Failed')
      : require('/tmp/autoinstall').installAndRunWrapper(event, context, callback, package_json, __filename, wrapper, wrap);
    if (require('fs').existsSync('/tmp/autoinstall.js')) return afterExec(null);  //  Already downloaded.
    const cmd = 'curl -s -S -o /tmp/autoinstall.js https://raw.githubusercontent.com/UnaBiz/sigfox-iot-cloud/master/autoinstall.js';
    const child = require('child_process').exec(cmd, { maxBuffer: 1024 * 500 }, afterExec);
    child.stdout.on('data', console.log); child.stderr.on('data', console.error); return null; };
//  exports.main is the startup function for AWS Lambda and Google Cloud Function.
//  When AWS starts our Lambda function, we load the autoinstall script from GitHub to install any NPM dependencies.
//  For first run, install the dependencies specified in package_json and proceed to next step.
//  For future runs, just execute the wrapper function with the event, context, callback parameters.
//  //////////////////////////////////////////////////////////////////////////////////// endregion

/* Expected Output:
START RequestId:  Version: $LATEST
2017-11-27T10:30:30.871Z		total 12
-rw-rw-r-- 1 sbx_user1060 486 6351 Nov 27 10:30 autoinstall.js
-rw-rw-r-- 1 sbx_user1060 486 233 Nov 27 10:30 package.json

2017-11-27T10:30:49.772Z		/tmp
├─┬ sigfox-aws@2.0.2
│ ├─┬ aws-sdk@2.157.0
│ │ ├─┬ buffer@4.9.1
│ │ │ ├── base64-js@1.2.1
│ │ │ ├── ieee754@1.1.8
│ │ │ └── isarray@1.0.0
│ │ ├── crypto-browserify@1.0.9
│ │ ├── events@1.1.1
│ │ ├── jmespath@0.15.0
│ │ ├── querystring@0.2.0
│ │ ├── sax@1.2.1
│ │ ├─┬ url@0.10.3
│ │ │ └── punycode@1.3.2
│ │ ├── xml2js@0.4.17
│ │ └─┬ xmlbuilder@4.2.1
│ │ └── lodash@4.17.4
│ ├─┬ aws-xray-sdk-core@1.1.6
│ │ ├─┬ continuation-local-storage@3.2.1
│ │ │ ├─┬ async-listener@0.6.8
│ │ │ │ └── shimmer@1.2.0
│ │ │ └── emitter-listener@1.1.1
│ │ ├── moment@2.19.2
│ │ ├── pkginfo@0.4.1
│ │ ├── semver@5.4.1
│ │ ├── underscore@1.8.3
│ │ └─┬ winston@2.4.0
│ │ ├── async@1.0.0
│ │ ├── colors@1.0.3
│ │ ├── cycle@1.0.3
│ │ ├── eyes@0.1.8
│ │ ├── isstream@0.1.2
│ │ └── stack-trace@0.0.10
│ └─┬ sigfox-iot-cloud@1.0.2
│ └── json-stringify-safe@5.0.1
└── uuid@3.1.0


2017-11-27T10:30:49.813Z		total 20
-rw-rw-r-- 1 sbx_user1060 486 6351 Nov 27 10:30 autoinstall.js
drwxrwxr-x 38 sbx_user1060 486 4096 Nov 27 10:30 node_modules
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 npm-16-9cd3e1cb
-rw-rw-r-- 1 sbx_user1060 486 233 Nov 27 10:30 package.json

2017-11-27T10:30:49.849Z		total 156
drwxrwxr-x 4 sbx_user1060 486 4096 Nov 27 10:30 async
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 async-listener
drwxrwxr-x 9 sbx_user1060 486 4096 Nov 27 10:30 aws-sdk
drwxrwxr-x 4 sbx_user1060 486 4096 Nov 27 10:30 aws-xray-sdk-core
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 base64-js
drwxrwxr-x 4 sbx_user1060 486 4096 Nov 27 10:30 buffer
drwxrwxr-x 7 sbx_user1060 486 4096 Nov 27 10:30 colors
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 continuation-local-storage
drwxrwxr-x 4 sbx_user1060 486 4096 Nov 27 10:30 crypto-browserify
drwxrwxr-x 2 sbx_user1060 486 4096 Nov 27 10:30 cycle
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 emitter-listener
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 events
drwxrwxr-x 4 sbx_user1060 486 4096 Nov 27 10:30 eyes
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 ieee754
drwxrwxr-x 2 sbx_user1060 486 4096 Nov 27 10:30 isarray
drwxrwxr-x 2 sbx_user1060 486 4096 Nov 27 10:30 isstream
drwxrwxr-x 4 sbx_user1060 486 4096 Nov 27 10:30 jmespath
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 json-stringify-safe
drwxrwxr-x 3 sbx_user1060 486 20480 Nov 27 10:30 lodash
drwxrwxr-x 5 sbx_user1060 486 4096 Nov 27 10:30 moment
drwxrwxr-x 5 sbx_user1060 486 4096 Nov 27 10:30 pkginfo
drwxrwxr-x 2 sbx_user1060 486 4096 Nov 27 10:30 punycode
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 querystring
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 sax
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 semver
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 shimmer
drwxrwxr-x 7 sbx_user1060 486 4096 Nov 27 10:30 sigfox-aws
drwxrwxr-x 6 sbx_user1060 486 4096 Nov 27 10:30 sigfox-iot-cloud
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 stack-trace
drwxrwxr-x 2 sbx_user1060 486 4096 Nov 27 10:30 underscore
drwxrwxr-x 2 sbx_user1060 486 4096 Nov 27 10:30 url
drwxrwxr-x 4 sbx_user1060 486 4096 Nov 27 10:30 uuid
drwxrwxr-x 4 sbx_user1060 486 4096 Nov 27 10:30 winston
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 xml2js
drwxrwxr-x 3 sbx_user1060 486 4096 Nov 27 10:30 xmlbuilder

2017-11-27T10:30:49.850Z		Creating /tmp/index.js
2017-11-27T10:30:49.850Z		require /tmp/index.js
2017-11-27T10:30:49.851Z		Calling handler in /tmp/index.js from /tmp/autoinstall.js...
2017-11-27T10:30:49.851Z		Creating instance of wrap function... /tmp/autoinstall.js
2017-11-27T10:30:50.132Z		AWS_XRAY_DAEMON_ADDRESS is set. Configured daemon address to 169.254.79.2:2000.
2017-11-27T10:30:50.135Z		AWS_XRAY_CONTEXT_MISSING is set. Configured context missing strategy to LOG_ERROR.
2017-11-27T10:30:50.191Z		Subsegment streaming threshold set to: 0
2017-11-27T10:30:50.193Z		Using custom sampling rules source.
2017-11-27T10:30:50.951Z		{ wrapCount: 0 }
2017-11-27T10:30:50.953Z		main { event: { key3: 'value3', key2: 'value2', key1: 'value1' },
context:
{ callbackWaitsForEmptyEventLoop: [Getter/Setter],
done: [Function: done],
succeed: [Function: succeed],
fail: [Function: fail],
logGroupName: '/aws/lambda/testExec',
logStreamName: '2017/11/27/[$LATEST]22c0cd388e224f2690ec15b3fad92aa5',
functionName: 'testExec',
memoryLimitInMB: '640',
functionVersion: '$LATEST',
getRemainingTimeInMillis: [Function: getRemainingTimeInMillis],
invokeid: '',
awsRequestId: '',
invokedFunctionArn: 'arn:aws:lambda:ap-southeast-1:112039193356:function:testExec',
autoinstalled: true },
callback: [Function: callback],
scloud:
{ isGoogleCloud: false,
isAWS: true,
projectId: null,
functionName: 'testExec',
sleep: [Function: sleep],
removeNulls: [Function: removeNulls],
log: [Function: log],
error: [Function: log],
flushLog: [Function: flushLog],
dumpError: [Function: dumpError],
dumpNullError: [Function: dumpNullError],
createTraceID: [Function: createTraceID],
startRootSpan: [Function: startRootSpan],
publishJSON: [Function: publishJSON],
logQueue: [Function: logQueue],
publishMessage: [Function: publishMessage],
updateMessageHistory: [Function: updateMessageHistory],
dispatchMessage: [Function: dispatchMessage],
setLogQueue: [Function: setLogQueue],
setRoute: [Function: setRoute],
createDevice: [Function: createDevice],
getDeviceState: [Function: getDeviceState],
updateDeviceState: [Function: updateDeviceState],
init: [Function: init],
main: [Function: main],
endTask: [Function: endTask],
getRootSpan: [Function: getRootSpan],
endRootSpan: [Function: endRootSpan],
createChildSpan: [Function: createChildSpan] },
uuid: { [Function: v4] v1: [Function: v1], v4: [Circular] } }
END RequestId:
REPORT RequestId: 	Duration: 20561.86 ms	Billed Duration: 20600 ms Memory Size: 640 MB	Max Memory Used: 231 MB
*/

/* Subsequent Run:
START RequestId: 763fab4a-d35e-11e7-837f-4109beff3ef1 Version: $LATEST
2017-11-27T10:33:52.274Z	763fab4a-d35e-11e7-837f-4109beff3ef1	Reusing /tmp/index.js
2017-11-27T10:33:52.274Z	763fab4a-d35e-11e7-837f-4109beff3ef1	require /tmp/index.js
2017-11-27T10:33:52.274Z	763fab4a-d35e-11e7-837f-4109beff3ef1	Calling handler in /tmp/index.js from /tmp/autoinstall.js...
2017-11-27T10:33:52.274Z	763fab4a-d35e-11e7-837f-4109beff3ef1	{ wrapCount: 1 }
2017-11-27T10:33:52.274Z	763fab4a-d35e-11e7-837f-4109beff3ef1	main { event: { key3: 'value3', key2: 'value2', key1: 'value1' },
context:
{ callbackWaitsForEmptyEventLoop: [Getter/Setter],
done: [Function: done],
succeed: [Function: succeed],
fail: [Function: fail],
logGroupName: '/aws/lambda/testExec',
logStreamName: '2017/11/27/[$LATEST]22c0cd388e224f2690ec15b3fad92aa5',
functionName: 'testExec',
memoryLimitInMB: '640',
functionVersion: '$LATEST',
getRemainingTimeInMillis: [Function: getRemainingTimeInMillis],
invokeid: '763fab4a-d35e-11e7-837f-4109beff3ef1',
awsRequestId: '763fab4a-d35e-11e7-837f-4109beff3ef1',
invokedFunctionArn: 'arn:aws:lambda:ap-southeast-1:112039193356:function:testExec',
autoinstalled: true },
callback: [Function: callback],
scloud:
{ isGoogleCloud: false,
isAWS: true,
projectId: null,
functionName: 'testExec',
sleep: [Function: sleep],
removeNulls: [Function: removeNulls],
log: [Function: log],
error: [Function: log],
flushLog: [Function: flushLog],
dumpError: [Function: dumpError],
dumpNullError: [Function: dumpNullError],
createTraceID: [Function: createTraceID],
startRootSpan: [Function: startRootSpan],
publishJSON: [Function: publishJSON],
logQueue: [Function: logQueue],
publishMessage: [Function: publishMessage],
updateMessageHistory: [Function: updateMessageHistory],
dispatchMessage: [Function: dispatchMessage],
setLogQueue: [Function: setLogQueue],
setRoute: [Function: setRoute],
createDevice: [Function: createDevice],
getDeviceState: [Function: getDeviceState],
updateDeviceState: [Function: updateDeviceState],
init: [Function: init],
main: [Function: main],
endTask: [Function: endTask],
getRootSpan: [Function: getRootSpan],
endRootSpan: [Function: endRootSpan],
createChildSpan: [Function: createChildSpan] },
uuid: { [Function: v4] v1: [Function: v1], v4: [Circular] } }
END RequestId: 763fab4a-d35e-11e7-837f-4109beff3ef1
REPORT RequestId: 763fab4a-d35e-11e7-837f-4109beff3ef1	Duration: 36.36 ms	Billed Duration: 100 ms Memory Size: 640 MB	Max Memory Used: 231 MB
*/
