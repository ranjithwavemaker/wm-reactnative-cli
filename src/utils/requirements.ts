import * as fs from 'fs';
import * as os from 'os';
import * as semver from 'semver';
import prompt = require('prompt');

import logger from './logger';
import { exec } from './exec';

const loggerLabel = 'rn-cli-requirements';

interface Versions {
    [key: string]: string;
}

let VERSIONS: Versions = {
    'NODE': '14.0.0',
    'POD': '1.9.0',
    'JAVA': '11.0.0',
    'REACT_NATIVE': '0.68.2',
    'EXPO': '5.4.4',
};

async function checkAvailability(cmd: string, transformFn?: (output: string) => string, projectSrc?: string): Promise<string | false> {
    try {
        let options: { cwd?: string } = {};
        if (projectSrc) {
            options = {
                cwd: projectSrc
            };
        }
        let output = (await exec(cmd, ['--version'])).join('');

        if (transformFn) {
            output = transformFn(output);
        }
        
        const versionMatch = output.match(/[0-9]+\.[0-9\.]+/);
        if (!versionMatch) {
            return false;
        }
        
        let version = versionMatch[0];

        logger.info({
            'label': loggerLabel,
            'message': cmd + ' version available is ' + version
        });
        
        const requiredVersion = VERSIONS[cmd.toUpperCase()];
        const coercedVersion = semver.coerce(version);
        if (!coercedVersion) {
            return false;
        }
        
        version = coercedVersion.version;
        
        if (requiredVersion && semver.lt(version, requiredVersion)) {
            logger.error('Minimum ' + cmd + ' version required is ' + requiredVersion + '. Please update the version.');
            return false;
        }
        return version;
    } catch(e) {
        console.error(e);
        logger.error('Observing error while checking ' + cmd.toUpperCase() + ' availability');
        return false;
    }
}

async function checkForGradleAvailability(): Promise<string | false> {
    return await checkAvailability('gradle', o => o && o.substring(o.indexOf('Gradle')));
}

async function checkForAndroidStudioAvailability(): Promise<boolean> {
    const ANDROID_HOME = process.env['ANDROID_HOME'];
    const ANDROID_SDK_ROOT = process.env['ANDROID_SDK_ROOT'];
    
    if (ANDROID_HOME && !ANDROID_SDK_ROOT) {
        logger.warn({
            'label': loggerLabel,
            'message': 'ANDROID_HOME is deprecated. Recommended to set ANDROID_SDK_ROOT'
        });
    }
    
    const envVariable = ANDROID_SDK_ROOT || ANDROID_HOME;
    if (!envVariable) {
        logger.error({
            'label': loggerLabel,
            'message': 'Failed to find \'ANDROID_SDK_ROOT\' environment variable. Try setting it manually.\n' +
            'Try update your \'PATH\' to include path to valid SDK directory.'});
        return false;
    }
    
    if (!fs.existsSync(envVariable)) {
        logger.error({
            'label': loggerLabel,
            'message': '\'ANDROID_HOME\' environment variable is set to non-existent path: ' + ANDROID_HOME +
            '\nTry update it manually to point to valid SDK directory.'});
        return false;
    }
    
    let sdkPath = envVariable + '/tools/bin/sdkmanager';

    // file extension has to be added for windows os for existsSync to work.
    sdkPath = os.type().includes('Windows') ? sdkPath + '.bat' : sdkPath;

    if (fs.existsSync(sdkPath)) {
        logger.info({
            'label': loggerLabel,
            'message': 'Found Android SDK manager at ' + sdkPath
        });
        
        try {
            await exec(sdkPath, ['--list']);
        } catch(e) {
            console.warn(e);
        }
    } else {
        logger.warn({
            'label': loggerLabel,
            'message': 'Failed to find \'android-sdk\' in your \'PATH\'. Install Android-Studio before proceeding to build.'});
    }
    
    return true;
}

async function hasValidJavaVersion(): Promise<boolean> {
    try {
        const javaOutput = (await exec('java', ['-version'])).join('');
        const versionMatch = javaOutput.match(/[0-9\.]+/);
        
        if (!versionMatch) {
            return false;
        }
        
        const javaVersion = versionMatch[0];
        const coercedVersion = semver.coerce(javaVersion);
        
        if (!coercedVersion || semver.lt(coercedVersion.version, VERSIONS.JAVA)) {
            logger.error('Minimum java version required is ' + VERSIONS.JAVA + '. Please update the java version.');
            return false;
        }

        const envVariable = process.env['JAVA_HOME'];

        if (!envVariable) {
            logger.error({
                'label': loggerLabel,
                'message': 'Failed to find \'JAVA_HOME\' environment variable. Try setting it manually.\n' +
                'Try update your \'PATH\' to include path to valid directory.'});
            return false;
        }
        
        return true;
    } catch(e) {
        return false;
    }
}

async function isGitInstalled(): Promise<string | false> {
    return await checkAvailability('git');
}

async function hasYarnPackage(): Promise<string | false> {
    return await checkAvailability('yarn');
}

async function isCocoaPodsInstalled(): Promise<string | false> {
    return await checkAvailability('pod');
}

async function hasValidNodeVersion(): Promise<string | false> {
    return await checkAvailability('node');
}

async function hasValidExpoVersion(): Promise<boolean> {
    // return await checkAvailability('expo');
    return true;
}

function validateForAndroid(keyStore: string, storePassword: string, keyAlias: string, keyPassword: string): string[] {
    let errors: string[] = [];
    
    if (!(keyStore && fs.existsSync(keyStore))) {
        errors.push(`keystore is required (valid file): ${keyStore}`);
    }
    if (!keyAlias) {
        errors.push('keyAlias is required.');
    }
    if (!keyPassword) {
        errors.push('keyPassword is required.');
    }
    if (!storePassword) {
        errors.push('storePassword is required.');
    }
    
    return errors;
}

function validateForIos(certificate: string, password: string, provisionalFilePath: string, buildType: string): string[] {
    let errors: string[] = [];
    
    if (!(certificate && fs.existsSync(certificate))) {
        errors.push(`p12 certificate does not exists : ${certificate}`);
    }
    if (!password) {
        errors.push('password to unlock certificate is required.');
    }
    if (!(provisionalFilePath && fs.existsSync(provisionalFilePath))) {
        errors.push(`Provisional file does not exists : ${provisionalFilePath}`);
    }
    if (!buildType) {
        errors.push('Package type is required.');
    }
    
    return errors;
}

async function showConfirmation(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
        prompt.get({
            properties: {
                confirm: {
                    pattern: /^(yes|no|y|n)$/gi,
                    description: message,
                    message: 'Type yes/no',
                    required: true,
                    default: 'no'
                }
            }
        }, function (err: Error | null, result: any) {
            if (err) {
                reject(err);
                return;
            }
            resolve(result.confirm.toLowerCase());
        });
    });
}

async function canDoEmbed(): Promise<boolean> {
    let flag = true;
    flag = flag && !!(await hasValidNodeVersion());
    flag = flag && !!(await hasYarnPackage());
    flag = flag && !!(await isGitInstalled());
    flag = flag && await hasValidExpoVersion();
    return flag;
}

async function canDoIosBuild(): Promise<boolean> {
    let flag = true;
    flag = flag && !!(await hasValidNodeVersion());
    flag = flag && !!(await hasYarnPackage());
    flag = flag && !!(await isGitInstalled());
    flag = flag && await hasValidExpoVersion();
    flag = flag && !!(await isCocoaPodsInstalled());
    return flag;
}

async function canDoAndroidBuild(): Promise<boolean> {
    let flag = true;
    flag = flag && !!(await hasValidNodeVersion());
    flag = flag && !!(await hasYarnPackage());
    flag = flag && !!(await isGitInstalled());
    flag = flag && !!(await hasValidExpoVersion());
    flag = flag && await hasValidJavaVersion();
    flag = flag && !!(await checkForGradleAvailability());
    return flag;
}

export {
    validateForIos,
    validateForAndroid,
    isCocoaPodsInstalled,
    isGitInstalled,
    hasYarnPackage,
    hasValidNodeVersion,
    hasValidJavaVersion,
    showConfirmation,
    checkForAndroidStudioAvailability,
    checkForGradleAvailability,
    hasValidExpoVersion,
    VERSIONS,
    canDoEmbed,
    canDoIosBuild,
    canDoAndroidBuild
};
// TODO: support for multiple react native versions.
