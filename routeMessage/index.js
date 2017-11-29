//  Cloud Function routeMessage is triggered when a Sigfox message is received
//  by sigfoxCallback and delivered to sigfox.devices.all (Google Cloud) /
//  sigfox.received (AWS).  We set the route in the message, which determines
//  which queues will receive the message and the message processing functions
//  to be run (e.g. decodeStructuredMessage, sendToDatabase). The route is
//  configured in the Google Cloud Metadata store and AWS Lambda Environment Variables.

//  Don't call any database functions that may cause this function to fail
//  under heavy load.  High availability of this Cloud Function is
//  essential in order to route every Sigfox message efficiently.

/* eslint-disable camelcase,max-len,global-require,import/no-unresolved,no-nested-ternary */
//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region AutoInstall: List all dependencies here, or just paste the contents of package.json. AutoInstall will install these dependencies before calling wrap().
const package_json = /* eslint-disable quote-props,quotes,comma-dangle,indent */
//  PASTE PACKAGE.JSON BELOW  //////////////////////////////////////////////////////////
{
  "json-stringify-safe": "^5.0.1"
}
//  PASTE PACKAGE.JSON ABOVE  //////////////////////////////////////////////////////////
; /* eslint-enable quote-props,quotes,comma-dangle,indent */

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Declarations: Don't use any require() or process.env in this section because AutoInstall has not loaded our dependencies yet.

//  A route is an array of strings.  Each string indicates the next processing step,
//  e.g. ['decodeStructuredMessage', 'logToDatabase', ''logToUbidots'].
//  The route is stored in this key in the Google Cloud Metadata store and AWS Lambda Environment Variable.
const defaultRouteKey = 'sigfox-route';
const routeExpiry = 10 * 1000;  //  Routes expire in 10 seconds. Reload routes after expiry.

let defaultRoute = null;        //  The cached route.
let defaultRouteExpiry = null;  //  Cache expiry timestamp.

//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region Message Processing Code

function wrap(scloud) {  //  scloud will be either sigfox-gcloud or sigfox-aws, depending on platform.
  //  Wrap the module into a function so that all we defer loading of dependencies,
  //  and ensure that cloud resources are properly disposed. For AWS, wrap() is called after
  //  all dependencies have been loaded.
  let wrapCount = 0; //  Count how many times the wrapper was reused.

  //  List all require() here because AutoInstall has loaded our dependencies. Don't include sigfox-gcloud or sigfox-aws, they are added by AutoInstall.
  const stringify = require('json-stringify-safe');

  function getRoute(req) {
    //  Fetch the route from the Google Cloud Metadata store, which is easier
    //  to edit.  Previously we used a hardcoded route.
    //  Refresh the route every 10 seconds in case it has been updated.
    //  Returns a promise.

    //  Return the cached route if not expired.
    if (defaultRoute && defaultRouteExpiry >= Date.now()) return Promise.resolve(defaultRoute);
    //  Extend the expiry temporarily so we don't have 2 concurrent requests to fetch the route.
    if (defaultRoute) defaultRouteExpiry = Date.now() + routeExpiry;
    let authClient = null;
    let metadata = null;
    //  Get authorisation to access the metadata.
    return scloud.authorizeMetadata(req)
      .then((res) => { authClient = res; })
      //  Get the project metadata.
      .then(() => scloud.getMetadata(req, authClient))
      .then((res) => { metadata = res; })
      //  Convert the metadata to a JavaScript object.
      .then(() => scloud.convertMetadata(req, metadata))
      //  Return the default route from the metadata.
      .then(metadataObj => metadataObj[defaultRouteKey])
      .then((res) => {
        //  Cache for 10 seconds.
        //  result looks like 'decodeStructuredMessage,logToDatabase'
        //  Convert to ['decodeStructuredMessage', 'logToDatabase']
        const result = res.split(' ').join('').split(',');  //  Remove spaces.
        if (scloud.isAWS) {
          //  TODO: For AWS we start with sigfox.received and end with sigfox.devices.all.
          //  Last route for AWS is always "all".
          if (result.indexOf('all') < 0) result.push('all');
        }
        defaultRoute = result;
        defaultRouteExpiry = Date.now() + routeExpiry;
        scloud.log(req, 'getRoute', { result, device: req.device });
        return result;
      })
      .catch((error) => {
        scloud.log(req, 'getRoute', { error, device: req.device });
        //  In case of error, reuse the previous route if any.
        if (defaultRoute) return defaultRoute;
        throw error;
      });
  }

  function routeMessage(req, device, body, msg0) {
    //  Set the message route according to the map and device ID.
    //  message = { device, type, body, query }
    //  Returns a promise.
    const msg = Object.assign({}, msg0);
    return getRoute(req)
      .then((route) => {
        //  Must clone the route because it might be mutated accidentally.
        msg.route = JSON.parse(stringify(route || []));
        const result = msg;
        scloud.log(req, 'routeMessage', { result, route, device, body, msg });
        return result;
      })
      .catch((error) => {
        scloud.log(req, 'routeMessage', { error, device, body, msg });
        throw error;
      });
  }

  function task(req, device, body, msg) {
    //  The task for this Cloud Function: Set the route for the Sigfox message.
    //  The route is saved into the "route" field of the Sigfox message.
    console.log('task', { scloud }); //
    scloud.log(req, 'task', { device, body, msg, wrapCount }); wrapCount += 1;  //  Count how many times the wrapper was reused.
    return routeMessage(req, device, body, msg)
      .catch((error) => {
        scloud.log(req, 'task', { error, device, body, msg });
        throw error;
      });
  }

  //  Expose these functions outside of the wrapper. "task" is called to execute the
  //  wrapped function when the dependencies and the wrapper have been loaded.
  return { task };
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
