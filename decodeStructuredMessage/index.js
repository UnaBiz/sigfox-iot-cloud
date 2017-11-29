//  region Introduction
//  Cloud Function decodeStructuredMessage is triggered when a
//  Sigfox message is sent to the message queue
//  sigfox.types.decodeStructuredMessage.
//  We decode the structured sensor data inside the Sigfox message,
//  sent by unabiz-arduino library, containing field names and values.

//  See this for the definition of structured messages:
//  https://github.com/UnaBiz/unabiz-arduino/wiki/UnaShield

/* eslint-disable camelcase,max-len,global-require,import/no-unresolved,no-nested-ternary */
//  //////////////////////////////////////////////////////////////////////////////////// endregion
//  region AutoInstall: List all dependencies here, or just paste the contents of package.json. AutoInstall will install these dependencies before calling wrap().
const package_json = /* eslint-disable quote-props,quotes,comma-dangle,indent */
//  PASTE PACKAGE.JSON BELOW  //////////////////////////////////////////////////////////
{
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
  const structuredMessage = require('./structuredMessage');

  function decodeMessage(req, body) {
    //  Decode the packed binary SIGFOX message body data e.g. 920e5a00b051680194597b00
    //  2 bytes name, 2 bytes float * 10, 2 bytes name, 2 bytes float * 10, ...
    //  Returns a promise for the updated body.  If no body available, return {}.
    scloud.log(req, 'task', { wrapCount }); wrapCount += 1;  //  Count how many times the wrapper was reused.
    if (!body || !body.data) return Promise.resolve(Object.assign({}, body));
    try {
      const decodedData = structuredMessage.decodeMessage(body.data);
      const result = Object.assign({}, body, decodedData);
      scloud.log(req, 'decodeMessage', { result, body, device: req.device });
      return Promise.resolve(result);
    } catch (error) {
      //  In case of error, return the original message.
      scloud.log(req, 'decodeMessage', { error, body, device: req.device });
      return Promise.resolve(body);
    }
  }

  function task(req, device, body, msg) {
    //  The task for this Cloud Function:
    //  Decode the structured body in the Sigfox message.
    //  This adds additional decoded fields to the message body,
    //  e.g. tmp (temperature), hmd (humidity), alt (altitude).
    return decodeMessage(req, body)
    //  Return the message with the body updated.
      .then(updatedBody => Object.assign({}, msg, { body: updatedBody, device: req.device }))
      .catch((error) => { throw error; });
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
