import { BaseBuild } from './base-build';
// import config from '../config';
import * as fs from 'fs-extra';
import logger from '../utils/logger';
import { exec } from '../utils/exec';
import { buildSteps } from '../utils/steps';
import { readAndReplaceFileContent } from '../utils/utils';
const taskLogger = require('../custom-logger/task-logger').spinnerBar;
import { checkForAndroidStudioAvailability, showConfirmation, validateForAndroid } from '../utils/requirements';
import path from 'path';
import { BuildResult } from './base-build';
import { BuildArgs } from '../types/cli-args';
import chalk from 'chalk';

export class AndroidBuild extends BaseBuild {
  public loggerLabel: string = 'android-build';

  constructor(args: BuildArgs) {
    super(args);
  }

  setKeyStoreValuesInGradleProps(content: string, keystoreName: string, ksData: any) {
    // TODO: if key pwds are changed, then just update the values.
    if(content.search(/MYAPP_UPLOAD_STORE_PASSWORD/gm) == -1) {
        return content.concat(` \n MYAPP_UPLOAD_STORE_FILE=${keystoreName}
        MYAPP_UPLOAD_KEY_ALIAS=${ksData.keyAlias}
        MYAPP_UPLOAD_STORE_PASSWORD=${ksData.storePassword}
        MYAPP_UPLOAD_KEY_PASSWORD=${ksData.keyPassword}`);
    }
    return content;
  }

  updateSigningConfig(content: string) {
    // TODO: replace one of the buildTypes to signingConfigs.release
    if(content.search(/if \(project.hasProperty\(\'MYAPP_UPLOAD_STORE_FILE\'\)\)/gm) == -1) {
        content = content.replace(/signingConfigs\.debug/g, 'signingConfigs.release');
        return content.replace(/signingConfigs \{/gm, `signingConfigs {
            release {
                if (project.hasProperty('MYAPP_UPLOAD_STORE_FILE')) {
                    storeFile file(MYAPP_UPLOAD_STORE_FILE)
                    storePassword MYAPP_UPLOAD_STORE_PASSWORD
                    keyAlias MYAPP_UPLOAD_KEY_ALIAS
                    keyPassword MYAPP_UPLOAD_KEY_PASSWORD
                }
            }`);
    }
    return content;
  }

  async generateAab(packageType: string) {
    try {
        // addKeepFileEntries();
        await exec('./gradlew', ['clean'], {
            cwd: this.config.src + 'android'
        });
        logger.info('****** invoking aab build *****');
        if (packageType === 'bundle') {
            await exec('./gradlew', [':app:bundleRelease'], {
                cwd: this.config.src + 'android'
            });
        } else {
            await exec('./gradlew', ['assembleRelease'], {
                cwd: this.config.src + 'android'
            });
        }
    }
    catch(e) {
        console.error('error generating release apk. ', e);
        return {
            success: false,
            errors: e
        }
    }
  }

  async generateSignedApk(keyStore: string, storePassword: string, keyAlias: string, keyPassword: string, packageType: string) {
    const ksData = {storePassword: storePassword, keyAlias: keyAlias, keyPassword: keyPassword};
    const namesArr = keyStore.split('/');
    const keystoreName = namesArr[namesArr.length - 1];
    const filepath = this.config.src + 'android/app/' + keystoreName;

    fs.copyFileSync(keyStore, filepath);

    // edit file android/gradle.properties
    const gradlePropsPath = this.config.src + 'android/gradle.properties';
    if (fs.existsSync(gradlePropsPath)) {
        let data = fs.readFileSync(gradlePropsPath, 'utf8');
        let content = await this.setKeyStoreValuesInGradleProps(data, keystoreName, ksData);
        fs.writeFileSync(gradlePropsPath, content);
    }

    const appGradlePath = this.config.src + 'android/app/build.gradle';
    let content = fs.readFileSync(appGradlePath, 'utf8');
    content = await this.updateSigningConfig(content);
    fs.writeFileSync(appGradlePath, content);
    await this.generateAab(packageType);
  }

  async validateAndroidPrerequisites(): Promise<boolean> {
    return await checkForAndroidStudioAvailability();
  }

  updateJSEnginePreference() {
    const jsEngine = require(this.config.src + 'app.json').expo.jsEngine;
    const gradlePropsPath = this.config.src + 'android/gradle.properties';
    if (fs.existsSync(gradlePropsPath)) {
        let data = fs.readFileSync(gradlePropsPath, 'utf8');
        data = data.replace(/expo\.jsEngine=(jsc|hermes)/, `expo.jsEngine=${jsEngine}`)
        fs.writeFileSync(gradlePropsPath, data);
        logger.info({
            label: this.loggerLabel,
            message: `js engine is set as ${jsEngine}`
        });
    }
  }

  updateSettingsGradleFile(appName: string) {
    const path = this.config.src + 'android/settings.gradle';
    let content = fs.readFileSync(path, 'utf8');
    if (content.search(/^rootProject.name = \'\'/gm) > -1) {
        content = content.replace(/^rootProject.name = \'\'/gm, `rootProject.name = ${appName}`);
        fs.writeFileSync(path, content);
    }
  }

  addProguardRule() {
    const proguardRulePath = this.config.src + 'android/app/proguard-rules.pro';
    if (fs.existsSync(proguardRulePath)) {
        var data = `-keep class com.facebook.react.turbomodule.** { *; }`;
        fs.appendFileSync(proguardRulePath,data, 'utf8');
        logger.info('***** added proguard rule ******')
    }
  }

  updateOptimizationFlags() {
    logger.info('***** into optimization ******')
    const buildGradlePath = this.config.src + 'android/app/build.gradle';
    if (fs.existsSync(buildGradlePath)) {
        let content = fs.readFileSync(buildGradlePath, 'utf8');
        if (content.search(`def enableProguardInReleaseBuilds = false`) > -1) {
            content = content.replace(/def enableProguardInReleaseBuilds = false/gm, `def enableProguardInReleaseBuilds = true`)
                .replace(/minifyEnabled enableProguardInReleaseBuilds/gm, `minifyEnabled enableProguardInReleaseBuilds\n shrinkResources false\n`);
        }
        content = content.replace(
            `shrinkResources (findProperty('android.enableShrinkResourcesInReleaseBuilds')?.toBoolean() ?: false)`,
            "shrinkResources true"
          )
          .replace(
            /minifyEnabled\s+\(?\s*(enableProguardInReleaseBuilds)\s*\)?/g,
            "minifyEnabled true\n    "
          );

        console.log(content);
        fs.writeFileSync(buildGradlePath, content);
    }
  }

  async createJSBundle() {
    fs.mkdirpSync(this.config.src + '/android/app/src/main/assets');
    return await exec('npx', ['react-native', 'bundle', '--platform',  'android',
            '--dev', 'false', '--entry-file', 'index.js',
            '--bundle-output', 'android/app/src/main/assets/index.android.bundle',
            '--assets-dest', 'android/app/src/main/res/'], {
        cwd: this.config.src
    });
  }

  async updateAndroidBuildGradleFile(type: string) {
    const buildGradlePath = this.config.src + 'android/app/build.gradle';
    if (fs.existsSync(buildGradlePath)) {
        let content = fs.readFileSync(buildGradlePath, 'utf8');
        if (type === 'release') {
            if (content.search(`entryFile: "index.js"`) === -1) {
                content = content.replace(/^(?!\s)project\.ext\.react = \[/gm, `project.ext.react = [
        entryFile: "index.js",
        bundleAssetName: "index.android.bundle",
        bundleInRelease: true,`);
            } else {
                content = content.replace(/bundleInDebug\: true/gm, `bundleInDebug: false,
        bundleInRelease: true,`).replace(/devDisabledInDebug\: true/gm, ``)
                    .replace(/bundleInRelease\: false/gm, `bundleInRelease: true`);
            }
        } else {
            if (content.search(`entryFile: "index.js"`) === -1 && content.search('project.ext.react =') >= 0) {
                content = content.replace(/^(?!\s)project\.ext\.react = \[/gm, `project.ext.react = [
        entryFile: "index.js",
        bundleAssetName: "index.android.bundle",
        bundleInDebug: true,
        devDisabledInDebug: true,`);
            } else if (content.indexOf(`bundleInDebug:`) >= 0) {
                content = content.replace(/bundleInDebug\: false/gm, `bundleInDebug: true`)
                    .replace(/devDisabledInDebug\: false/gm, `devDisabledInDebug: true`)
                    .replace(/bundleInRelease\: true/gm, `bundleInRelease: false`);
            } else {
                await this.createJSBundle();
            }
        }
        fs.writeFileSync(buildGradlePath, content);
    }
  }

  endWith(str: string, suffix: string) {
    if (!str.endsWith(suffix)) {
        return str += suffix;
    }
    return str;
  };
  
  findFile(path: string, nameregex: RegExp) {
    const files = fs.readdirSync(path);
    const f = files.find(f => f.match(nameregex));
    return this.endWith(path, '/') + f;
  }

  async invokeAndroidBuild() {
    taskLogger.start(buildSteps[4].start);
    taskLogger.setTotal(buildSteps[4].total);
    let keyStore, storePassword, keyAlias,keyPassword;

    if (this.args.buildType === 'debug' && !this.args.aKeyStore) {
        keyStore = __dirname + '/../defaults/android-debug.keystore';
        keyAlias = 'androiddebugkey';
        keyPassword = 'android';
        storePassword = 'android';
    } else {
        keyStore = this.args.aKeyStore,
        storePassword = this.args.aStorePassword,
        keyAlias = this.args.aKeyAlias,
        keyPassword = this.args.aKeyPassword
    }

    if (!await this.validateAndroidPrerequisites()) {
        return {
            success: false
        }
    }
    await readAndReplaceFileContent(
        `${this.args.dest}/App.js`,
        (content : string) => {
            return content + `
            // Remove cookies with no expiry time set
            (function() {
                try {
                    require('@react-native-cookies/cookies').removeSessionCookies();
                } catch(e) {
                    console.error(e);
                }
            }());
            `
        });    
    this.updateJSEnginePreference();
    const appName = this.config.metaData.name;
    this.updateSettingsGradleFile(appName);
    if (this.args.buildType === 'release') {
        const errors = validateForAndroid(keyStore, storePassword, keyAlias, keyPassword);
        if (errors.length > 0) {
            return {
                success: false,
                errors: errors
            }
        }
        this.addProguardRule();
        this.updateOptimizationFlags();
        this.updateAndroidBuildGradleFile(this.args.buildType);
        taskLogger.incrementProgress(1);
        await this.generateSignedApk(keyStore, storePassword, keyAlias, keyPassword, this.args.packageType);
        taskLogger.succeed(buildSteps[4].succeed);
    } else {
        await this.updateAndroidBuildGradleFile(this.args.buildType);
        logger.info({
            label: this.loggerLabel,
            message: 'Updated build.gradle file with debug configuration'
        });
        taskLogger.incrementProgress(0.5)
        try {
        await exec('./gradlew', ['assembleDebug'], {
            cwd: this.config.src + 'android'
        });
        taskLogger.incrementProgress(1.2)
        taskLogger.succeed(buildSteps[4].succeed);
    } catch(e) {
        console.error('error generating release apk. ', e);
        taskLogger.fail(buildSteps[4].fail);
        return {
            success: false,
            errors: e
        }
    }
    }
    logger.info({
        label: this.loggerLabel,
        message: 'build completed'
    });
    taskLogger.succeed('build completed')
    const output = this.args.dest + 'output/android/';
    const outputFilePath = `${output}${appName}(${this.config.metaData.version}).${this.args.buildType}.${this.args.packageType === 'bundle' ? 'aab': 'apk'}`;

    let bundlePath = null;
    let folder = this.args.buildType === 'release' ? 'release' : 'debug';
    if (this.args.packageType === 'bundle') {
        bundlePath = this.findFile(`${this.args.dest}android/app/build/outputs/bundle/${folder}`, /\.aab?/);
    } else {
        bundlePath = this.findFile(`${this.args.dest}android/app/build/outputs/apk/${folder}`, /\.apk?/);
    }
    fs.mkdirSync(output, {recursive: true});
    fs.copyFileSync(bundlePath, outputFilePath);
    return {
        success: true,
        output: outputFilePath
    };
  }
  
  async build(platform: string = 'android') {
    await this.setupConfig();
    this.config.platform = platform || this.args.platform;

    await this.prepareProject();

    if (!this.args.autoEject) {
      const response = await showConfirmation(
          'Would you like to eject the expo project (yes/no) ?'
      );
      if (response !== 'y' && response !== 'yes') {
          process.exit();
      }
    }

    let response;
    if (this.args.dest) {
        if (!this.config.metaData.ejected) {
            response = await this.ejectProject(this.args);
        }
    } else {
        response = await this.ejectProject(this.args);
    }

    if (response && response.errors) {
      return response;
    }

    if (this.args.ejectProject || this.config.embed)  {
        return;
    }

    if (this.args.dest) {
      this.config.src = this.args.dest;
    }

    if (!(this.config.metaData.sslPinning && this.config.metaData.sslPinning.enabled)) {
      await readAndReplaceFileContent(`${this.config.src}/App.js`, content => {
          return content.replace('if (isSslPinningAvailable()) {', 
              'if (false && isSslPinningAvailable()) {');
      });
    }

    if(this.args.architecture) {
        await readAndReplaceFileContent(`${this.config.src}/android/gradle.properties`, content => {
            return content.replace(/^reactNativeArchitectures=.*$/m,`reactNativeArchitectures=${this.args.architecture?.join(',')}`);
        })
    }

    this.config.outputDirectory = this.config.src + 'output/';
    this.config.logDirectory = this.config.outputDirectory + 'logs/';
    logger.info({
        label: this.loggerLabel,
        message: `Building at : ${this.config.src}`
    });
    
    taskLogger.info(`Building at : ${chalk.blue(this.config.src)}`);

    try {
      let result : BuildResult | undefined = await this.invokeAndroidBuild() as BuildResult;
      if (result?.errors && result?.errors.length) {
          logger.error({
              label: this.loggerLabel,
              message: 'Android build failed due to: \n\t' + result.errors.join('\n\t')
          });
          taskLogger.fail('Android build failed due to: \n\t' + result.errors.join('\n\t'));
      } else if (!result?.success) {
          logger.error({
              label: this.loggerLabel,
              message: 'Android BUILD FAILED'
          });
          taskLogger.fail('Android BUILD FAILED');
      } else {
          logger.info({
              label: this.loggerLabel,
              message: `Android BUILD SUCCEEDED. check the file at : ${result?.output}.`
          });
          taskLogger.info(`Android BUILD SUCCEEDED. check the file at : ${result?.output}.`);
          logger.info({
              label: this.loggerLabel,
              message: `File size : ${Math.round(this.getFileSize(result?.output || '') * 100 / (1024 * 1024)) / 100} MB.`
          });
          taskLogger.info(`File size : ${Math.round(this.getFileSize(result?.output || '') * 100 / (1024 * 1024)) / 100} MB.`);
      }
      return result;
    } catch(e: any) {
        logger.error({
            label: this.loggerLabel,
            message: 'Android BUILD Failed. Due to :' + e
        });
        taskLogger.fail('Android BUILD Failed. Due to :' + e);
        return {
            success : false,
            errors: e
        };
    }
  }
}