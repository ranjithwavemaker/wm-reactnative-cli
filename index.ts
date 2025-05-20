#!/usr/bin/env node

import { Argv } from 'yargs';

declare global {
    var rootDir: string;
    var localStorage: Storage;
    var verbose: boolean;
    var logDirectory: string;
}

// import {
//     prepareProject,
//     ejectProject,
//     build,
//     embed
// } from './src/command';
import { prepareProject } from './src/build/base-build';

import os from 'os';
import { LocalStorage } from 'node-localstorage';
import { runAndroid, runIos, sync } from './src/preview/expo-mobile';
import { runESBuildWebPreview } from './src/preview/esbuild-web';
import { runExpoWebApp } from './src/preview/expo-web';
import updateNotifier from 'update-notifier';
import pkg from './package.json';
import { canDoAndroidBuild, canDoIosBuild, showConfirmation } from './src/utils/requirements';
import prompt from 'prompt';
import logger from './src/utils/logger';
import { calculateTotalSteps, buildSteps, previewSteps } from './src/utils/steps';
import { overallProgressBar } from './src/custom-logger/progress-bar';
import { spinnerBar } from './src/custom-logger/task-logger';
import type {
    BuildArgs,
    EjectArgs,
    EmbedArgs,
    WebArgs,
    SyncArgs
} from './src/types/cli-args';
import {AndroidBuild} from './src/build/android';
import {IosBuild} from './src/build/ios';
// Initialize update notifier
updateNotifier({
    pkg,
    updateCheckInterval: 60 * 60 * 1000
}).notify({
    defer: false
});
// Set global variables
global.rootDir = process.env.WM_REACTNATIVE_CLI || `${os.homedir()}/.wm-reactnative-cli`;
global.localStorage = new LocalStorage(`${global.rootDir}/.store`);

console.log("wavemaker react native cli version");

// Handle deprecated commands
async function handleDeprecatedCommands(args: WebArgs): Promise<void> {
    if (!args.previewUrl) {
        throw new Error('previewUrl is required');
    }
    const syncCommand = `wm-reactnative sync ${args.previewUrl} ${args.clean ? '--clean' : ''} ${args.useProxy ? '--useProxy' : ''}`;
    const response = await showConfirmation(
        `Would you like to execute ${syncCommand} (yes/no) ?`
    );
    if (response !== 'y' && response !== 'yes') {
        process.exit();
    }
    sync(args.previewUrl, args.clean ?? false, args.useProxy ?? false);
}

// Main command definitions
require('yargs')
    .command('build', 'build the project to generate android and ios folders', (yargs: Argv<BuildArgs>) => {
        yargs.command('android [src] [options]', 'build for android', (yargs: Argv<BuildArgs>) => {
            yargs.option('appId', {
                alias: 'appId',
                describe: 'unique application identifier',
                type: 'string'
            })
            .option('aks', {
                alias: 'aKeyStore',
                describe: '(Android) path to keystore',
                type: 'string'
            })
            .option('asp', {
                alias: 'aStorePassword',
                describe: '(Android) password to keystore',
                type: 'string'
            })
            .option('aka', {
                alias: 'aKeyAlias',
                describe: '(Android) Alias name',
                type: 'string'
            })
            .option('akp', {
                alias: 'aKeyPassword',
                describe: '(Android) password for key.',
                type: 'string'
            })
            .option('p', {
                alias: 'packageType',
                describe: 'apk (or) bundle',
                default: 'apk',
                choices: ['apk', 'bundle']
            })
            .option('architecture', {
                alias: 'arch',
                describe: 'Specify the target architectures for the build (e.g., armeabi-v7a, arm64-v8a, x86, x86_64)',
                type: 'array',
                choices: ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'],
            });
        }, (args: BuildArgs) => {
            args.platform = 'android';
            if (args.interactive) {
                overallProgressBar.enable();
            } else {
                overallProgressBar.disable();
            }
            global.verbose = args.verbose;
            const totalCount = calculateTotalSteps(buildSteps);
            overallProgressBar.setTotal(totalCount);
            const androidBuild = new AndroidBuild(args);
            androidBuild.build();
        })
        .command('ios [src] [options]', 'build for iOS', (yargs: Argv<BuildArgs>) => {
            yargs.option('ic', {
                alias: 'iCertificate',
                describe: '(iOS) path of p12 certificate to use',
                type: 'string'
            })
            .option('icp', {
                alias: 'iCertificatePassword',
                describe: '(iOS) password to unlock certificate',
                type: 'string'
            })
            .option('ipf', {
                alias: 'iProvisioningFile',
                describe: '(iOS) path of the provisional profile to use',
                type: 'string'
            });
        }, (args: BuildArgs) => {
            args.platform = 'ios';
            if (args.interactive) {
                overallProgressBar.enable();
            } else {
                overallProgressBar.disable();
            }
            global.verbose = args.verbose;
            const totalCount = calculateTotalSteps(buildSteps);
            overallProgressBar.setTotal(totalCount);
            const iosBuild = new IosBuild(args);
            iosBuild.build();        
        })
        .positional('src', {
            describe: 'path of rn project',
            default: './',
            type: 'string',
            normalize: true
        })
        .option('dest', {
            alias: 'dest',
            describe: 'dest folder where the react native project will be extracted to',
            type: 'string'
        })
        .option('bt', {
            alias: 'buildType',
            describe: 'development (or) debug (or) production (or) release',
            default: 'debug',
            coerce: (val: string) => {
                if (val === 'development') {
                    return 'debug';
                }
                if (val === 'production') {
                    return 'release';
                }
                return val;
            },
            choices: ['development', 'debug', 'production', 'release']
        })
        .option('localrnruntimepath', {
            alias: 'localrnruntimepath',
            describe: 'local path pointing to the app-rn-runtime folder',
            type: 'string'
        })
        .option('auto-eject', {
            alias: 'autoEject',
            describe: 'If set to true then project will be eject automatically without prompting any confirmations',
            default: false,
            type: 'boolean'
        })
        .option('verbose', {
            describe: 'If set to true, then detailed logs will be displayed.',
            default: false,
            type: 'boolean'
        })
        .option('interactive', {
            alias: 'i',
            describe: 'if set true, progress bar will show',
            default: false,
            type: 'boolean'
        });
    })
    .command('eject expo [src] [dest]', 'Removes Expo and generate pure react native project.', (yargs: Argv<EjectArgs>) => {
        yargs.positional('src', {
            describe: 'path of React Native project',
            default: './',
            type: 'string',
            normalize: true
        })
        .option('dest', {
            alias: 'dest',
            describe: 'dest folder where the react native project will be extracted to',
            type: 'string'
        });
    }, (args: EjectArgs) => {
        // ejectProject(args);
    })
    .command('prepare expo [src] [dest]', 'Prepare Expo and generate RN native project.', (yargs: Argv<EjectArgs>) => {
        yargs.positional('src', {
            describe: 'path of React Native project',
            default: './',
            type: 'string',
            normalize: true,
        })
        .option('dest', {
            alias: 'dest',
            describe: 'dest folder where the react native project will be extracted to',
            type: 'string',
        })
        .option('verbose', {
            describe: 'If set to true, then detailed logs will be displayed.',
            default: true,
            type: 'boolean'
        })
        .option('interactive', {
            alias: 'i',
            describe: 'if set true, progress bar will show',
            default: false,
            type: 'boolean'
        });
    }, async (args: EjectArgs) => {
        global.verbose = args.verbose;
        await prepareProject(args);
    })
    .command('embed', '', (yargs: Argv<EmbedArgs>) => {
        yargs.command('android [src]', 'Embed React Native project with Native Android project', () => {}, (args: EmbedArgs) => {
            args.platform = 'android';
            // return embed(args);
        })
        .command('ios [src]', 'Embed React Native project with Native iOS project.', () => {}, (args: EmbedArgs) => {
            args.platform = 'ios';
            // return embed(args);
        })
        .positional('src', {
            describe: 'path of React Native project',
            default: './',
            type: 'string',
            normalize: true
        })
        .option('dest', {
            alias: 'dest',
            describe: 'dest folder where the react native project will be extracted to',
            type: 'string'
        })
        .option('modulePath', {
            alias: 'mp',
            describe: 'path to the app module that needs to be embedded.',
            type: 'string',
            requiresArg: true
        });
    })
    .command('run', '', (yargs: Argv<WebArgs>) => {
        yargs.command('expo <previewUrl>', 'Embed React Native project with Native Android project', (yargs: Argv<WebArgs>) => {
            yargs.option('web', {
                describe: 'If set to true then web will be started.',
                default: false,
                type: 'boolean'
            });
        }, async (args: WebArgs) => {
            console.log(`Command run expo is no longer supported, instead use sync command`);
            await handleDeprecatedCommands(args);
        })
        .command('web-preview <previewUrl>', 'launches React Native app in web browser.', (yargs: Argv<WebArgs>) => {
            yargs.option('proxyHost', {
                describe: 'If provided, this will be used as the host name to the proxy server. By default, ip address is used as host name.'
            }).option('basePath', {
                describe: 'Base Path at which the web preview has to be server.',
                default: '/rn-bundle/',
            })
            .option('verbose', {
                describe: 'If set to true, then detailed logs will be displayed.',
                default: false,
                type: 'boolean'
            })
            .option('interactive', {
                alias: 'i',
                describe: 'if set true, progress bar will show',
                default: false,
                type: 'boolean'
            });
        }, (args: WebArgs) => {
            if (args.clean) {
                localStorage.clear();
            }
            if (args.interactive) {
                overallProgressBar.enable();
            } else {
                overallProgressBar.disable();
            }
            global.verbose = args.verbose;
            const totalCount = calculateTotalSteps(previewSteps);
            const splits = args.previewUrl?.split('#') ?? [];
            args.previewUrl = splits[0];
            const authToken = splits[1];
            if (args.esbuild) {
                overallProgressBar.setTotal(totalCount - previewSteps[4].total);
                runESBuildWebPreview(args.previewUrl, args.clean ?? false, authToken);
            } else {
                overallProgressBar.setTotal(totalCount);
                runExpoWebApp(args.previewUrl, args.clean ?? false, authToken, args.proxyHost, args.basePath);
            }
        })
        .command('android <previewUrl>', 'launches React Native app in a Android device.', () => {}, async (args: WebArgs) => {
            console.log(`Command run android is no longer supported, instead use sync command`);
            await handleDeprecatedCommands(args);
        })
        .command('ios <previewUrl>', 'launches React Native app in a iOS device.', () => {}, async (args: WebArgs) => {
            console.log(`Command run ios is no longer supported, instead use sync command`);
            await handleDeprecatedCommands(args);
        })
        .positional('previewUrl', {
            describe: 'Pereview Url of the React Native app.',
            type: 'string'
        })
        .option('clean', {
            describe: 'If set to true then all existing folders are removed.',
            default: false,
            type: 'boolean'
        });
    })
    .command('sync [previewUrl]', '', (yargs: Argv<SyncArgs>) => {
        yargs.positional('previewUrl', {
            describe: 'Pereview Url of the React Native app.',
            type: 'string'
        })
        .option('useProxy', {
            describe: 'If set to true then all preview requests are routed through a internal proxy server.',
            default: false,
            type: 'boolean'
        })
        .option('clean', {
            describe: 'If set to true then all existing folders are removed.',
            default: false,
            type: 'boolean'
        })
        .option('verbose', {
            describe: 'If set to true, then detailed logs will be displayed.',
            default: false,
            type: 'boolean'
        })
        .option('interactive', {
            alias: 'i',
            describe: 'if set true, progress bar will show',
            default: false,
            type: 'boolean'
        });
    }, (args: SyncArgs) => {
        if (args.clean) {
            localStorage.clear();
        }
        if (args.interactive) {
            overallProgressBar.enable();
        } else {
            overallProgressBar.disable();
        }
        global.verbose = args.verbose;
        let totalCount = calculateTotalSteps(previewSteps);
        if(!args.useProxy) {
            totalCount = totalCount - previewSteps[5].total;
        }
        overallProgressBar.setTotal(totalCount);
        if (!args.previewUrl) {
            throw new Error('previewUrl is required');
        }
        sync(args.previewUrl, args.clean ?? false, args.useProxy ?? false);
    })
    .help('h')
    .alias('h', 'help')
    .argv;