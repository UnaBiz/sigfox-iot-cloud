/* eslint-disable global-require,camelcase,import/no-dynamic-require,no-console,max-len,import/no-extraneous-dependencies,import/no-unresolved */
//  This script allows you to use require(...) for NPM modules in AWS Lambda Functions,
//  without preinstalling or bundling the dependencies in advance.  The AWS Lambda Function
//  should call the install() function passing a package.json that lists the
//  NPM modules to be installed.  The NPM modules will be installed in /tmp/node_modules.
//  This is meant to replicate the auto NPM install feature in Google Cloud.
//  This is not as fast as preinstalling and bundling the dependencies,
//  but it's easier to maintain and faster to prototype.  The first call
//  is slower because it loads the dependencies, but subsequent calls will
//  be faster because AWS reuses the dependencies until it spawns another Lambda instance.
//  Standard template with sample usage: https://github.com/UnaBiz/sigfox-iot-cloud/blob/master/test/test-autoinstall.js

const sigfoxGCloudDependency = 'sigfox-gcloud';  //  Name of sigfox-gcloud dependency.
const sigfoxAWSDependency = 'sigfox-aws';  //  Name of sigfox-aws dependency.
const sigfoxAWSMain = `${sigfoxAWSDependency}/main`;
const sigfoxAWSVersion = 'latest';  //  Version of sigfox-aws to include.
const tmp = '/tmp';  //  Relocate code here.
const sourceFilename = 'index.js';  //  Lambda source code will be written to this filename.
const packageFilename = 'package.json';  //  Package.json will be written to this filename.
const installedSourceFilename = `${tmp}/${sourceFilename}`;
const installedPackageFilename = `${tmp}/${packageFilename}`;

//  Show a message in case of errors.
process.on('uncaughtException', err => console.error('uncaughtException', err.message, err.stack));  //  Display uncaught exceptions.
process.on('unhandledRejection', (reason, p) => console.error('unhandledRejection', reason, p));  //  Display uncaught promises.

const fs = require('fs');
const exec = require('child_process').exec;

function reloadLambda(event, context, callback) {
  //  Load the relocated Lambda Function at /tmp/index.js and call it.
  console.log('AutoInstall require', installedSourceFilename);
  const installedModule = require(installedSourceFilename);
  console.log(`AutoInstall Calling handler in ${installedSourceFilename} from ${__filename}...`);
  //  Set a flag so we know that we have reloaded.
  //  eslint-disable-next-line no-param-reassign
  context.autoinstalled = true;
  if (installedModule.main) return installedModule.main(event, context, callback);
  throw new Error('Handler not found - should be named "main"');
}

function addDependencies(package_json) {
  //  Add necessary dependencies to package_json before installing.  Return the updated package_json.
  //  If the package.json passed in doesn't contain "dependencies", wrap it as "dependencies".
  let packageObj = package_json || {};
  if (!packageObj.dependencies) packageObj = { dependencies: packageObj };
  //  Remove sigfox-gcloud if included.
  if (packageObj.dependencies[sigfoxGCloudDependency]) delete packageObj.dependencies[sigfoxGCloudDependency];
  //  Include the right version of sigfox-aws.
  const dependencies = [{ dependency: sigfoxAWSDependency, version: sigfoxAWSVersion }];
  if (process.env.AUTOINSTALL_DEPENDENCY) {
    //  If environment contains AUTOINSTALL_DEPENDENCY, add that dependency too.
    //  e.g. AUTOINSTALL_DEPENDENCY= sigfox-aws-data / AUTOINSTALL_VERSION= >=0.0.11
    const dependency = process.env.AUTOINSTALL_DEPENDENCY.trim()
    //  If dependency contains "/" like "sigfox-iot-cloud/sigfoxCallback", take the first part.
      .split('/', 2)[0];
    //  If version is missing, assume latest.
    const version = (process.env.AUTOINSTALL_VERSION || 'latest').trim();
    dependencies.push({ dependency, version });
  }
  //  Add the dependencies.
  dependencies.forEach((dep) => {
    console.log(`AutoInstall Added dependency ${dep.dependency} version ${dep.version}`);
    packageObj.dependencies[dep.dependency] = dep.version;
  });
  //  Add description, repository, license if missing.  NPM will complain if missing.
  packageObj = Object.assign({
    description: '(missing)',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'git+https://github.com/UnaBiz/sigfox-iot-cloud.git',
    },
  }, packageObj);
  //  Return the new package_json for installation.
  return packageObj;
}

function installDependencies(package_json, event, context, callback, sourceCode) {
  //  Copy the specified source code to /tmp/index.js. Write package_json to /tmp/package.json.
  //  Then run "npm install" to install dependencies from package.json.
  //  Finally reload /tmp/index.js and continue execution from the handler.
  //  This is not as fast as preinstalling and bundling the dependencies,
  //  but it's easier to maintain and faster to prototype.

  //  If package.json and source code file both exist in /tmp, then assume already installed.
  if (fs.existsSync(installedPackageFilename) && fs.existsSync(installedSourceFilename)) {
    console.log('AutoInstall Reusing', installedSourceFilename);
    return reloadLambda(event, context, callback);
  }
  //  Add the necessary dependencies before installing.
  const packageObj = addDependencies(package_json);
  //  Write the provided package.json and call "npm install".
  fs.writeFileSync(installedPackageFilename, JSON.stringify(packageObj, null, 2));
  const cmd = [  //  This shell script will be executed in the Lambda shell.
    `export HOME=${tmp}`,
    `cd ${tmp}`,
    `echo "Before install - ${tmp}:"; ls -l`,
    'npm install --only=prod',
    `echo "After install - ${tmp}:"; ls -l`,
    `echo "After install - ${tmp}/node_modules:"; ls -l node_modules`,
  ].join('; ');
  console.log('AutoInstall started, installing dependencies...');
  const child = exec(cmd, { maxBuffer: 1024 * 500 }, (error) => {
    //  NPM command failed.
    if (error) return callback(error, 'AutoInstall Failed');
    //  Write the source code file to indicate that we have succeeded.
    console.log('AutoInstall Creating', installedSourceFilename);
    fs.writeFileSync(installedSourceFilename, sourceCode);
    //  Load the relocated source file at /tmp/index.js and call it.
    return reloadLambda(event, context, callback);
  });
  //  Log stdout and stderr from the NPM command to show any errors.
  child.stdout.on('data', console.log);
  child.stderr.on('data', console.error);
  return null;
}

function installAndRunWrapper(event, context, callback, package_json, sourceFile,
  wrapVar, wrapFunc0) { /* eslint-disable no-param-reassign */
  //  Copy the specified Lambda function source file to /tmp/index.js.
  //  Write package_json to /tmp/package.json.
  //  Then run "npm install" to install dependencies from package.json.
  //  Then reload /tmp/index.js, create an instance of the wrap()
  //  function, save into wrapVar and call wrap().main(event, context, callback)
  if (!context.autoinstallStart) context.autoinstallStart = Date.now();
  let wrapFunc = wrapFunc0;
  if (!wrapFunc) {
    //  If wrap function is missing, set
    //  wrap = () => require(AUTOINSTALL_DEPENDENCY)
    const dependency = (process.env.AUTOINSTALL_DEPENDENCY || '').trim();
    if (dependency.length === 0) throw new Error('wrap function is missing');
    wrapFunc = () => require(dependency);
  }
  //  Preserve the wrapper in the context so it won't be changed during reload.
  //  if (!context.wrapVar) context.wrapVar = wrapVar;
  //  Check whether dependencies are installed.
  if (!context.autoinstalled && !context.unittest) {
    //  Dependencies not installed yet.
    //  Read the source code of the Lambda function so that we may
    //  relocate it to /tmp and call it after installing dependencies.
    const sourceCode = fs.readFileSync(sourceFile);
    //  Install the dependencies in package_json and re-run the
    //  Lambda function after relocating to /tmp/index.js.
    return installDependencies(package_json, event, context, callback, sourceCode);
  }
  //  We have been reloaded with dependencies installed.  Get the main function.
  const mainFunc = require(sigfoxAWSMain).getMainFunction(wrapVar, wrapFunc, package_json);
  //  Run the wrapper, setting "this" to the wrap instance.
  return mainFunc(event, context, callback);
} /* eslint-enable no-param-reassign */

module.exports = {
  installAndRunWrapper,
};
