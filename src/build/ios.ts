import * as fs from 'fs-extra';
import path from 'path';
// import config from '../config';
import logger from '../utils/logger';
import plist from 'plist';
// import xcode from 'xcode';
import { exec } from '../utils/exec';
import { validateForIos } from '../utils/requirements';
import { readAndReplaceFileContent } from '../utils/utils';
import { newPostInstallBlock } from '../../templates/ios-build-patch/podFIlePostInstall';
const taskLogger = require('../custom-logger/task-logger').spinnerBar;
import { buildSteps } from '../utils/steps';
import { BaseBuild } from './base-build';

// Use require for modules without TypeScript definitions
const pparse = require('../mobileprovision-parse');
import { showConfirmation } from '../utils/utils';
import { BuildArgs } from '../types/cli-args';
import chalk from 'chalk';

interface ExportOptions {
  compileBitcode: boolean;
  provisioningProfiles: { [key: string]: string };
  signingCertificate: string;
  signingStyle: string;
  teamId: string;
  method: string;
  testFlightInternalTestingOnly: boolean;
  stripSwiftSymbols?: boolean;
}

interface ExportPListArgs {
  appId: string;
  provisioningProfile: string;
  teamId: string;
  packageType: string;
  codeSignIdentity: string;
  buildType: string;
}

interface IosBuildArgs {
  iCertificate: string;
  iCertificatePassword: string;
  iProvisioningFile: string;
  buildType: string;
  dest: string;
}

interface EmbedArgs {
  mp: string;
}

interface BuildResult {
  success: boolean;
  errors?: any;
  output?: string;
}

export class IosBuild extends BaseBuild {
  loggerLabel: string = 'Generating ipa file';

  constructor(args: BuildArgs) {
    super(args);
  }

  private async importCertToKeyChain(keychainName: string, certificate: string, certificatePassword: string): Promise<() => Promise<void>> {
    await exec('security', ['create-keychain', '-p', keychainName, keychainName], {log: false});
    await exec('security', ['unlock-keychain', '-p', keychainName, keychainName], {log: false});
    await exec('security', ['set-keychain-settings', '-t', '3600', keychainName], {log: false});
    let keychains = await exec('security', ['list-keychains', '-d', 'user'], {log: false});
    keychains = keychains.map((k: string) => k.replace(/[\"\s]+/g, '')).filter((k: string) => k !== '');
    await exec('security', ['list-keychains', '-d', 'user', '-s', keychainName, ...keychains], {log: false});
    await exec('security',
        ['import',
        certificate,
        '-k', keychainName,
        '-P', certificatePassword,
        '-T', '/usr/bin/codesign',
        '-T', '/usr/bin/productsign',
        '-T', '/usr/bin/productbuild',
        '-T', '/Applications/Xcode.app'], {log: false});
    await exec('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign', '-s', '-k', keychainName, keychainName], {log: false});
    logger.info({
        label: this.loggerLabel,
        message: `Cerificate at (${certificate}) imported in (${keychainName})`
    });
    let signingDetails = await exec('security', ['find-identity', '-v', '-p', 'codesigning'], {log: false});
    console.log(signingDetails);
    return async () => {
        keychains = keychains.map((k: string) => k.replace(/[\"\s]+/g, ''));
        await exec('security', ['list-keychains', '-d', 'user', '-s', ...keychains], {log: false});
        await this.deleteKeyChain(keychainName);
        logger.info({
            label: this.loggerLabel,
            message: `removed keychain (${keychainName}).`
        });
    };
  }

  private async deleteKeyChain(keychainName: string): Promise<void> {
    await exec('security', ['delete-keychain', keychainName]);
  }

  private async extractUUID(provisionalFile: string): Promise<string> {
    const content = await exec('grep', ['UUID', '-A1', '-a', provisionalFile], {log: false});
    return content.join('\n').match(/[-A-F0-9]{36}/i)![0];
  }
  private async getLoginKeyChainName(): Promise<string> {
    const content = await exec('security list-keychains | grep login.keychain', [], {
        shell: true
    });
    return content[0].substring(content[0].lastIndexOf('/') + 1, content[0].indexOf('-'));
  }

  private async extractTeamId(provisionalFile: string): Promise<string> {
    const content = await exec('grep', ['TeamIdentifier', '-A2', '-a', provisionalFile], {log: false});
    return content[2].match(/>[A-Z0-9]+/i)![0].substr(1);
  }

  private async getUsername(): Promise<string> {
    const content = await exec('id', ['-un'], false);
    return content[0];
  }

  private updateJSEnginePreference(): void {
    const jsEngine = require(this.config.src + 'app.json').expo.jsEngine;
    const podJSON = this.config.src + 'ios/Podfile.properties.json';
    if (fs.existsSync(podJSON)) {
        let data = require(podJSON);
        data['expo.jsEngine'] = jsEngine;
        fs.writeFileSync(podJSON, JSON.stringify(data, null, 4));
        logger.info({
            label: this.loggerLabel,
            message: `js engine is set as ${jsEngine}`
        });
    }
  }

  private addResourceFileToProject(iosProject: any, filePath: string, opt: any, group: string): any {
    const file = iosProject.addFile(filePath, group);
    file.uuid = iosProject.generateUuid();
    iosProject.addToPbxBuildFileSection(file);        // PBXBuildFile
    iosProject.addToPbxResourcesBuildPhase(file);     // PBXResourcesBuildPhase
    iosProject.addToPbxFileReferenceSection(file);    // PBXFileReference
    if (group) {
        if (iosProject.getPBXGroupByKey(group)) {
            iosProject.addToPbxGroup(file, group);        //Group other than Resources (i.e. 'splash')
        }
        else if (iosProject.getPBXVariantGroupByKey(group)) {
            iosProject.addToPbxVariantGroup(file, group);  // PBXVariantGroup
        }
    }
    return file;
  }

  public async embed(args: EmbedArgs): Promise<void> {
    const rnIosProject = this.config.src;
    const embedProject = `${rnIosProject}ios-embed`;
    fs.copySync(args.mp, embedProject);
    const rnModulePath = `${embedProject}/rnApp`;
    fs.removeSync(rnModulePath);
    fs.mkdirpSync(rnModulePath);
    fs.copyFileSync(`${__dirname}/../templates/embed/ios/ReactNativeView.swift`, `${rnModulePath}/ReactNativeView.swift`);
    fs.copyFileSync(`${__dirname}/../templates/embed/ios/ReactNativeView.h`, `${rnModulePath}/ReactNativeView.h`);
    fs.copyFileSync(`${__dirname}/../templates/embed/ios/ReactNativeView.m`, `${rnModulePath}/ReactNativeView.m`);
    const projectName = fs.readdirSync(`${this.config.src}ios-embed`)
    .find((f: string) => f.endsWith('xcodeproj'))!
    .split('.')[0];
            
    // xcode 16 issue https://github.com/CocoaPods/CocoaPods/issues/12456 - not required can be removed
    await readAndReplaceFileContent(`${embedProject}/${projectName}.xcodeproj/project.pbxproj`, (content: string) => {
        content = content.replace(/PBXFileSystemSynchronizedRootGroup/g, "PBXGroup");
        return content.replace(/objectVersion = 77/g, `objectVersion = 56`);
    });
    
    fs.copyFileSync(`${rnIosProject}/ios/Podfile`, `${rnIosProject}/ios-embed/Podfile`);
    await readAndReplaceFileContent(`${embedProject}/Podfile`, (content: string) => {
        return content.replace(/target .* do/g, `target '${projectName}' do`);
    });
    await readAndReplaceFileContent(
        `${rnIosProject}/app.js`,
        (content: string) => content.replace('props = props || {};', 'props = props || {};\n\tprops.landingPage = props.landingPage || props.pageName;'));
    await exec('npx', ['react-native', 'bundle', '--platform',  'ios',
            '--dev', 'false', '--entry-file', 'index.js',
            '--bundle-output', 'ios-embed/rnApp/main.jsbundle',
            '--assets-dest', 'ios-embed/rnApp'], {
        cwd: this.config.src
    });
    await exec('pod', ['install'], {
        cwd: embedProject
    });
    logger.info({
        label: this.loggerLabel,
        message: 'Changed Native Ios project.'
    });
  }

  public async invokeiosBuild(): Promise<BuildResult> {
    taskLogger.info("Invoke IOS build");
    const certificate = this.args.iCertificate;
    const certificatePassword = this.args.iCertificatePassword;
    const provisionalFile = this.args.iProvisioningFile;
    const buildType = this.args.buildType;
    const errors = validateForIos(certificate, certificatePassword, provisionalFile, buildType);
        if (errors.length > 0) {
            return {
                success: false,
                errors: errors
            };
        }
        this.updateJSEnginePreference();
        const random = Date.now();
        const username = await this.getUsername();
        const keychainName = `wm-reactnative-${random}.keychain`;
        const provisionuuid = await this.extractUUID(provisionalFile);
        const codeSignIdentityResult = await exec(`openssl pkcs12 -in ${certificate} -passin pass:${certificatePassword} -nodes | openssl x509 -noout -subject -nameopt multiline | grep commonName | sed -n 's/ *commonName *= //p'`, [], {
            shell: true
        });
        const codeSignIdentity = codeSignIdentityResult[1];
        logger.info({
            label: this.loggerLabel,
            message: `provisional UUID : ${provisionuuid}`
        });
        taskLogger.info(`provisional UUID : ${provisionuuid}`);
        const developmentTeamId = await this.extractTeamId(provisionalFile);
        logger.info({
            label: this.loggerLabel,
            message: `developmentTeamId : ${developmentTeamId}`
        });
        taskLogger.info(`developmentTeamId : ${developmentTeamId}`);
        const ppFolder = `/Users/${username}/Library/MobileDevice/Provisioning\\ Profiles`;
        fs.mkdirSync(ppFolder, {
            recursive: true
        });
        const targetProvisionsalPath = `${ppFolder}/${provisionuuid}.mobileprovision`;
        fs.copyFileSync(provisionalFile, targetProvisionsalPath);
        logger.info({
            label: this.loggerLabel,
            message: `copied provisionalFile (${provisionalFile}).`
        });
        taskLogger.info(`copied provisionalFile (${provisionalFile}).`);
        const removeKeyChain = await this.importCertToKeyChain(keychainName, certificate, certificatePassword);

        try {
            // XCode14 issue https://github.com/expo/expo/issues/19759
            // This is not required when expo 47 is used.
            await readAndReplaceFileContent(`${this.config.src}ios/Podfile`, (content: string) => {
                return content.replace('__apply_Xcode_12_5_M1_post_install_workaround(installer)', 
                '__apply_Xcode_12_5_M1_post_install_workaround(installer)' + '\n' +
                '    # Add these lines for Xcode 14 builds' + '\n' +
                '    installer.pods_project.targets.each do |target| ' +   '\n' +
                '       if target.respond_to?(:product_type) and target.product_type == "com.apple.product-type.bundle"' + '\n' +
                '           target.build_configurations.each do |this.config|'+ '\n' +
                '               this.config.build_settings[\'CODE_SIGNING_ALLOWED\'] = \'NO\'' + '\n' +
                '           end' + '\n' +
                '       end' + '\n' +
                '   end');
            });

            const appJsonPath = path.join(this.config.src, 'app.json');
            const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
            const buildPropertiesPlugin = appJson.expo.plugins && appJson.expo.plugins.find((plugin: any) => plugin[0] === 'expo-build-properties');

            if (buildPropertiesPlugin) {
                const iosConfig = buildPropertiesPlugin[1].ios;
                if (iosConfig && iosConfig.useFrameworks === 'static') {
                    await readAndReplaceFileContent(`${this.config.src}ios/Podfile`, (podfileContent: string) => {
                        const postInstallRegex = /^(\s*)post_install\s+do\s+\|installer\|[\s\S]*?^\1end$/m;
                        const modifiedPodContent = podfileContent.replace(postInstallRegex, newPostInstallBlock);
                        return modifiedPodContent;
                    });
                }
            }

            await exec('pod', ['install'], {cwd: this.config.src + 'ios'});
            return await this.xcodebuild(codeSignIdentity, provisionuuid, developmentTeamId);
        } catch (e: any) {
            console.error(e);
            return {
                errors: e,
                success: false
            };
        } finally {
            await removeKeyChain();
        }
  }

  private async getPackageType(provisionalFile: string): Promise<string> {
    const data = await pparse(provisionalFile);
    if (data.type === 'appstore') {
        return 'app-store';
    }
    if (data.type === 'inhouse') {
        return 'enterprise';
    } 
    if (data.type === 'adhoc') {
        return 'ad-hoc';
    }
    throw new Error('Not able find the type of provisioning file.');
  }

  private async createExportPList(projectPath: string, plistArgs: ExportPListArgs): Promise<string> {
    const exportOptions: ExportOptions = {
        compileBitcode: true,
        provisioningProfiles: { [plistArgs.appId]: String(plistArgs.provisioningProfile) },
        signingCertificate: plistArgs.codeSignIdentity,
        signingStyle: 'manual',
        teamId: plistArgs.teamId,
        method: plistArgs.packageType,
        testFlightInternalTestingOnly: false
    };
    
    if (this.args.buildType === 'development') {
        exportOptions.stripSwiftSymbols = false;
    } else {
        exportOptions.stripSwiftSymbols = true;
    }
    
    const exportOptionsPlist = plist.build(exportOptions as any);
    const exportOptionsPath = path.join(projectPath, 'exportOptions.plist');
    fs.writeFileSync(exportOptionsPath, exportOptionsPlist, 'utf-8');
    return 'success';
  }

  private removePushNotifications(projectDir: string, projectName: string): void {
    const dir = `${projectDir}ios/${projectName}/`;
    const entitlements = dir + fs.readdirSync(dir).find((f: string) => f.endsWith('entitlements'));
    const o = plist.parse(fs.readFileSync(entitlements!, 'utf8')) as Record<string, any>;
    delete o['aps-environment'];
    fs.writeFileSync(entitlements!, plist.build(o), 'utf8');
    logger.info({
        label: this.loggerLabel,
        message: `removed aps-environment from entitlements`
    });
  }

  private endWith(str: string, suffix: string): string {
    if (!str.endsWith(suffix)) {
        return str += suffix;
    }
    return str;
  }

  private findFile(dirPath: string, nameregex: RegExp): string {
    const files = fs.readdirSync(dirPath);
    const f = files.find(f => f.match(nameregex));
    return f ? this.endWith(dirPath, '/') + f : '';
  }

  private async xcodebuild(CODE_SIGN_IDENTITY_VAL: string, PROVISIONING_UUID: string, DEVELOPMENT_TEAM: string): Promise<BuildResult> {
    try {
        taskLogger.start(buildSteps[4].start);
        taskLogger.setTotal(buildSteps[4].total);
        let xcworkspacePath = this.findFile(this.config.src + 'ios', /\.xcworkspace?/) || this.findFile(this.config.src + 'ios', /\.xcodeproj?/);
        if (!xcworkspacePath) {
            return {
                errors: '.xcworkspace or .xcodeproj files are not found in ios directory',
                success: false
            };
        }
        
        const projectName = fs.readdirSync(`${this.config.src}ios`)
            .find((f: string) => f.endsWith('xcodeproj'))!
            .split('.')[0];
        const pathArr = xcworkspacePath.split('/');
        const xcworkspaceFileName = pathArr[pathArr.length - 1];
        const fileName = xcworkspaceFileName.split('.')[0];
        this.removePushNotifications(this.config.src, fileName);
        taskLogger.incrementProgress(0.4);
        
        let _buildType: string;
        if (this.args.buildType === 'development' || this.args.buildType === 'debug') {
            _buildType = 'Debug';
            // Instead of loading from metro server, load it from the bundle.
            await readAndReplaceFileContent(`${this.config.src}ios/${projectName}.xcodeproj/project.pbxproj`, (content: string) => {
                return content.replace('SKIP_BUNDLING=1', 'FORCE_BUNDLING=1');
            });
            await readAndReplaceFileContent(`${this.config.src}ios/${projectName}/AppDelegate.mm`, (content: string) => {
                return content.replace(
                    'return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];',
                    'return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];')
                    .replace(
                        'return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@".expo/.virtual-metro-entry"];',
                        'return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];');
            });
        } else {
            _buildType = 'Release';
        }
        
        const env = {
            RCT_NO_LAUNCH_PACKAGER: 1
        };
        taskLogger.incrementProgress(0.4);
        
        await exec('xcodebuild', [
            '-workspace', fileName + '.xcworkspace',
            '-scheme', fileName,
            '-configuration', _buildType,
            '-destination', 'generic/platform=iOS',
            '-archivePath', 'build/' + fileName + '.xcarchive', 
            'CODE_SIGN_IDENTITY=' + CODE_SIGN_IDENTITY_VAL,
            'PROVISIONING_PROFILE=' + PROVISIONING_UUID,
            'CODE_SIGN_STYLE=Manual',
            'archive'], {
            cwd: this.config.src + 'ios',
            env: env
        });
        
        let packageType = 'development';
        if (this.args.buildType === 'release') {
            packageType = await this.getPackageType(this.args.iProvisioningFile);
        }
        
        const status = await this.createExportPList(this.config.src + 'ios', {
            appId: this.config.metaData.id,
            provisioningProfile: PROVISIONING_UUID,
            teamId: DEVELOPMENT_TEAM,
            packageType: packageType,
            codeSignIdentity: CODE_SIGN_IDENTITY_VAL,
            buildType: this.args.buildType
        });

        if (status === 'success') {
            await exec('xcodebuild', [
                '-exportArchive',
                '-archivePath', 'build/' + fileName + '.xcarchive',
                '-exportOptionsPlist', './exportOptions.plist', 
                '-exportPath',
                'build'], {
                cwd: this.config.src + 'ios',
                env: env
            });
            
            const output = this.args.dest + 'output/ios/';
            const outputFilePath = `${output}${fileName}(${this.config.metaData.version}).${this.args.buildType}.ipa`;
            fs.mkdirSync(output, {recursive: true});
            fs.copyFileSync(this.findFile(`${this.args.dest}ios/build/`, /\.ipa?/), outputFilePath);
            taskLogger.succeed(buildSteps[4].succeed);
            
            return {
                success: true,
                output: outputFilePath
            };
        }
        
        return {
            success: false,
            errors: 'Failed to create export plist'
        };
    } catch (e: any) {
        logger.error({
            label: this.loggerLabel,
            message: e
        });
        taskLogger.fail(buildSteps[4].fail);
        console.error(e);
        return {
            errors: e,
            success: false
        };
    }
  }

  async build(platform: string = 'ios') {

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

    // TODO: iOS app showing blank screen
    if (!(this.config.metaData.sslPinning && this.config.metaData.sslPinning.enabled)) {
        await readAndReplaceFileContent(`${this.config.src}/App.js`, (content: string) => {
            return content.replace('if (isSslPinningAvailable()) {', 
                'if (false && isSslPinningAvailable()) {');
        });
    }

    this.config.outputDirectory = this.config.src + 'output/';
    this.config.logDirectory = this.config.outputDirectory + 'logs/';
    logger.info({
        label: this.loggerLabel,
        message: `Building at : ${this.config.src}`
    });
    
    taskLogger.info(`Building at : ${chalk.blue(this.config.src)}`);

    try {
        let result: BuildResult | undefined;

        try {
            taskLogger.start("Installing pods....")
            await exec('pod', ['install'], {
                cwd: this.config.src + 'ios'
            });
        } catch(e: any) {
            taskLogger.fail("Pod install failed");
        }
        result = await this.invokeiosBuild() as BuildResult;
        
        if (result?.errors && result?.errors.length) {
            logger.error({
                label: this.loggerLabel,
                message: 'IOS build failed due to: \n\t' + result.errors.join('\n\t')
            });
            taskLogger.fail('IOS build failed due to: \n\t' + result.errors.join('\n\t'));
        } else if (!result?.success) {
            logger.error({
                label: this.loggerLabel,
                message: 'IOS BUILD FAILED'
            });
            taskLogger.fail('IOS BUILD FAILED');
        } else {
            logger.info({
                label: this.loggerLabel,
                message: `IOS BUILD SUCCEEDED. check the file at : ${result?.output}.`
            });
            taskLogger.info(`IOS BUILD SUCCEEDED. check the file at : ${result?.output}.`);
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
            message: 'IOS BUILD Failed. Due to :' + e
        });
        taskLogger.fail('IOS BUILD Failed. Due to :' + e);
        return {
            success : false,
            errors: e
        };
    }
  }
}